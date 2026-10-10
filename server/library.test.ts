import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { SkillLibrary } from "./library.ts";
import { createServer } from "./http.ts";

function fixture(t: { after: (fn: () => void) => void }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-test-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const library = new SkillLibrary(home);
  function put(
    root: string,
    name: string,
    body = "Original instructions",
    extra = "",
  ) {
    const p = path.join(home, root, "skills", name);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(
      path.join(p, "SKILL.md"),
      `---\nname: ${name}\ndescription: Test skill\n---\n${body}\n`,
    );
    if (extra) {
      fs.mkdirSync(path.join(p, "references"));
      fs.writeFileSync(path.join(p, "references", "guide.md"), extra);
    }
    return p;
  }
  return { home, library, put };
}

test("sync previews local packages and skips conflicts and invalid metadata", (t) => {
  const { library, put } = fixture(t);
  put(".claude", "local", undefined, "Reference");
  put(".claude", "conflict", "A");
  put(".codex", "conflict", "B");
  const invalid = put(".claude", "invalid");
  fs.writeFileSync(path.join(invalid, "SKILL.md"), "No metadata");
  const preview = library.syncPlan();
  assert.deepEqual(
    preview.plans.map((p) => p.name),
    ["local"],
  );
  assert.deepEqual(
    preview.skipped.map((p) => p.name),
    ["conflict", "invalid"],
  );
  assert.equal(library.history().length, 0);
  const result = library.sync(preview.plans, preview.tools);
  assert.deepEqual(result, { synced: ["local"], failed: [] });
  assert.equal(library.skill("local").status, "shared");
  assert.equal(
    fs.readFileSync(
      path.join(library.shared, "local", "references", "guide.md"),
      "utf8",
    ),
    "Reference",
  );
  assert.equal(library.skill("conflict").status, "conflict");
  assert.equal(library.syncPlan().plans.length, 0);
  library.restore(library.history()[0].id);
  assert.equal(library.skill("local").status, "local");
});

test("sync rejects stale selections before changing any skill", (t) => {
  const { library, put } = fixture(t);
  const a = put(".claude", "a");
  put(".claude", "b");
  const preview = library.syncPlan();
  fs.appendFileSync(path.join(a, "SKILL.md"), "Changed externally");
  assert.throws(() => library.sync(preview.plans, preview.tools), /changed/);
  assert.equal(library.skill("b").status, "local");
  assert.equal(library.history().length, 0);
  assert.throws(() => library.sync([], preview.tools), /Choose skills/);
  const current = library.syncPlan();
  assert.throws(
    () => library.sync([current.plans[0], current.plans[0]], current.tools),
    /Choose skills/,
  );
});

test("sync preserves disabled shared apps and unrelated target folders", (t) => {
  const { library, put, home } = fixture(t);
  put(".claude", "shared");
  library.share("shared", "claude", library.skill("shared").revision, [
    "claude",
  ]);
  put(".claude", "occupied");
  const target = path.join(home, ".agents", "skills", "occupied");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "keep.txt"), "Personal file");
  const linked = put(".claude", "linked");
  fs.symlinkSync(target, path.join(linked, "reference"));
  const preview = library.syncPlan();
  assert.equal(preview.plans.length, 0);
  assert.deepEqual(
    preview.skipped.map((p) => p.name),
    ["linked", "occupied"],
  );
  assert.deepEqual(library.skill("shared").tools, ["claude"]);
  assert.equal(
    fs.readFileSync(path.join(target, "keep.txt"), "utf8"),
    "Personal file",
  );
});

test("sync applies only selected packages and records recoverable backups", (t) => {
  const { library, put } = fixture(t);
  put(".claude", "a");
  put(".claude", "b");
  const preview = library.syncPlan(["codex"]);
  assert.deepEqual(library.sync([preview.plans[0]], preview.tools).synced, [
    "a",
  ]);
  assert.equal(library.skill("b").status, "local");
  const operations = library.history();
  assert.equal(operations.length, 1);
  library.restore(operations[0].id);
  assert.deepEqual(library.skill("a").tools, ["claude"]);
});

test("full-package differences are conflicts even with identical SKILL.md", (t) => {
  const { library, put } = fixture(t);
  put(".claude", "example", undefined, "A");
  put(".codex", "example", undefined, "B");
  assert.equal(library.skill("example").status, "conflict");
  assert.deepEqual(library.shareIdentical().skills, []);
});

test("sharing refuses to replace an unrelated app folder", (t) => {
  const { library, put, home } = fixture(t);
  put(".claude", "example");
  const occupied = path.join(home, ".agents", "skills", "example");
  fs.mkdirSync(occupied, { recursive: true });
  fs.writeFileSync(path.join(occupied, "personal.txt"), "keep this");
  assert.throws(
    () => library.share("example", "claude", library.skill("example").revision),
    /unrelated folder/,
  );
  assert.equal(
    fs.readFileSync(path.join(occupied, "personal.txt"), "utf8"),
    "keep this",
  );
});

