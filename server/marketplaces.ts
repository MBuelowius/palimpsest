import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTwoFilesPatch } from "diff";
import { parseDocument } from "yaml";
import {
  LibraryError,
  SkillLibrary,
  metadata,
  tree,
  type Tool,
} from "./library.ts";

export type Marketplace = {
  id: string;
  repo: string;
  url: string;
  commit: string;
  addedAt: string;
  refreshedAt?: string;
};
export type CatalogueSkill = {
  id: string;
  name: string;
  path: string;
  description: string;
  issues: string[];
  // Frontmatter `license` text; licenseFile is a LICENSE or COPYING file in
  // the package, else at the repository root.
  license: string;
  licenseFile?: string;
  scripts: number;
  otherFiles: number;
  changedAt?: string;
  // The latest touch is the shallow snapshot's oldest commit, so the real
  // change may be older than changedAt.
  changedBefore?: boolean;
};
type Changes = Map<string, { date: string; before: boolean }>;
const run = promisify(execFile);
const CATALOGUE_VERSION = 1;
const licenseName = /^(licen[cs]e|copying)\b/i;
const scriptName =
  /\.(py|sh|bash|zsh|fish|js|mjs|cjs|ts|rb|pl|php|ps1|bat|cmd|lua)$/i;
const skipped = new Set([
  ".git",
  "node_modules",
  ".venv",
  "__pycache__",
  ".DS_Store",
]);
export function githubRepository(input: string) {
  const value = input
    .trim()
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  const match = value.match(
    /^(?:https:\/\/github\.com\/)?([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/,
  );
  if (!match || match[1].startsWith(".") || match[2].startsWith("."))
    throw new LibraryError(
      "Paste a public GitHub repository URL or owner/repository.",
    );
  return match[1] + "/" + match[2];
}
function gitEnv() {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("GIT_")) delete env[key];
  return Object.assign(env, {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_LFS_SKIP_SMUDGE: "1",
  });
}
async function cloneRepository(repo: string, directory: string) {
  const env = gitEnv();
  await run(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "clone",
      // ponytail: 300 commits of trees, no old blobs. Folders untouched in
      // that window get the oldest commit's date, marked as "on or before".
      "--depth",
      "300",
      "--filter=blob:none",
      "--no-recurse-submodules",
      "--template=",
      "--",
      "https://github.com/" + repo + ".git",
      directory,
    ],
    { env, timeout: 60000, maxBuffer: 1024 * 1024 },
  );
  const { stdout } = await run("git", ["-C", directory, "rev-parse", "HEAD"], {
    env,
    timeout: 5000,
  });
  return stdout.trim();
}
// One `git log` pass at download time: the latest commit date for every
// folder in the snapshot's history.
async function history(directory: string): Promise<Changes> {
  const changes: Changes = new Map();
  if (!fs.existsSync(path.join(directory, ".git"))) return changes;
  const shallow = path.join(directory, ".git", "shallow"),
    boundary = new Set(
      fs.existsSync(shallow)
        ? fs.readFileSync(shallow, "utf8").split("\n")
        : [],
    );
  // --no-renames: rename detection would fetch old blobs in a blobless clone.
  const { stdout } = await run(
    "git",
    [
      "-C",
      directory,
      "-c",
      "core.quotePath=false",
      "log",
      "--format=%x00%H %cI",
      "--name-only",
      "--no-renames",
    ],
    { env: gitEnv(), timeout: 30000, maxBuffer: 64 * 1024 * 1024 },
  );
  for (const commit of stdout.split("\0").slice(1)) {
    const [header, ...files] = commit.split("\n"),
      [hash, date] = header.split(" ");
    for (const file of files.filter(Boolean))
      // Setting a folder also sets its parents, so stop at the first one seen.
      for (let folder = path.posix.dirname(file); ;) {
        const key = folder === "." ? "" : folder;
        if (changes.has(key)) break;
        changes.set(key, { date, before: boundary.has(hash) });
        if (!key) break;
        folder = path.posix.dirname(folder);
      }
  }
  return changes;
}
function licenseFile(root: string, relative: string) {
  const name = fs
    .readdirSync(path.join(root, relative), { withFileTypes: true })
    .find((entry) => entry.isFile() && licenseName.test(entry.name))?.name;
  return name && path.posix.join(relative, name);
}
function frontmatterLicense(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/),
    doc = match && parseDocument(match[1]),
    value = doc && !doc.errors.length ? doc.toJS()?.license : undefined;
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}
function contents(directory: string) {
  let scripts = 0,
    otherFiles = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (skipped.has(entry.name) || entry.name.endsWith(".pyc")) continue;
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const inner = contents(location);
      scripts += inner.scripts;
      otherFiles += inner.otherFiles;
    } else if (
      entry.isFile() &&
      !/\.md$/i.test(entry.name) &&
      !licenseName.test(entry.name)
    ) {
      if (scriptName.test(entry.name) || fs.statSync(location).mode & 0o111)
        scripts++;
      else otherFiles++;
    }
  }
  return { scripts, otherFiles };
}
function scan(root: string, changes: Changes = new Map()) {
  const skills: CatalogueSkill[] = [],
    rootLicense = licenseFile(root, "");
  let files = 0;
  function visit(directory: string, depth: number) {
    if (depth > 10) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++files > 30000)
        throw new LibraryError("This repository is too large to browse.");
      if (
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        entry.name === ".system"
      )
        continue;
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(location, depth + 1);
      if (
        entry.isFile() &&
        entry.name === "SKILL.md" &&
        fs.statSync(location).size <= 1024 * 1024
      ) {
        const relative = path.relative(root, directory),
          content = fs.readFileSync(location, "utf8"),
          info = metadata(content),
          changed = changes.get(relative);
        skills.push({
          id: skillId(relative),
          name: path.basename(directory),
          path: relative,
          description: info.description,
          issues: info.issues,
          license: frontmatterLicense(content),
          licenseFile: licenseFile(root, relative) || rootLicense,
          ...contents(directory),
          changedAt: changed?.date,
          changedBefore: changed?.before,
        });
      }
    }
  }
  visit(root, 0);
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
const skillId = (relative: string) =>
  createHash("sha256").update(relative).digest("hex").slice(0, 16);
