import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isAlias, parseDocument, visit } from "yaml";
import {
  LibraryError,
  namePattern,
  SkillLibrary,
  tree,
  type PolicyStep,
  type Tool,
} from "./library.ts";
import { scanPackage } from "./scan.ts";
import {
  cloneRepository,
  fetchCommit,
  sourceId,
  githubRepository,
  Marketplaces,
} from "./marketplaces.ts";

export type SkillPolicy = {
  version: 1;
  sources: { github?: string[]; skillsMd: boolean };
  skills: { name: string; source: string; path: string; commit: string }[];
  blocked: string[];
};
export type StoredPolicy = {
  repo: string;
  commit: string;
  checkedAt: string;
  policy: SkillPolicy;
  warnings: string[];
};
export type PolicyDrift = {
  kind: "missing" | "version" | "name-taken" | "blocked" | "source";
  name?: string;
  repo?: string;
  reason: string;
};

type PolicyChange = {
  name: string;
  action: "install" | "update";
  repo: string;
  path: string;
  commit: string;
  hash: string;
  edited: boolean;
  scan: ReturnType<typeof scanPackage>;
};
const changed = () =>
  new LibraryError("The policy or your skills changed. Preview again.", 409);
const nameTaken = "Another skill uses this name. Palimpsest won't replace it.";

function invalid(problem: string): never {
  throw new LibraryError(
    "palimpsest-policy.yaml is not valid: " + problem + ".",
  );
}

export function parsePolicy(
  text: string,
): Pick<StoredPolicy, "policy" | "warnings"> {
  if (Buffer.byteLength(text) > 64 * 1024) invalid("file exceeds 64 KB");
  const doc = parseDocument(text);
  if (doc.errors.length)
    invalid(doc.errors[0].message.split("\n")[0].replace(/\.$/, ""));
  visit(doc, (_, node) => {
    if (isAlias(node)) invalid("aliases are not allowed");
  });
  const warnings: string[] = [];
  function mapping(value: unknown, key: string, known: string[]) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      invalid((key || "policy") + " must be a mapping");
    for (const name of Object.keys(value))
      if (!known.includes(name))
        warnings.push(
          "Ignored unknown setting: " + (key ? key + "." : "") + name,
        );
    return value as Record<string, unknown>;
  }
  function list(value: unknown, key: string): unknown[] {
    if (!Array.isArray(value)) invalid(key + " must be a list");
    return value;
  }
  function repository(value: unknown, key: string) {
    if (typeof value !== "string")
      invalid(key + " must be a GitHub repository");
    try {
      return githubRepository(value);
    } catch {
      invalid(key + " must be a GitHub repository");
    }
  }
  function folder(value: unknown, key: string) {
    if (
      typeof value !== "string" ||
      !namePattern.test(value) ||
      value === "synced"
    )
      invalid(key + " must be a valid skill folder name");
    return value;
  }
  const data = mapping(doc.toJS(), "", [
    "version",
    "sources",
    "skills",
    "blocked",
  ]);
  if (!Number.isInteger(data.version)) invalid("version must be an integer");
  if ((data.version as number) > 1)
    throw new LibraryError("This policy needs a newer version of Palimpsest.");
  if (data.version !== 1) invalid("version must be 1");
  const sources =
    data.sources === undefined
      ? {}
      : mapping(data.sources, "sources", ["github", "skillsMd"]);
  if (sources.skillsMd !== undefined && typeof sources.skillsMd !== "boolean")
    invalid("sources.skillsMd must be a boolean");
  const github =
    sources.github === undefined
      ? undefined
      : list(sources.github, "sources.github").map((repo, index) =>
          repository(repo, "sources.github." + index),
        );
  const blocked =
    data.blocked === undefined
      ? []
      : list(data.blocked, "blocked").map((name, index) =>
          folder(name, "blocked." + index),
        );
  const names = new Set<string>();
  const skills = (
    data.skills === undefined ? [] : list(data.skills, "skills")
  ).map((value, index) => {
    const key = "skills." + index,
      entry = mapping(value, key, ["source", "path", "commit"]),
      source = repository(entry.source, key + ".source"),
      relative = entry.path;
    if (
      typeof relative !== "string" ||
      !relative ||
      path.posix.isAbsolute(relative) ||
      path.win32.isAbsolute(relative) ||
      relative.includes("..") ||
      relative.includes("\\")
    )
      invalid(key + ".path must be a relative path without .. or backslashes");
    const name = folder(relative.split("/").at(-1), key + ".path");
    if (
      typeof entry.commit !== "string" ||
      !/^[0-9a-f]{40}$/.test(entry.commit)
    )
      invalid(key + ".commit must be a full 40-character lowercase hash");
    if (names.has(name)) invalid("duplicate skill name " + name);
    names.add(name);
    if (blocked.includes(name)) invalid(name + " is both required and blocked");
    if (
      github &&
      !github.some((repo) => repo.toLowerCase() === source.toLowerCase())
    )
      invalid(source + " is not in sources.github");
    return { name, source, path: relative, commit: entry.commit };
  });
  return {
    policy: {
      version: 1,
      sources: {
        ...(github === undefined ? {} : { github }),
        skillsMd: sources.skillsMd ?? true,
      },
      skills,
      blocked,
    },
    warnings,
  };
}