test("sharing makes both tools use one package and restore returns exact originals", (t) => {
  const { library, put } = fixture(t);
  const a = put(".claude", "example", "Claude", "reference"),
    b = put(".codex", "example", "Codex");
  const result = library.share(
    "example",
    "claude",
    library.skill("example").revision,
  );
  assert.equal(result.skill.status, "shared");
  assert.equal(fs.realpathSync(a), fs.realpathSync(b));
  assert.equal(
    fs.readFileSync(path.join(b, "references", "guide.md"), "utf8"),
    "reference",
  );
  library.restore(result.operation.id);
  assert.equal(fs.lstatSync(a).isSymbolicLink(), false);
  assert.equal(fs.lstatSync(b).isSymbolicLink(), false);
  assert.match(fs.readFileSync(path.join(b, "SKILL.md"), "utf8"), /Codex/);
  assert.equal(fs.existsSync(path.join(library.shared, "example")), false);
});

test("newly enabled Codex skill uses .agents and disabling preserves shared content", (t) => {
  const { library, put, home } = fixture(t);
  put(".claude", "example");
  library.share("example", "claude", library.skill("example").revision);
  const binding = path.join(home, ".agents", "skills", "example");
  assert.equal(fs.lstatSync(binding).isSymbolicLink(), true);
  const result = library.setEnabled(
    "example",
    "codex",
    false,
    library.skill("example").revision,
  );
  assert.equal(fs.existsSync(binding), false);
  assert.equal(
    fs.existsSync(path.join(library.shared, "example", "SKILL.md")),
    true,
  );
  library.restore(result.operation.id);
  assert.equal(fs.existsSync(binding), true);
});

test("stale share and stale edit are rejected without losing newer content", (t) => {
  const { library, put } = fixture(t);
  const p = put(".claude", "example"),
    revision = library.skill("example").revision;
  const file = library.readFile("example", "claude", "SKILL.md");
  fs.appendFileSync(path.join(p, "SKILL.md"), "\nNew content");
  assert.throws(
    () => library.share("example", "claude", revision),
    /changed on disk/,
  );
  assert.throws(
    () =>
      library.saveFile(
        "example",
        "claude",
        "SKILL.md",
        file.content,
        file.revision,
      ),
    /changed on disk/,
  );
  assert.match(
    fs.readFileSync(path.join(p, "SKILL.md"), "utf8"),
    /New content/,
  );
});

test("nested symlinks cannot leak files through editor or relocation", (t) => {
  const { library, put, home } = fixture(t);
  const p = put(".claude", "example");
  fs.writeFileSync(path.join(home, "private.txt"), "private");
  fs.symlinkSync(path.join(home, "private.txt"), path.join(p, "outside.md"));
  assert.throws(
    () => library.readFile("example", "claude", "outside.md"),
    /inside the skill/,
  );
  assert.throws(
    () => library.readFile("example", "claude", "../private.txt"),
    /Invalid file/,
  );
  assert.throws(
    () => library.share("example", "claude", library.skill("example").revision),
    /nested symlinks/,
  );
});

test("restoring refuses to overwrite changes made after adoption", (t) => {
  const { library, put } = fixture(t);
  put(".claude", "example");
  const result = library.share(
    "example",
    "claude",
    library.skill("example").revision,
  );
  fs.appendFileSync(
    path.join(library.shared, "example", "SKILL.md"),
    "\nNew edits",
  );
  assert.throws(() => library.restore(result.operation.id), /changed after/);
});

test("file edit updates both tools and backup can restore it", (t) => {
  const { library, put } = fixture(t);
  put(".claude", "example");
  library.share("example", "claude", library.skill("example").revision);
  const file = library.readFile("example", "shared", "SKILL.md");
  const result = library.saveFile(
    "example",
    "shared",
    "SKILL.md",
    file.content + "\nEdited",
    file.revision,
  );
  assert.match(
    library.readFile("example", "agents", "SKILL.md").content,
    /Edited/,
  );
  library.restore(result.operation.id);
  assert.equal(
    library.readFile("example", "shared", "SKILL.md").content,
    file.content,
  );
});

test("trash, system, and synced skills are excluded from writable inventory", (t) => {
  const { library, put } = fixture(t);
  put(".claude", ".trash/old");
  put(".claude", "synced/account/vendor");
  put(".codex", ".system/vendor");
  put(".agents", "personal");
  assert.deepEqual(
    library.inventory().skills.map((s) => s.name),
    ["personal"],
  );
});

