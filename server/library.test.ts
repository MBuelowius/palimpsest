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
