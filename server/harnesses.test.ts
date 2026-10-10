import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  detectHarnesses,
  harnessDefinitions,
  skillRoots,
  type Tool,
} from "./harnesses.ts";
import { SkillLibrary } from "./library.ts";
import { createServer } from "./http.ts";

function fixture(t: { after: (fn: () => void) => void }) {
  const home = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "harness-detection-test-")),
  );
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

function skill(directory: string, name = "example") {
  const location = path.join(directory, name);
  fs.mkdirSync(location, { recursive: true });
  fs.writeFileSync(
    path.join(location, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill\n---\nInstructions\n`,
  );
  return location;
}

test("isolated homes do not inherit host harnesses or infer Codex from .agents", (t) => {
  const home = fixture(t);
  for (const directory of [
    ".agents/skills",
    ".harnesses-shared/skills",
    ".config",
    ".codeium",
  ])
    fs.mkdirSync(path.join(home, directory), { recursive: true });
  const before = fs.readdirSync(home);
  assert.deepEqual(
    detectHarnesses(home).filter((harness) => harness.detected),
    [],
  );
  assert.deepEqual(new SkillLibrary(home).detectedTools(), []);
  assert.deepEqual(fs.readdirSync(home), before);
  assert.equal(fs.existsSync(path.join(home, ".local")), false);
});

test("configuration detection includes every supported harness and refreshes on disk changes", (t) => {
  const home = fixture(t);
  const library = new SkillLibrary(home);
  for (const definition of harnessDefinitions)
    fs.mkdirSync(path.join(home, definition.config), { recursive: true });
  const detected = library.inventory().harnesses;
  assert.deepEqual(
    detected.map((harness) => harness.id),
    harnessDefinitions.map((harness) => harness.id),
  );
  assert.ok(
    detected.every(
      (harness) => harness.detected && harness.evidence[0].kind === "config",
    ),
  );
  fs.rmdirSync(path.join(home, ".gemini"));
  assert.equal(
    library.inventory().harnesses.find((harness) => harness.id === "gemini")!
      .detected,
    false,
  );
  fs.writeFileSync(path.join(home, ".claude.json"), "{}");
  fs.rmdirSync(path.join(home, ".claude"));
  assert.equal(
    detectHarnesses(home).find((harness) => harness.id === "claude")!.detected,
    true,
  );
});

test("executable detection follows valid links without running commands", (t) => {
  const home = fixture(t);
  const bin = path.join(home, ".local", "bin");
  fs.mkdirSync(bin, { recursive: true });
  const marker = path.join(home, "executed");
  const executable = path.join(home, "installed-command");
  fs.writeFileSync(executable, `#!/bin/sh\ntouch '${marker}'\n`, {
    mode: 0o755,
  });
  fs.symlinkSync(executable, path.join(bin, "claude"));
  fs.writeFileSync(path.join(bin, "codex"), "not executable", { mode: 0o644 });
  fs.symlinkSync(path.join(home, "missing"), path.join(bin, "gemini"));
  fs.mkdirSync(path.join(bin, "opencode"));
  const detected = detectHarnesses(home, { platform: "linux" });
  assert.deepEqual(
    detected.filter((harness) => harness.detected).map((harness) => harness.id),
    ["claude"],
  );
  assert.equal(detected[0].evidence[0].path, path.join(bin, "claude"));
  assert.equal(fs.existsSync(marker), false);
});