test("new skills can be created, shared, and restored", (t) => {
  const { library } = fixture(t);
  const result = library.create(
    "example",
    "Use for examples",
    "# Examples\nDo the work.",
    ["claude", "codex"],
  );
  assert.equal(result.skill.status, "shared");
  assert.throws(
    () => library.create("example", "Another", "body", ["claude"]),
    /already exists/,
  );
  library.restore(result.operation.id);
  assert.equal(library.inventory().skills.length, 0);
});

test("HTTP writes require session token and reject foreign origins and hosts", async (t) => {
  const { library, home } = fixture(t);
  fs.writeFileSync(path.join(home, "index.html"), "<html>Library</html>");
  const server = createServer(library, home);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address() as { port: number },
    base = `http://127.0.0.1:${address.port}`;
  const data = {
    name: "example",
    description: "Test",
    body: "Instructions",
    tools: ["claude"],
  };
  assert.equal(
    (
      await fetch(base + "/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/session", {
        headers: { Origin: "https://foreign.example" },
      })
    ).status,
    403,
  );
  const session = (await (await fetch(base + "/api/session")).json()) as {
    token: string;
  };
  assert.equal(
    (
      await fetch(base + "/api/skills", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Skill-Library-Token": session.token,
        },
        body: JSON.stringify(data),
      })
    ).status,
    201,
  );
  const status = await new Promise<number | undefined>((resolve) => {
    http.get(
      base + "/api/inventory",
      { headers: { Host: "attacker.example" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
  });
  assert.equal(status, 403);
});

for (const [tool, directory] of [
  ["cursor", ".cursor"],
  ["gemini", ".gemini"],
  ["copilot", ".copilot"],
  ["opencode", ".config/opencode"],
] as const) {
  test(`${tool} shares full packages, removes only its binding, and restores it`, (t) => {
    const { library, put, home } = fixture(t);
    put(directory, "example", "Instructions", "Reference content");
    assert.deepEqual(library.skill("example").tools, [tool]);
    library.share("example", tool, library.skill("example").revision, [tool]);
    const target = path.join(home, directory, "skills", "example");
    assert.equal(fs.realpathSync(target), path.join(library.shared, "example"));
    assert.equal(
      fs.readFileSync(path.join(target, "references", "guide.md"), "utf8"),
      "Reference content",
    );
    const operation = library.setEnabled(
      "example",
      tool,
      false,
      library.skill("example").revision,
    );
    assert.equal(fs.existsSync(target), false);
    assert.equal(
      fs.existsSync(path.join(library.shared, "example", "SKILL.md")),
      true,
    );
    library.restore(operation.operation.id);
    assert.equal(fs.realpathSync(target), path.join(library.shared, "example"));
  });

  test(`${tool} enables an existing shared skill in its own directory`, (t) => {
    const { library, home } = fixture(t);
    library.create("example", "Test skill", "Instructions", ["claude"]);
    library.setEnabled(
      "example",
      tool,
      true,
      library.skill("example").revision,
    );
    assert.equal(
      fs.realpathSync(path.join(home, directory, "skills", "example")),
      path.join(library.shared, "example"),
    );
    assert.deepEqual(
      new Set(library.skill("example").tools),
      new Set(["claude", tool]),
    );
  });
}

test("creating across all harnesses produces distinct bindings to one package", (t) => {
  const { library } = fixture(t);
  const tools = [
    "claude",
    "codex",
    "cursor",
    "gemini",
    "copilot",
    "opencode",
  ] as const;
  library.create("example", "Test skill", "Instructions", [...tools]);
  const skill = library.skill("example");
  assert.deepEqual(new Set(skill.tools), new Set(tools));
  assert.equal(
    new Set(skill.variants.map((variant) => variant.realPath)).size,
    1,
  );
  assert.equal(skill.variants.length, 7);
  assert.throws(
    () =>
      library.create("invalid", "Description", "Body", ["unknown" as never]),
    /supported harness/,
  );
});

test("sync shares a Cursor package across all harnesses while preserving existing shared links", (t) => {
  const { library, put, home } = fixture(t);
  put(".cursor", "example", "Instructions", "Reference content");
  library.create("already-shared", "Keep current links", "Instructions", [
    "gemini",
  ]);
  const tools = [
    "claude",
    "codex",
    "cursor",
    "gemini",
    "copilot",
    "opencode",
  ] as const;
  const preview = library.syncPlan([...tools]);
  assert.deepEqual(
    preview.plans.map((plan) => plan.name),
    ["example"],
  );
  const result = library.sync(preview.plans, preview.tools);
  assert.deepEqual(result.synced, ["example"]);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(new Set(library.skill("example").tools), new Set(tools));
  assert.equal(
    fs.readFileSync(
      path.join(home, ".config/opencode/skills/example/references/guide.md"),
      "utf8",
    ),
    "Reference content",
  );
  assert.deepEqual(library.skill("already-shared").tools, ["gemini"]);
});
