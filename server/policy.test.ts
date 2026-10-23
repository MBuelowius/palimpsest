import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { stringify } from "yaml";
import { LibraryError, SkillLibrary, tree } from "./library.ts";
import { Marketplaces, sourceId } from "./marketplaces.ts";
import { parsePolicy, Policy } from "./policy.ts";

const commit = "9b1f0c2d3e4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c";
const nextCommit = "1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e";
const example = `version: 1
sources:
  github: [acme/agent-skills, anthropics/skills]
  skillsMd: false
skills:
  - source: acme/agent-skills
    path: review/code-review
    commit: ${commit}
  - source: anthropics/skills
    path: skills/pdf
    commit: ${nextCommit}
blocked: [web-scraper]
`;

function put(directory: string, name: string, body = "Instructions") {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill\n---\n${body}\n`,
  );
  return directory;
}

function fixture(t: TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "policy-test-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const library = new SkillLibrary(home),
    upstream = path.join(home, "policy-repo");
  fs.mkdirSync(upstream);
  let clones = 0;
  const policy = new Policy(library, async (repo, directory) => {
    assert.equal(repo.toLowerCase(), "team/policy");
    assert.equal(path.dirname(directory), path.join(library.state, "policy"));
    clones++;
    fs.cpSync(upstream, directory, { recursive: true, verbatimSymlinks: true });
    return commit;
  });
  async function connect(text: string) {
    fs.writeFileSync(path.join(upstream, "palimpsest-policy.yaml"), text);
    return policy.connect("team/policy");
  }
  return { home, library, upstream, policy, connect, clones: () => clones };
}

function refusal(message: string) {
  return (error: unknown) => {
    assert.ok(error instanceof LibraryError);
    assert.equal(error.status, 409);
    assert.equal(error.message, message);
    assert.ok(error.message.startsWith("Your skill policy"));
    return true;
  };
}

test("parse normalizes the design example and fills defaults", () => {
  assert.deepEqual(parsePolicy(example), {
    policy: {
      version: 1,
      sources: {
        github: ["acme/agent-skills", "anthropics/skills"],
        skillsMd: false,
      },
      skills: [
        {
          name: "code-review",
          source: "acme/agent-skills",
          path: "review/code-review",
          commit,
        },
        {
          name: "pdf",
          source: "anthropics/skills",
          path: "skills/pdf",
          commit: nextCommit,
        },
      ],
      blocked: ["web-scraper"],
    },
    warnings: [],
  });
  assert.deepEqual(parsePolicy("version: 1").policy, {
    version: 1,
    sources: { skillsMd: true },
    skills: [],
    blocked: [],
  });
  assert.deepEqual(
    parsePolicy("version: 1\nsources: {github: []}").policy.sources.github,
    [],
  );
  assert.equal(
    parsePolicy(example.replace("acme/agent-skills,", "ACME/AGENT-SKILLS,"))
      .policy.skills[0].name,
    "code-review",
  );
});

test("unknown keys warn at every schema level", () => {
  const data = {
    version: 1,
    note: "Description",
    sources: { github: ["owner/repo"], other: true },
    skills: [
      { source: "owner/repo", path: "skills/sample", commit, optional: true },
    ],
  };
  assert.deepEqual(parsePolicy(stringify(data)).warnings, [
    "Ignored unknown setting: note",
    "Ignored unknown setting: sources.other",
    "Ignored unknown setting: skills.0.optional",
  ]);
});

test("newer policies require a newer client", () => {
  assert.throws(() => parsePolicy("version: 2"), {
    message: "This policy needs a newer version of Palimpsest.",
  });
});

test("invalid policy values are rejected", async (t) => {
  const pin = { source: "owner/repo", path: "skills/sample", commit };
  const cases: [string, unknown][] = [
    ["missing version", {}],
    ["non-integer version", { version: 1.5 }],
    ["old version", { version: 0 }],
    ["not a mapping", []],
    ["invalid sources", { version: 1, sources: [] }],
    ["invalid GitHub list", { version: 1, sources: { github: "owner/repo" } }],
    [
      "invalid GitHub entry",
      { version: 1, sources: { github: ["gitlab.com/owner/repo"] } },
    ],
    ["invalid skillsMd", { version: 1, sources: { skillsMd: "false" } }],
    ["invalid skills", { version: 1, skills: {} }],
    ["invalid source", { version: 1, skills: [{ ...pin, source: "bad" }] }],
    ["short commit", { version: 1, skills: [{ ...pin, commit: "abc1234" }] }],
    [
      "uppercase commit",
      { version: 1, skills: [{ ...pin, commit: commit.toUpperCase() }] },
    ],
    ...[
      "",
      "/skills/sample",
      "../sample",
      "skills/../sample",
      "skills\\sample",
      "C:/skills/sample",
      "skills/Bad Name",
      "skills/synced",
    ].map((relative): [string, unknown] => [
      "path " + relative,
      { version: 1, skills: [{ ...pin, path: relative }] },
    ]),
    [
      "duplicate name",
      { version: 1, skills: [pin, { ...pin, path: "other/sample" }] },
    ],
    [
      "required and blocked",
      { version: 1, skills: [pin], blocked: ["sample"] },
    ],
    [
      "disallowed skill source",
      { version: 1, sources: { github: [] }, skills: [pin] },
    ],
    ["invalid blocked", { version: 1, blocked: ["Bad Name"] }],
  ];
  for (const [name, data] of cases)
    await t.test(name, () =>
      assert.throws(
        () => parsePolicy(stringify(data)),
        /^Error: palimpsest-policy.yaml is not valid: .+\.$/,
      ),
    );
  for (const text of [
    "version: [",
    "version: 1\nversion: 1",
    "version: 1\nnote: &anchor foo\nother: *anchor",
    "version: 1\n#" + "a".repeat(65536),
  ])
    assert.throws(
      () => parsePolicy(text),
      /palimpsest-policy.yaml is not valid:/,
    );
});

test("connect rejects missing, symlinked, non-file and oversized files", async (t) => {
  for (const kind of ["missing", "symlink", "directory", "oversized"])
    await t.test(kind, async (t) => {
      const f = fixture(t),
        file = path.join(f.upstream, "palimpsest-policy.yaml");
      if (kind === "symlink") {
        fs.writeFileSync(path.join(f.upstream, "target.yaml"), "version: 1");
        fs.symlinkSync("target.yaml", file);
      }
      if (kind === "directory") fs.mkdirSync(file);
      if (kind === "oversized")
        fs.writeFileSync(file, "version: 1\n#" + "a".repeat(65536));
      await assert.rejects(
        f.policy.connect("team/policy"),
        /palimpsest-policy.yaml is not valid:/,
      );
      assert.equal(f.library.policy(), undefined);
      assert.deepEqual(
        fs.readdirSync(path.join(f.library.state, "policy")),
        [],
      );
    });
});

test("connect, offline show, manual refresh and disconnect preserve installed skills and backups", async (t) => {
  const f = fixture(t);
  f.library.create("local", "Test skill", "Local instructions", ["claude"]);
  const before = f.library.skill("local"),
    history = f.library.history();
  fs.writeFileSync(path.join(f.upstream, "do-not-run.sh"), "exit 99\n");
  await f.connect(example);
  assert.equal(f.clones(), 1);
  const stored = f.library.policy()!;
  assert.equal(stored.repo, "team/policy");
  assert.equal(stored.commit, commit);
  assert.ok(Number.isFinite(Date.parse(stored.checkedAt)));
  assert.deepEqual(
    new Policy(new SkillLibrary(f.home), async () => {
      throw new Error("Must stay offline");
    }).show(),
    { ...stored, drift: f.policy.drift() },
  );
  assert.equal(f.clones(), 1);
  await assert.rejects(
    f.policy.connect("other/policy"),
    /Disconnect team\/policy before connecting another policy\./,
  );
  assert.equal(f.clones(), 1);
  await f.policy.connect();
  assert.equal(f.clones(), 2);
  fs.writeFileSync(
    path.join(f.upstream, "palimpsest-policy.yaml"),
    "version: 1\nblocked: [local]",
  );
  await f.policy.connect("https://github.com/TEAM/POLICY.git");
  assert.equal(f.clones(), 3);
  assert.deepEqual(f.library.skill("local"), before);
  assert.ok(
    f.policy
      .drift()
      .some((item) => item.kind === "blocked" && item.name === "local"),
  );
  assert.deepEqual(f.policy.disconnect(), { connected: false });
  assert.equal(fs.existsSync(path.join(f.library.state, "policy")), false);
  assert.equal(fs.existsSync(path.join(f.library.state, "policy.json")), false);
  assert.deepEqual(f.library.skill("local"), before);
  assert.deepEqual(f.library.history(), history);
  assert.deepEqual(f.policy.show(), { connected: false });
  assert.deepEqual(f.policy.drift(), []);
  await assert.rejects(f.policy.connect(), /Provide a policy repository/);
});

test("invalid refresh keeps the exact stored policy", async (t) => {
  const f = fixture(t);
  await f.connect(example);
  const file = path.join(f.library.state, "policy.json"),
    previous = fs.readFileSync(file, "utf8");
  await assert.rejects(
    f.connect("version: 1\nblocked: wrong"),
    /^Error: Kept the previous policy\. palimpsest-policy.yaml is not valid:/,
  );
  assert.equal(fs.readFileSync(file, "utf8"), previous);
  await assert.rejects(
    f.connect("version: 2"),
    /Kept the previous policy\. This policy needs a newer version/,
  );
  assert.equal(fs.readFileSync(file, "utf8"), previous);
});

test("a download cannot replace a policy changed while it was running", async (t) => {
  const f = fixture(t);
  await f.connect("version: 1");
  const racing = new Policy(f.library, async (_repo, directory) => {
    fs.writeFileSync(path.join(directory, "palimpsest-policy.yaml"), example);
    await f.connect("version: 1\nblocked: [local]");
    return nextCommit;
  });
  await assert.rejects(
    racing.connect(),
    refusal("Your skill policy changed during download. Connect again."),
  );
  assert.deepEqual(f.library.policy()!.policy.blocked, ["local"]);
});

test("collection add and refresh refuse disallowed repos before cloning", async (t) => {
  const f = fixture(t);
  let clones = 0;
  const marketplaces = new Marketplaces(f.library, async (_repo, directory) => {
    clones++;
    fs.mkdirSync(directory, { recursive: true });
    return commit;
  });
  const source = await marketplaces.add("other/skills");
  await f.connect("version: 1\nsources: {github: [acme/agent-skills]}");
  const denied = refusal(
    "Your skill policy doesn't allow the collection other/skills. Allowed: acme/agent-skills.",
  );
  await assert.rejects(marketplaces.add("other/skills"), denied);
  await assert.rejects(marketplaces.refresh(source.id), denied);
  assert.equal(clones, 1);
  await marketplaces.add("ACME/AGENT-SKILLS");
  assert.equal(clones, 2);
  await f.connect("version: 1\nsources: {github: []}");
  await assert.rejects(
    marketplaces.add("acme/agent-skills"),
    refusal("Your skill policy doesn't allow GitHub collections."),
  );
  assert.equal(clones, 2);
});

test("a policy change during a collection clone prevents registration", async (t) => {
  const f = fixture(t);
  const marketplaces = new Marketplaces(f.library, async (_repo, directory) => {
    fs.mkdirSync(directory, { recursive: true });
    await f.connect("version: 1\nsources: {github: []}");
    return commit;
  });
  await assert.rejects(
    marketplaces.add("owner/repo"),
    refusal("Your skill policy doesn't allow GitHub collections."),
  );
  assert.deepEqual(marketplaces.list(), []);
});

test("install checks blocked names, collection allowlist and every pin field", async (t) => {
  const f = fixture(t),
    directory = put(path.join(f.home, "package"), "code-review");
  const hash = tree(directory).hash,
    origin = {
      source: sourceId("acme/agent-skills"),
      repo: "acme/agent-skills",
      path: "review/code-review",
      commit,
    };
  await f.connect(example);
  assert.throws(
    () =>
      f.library.installPackage(
        "web-scraper",
        directory,
        hash,
        ["claude"],
        origin,
      ),
    refusal("Your skill policy blocks web-scraper."),
  );
  assert.throws(
    () =>
      f.library.installPackage("other", directory, hash, ["claude"], {
        ...origin,
        repo: "other/skills",
      }),
    refusal(
      "Your skill policy doesn't allow the collection other/skills. Allowed: acme/agent-skills, anthropics/skills.",
    ),
  );
  const pinned = refusal(
    `Your skill policy pins code-review to ${commit.slice(0, 7)} from acme/agent-skills. Apply the policy to install that version.`,
  );
  for (const mismatch of [
    undefined,
    { ...origin, commit: nextCommit },
    { ...origin, repo: "anthropics/skills" },
    { ...origin, path: "other/code-review" },
  ])
    assert.throws(
      () =>
        f.library.installPackage(
          "code-review",
          directory,
          hash,
          ["claude"],
          mismatch,
        ),
      pinned,
    );
  assert.equal(f.library.history().length, 0);
  f.library.installPackage("code-review", directory, hash, ["claude"], {
    ...origin,
    repo: "ACME/AGENT-SKILLS",
  });
  assert.equal(f.library.skill("code-review").status, "shared");
  assert.equal(f.library.origins()["code-review"].commit, commit);
});

test("marketplace install and update enforce policy even when updates are hidden", async (t) => {
  const f = fixture(t);
  let current = commit;
  const marketplaces = new Marketplaces(f.library, async (_repo, directory) => {
    for (const name of ["sample", "blocked", "normal"])
      put(path.join(directory, "skills", name), name, current);
    return current;
  });
  const source = await marketplaces.add("owner/repo");
  for (const skill of marketplaces.catalogue(source.id))
    marketplaces.install(
      source.id,
      skill.id,
      marketplaces.preview(source.id, skill.id).hash,
      ["claude"],
    );
  current = nextCommit;
  await marketplaces.refresh(source.id);
  assert.ok(marketplaces.updates().every((status) => status.update));
  const hashes = marketplaces
    .updates()
    .map(({ name, hash }) => ({ name, hash }));
  await f.connect(
    stringify({
      version: 1,
      skills: [{ source: "owner/repo", path: "skills/sample", commit }],
      blocked: ["blocked"],
    }),
  );
  assert.deepEqual(
    marketplaces
      .updates()
      .map(({ name, update }) => [name, update])
      .sort(),
    [
      ["blocked", false],
      ["normal", true],
      ["sample", false],
    ],
  );
  assert.throws(
    () =>
      marketplaces.update(
        "blocked",
        hashes.find((item) => item.name === "blocked")!.hash,
      ),
    refusal("Your skill policy blocks blocked."),
  );
  assert.throws(
    () =>
      marketplaces.update(
        "sample",
        hashes.find((item) => item.name === "sample")!.hash,
      ),
    refusal(
      `Your skill policy pins sample to ${commit.slice(0, 7)} from owner/repo. Apply the policy to install that version.`,
    ),
  );
  const result = marketplaces.applyUpdates(hashes);
  assert.deepEqual(result.updated, ["normal"]);
  assert.deepEqual(result.failed.map((item) => item.name).sort(), [
    "blocked",
    "sample",
  ]);
  assert.equal(f.library.origins().blocked.commit, commit);
  await f.connect(
    stringify({
      version: 1,
      skills: [
        { source: "owner/repo", path: "skills/sample", commit: nextCommit },
      ],
    }),
  );
  marketplaces.update(
    "sample",
    hashes.find((item) => item.name === "sample")!.hash,
  );
  assert.equal(f.library.origins().sample.commit, nextCommit);
  const fresh = fixture(t);
  await fresh.connect("version: 1\nblocked: [blocked]");
  const blockedMarket = new Marketplaces(
    fresh.library,
    async (_repo, directory) => {
      put(path.join(directory, "blocked"), "blocked");
      return commit;
    },
  );
  const blockedSource = await blockedMarket.add("owner/repo"),
    skill = blockedMarket.catalogue(blockedSource.id)[0];
  assert.throws(
    () =>
      blockedMarket.install(
        blockedSource.id,
        skill.id,
        blockedMarket.preview(blockedSource.id, skill.id).hash,
        ["claude"],
      ),
    refusal("Your skill policy blocks blocked."),
  );
});

test("blocked skills cannot be shared, synced or enabled, but can be created and disabled", async (t) => {
  const f = fixture(t);
  put(path.join(f.home, ".claude", "skills", "local"), "local");
  put(path.join(f.home, ".agents", "skills", "local"), "local");
  f.library.create("shared", "Test skill", "Instructions", ["claude"]);
  const preview = f.library.syncPlan(["claude", "codex"]);
  await f.connect("version: 1\nblocked: [local, shared, created]");
  const local = f.library.skill("local"),
    shared = f.library.skill("shared");
  assert.throws(
    () => f.library.plan("local", "claude", local.revision, ["codex"]),
    refusal("Your skill policy blocks local."),
  );
  assert.throws(
    () => f.library.share("local", "claude", local.revision, ["codex"]),
    refusal("Your skill policy blocks local."),
  );
  assert.throws(
    () => f.library.shareIdentical(false),
    refusal("Your skill policy blocks local."),
  );
  assert.throws(
    () => f.library.sync(preview.plans, preview.tools),
    refusal("Your skill policy blocks local."),
  );
  assert.deepEqual(f.library.syncPlan(["codex"]).skipped, [
    { name: "local", reason: "Your skill policy blocks local." },
  ]);
  assert.throws(
    () => f.library.setEnabled("shared", "codex", true, shared.revision),
    refusal("Your skill policy blocks shared."),
  );
  assert.equal(f.library.skill("local").revision, local.revision);
  assert.equal(f.library.skill("shared").revision, shared.revision);
  f.library.setEnabled("shared", "claude", false, shared.revision);
  assert.equal(f.library.skill("shared").tools.length, 0);
  f.library.create("created", "Test skill", "Instructions", ["claude"]);
  assert.ok(
    f.policy
      .drift()
      .some((item) => item.name === "created" && item.kind === "blocked"),
  );
});

test("drift reports missing, version, name-taken, blocked and source without changing files", async (t) => {
  const f = fixture(t);
  for (const name of [
    "version",
    "edited",
    "matches",
    "foreign",
    "wrong-path",
  ]) {
    const directory = put(path.join(f.home, "packages", name), name);
    f.library.installPackage(
      name,
      directory,
      tree(directory).hash,
      ["claude"],
      {
        source: sourceId("owner/repo"),
        repo: name === "foreign" ? "other/repo" : "OWNER/REPO",
        path: name === "wrong-path" ? "other/wrong-path" : "skills/" + name,
        commit: name === "version" ? nextCommit : commit,
      },
    );
  }
  fs.appendFileSync(
    path.join(f.library.shared, "edited", "SKILL.md"),
    "Local edit",
  );
  f.library.create("name-taken", "Test skill", "Local", ["claude"]);
  f.library.create("blocked", "Test skill", "Local", ["claude"]);
  const marketplaces = new Marketplaces(f.library, async (_repo, directory) => {
    fs.mkdirSync(directory, { recursive: true });
    return commit;
  });
  await marketplaces.add("disallowed/collection");
  await f.connect(
    stringify({
      version: 1,
      sources: { github: ["owner/repo"] },
      skills: [
        "missing",
        "version",
        "edited",
        "matches",
        "name-taken",
        "foreign",
        "wrong-path",
      ].map((name) => ({
        source: "owner/repo",
        path: "skills/" + name,
        commit,
      })),
      blocked: ["blocked"],
    }),
  );
  const before = f.library.inventory(),
    history = f.library.history();
  assert.deepEqual(f.policy.drift(), [
    { kind: "missing", name: "missing", reason: "Not installed." },
    { kind: "version", name: "version", reason: "Not the pinned version." },
    {
      kind: "version",
      name: "edited",
      reason: "Not the pinned version. Edited on this computer.",
    },
    ...["name-taken", "foreign", "wrong-path"].map((name) => ({
      kind: "name-taken",
      name,
      reason: "Another skill uses this name. Palimpsest won't replace it.",
    })),
    {
      kind: "blocked",
      name: "blocked",
      reason: "Blocked by the policy. Turn it off in each app to match.",
    },
    {
      kind: "source",
      name: "foreign",
      repo: "other/repo",
      reason: "From a collection the policy doesn't allow.",
    },
    {
      kind: "source",
      repo: "disallowed/collection",
      reason: "From a collection the policy doesn't allow.",
    },
  ]);
  assert.deepEqual(f.library.inventory(), before);
  assert.deepEqual(f.library.history(), history);
});

test("CLI show and disconnect use the fixture policy in an isolated --home", async (t) => {
  const f = fixture(t);
  await f.connect(example);
  const cli = (...args: string[]) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "server/cli.ts",
          "policy",
          ...args,
          "--home",
          f.home,
        ],
        { encoding: "utf8" },
      ),
    );
  assert.deepEqual(cli("show"), f.policy.show());
  assert.deepEqual(cli("disconnect"), { connected: false });
  assert.deepEqual(cli("show"), { connected: false });
});