test("PATH detection accepts absolute directories and Windows command wrappers", (t) => {
  const home = fixture(t);
  const bin = path.join(home, "custom-bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "cursor-agent"), "#!/bin/sh\n", {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(bin, "gemini.cmd"), "@echo off");
  assert.equal(
    detectHarnesses(home, {
      platform: "linux",
      searchPath: [".", "", bin].join(path.delimiter),
    }).find((harness) => harness.id === "cursor")!.detected,
    true,
  );
  assert.equal(
    detectHarnesses(home, { platform: "win32", searchPath: bin }).find(
      (harness) => harness.id === "gemini",
    )!.detected,
    true,
  );
  assert.equal(
    detectHarnesses(home).some((harness) => harness.detected),
    false,
  );
});

test("macOS applications require an app bundle and do not leak into isolated homes", (t) => {
  const home = fixture(t);
  const apps = path.join(home, "test-apps");
  fs.mkdirSync(path.join(apps, "Cursor.app", "Contents"), { recursive: true });
  fs.writeFileSync(
    path.join(apps, "Cursor.app", "Contents", "Info.plist"),
    "<plist/>",
  );
  fs.mkdirSync(path.join(apps, "Claude.app"));
  const detected = detectHarnesses(home, {
    platform: "darwin",
    applicationDirectories: [apps],
  });
  assert.deepEqual(
    detected.filter((harness) => harness.detected).map((harness) => harness.id),
    ["cursor"],
  );
  assert.equal(
    detected.find((harness) => harness.id === "cursor")!.evidence[0].kind,
    "application",
  );
  assert.equal(
    detectHarnesses(home).some((harness) => harness.detected),
    false,
  );
});

test("Copilot extension detection ignores unrelated extensions and incomplete installs", (t) => {
  const home = fixture(t);
  const extensions = path.join(home, ".vscode", "extensions");
  fs.mkdirSync(path.join(extensions, "github.copilot-chat-1.0.0"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(extensions, "github.copilot-helper-1.0.0"));
  assert.equal(
    detectHarnesses(home).find((harness) => harness.id === "copilot")!.detected,
    false,
  );
  fs.writeFileSync(
    path.join(extensions, "github.copilot-chat-1.0.0", "package.json"),
    "{}",
  );
  const copilot = detectHarnesses(home).find(
    (harness) => harness.id === "copilot",
  )!;
  assert.equal(copilot.detected, true);
  assert.equal(copilot.evidence[0].kind, "extension");
});

test("sharing defaults to detected harnesses and manual choices remain available", (t) => {
  const home = fixture(t);
  skill(path.join(home, ".claude", "skills"));
  fs.mkdirSync(path.join(home, ".cursor"));
  const library = new SkillLibrary(home);
  const preview = library.plan(
    "example",
    "claude",
    library.skill("example").revision,
  );
  assert.deepEqual(preview.tools, ["claude", "cursor"]);
  const result = library.share(preview.name, preview.source, preview.revision);
  assert.deepEqual(result.skill.tools, ["claude", "cursor"]);
  assert.equal(fs.existsSync(path.join(home, ".agents")), false);
  library.setEnabled(
    "example",
    "gemini",
    true,
    library.skill("example").revision,
  );
  assert.ok(library.skill("example").tools.includes("gemini"));
});

for (const tool of [
  "cursor",
  "gemini",
  "opencode",
  "copilot",
  "windsurf",
] as Tool[]) {
  test(`${tool} skill packages can be shared, unlinked, and restored`, (t) => {
    const home = fixture(t);
    const root = skillRoots(home).find((root) => root.id === tool)!;
    const original = skill(root.path);
    const library = new SkillLibrary(home);
    const shared = library.share(
      "example",
      tool,
      library.skill("example").revision,
      [tool],
    );
    assert.equal(fs.lstatSync(original).isSymbolicLink(), true);
    assert.deepEqual(library.skill("example").tools, [tool]);
    const unlinked = library.setEnabled(
      "example",
      tool,
      false,
      library.skill("example").revision,
    );
    assert.equal(fs.existsSync(original), false);
    assert.equal(
      fs.existsSync(path.join(library.shared, "example", "SKILL.md")),
      true,
    );
    library.restore(unlinked.operation.id);
    library.restore(shared.operation.id);
    assert.equal(fs.lstatSync(original).isSymbolicLink(), false);
    assert.match(
      fs.readFileSync(path.join(original, "SKILL.md"), "utf8"),
      /Instructions/,
    );
  });
}

test("no detected harnesses require an explicit choice and OpenCode rejects incompatible names", (t) => {
  const home = fixture(t);
  const library = new SkillLibrary(home);
  assert.throws(() => library.syncPlan(), /select one manually/);
  assert.throws(
    () => library.create("bad_name", "Test", "Instructions", ["opencode"]),
    /OpenCode requires/,
  );
  assert.throws(
    () =>
      library.create("example", "Test", "Instructions", ["unknown" as Tool]),
    /supported harness/,
  );
  assert.equal(library.history().length, 0);
  library.create("bad_name", "Test", "Instructions", ["claude"]);
  assert.throws(
    () =>
      library.setEnabled(
        "bad_name",
        "opencode",
        true,
        library.skill("bad_name").revision,
      ),
    /OpenCode requires/,
  );
  assert.equal(fs.existsSync(path.join(home, ".config", "opencode")), false);
  library.create("example", "Test", "Instructions", ["gemini"]);
  assert.deepEqual(library.skill("example").tools, ["gemini"]);
});

test("inventory API exposes detection without creating missing harness folders", async (t) => {
  const home = fixture(t);
  fs.mkdirSync(path.join(home, ".gemini"));
  const server = createServer(new SkillLibrary(home), home);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address() as { port: number };
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/inventory`,
  );
  assert.equal(response.status, 200);
  const inventory = (await response.json()) as ReturnType<
    SkillLibrary["inventory"]
  >;
  assert.deepEqual(
    inventory.harnesses
      .filter((harness) => harness.detected)
      .map((harness) => harness.id),
    ["gemini"],
  );
  assert.equal(fs.existsSync(path.join(home, ".gemini", "skills")), false);
});

test("CLI reports detected harnesses and honors default and manual targets", async (t) => {
  const home = fixture(t);
  skill(path.join(home, ".cursor", "skills"));
  const run = promisify(execFile);
  const cli = path.resolve("server/cli.ts");
  const args = ["--import", "tsx", cli];
  const detected = await run(process.execPath, [
    ...args,
    "harnesses",
    "--home",
    home,
    "--json",
  ]);
  assert.deepEqual(
    JSON.parse(detected.stdout)
      .filter((harness: { detected: boolean }) => harness.detected)
      .map((harness: { id: string }) => harness.id),
    ["cursor"],
  );
  const defaults = await run(process.execPath, [
    ...args,
    "share",
    "example",
    "--source",
    "cursor",
    "--home",
    home,
  ]);
  assert.deepEqual(JSON.parse(defaults.stdout).tools, ["cursor"]);
  const manual = await run(process.execPath, [
    ...args,
    "share",
    "example",
    "--source",
    "cursor",
    "--home",
    home,
    "--tools",
    "gemini,opencode",
  ]);
  assert.deepEqual(JSON.parse(manual.stdout).tools, ["gemini", "opencode"]);
  assert.equal(fs.existsSync(path.join(home, ".gemini")), false);
});