export class Marketplaces {
  readonly root: string;
  constructor(
    readonly library: SkillLibrary,
    private readonly clone = cloneRepository,
  ) {
    this.root = path.join(library.state, "marketplaces");
  }
  list(): Marketplace[] {
    const file = path.join(this.root, "sources.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  }
  private write(name: string, data: unknown) {
    fs.mkdirSync(this.root, { recursive: true });
    const temporary = path.join(this.root, randomUUID() + ".json");
    fs.writeFileSync(temporary, JSON.stringify(data));
    fs.renameSync(temporary, path.join(this.root, name));
  }
  private source(id: string) {
    const source = this.list().find((s) => s.id === id);
    if (!source) throw new LibraryError("Marketplace not found.", 404);
    return source;
  }
  async add(input: string) {
    return this.download(input);
  }
  async refresh(id: string) {
    return this.download(this.source(id).repo, true);
  }
  private async download(input: string, refresh = false) {
    const repo = githubRepository(input),
      id = createHash("sha256")
        .update(repo.toLowerCase())
        .digest("hex")
        .slice(0, 16);
    const existing = this.list().find((s) => s.id === id);
    if (existing && !refresh) return existing;
    fs.mkdirSync(this.root, { recursive: true });
    const directory = path.join(this.root, id + "-" + randomUUID());
    try {
      const commit = await this.clone(repo, directory),
        skills = scan(directory, await history(directory));
      const source = {
        id,
        repo,
        url: "https://github.com/" + repo,
        commit,
        addedAt: existing?.addedAt ?? new Date().toISOString(),
        refreshedAt: new Date().toISOString(),
      };
      // Another request may have registered this source while the clone was running.
      const sources = this.list(),
        duplicate = sources.find((s) => s.id === id);
      if (duplicate && !refresh) return duplicate;
      if (
        refresh &&
        (!duplicate ||
          duplicate.commit !== existing?.commit ||
          duplicate.refreshedAt !== existing?.refreshedAt)
      )
        throw new LibraryError(
          "This source changed during refresh. Retry from the marketplace page.",
          409,
        );
      const target = path.join(this.root, id);
      const archive = path.join(this.root, id + "-archive-" + randomUUID());
      const hadSnapshot = fs.existsSync(target);
      if (hadSnapshot) fs.renameSync(target, archive);
      try {
        fs.renameSync(directory, target);
        this.write(id + ".catalogue.json", {
          version: CATALOGUE_VERSION,
          commit,
          skills,
        });
        this.write(
          "sources.json",
          duplicate
            ? sources.map((s) => (s.id === id ? source : s))
            : [...sources, source],
        );
      } catch (error) {
        fs.rmSync(target, { recursive: true, force: true });
        if (hadSnapshot) fs.renameSync(archive, target);
        throw error;
      }
      if (hadSnapshot) fs.rmSync(archive, { recursive: true });
      return source;
    } catch (error) {
      if (error instanceof LibraryError) throw error;
      throw new LibraryError(
        "Could not download this public GitHub repository: " +
          (error as Error).message.split("\n")[0],
      );
    } finally {
      if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true });
    }
  }
  remove(id: string) {
    this.source(id);
    this.write(
      "sources.json",
      this.list().filter((s) => s.id !== id),
    );
  }
  // Downloads cache the catalogue per commit. Snapshots without a cache are
  // scanned on each call, without change dates.
  catalogue(id: string): CatalogueSkill[] {
    const source = this.source(id),
      file = path.join(this.root, id + ".catalogue.json");
    if (fs.existsSync(file)) {
      const cached = JSON.parse(fs.readFileSync(file, "utf8"));
      if (
        cached.version === CATALOGUE_VERSION &&
        cached.commit === source.commit
      )
        return cached.skills;
    }
    return scan(path.join(this.root, id));
  }
  preview(id: string, skillId: string) {
    const source = this.source(id),
      skill = this.catalogue(id).find((s) => s.id === skillId);
    if (!skill) throw new LibraryError("Skill not found.", 404);
    const directory = path.join(this.root, id, skill.path),
      packageTree = tree(directory);
    return {
      ...skill,
      source,
      content: fs.readFileSync(path.join(directory, "SKILL.md"), "utf8"),
      hash: packageTree.hash,
      files: packageTree.files,
      installable: !packageTree.links.length && !!skill.description,
    };
  }
  install(id: string, skillId: string, hash: string, tools: Tool[]) {
    const preview = this.preview(id, skillId);
    if (!preview.installable)
      throw new LibraryError(
        "This package cannot be installed. Check its metadata and symlinks.",
      );
    return this.library.installPackage(
      preview.name,
      path.join(this.root, id, preview.path),
      hash,
      tools,
      { source: id, path: preview.path },
    );
  }
  // Skills added from a collection, with whether the collection's current
  // snapshot differs from what was installed and whether the copy was edited.
  updates() {
    const sources = new Map(this.list().map((s) => [s.id, s.repo])),
      skills = this.library.inventory().skills;
    return Object.entries(this.library.origins()).flatMap(([name, origin]) => {
      const skill = skills.find((s) => s.name === name),
        shared = skill?.variants.find((v) => v.tool === "shared"),
        directory = path.join(this.root, origin.source, origin.path);
      if (!skill || !shared || !sources.has(origin.source)) return [];
      const upstream = fs.existsSync(path.join(directory, "SKILL.md"))
        ? tree(directory)
        : undefined;
      return [
        {
          name,
          source: origin.source,
          repo: sources.get(origin.source)!,
          skillId: skillId(origin.path),
          update:
            skill.status === "shared" &&
            !!upstream &&
            !upstream.links.length &&
            upstream.hash !== origin.hash,
          edited: shared.hash !== origin.hash,
          hash: upstream?.hash ?? origin.hash,
        },
      ];
    });
  }
  private pending(name: string) {
    const status = this.updates().find((u) => u.name === name && u.update);
    if (!status) throw new LibraryError("No update is available.", 404);
    const origin = this.library.origins()[name];
    return {
      status,
      origin,
      upstream: path.join(this.root, origin.source, origin.path),
      installed: this.library
        .skill(name)
        .variants.find((v) => v.tool === "shared")!.realPath,
    };
  }
  updatePreview(name: string) {
    const { status, origin, upstream, installed } = this.pending(name);
    const before = new Map(
        tree(installed).files.map((file) => [
          file,
          fs.readFileSync(path.join(installed, file)),
        ]),
      ),
      after = new Map(
        tree(upstream).files.map((file) => [
          file,
          fs.readFileSync(path.join(upstream, file)),
        ]),
      );
    const text = (bytes?: Buffer) =>
      !bytes
        ? ""
        : bytes.length > 200 * 1024 || bytes.includes(0)
          ? undefined
          : bytes.toString("utf8");
    const files = [...new Set([...before.keys(), ...after.keys()])]
      .sort()
      .filter((file) => {
        const old = before.get(file),
          next = after.get(file);
        return !old || !next || !old.equals(next);
      })
      .map((file) => {
        const old = text(before.get(file)),
          next = text(after.get(file));
        return {
          file,
          change: !before.has(file)
            ? ("added" as const)
            : !after.has(file)
              ? ("removed" as const)
              : ("changed" as const),
          patch:
            old === undefined || next === undefined
              ? ""
              : createTwoFilesPatch(file, file, old, next, "", "", {
                  context: 3,
                }),
        };
      });
    return {
      name,
      repo: this.source(origin.source).repo,
      edited: status.edited,
      hash: status.hash,
      files,
    };
  }
  update(name: string, hash: string) {
    return this.library.updatePackage(name, this.pending(name).upstream, hash);
  }
  applyUpdates(items: { name: string; hash: string }[]) {
    const updated: string[] = [],
      failed: { name: string; reason: string }[] = [];
    for (const { name, hash } of items) {
      try {
        this.update(name, hash);
        updated.push(name);
      } catch (error) {
        if (!(error instanceof LibraryError)) throw error;
        failed.push({ name, reason: error.message });
      }
    }
    return { updated, failed };
  }
}
