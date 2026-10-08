import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { parseDocument } from "yaml";
import { createTwoFilesPatch } from "diff";

export type Tool = "claude" | "codex";
export type Variant = {
  id: string;
  tool: Tool | "shared";
  path: string;
  realPath: string;
  hash: string;
  linked: boolean;
  content: string;
  version: string;
  files: number;
  issues: string[];
};
export type Skill = {
  name: string;
  title: string;
  description: string;
  status: "shared" | "identical" | "conflict" | "local";
  revision: string;
  managed: boolean;
  variants: Variant[];
  issues: string[];
  tools: Tool[];
};
type Manifest = { schema: 1; skills: Record<string, { adoptedAt: string }> };
type Snapshot = { path: string; backup: string | null; after?: string };
export type Operation = {
  id: string;
  at: string;
  label: string;
  name: string;
  status: "pending" | "committed" | "restored" | "failed";
  snapshots: Snapshot[];
  manifestBefore: Manifest;
  manifestAfter?: string;
  error?: string;
};

export class LibraryError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const ignored = new Set([
  ".git",
  "node_modules",
  ".venv",
  "__pycache__",
  ".trash",
  ".DS_Store",
]);
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const present = (p: string) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};
const within = (root: string, p: string) =>
  p === root || p.startsWith(root + path.sep);
const namePattern = /^[a-z0-9][a-z0-9_-]{0,127}$/;

