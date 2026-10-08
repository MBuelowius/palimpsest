import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
export class Marketplaces {
  readonly root: string;
  constructor(readonly library: SkillLibrary) {
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
    const repo = githubRepository(input),
      id = createHash("sha256")
        .update(repo.toLowerCase())
        .digest("hex")
        .slice(0, 16);
    const existing = this.list().find((s) => s.id === id);
    if (existing) return existing;
    fs.mkdirSync(this.root, { recursive: true });
    const directory = path.join(this.root, id + "-" + randomUUID());
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env))
      if (key.startsWith("GIT_")) delete env[key];
    Object.assign(env, {
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_LFS_SKIP_SMUDGE: "1",
    });
    try {
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
      const { stdout } = await run(
        "git",
        ["-C", directory, "rev-parse", "HEAD"],
        { env, timeout: 5000 },
      );
      const source = {
        id,
        repo,
        url: "https://github.com/" + repo,
        commit: stdout.trim(),
        addedAt: new Date().toISOString(),
      };
      // Another request may have registered this source while the clone was running.
      const sources = this.list(),
        duplicate = sources.find((s) => s.id === id);
      if (duplicate) return duplicate;
      if (fs.existsSync(path.join(this.root, id)))
        fs.renameSync(
          path.join(this.root, id),
          path.join(this.root, id + "-archive-" + randomUUID()),
        );
      fs.renameSync(directory, path.join(this.root, id));
      this.write([...sources, source]);
      return source;
    } catch (error) {
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
            id: createHash("sha256")
              .update(relative)
              .digest("hex")
              .slice(0, 16),
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
    );
  }
}
