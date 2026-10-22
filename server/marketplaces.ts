import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTwoFilesPatch } from "diff";
import { scanPackage } from "./scan.ts";
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
};
const run = promisify(execFile);
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
async function cloneRepository(repo: string, directory: string) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("GIT_")) delete env[key];
  Object.assign(env, {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_LFS_SKIP_SMUDGE: "1",
  });
  await run(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "clone",
      "--depth",
      "1",
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
  private write(sources: Marketplace[]) {
    fs.mkdirSync(this.root, { recursive: true });
    const temporary = path.join(this.root, randomUUID() + ".json");
    fs.writeFileSync(temporary, JSON.stringify(sources));
    fs.renameSync(temporary, path.join(this.root, "sources.json"));
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
      const commit = await this.clone(repo, directory);
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
        this.write(
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
    this.write(this.list().filter((s) => s.id !== id));
  }
  catalogue(id: string): CatalogueSkill[] {
    this.source(id);
    const root = path.join(this.root, id),
      skills: CatalogueSkill[] = [];
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
            info = metadata(fs.readFileSync(location, "utf8"));
          skills.push({
            id: skillId(relative),
            name: path.basename(directory),
            path: relative,
            description: info.description,
            issues: info.issues,
          });
        }
      }
    }
    visit(root, 0);
    return skills.sort((a, b) => a.name.localeCompare(b.name));
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
      scan: scanPackage(directory, packageTree.files),
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
      {
        source: id,
        path: preview.path,
        repo: preview.source.repo,
        commit: preview.source.commit,
      },
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
      scan: scanPackage(upstream, [...after.keys()]),
    };
  }
  update(name: string, hash: string) {
    const { origin, upstream } = this.pending(name);
    const source = this.source(origin.source);
    return this.library.updatePackage(name, upstream, hash, {
      repo: source.repo,
      commit: source.commit,
    });
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