export function metadata(content: string) {
  const issues: string[] = [];
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match)
    return {
      title: "",
      description: "",
      version: "",
      issues: ["Missing YAML frontmatter."],
    };
  const doc = parseDocument(match[1]);
  if (doc.errors.length)
    return {
      title: "",
      description: "",
      version: "",
      issues: ["Invalid YAML: " + doc.errors[0].message.split("\n")[0]],
    };
  const data = doc.toJS();
  if (!data || typeof data !== "object" || Array.isArray(data))
    return {
      title: "",
      description: "",
      version: "",
      issues: ["Frontmatter must be a mapping."],
    };
  if (typeof data.description !== "string" || !data.description.trim())
    issues.push("Missing description.");
  if (typeof data.name !== "string")
    issues.push(
      "No name field; Claude can use the folder name, but Codex needs a name.",
    );
  if (
    data["allowed-tools"] ||
    data.context ||
    data.agent ||
    data["disable-model-invocation"] ||
    /!`/.test(content)
  )
    issues.push("Contains app-specific instructions; review before sharing.");
  return {
    title: typeof data.name === "string" ? data.name : "",
    description: typeof data.description === "string" ? data.description : "",
    version: String(data.metadata?.version ?? data.version ?? ""),
    issues,
  };
}

export function tree(root: string): {
  hash: string;
  files: string[];
  links: string[];
} {
  const hash = createHash("sha256"),
    files: string[] = [],
    links: string[] = [];
  function visit(dir: string, prefix = "") {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored.has(entry.name) || entry.name.endsWith(".pyc")) continue;
      const rel = prefix + entry.name,
        p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        hash.update("dir\0" + rel + "\0");
        visit(p, rel + "/");
      } else if (entry.isSymbolicLink()) {
        links.push(rel);
        hash.update("link\0" + rel + "\0" + fs.readlinkSync(p) + "\0");
      } else if (entry.isFile()) {
        files.push(rel);
        hash.update("file\0" + rel + "\0");
        hash.update(fs.readFileSync(p));
        hash.update("\0");
      } else throw new LibraryError("Unsupported file type: " + p);
    }
  }
  visit(root);
  return { hash: hash.digest("hex"), files, links };
}

function fingerprint(p: string): string {
  if (!present(p)) return "missing";
  const stat = fs.lstatSync(p);
  if (stat.isSymbolicLink()) return "link:" + fs.readlinkSync(p);
  if (stat.isDirectory()) return "dir:" + tree(p).hash;
  return "file:" + digest(fs.readFileSync(p));
}

export class SkillLibrary {
  readonly home: string;
  readonly shared: string;
  readonly state: string;
  readonly roots: { id: string; tool: Tool; path: string }[];
  constructor(home = os.homedir()) {
    this.home = fs.realpathSync(path.resolve(home));
    this.shared = path.join(this.home, ".harnesses-shared", "skills");
    this.state = path.join(
      this.home,
      ".local",
      "share",
      "skill-library",
      "state",
    );
    this.roots = [
      {
        id: "claude",
        tool: "claude",
        path: path.join(this.home, ".claude", "skills"),
      },
      {
        id: "codex",
        tool: "codex",
        path: path.join(this.home, ".codex", "skills"),
      },
      {
        id: "agents",
        tool: "codex",
        path: path.join(this.home, ".agents", "skills"),
      },
    ];
  }
  private manifest(): Manifest {
    const p = path.join(this.state, "manifest.json");
    return present(p)
      ? JSON.parse(fs.readFileSync(p, "utf8"))
      : { schema: 1, skills: {} };
  }
  private json(p: string, value: unknown) {
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
    const temp = p + "." + randomUUID() + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
    });
    fs.renameSync(temp, p);
  }
  inventory() {
    const map = new Map<string, Variant[]>(),
      scanIssues: string[] = [],
      manifest = this.manifest();
    const roots = [
      ...this.roots,
      { id: "shared", tool: "shared" as const, path: this.shared },
    ];
    for (const root of roots) {
      if (!present(root.path)) continue;
      for (const entry of fs.readdirSync(root.path, { withFileTypes: true })) {
        if (
          entry.name.startsWith(".") ||
          entry.name === "synced" ||
          (!entry.isDirectory() && !entry.isSymbolicLink())
        )
          continue;
        const p = path.join(root.path, entry.name);
        try {
          const real = fs.realpathSync(p),
            skillFile = path.join(real, "SKILL.md");
          if (!present(skillFile)) continue;
          const content = fs.readFileSync(skillFile, "utf8"),
            meta = metadata(content),
            result = tree(real);
          const variants = map.get(entry.name) ?? [];
          variants.push({
            id: root.id,
            tool: root.tool,
            path: p,
            realPath: real,
            hash: result.hash,
            linked: entry.isSymbolicLink(),
            content,
            version: meta.version,
            files: result.files.length,
            issues: [
              ...meta.issues,
              ...(result.links.length
                ? ["Contains nested symlinks; cannot relocate automatically."]
                : []),
            ],
          });
          map.set(entry.name, variants);
        } catch (error) {
          scanIssues.push(p + ": " + (error as Error).message);
        }
      }
    }
    const skills: Skill[] = [];
    for (const [name, variants] of map) {
      const meta = metadata(
        variants.find((v) => v.tool === "shared")?.content ??
          variants[0].content,
      );
      const hashes = new Set(variants.map((v) => v.hash)),
        realPaths = new Set(variants.map((v) => v.realPath));
      const tools = [
        ...new Set(
          variants
            .filter((v) => v.tool !== "shared")
            .map((v) => v.tool as Tool),
        ),
      ];
      const shared =
        variants.some((v) => v.tool === "shared") && realPaths.size === 1;
      skills.push({
        name,
        title: meta.title || name,
        description: meta.description,
        status:
          hashes.size > 1
            ? "conflict"
            : shared
              ? "shared"
              : tools.length > 1
                ? "identical"
                : "local",
        revision: digest(
          JSON.stringify(
            variants.map((v) => [v.id, v.path, v.realPath, v.hash, v.linked]),
          ),
        ),
        managed: !!manifest.skills[name],
        variants,
        issues: [...new Set(variants.flatMap((v) => v.issues))],
        tools,
      });
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return {
      skills,
      scanIssues,
      roots: this.roots,
      shared: this.shared,
      state: this.state,
      counts: {
        total: skills.length,
        shared: skills.filter((s) => s.status === "shared").length,
        conflicts: skills.filter((s) => s.status === "conflict").length,
        identical: skills.filter((s) => s.status === "identical").length,
      },
    };
  }
  skill(name: string, revision?: string) {
    if (!namePattern.test(name) || name === "synced")
      throw new LibraryError("Invalid skill folder name.");
    const skill = this.inventory().skills.find((s) => s.name === name);
    if (!skill) throw new LibraryError("Skill not found.", 404);
    if (revision && skill.revision !== revision)
      throw new LibraryError(
        "This skill changed on disk. Refresh and review the current version.",
        409,
      );
    return skill;
  }
  detail(name: string) {
    const skill = this.skill(name);
    const base = skill.variants[0];
    const fileHashes = (variant: Variant) =>
      new Map(
        tree(variant.realPath).files.map((file) => [
          file,
          digest(fs.readFileSync(path.join(variant.realPath, file))),
        ]),
      );
    const baseFiles = fileHashes(base);
    return {
      ...skill,
      packageDiffs: skill.variants.slice(1).map((variant) => {
        const other = fileHashes(variant);
        const files = [...new Set([...baseFiles.keys(), ...other.keys()])]
          .sort()
          .filter((file) => baseFiles.get(file) !== other.get(file))
          .map((file) => ({
            file,
            change: !baseFiles.has(file)
              ? "added"
              : !other.has(file)
                ? "removed"
                : "changed",
          }));
        return { from: base.id, to: variant.id, files };
      }),
      diffs: skill.variants.slice(1).map((v) => ({
        from: skill.variants[0].id,
        to: v.id,
        patch: createTwoFilesPatch(
          skill.variants[0].id,
          v.id,
          skill.variants[0].content,
          v.content,
          "",
          "",
          { context: 3 },
        ),
      })),
    };
  }
  private variant(skill: Skill, id: string) {
    const variant = skill.variants.find((v) => v.id === id);
    if (!variant) throw new LibraryError("Choose an existing version.");
    return variant;
  }
  plan(
    name: string,
    source: string,
    revision: string,
    tools: Tool[] = ["claude", "codex"],
  ) {
    const skill = this.skill(name, revision),
      chosen = this.variant(skill, source);
    this.validateTools(tools);
    if (tree(chosen.realPath).links.length)
      throw new LibraryError(
        "This package has nested symlinks. Keep it local until those references are made portable.",
      );
    const meta = metadata(chosen.content);
    if (
      meta.issues.some(
        (i) => i.startsWith("Invalid") || i.startsWith("Missing"),
      )
    )
      throw new LibraryError(
        "Fix the selected version’s YAML frontmatter and description before sharing.",
      );
    if (tools.includes("codex") && !meta.title)
      throw new LibraryError("Add a name field before sharing with Codex.");
    const canonical = path.join(this.shared, name);
    if (present(canonical) && fs.lstatSync(canonical).isSymbolicLink())
      throw new LibraryError(
        "The shared package is an external symlink. Keep it under its current owner.",
      );
    if (present(canonical) && !skill.variants.some((v) => v.path === canonical))
      throw new LibraryError(
        "An unrelated folder occupies the shared package location.",
        409,
      );
    const targets = tools.flatMap((tool) => {
      const existing = skill.variants.filter((v) => v.tool === tool);
      return existing.length
        ? existing.map((v) => v.path)
        : [
            path.join(
              this.roots.find(
                (r) => r.id === (tool === "codex" ? "agents" : "claude"),
              )!.path,
              name,
            ),
          ];
    });
    if (
      targets.some(
        (target) =>
          present(target) && !skill.variants.some((v) => v.path === target),
      )
    )
      throw new LibraryError(
        "An unrelated folder occupies an app location. It has been left untouched.",
        409,
      );
    return {
      name,
      source,
      revision,
      tools,
      canonical,
      targets,
      replaced: skill.variants
        .filter((v) => targets.includes(v.path) && v.hash !== chosen.hash)
        .map((v) => ({ tool: v.tool, path: v.path, version: v.version })),
      issues: chosen.issues,
      files: chosen.files,
      selectedHash: chosen.hash,
    };
  }
  private validateTools(tools: Tool[]) {
    if (
      !Array.isArray(tools) ||
      !tools.length ||
      tools.some((t) => t !== "claude" && t !== "codex") ||
      new Set(tools).size !== tools.length
    )
      throw new LibraryError("Choose Claude, Codex, or both.");
  }
  private lock<T>(run: () => T): T {
    fs.mkdirSync(this.state, { recursive: true, mode: 0o700 });
    const lock = path.join(this.state, "write-lock");
    try {
      fs.mkdirSync(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new LibraryError(
          "Another skill operation is running. Retry when it finishes.",
          409,
        );
      throw error;
    }
    try {
      return run();
    } finally {
      fs.rmdirSync(lock);
    }
  }
  private transaction(
    name: string,
    label: string,
    paths: string[],
    run: () => void,
  ) {
    const id =
      new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      randomUUID().slice(0, 8);
    const dir = path.join(this.state, "history", id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const record: Operation = {
      id,
      at: new Date().toISOString(),
      label,
      name,
      status: "pending",
      snapshots: [],
      manifestBefore: this.manifest(),
    };
    for (const [i, p] of [...new Set(paths)].entries()) {
      const backup = present(p) ? path.join(dir, String(i)) : null;
      if (backup)
        fs.cpSync(p, backup, {
          recursive: true,
          dereference: false,
          verbatimSymlinks: true,
        });
      record.snapshots.push({ path: p, backup });
    }
    this.json(path.join(dir, "operation.json"), record);
    try {
      run();
      for (const snapshot of record.snapshots)
        snapshot.after = fingerprint(snapshot.path);
      record.manifestAfter = digest(JSON.stringify(this.manifest()));
      record.status = "committed";
      this.json(path.join(dir, "operation.json"), record);
      return {
        operation: { id, label, at: record.at },
        skill: this.skill(name),
      };
    } catch (error) {
      this.restoreSnapshots(record);
      record.status = "failed";
      record.error = (error as Error).message;
      this.json(path.join(dir, "operation.json"), record);
      throw error;
    }
  }
  private restoreSnapshots(record: Operation) {
    for (const snapshot of record.snapshots.slice().reverse()) {
      fs.rmSync(snapshot.path, { recursive: true, force: true });
      if (snapshot.backup)
        fs.cpSync(snapshot.backup, snapshot.path, {
          recursive: true,
          dereference: false,
          verbatimSymlinks: true,
        });
    }
    this.json(path.join(this.state, "manifest.json"), record.manifestBefore);
  }
  share(
    name: string,
    source: string,
    revision: string,
    tools: Tool[] = ["claude", "codex"],
  ) {
    return this.lock(() => {
      const plan = this.plan(name, source, revision, tools);
      const chosen = this.variant(this.skill(name, revision), source);
      return this.transaction(
        name,
        "Share with " +
          tools.map((t) => (t === "claude" ? "Claude" : "Codex")).join(" and "),
        [plan.canonical, ...plan.targets],
        () => {
          if (chosen.realPath !== plan.canonical) {
            const staging = path.join(this.state, "stage-" + randomUUID());
            try {
              fs.cpSync(chosen.realPath, staging, {
                recursive: true,
                filter: (p) =>
                  !ignored.has(path.basename(p)) && !p.endsWith(".pyc"),
              });
              if (tree(staging).hash !== plan.selectedHash)
                throw new LibraryError(
                  "The source changed during sharing. Refresh and retry.",
                  409,
                );
              fs.mkdirSync(this.shared, { recursive: true });
              fs.rmSync(plan.canonical, { recursive: true, force: true });
              fs.renameSync(staging, plan.canonical);
            } finally {
              fs.rmSync(staging, { recursive: true, force: true });
            }
          }
          for (const target of plan.targets) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.rmSync(target, { recursive: true, force: true });
            fs.symlinkSync(plan.canonical, target, "dir");
          }
          const manifest = this.manifest();
          manifest.skills[name] = {
            adoptedAt:
              manifest.skills[name]?.adoptedAt ?? new Date().toISOString(),
          };
          this.json(path.join(this.state, "manifest.json"), manifest);
        },
      );
    });
  }
  setEnabled(name: string, tool: Tool, enabled: boolean, revision: string) {
    return this.lock(() => {
      this.validateTools([tool]);
      const skill = this.skill(name, revision),
        canonical = path.join(this.shared, name);
      if (!skill.managed || !present(canonical))
        throw new LibraryError(
          "Share this skill before changing its app availability.",
        );
      const bindings = skill.variants.filter((v) => v.tool === tool);
      if (bindings.some((v) => !v.linked || v.realPath !== canonical))
        throw new LibraryError(
          "This app has its own version. Review and share that version first.",
          409,
        );
      const targets = bindings.length
        ? bindings.map((v) => v.path)
        : [
            path.join(
              this.roots.find(
                (r) => r.id === (tool === "codex" ? "agents" : "claude"),
              )!.path,
              name,
            ),
          ];
      if (!bindings.length && targets.some((target) => present(target)))
        throw new LibraryError(
          "An unrelated folder occupies this app location. It has been left untouched.",
          409,
        );
      return this.transaction(
        name,
        (enabled ? "Enable in " : "Disable in ") + tool,
        targets,
        () => {
          for (const target of targets) {
            if (enabled && !present(target)) {
              fs.mkdirSync(path.dirname(target), { recursive: true });
              fs.symlinkSync(canonical, target, "dir");
            }
            if (!enabled && present(target)) fs.unlinkSync(target);
          }
        },
      );
    });
  }
  files(name: string, source: string) {
    const variant = this.variant(this.skill(name), source);
    return tree(variant.realPath).files;
  }
  private filePath(name: string, source: string, file: string) {
    if (
      !file ||
      file.includes("\0") ||
      path.isAbsolute(file) ||
      file.split(/[\\/]/).some((p) => p === ".." || ignored.has(p))
    )
      throw new LibraryError("Invalid file path.");
    const variant = this.variant(this.skill(name), source);
    const p = path.resolve(variant.realPath, file);
    if (!within(variant.realPath, p) || !present(p))
      throw new LibraryError("File not found.", 404);
    const real = fs.realpathSync(p);
    if (!within(variant.realPath, real) || !fs.statSync(real).isFile())
      throw new LibraryError("File must stay inside the skill package.");
    return { p: real, variant };
  }
  readFile(name: string, source: string, file: string) {
    const { p } = this.filePath(name, source, file),
      bytes = fs.readFileSync(p);
    if (bytes.length > 1024 * 1024 || bytes.includes(0))
      throw new LibraryError(
        "This is a binary or large file. Edit it in your usual editor.",
      );
    return { file, content: bytes.toString("utf8"), revision: digest(bytes) };
  }
  saveFile(
    name: string,
    source: string,
    file: string,
    content: string,
    revision: string,
  ) {
    return this.lock(() => {
      if (
        typeof content !== "string" ||
        Buffer.byteLength(content) > 1024 * 1024
      )
        throw new LibraryError("File exceeds the 1 MB editor limit.");
      const { p, variant } = this.filePath(name, source, file);
      const current = fs.readFileSync(p);
      if (digest(current) !== revision)
        throw new LibraryError(
          "This file changed on disk. Reload before saving.",
          409,
        );
      if (
        file === "SKILL.md" &&
        metadata(content).issues.some(
          (i) => i.startsWith("Invalid") || i.startsWith("Missing"),
        )
      )
        throw new LibraryError(
          "SKILL.md needs valid YAML frontmatter and a description.",
        );
      const canonical = path.join(this.shared, name),
        skill = this.skill(name);
      if (variant.realPath === canonical && !skill.managed)
        throw new LibraryError(
          "This shared package belongs to another installer. Adopt it before editing.",
        );
      return this.transaction(name, "Edit " + file, [variant.realPath], () => {
        const temp = p + "." + randomUUID() + ".tmp";
        fs.writeFileSync(temp, content, { mode: fs.statSync(p).mode });
        fs.renameSync(temp, p);
      });
    });
  }
  create(name: string, description: string, body: string, tools: Tool[]) {
    return this.lock(() => {
      if (!namePattern.test(name) || name === "synced")
        throw new LibraryError(
          "Use a lowercase folder name with letters, numbers, hyphens, or underscores.",
        );
      this.validateTools(tools);
      if (!description.trim() || description.length > 1024)
        throw new LibraryError("Add a description of 1–1024 characters.");
      if (this.inventory().skills.some((s) => s.name === name))
        throw new LibraryError(
          "A skill with this folder name already exists.",
          409,
        );
      const canonical = path.join(this.shared, name),
        targets = tools.map((tool) =>
          path.join(
            this.roots.find(
              (r) => r.id === (tool === "codex" ? "agents" : "claude"),
            )!.path,
            name,
          ),
        );
      if ([canonical, ...targets].some((p) => present(p)))
        throw new LibraryError("An existing directory uses this name.", 409);
      return this.transaction(
        name,
        "Create skill",
        [canonical, ...targets],
        () => {
          fs.mkdirSync(canonical, { recursive: true });
          fs.writeFileSync(
            path.join(canonical, "SKILL.md"),
            `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description.trim())}\n---\n\n${body.trim()}\n`,
          );
          for (const target of targets) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.symlinkSync(canonical, target, "dir");
          }
          const manifest = this.manifest();
          manifest.skills[name] = { adoptedAt: new Date().toISOString() };
          this.json(path.join(this.state, "manifest.json"), manifest);
        },
      );
    });
  }
  installPackage(name: string, directory: string, hash: string, tools: Tool[]) {
    return this.lock(() => {
      if (!namePattern.test(name) || name === "synced")
        throw new LibraryError("Invalid skill folder name.");
      this.validateTools(tools);
      const packageTree = tree(directory);
      if (packageTree.hash !== hash)
        throw new LibraryError("The package changed. Preview it again.", 409);
      if (packageTree.links.length)
        throw new LibraryError("Packages with symlinks cannot be installed.");
      const info = metadata(
        fs.readFileSync(path.join(directory, "SKILL.md"), "utf8"),
      );
      if (!info.description)
        throw new LibraryError("The package needs valid skill metadata.");
      if (this.inventory().skills.some((s) => s.name === name))
        throw new LibraryError(
          "This skill already exists. Existing files were preserved.",
          409,
        );
      const canonical = path.join(this.shared, name);
      const targets = tools.map((tool) =>
        path.join(
          this.roots.find(
            (r) => r.id === (tool === "codex" ? "agents" : "claude"),
          )!.path,
          name,
        ),
      );
      if ([canonical, ...targets].some((p) => present(p)))
        throw new LibraryError("An existing directory uses this name.", 409);
      return this.transaction(
        name,
        "Install marketplace skill",
        [canonical, ...targets],
        () => {
          fs.mkdirSync(path.dirname(canonical), { recursive: true });
          fs.cpSync(directory, canonical, {
            recursive: true,
            filter: (p) =>
              !ignored.has(path.basename(p)) && !p.endsWith(".pyc"),
          });
          for (const target of targets) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.symlinkSync(canonical, target, "dir");
          }
          const manifest = this.manifest();
          manifest.skills[name] = { adoptedAt: new Date().toISOString() };
          this.json(path.join(this.state, "manifest.json"), manifest);
        },
      );
    });
  }
  history() {
    const dir = path.join(this.state, "history");
    if (!present(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((id) => present(path.join(dir, id, "operation.json")))
      .map(
        (id) =>
          JSON.parse(
            fs.readFileSync(path.join(dir, id, "operation.json"), "utf8"),
          ) as Operation,
      )
      .sort((a, b) => b.at.localeCompare(a.at));
  }
  restore(id: string) {
    return this.lock(() => {
      const history = this.history(),
        record = history.find((o) => o.id === id);
      if (!record || record.status !== "committed")
        throw new LibraryError("Choose a completed operation to restore.");
      if (history.find((o) => o.status === "committed")?.id !== id)
        throw new LibraryError(
          "Restore the most recent operation first so later changes stay intact.",
          409,
        );
      if (
        record.snapshots.some((s) => fingerprint(s.path) !== s.after) ||
        digest(JSON.stringify(this.manifest())) !== record.manifestAfter
      )
        throw new LibraryError(
          "Files changed after this operation. The backup is preserved; automatic restore would overwrite those changes.",
          409,
        );
      this.restoreSnapshots(record);
      record.status = "restored";
      this.json(path.join(this.state, "history", id, "operation.json"), record);
      return { restored: id };
    });
  }
  shareIdentical(dryRun = true) {
    const candidates = this.inventory().skills.filter(
      (s) => s.status === "identical" && !s.issues.length,
    );
    if (dryRun)
      return {
        dryRun: true,
        skills: candidates.map((s) => ({
          name: s.name,
          source: s.variants[0].id,
          revision: s.revision,
        })),
      };
    return {
      dryRun: false,
      operations: candidates.map((s) => {
        const result = this.share(s.name, s.variants[0].id, s.revision);
        return { name: s.name, ...result.operation };
      }),
    };
  }
}