export class Policy {
  constructor(
    readonly library: SkillLibrary,
    private readonly clone = cloneRepository,
    private readonly fetch = fetchCommit,
  ) {}

  async connect(input?: string) {
    const previous = this.library.policy();
    if (!input && !previous)
      throw new LibraryError("Provide a policy repository to connect.");
    const repo = githubRepository(input ?? previous!.repo);
    if (previous && previous.repo.toLowerCase() !== repo.toLowerCase())
      throw new LibraryError(
        "Disconnect " + previous.repo + " before connecting another policy.",
        409,
      );
    const root = path.join(this.library.state, "policy");
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const directory = fs.mkdtempSync(path.join(root, "clone-"));
    try {
      const commit = await this.clone(repo, directory);
      let parsed: ReturnType<typeof parsePolicy>;
      try {
        const file = path.join(directory, "palimpsest-policy.yaml");
        let stat: fs.Stats;
        try {
          stat = fs.lstatSync(file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            invalid("file is missing");
          throw error;
        }
        if (!stat.isFile() || stat.isSymbolicLink())
          invalid("file must be a regular file, not a symlink");
        if (stat.size > 64 * 1024) invalid("file exceeds 64 KB");
        parsed = parsePolicy(fs.readFileSync(file, "utf8"));
      } catch (error) {
        if (previous && error instanceof LibraryError)
          throw new LibraryError(
            "Kept the previous policy. " + error.message,
            error.status,
          );
        throw error;
      }
      this.library.lock(() => {
        if (JSON.stringify(this.library.policy()) !== JSON.stringify(previous))
          throw new LibraryError(
            "Your skill policy changed during download. Connect again.",
            409,
          );
        this.library.json(path.join(this.library.state, "policy.json"), {
          repo,
          commit,
          checkedAt: new Date().toISOString(),
          ...parsed,
        });
      });
      return this.show();
    } catch (error) {
      if (error instanceof LibraryError) throw error;
      throw new LibraryError(
        "Could not download this public GitHub repository: " +
          (error as Error).message.split("\n")[0],
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  private snapshot(pin: SkillPolicy["skills"][number]) {
    return path.join(
      this.library.state,
      "policy",
      "snapshots",
      sourceId(pin.source) + "-" + pin.commit,
    );
  }

  async preview(tools: Tool[] = this.library.detectedTools()) {
    const stored = this.library.policy();
    if (!stored) throw new LibraryError("Connect a skill policy first.");
    for (const pin of stored.policy.skills) {
      const snapshot = this.snapshot(pin);
      if (fs.existsSync(snapshot)) continue;
      fs.mkdirSync(path.dirname(snapshot), { recursive: true, mode: 0o700 });
      const directory = fs.mkdtempSync(
        path.join(path.dirname(snapshot), "fetch-"),
      );
      try {
        await this.fetch(pin.source, pin.commit, directory);
        this.library.lock(() => {
          if (JSON.stringify(this.library.policy()) !== JSON.stringify(stored))
            throw changed();
          if (!fs.existsSync(snapshot)) fs.renameSync(directory, snapshot);
        });
      } catch (error) {
        if (error instanceof LibraryError) throw error;
        throw new LibraryError(
          "Could not download this public GitHub repository: " +
            (error as Error).message.split("\n")[0],
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
    if (JSON.stringify(this.library.policy()) !== JSON.stringify(stored))
      throw changed();
    return this.plan(tools).preview;
  }

  private plan(tools: Tool[]) {
    const stored = this.library.policy();
    if (!stored) throw changed();
    const skills = this.library.inventory().skills,
      origins = this.library.origins(),
      changes: PolicyChange[] = [],
      skipped: { name: string; reason: string }[] = [],
      steps: PolicyStep[] = [];
    for (const pin of stored.policy.skills) {
      const snapshot = this.snapshot(pin);
      if (!fs.existsSync(snapshot)) throw changed();
      try {
        const directory = path.join(snapshot, pin.path);
        for (const relative of [
          "",
          ...pin.path
            .split("/")
            .map((_, index, parts) => parts.slice(0, index + 1).join("/")),
          pin.path + "/SKILL.md",
        ]) {
          const file = path.join(snapshot, relative),
            stat = fs.lstatSync(file, { throwIfNoEntry: false });
          if (stat?.isSymbolicLink())
            throw new LibraryError(
              "Packages with symlinks cannot be installed.",
            );
          if (
            !stat ||
            (relative === pin.path + "/SKILL.md"
              ? !stat.isFile()
              : !stat.isDirectory())
          )
            throw new LibraryError(
              `No SKILL.md at ${pin.path} in ${pin.source} at ${pin.commit.slice(0, 7)}.`,
            );
        }
        const skill = skills.find((skill) => skill.name === pin.name),
          origin = origins[pin.name];
        if (
          skill &&
          (origin?.repo?.toLowerCase() !== pin.source.toLowerCase() ||
            origin.path !== pin.path)
        )
          throw new LibraryError(nameTaken);
        const shared = skill?.variants.find(
            (variant) => variant.tool === "shared",
          ),
          edited = !!skill && shared?.hash !== origin?.hash;
        if (
          skill &&
          skill.status === "shared" &&
          origin.commit === pin.commit &&
          !edited
        )
          continue;
        const packageTree = tree(directory),
          step: PolicyStep = {
            name: pin.name,
            action: skill ? "update" : "install",
            directory,
            hash: packageTree.hash,
            tools,
            origin: {
              source: sourceId(pin.source),
              repo: pin.source,
              path: pin.path,
              commit: pin.commit,
            },
          },
          staged = this.library.stagePolicy(step);
        changes.push({
          name: pin.name,
          action: step.action,
          repo: pin.source,
          path: pin.path,
          commit: pin.commit,
          hash: createHash("sha256")
            .update(
              JSON.stringify([
                stored.repo,
                stored.commit,
                stored.policy,
                tools,
                pin,
                packageTree.hash,
                skill?.revision,
                origin,
                staged.paths,
              ]),
            )
            .digest("hex"),
          edited,
          scan: scanPackage(directory, packageTree.files),
        });
        steps.push(step);
      } catch (error) {
        if (!(error instanceof LibraryError)) throw error;
        skipped.push({
          name: pin.name,
          reason: [
            "An existing directory uses this name.",
            "This skill already exists. Existing files were preserved.",
          ].includes(error.message)
            ? nameTaken
            : error.message,
        });
      }
    }
    return {
      preview: {
        repo: stored.repo,
        commit: stored.commit,
        tools,
        changes,
        skipped,
      },
      steps,
    };
  }

  apply(changes: { name: string; hash: string }[], tools: Tool[]) {
    return this.library.applyPolicy(() => {
      const plan = this.plan(tools);
      if (
        JSON.stringify(changes.map(({ name, hash }) => ({ name, hash }))) !==
        JSON.stringify(
          plan.preview.changes.map(({ name, hash }) => ({ name, hash })),
        )
      )
        throw changed();
      return plan.steps;
    });
  }

  show() {
    const stored = this.library.policy();
    return stored
      ? { ...stored, drift: this.drift() }
      : { connected: false as const };
  }

  disconnect() {
    return this.library.lock(() => {
      fs.rmSync(path.join(this.library.state, "policy.json"), { force: true });
      fs.rmSync(path.join(this.library.state, "policy"), {
        recursive: true,
        force: true,
      });
      return { connected: false as const };
    });
  }

  drift(): PolicyDrift[] {
    const stored = this.library.policy();
    if (!stored) return [];
    const { policy } = stored,
      skills = this.library.inventory().skills,
      origins = this.library.origins(),
      drift: PolicyDrift[] = [];
    for (const pin of policy.skills) {
      const skill = skills.find((skill) => skill.name === pin.name),
        origin = origins[pin.name];
      if (!skill)
        drift.push({
          kind: "missing",
          name: pin.name,
          reason: "Not installed.",
        });
      else if (
        origin?.repo?.toLowerCase() !== pin.source.toLowerCase() ||
        origin.path !== pin.path
      )
        drift.push({
          kind: "name-taken",
          name: pin.name,
          reason: "Another skill uses this name. Palimpsest won't replace it.",
        });
      else {
        const edited = skill.variants.some(
          (variant) => variant.hash !== origin.hash,
        );
        if (origin.commit !== pin.commit || edited)
          drift.push({
            kind: "version",
            name: pin.name,
            reason:
              "Not the pinned version." +
              (edited ? " Edited on this computer." : ""),
          });
      }
    }
    for (const skill of skills) {
      if (policy.blocked.includes(skill.name))
        drift.push({
          kind: "blocked",
          name: skill.name,
          reason: "Blocked by the policy. Turn it off in each app to match.",
        });
      const repo = origins[skill.name]?.repo;
      if (
        repo &&
        policy.sources.github &&
        !policy.sources.github.some(
          (allowed) => allowed.toLowerCase() === repo.toLowerCase(),
        )
      )
        drift.push({
          kind: "source",
          name: skill.name,
          repo,
          reason: "From a collection the policy doesn't allow.",
        });
    }
    for (const { repo } of new Marketplaces(this.library).list())
      if (
        policy.sources.github &&
        !policy.sources.github.some(
          (allowed) => allowed.toLowerCase() === repo.toLowerCase(),
        )
      )
        drift.push({
          kind: "source",
          repo,
          reason: "From a collection the policy doesn't allow.",
        });
    return drift;
  }
}
