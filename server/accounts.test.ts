import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SkillLibrary } from "./library.ts";
import { sourceName, toolName } from "../shared/harnesses.ts";

test("an account links skills into another config folder of the same app", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "accounts-test-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "accounts-outside-"));
  try {
    fs.mkdirSync(path.join(home, ".claude-work"));
    fs.mkdirSync(path.join(home, ".claude"));
    const library = new SkillLibrary(home);
    const account = library.addAccount("claude", "work", "~/.claude-work");
    assert.deepEqual(
      [account.id, account.name, account.base, account.detected],
      ["claude:work", "Claude Code · work", "claude", true],
    );
    const ids = library.inventory().harnesses.map((harness) => harness.id);
    assert.equal(ids[ids.indexOf("claude") + 1], "claude:work");
    assert.throws(
      () => library.create("sample", "A sample", "Body", ["claude:other"]),
      /supported harness/,
    );
    library.create("sample", "A sample", "Body", ["claude", "claude:work"]);
    const link = path.join(home, ".claude-work", "skills", "sample");
    assert.equal(
      fs.realpathSync(link),
      fs.realpathSync(path.join(library.shared, "sample")),
    );
    assert.deepEqual(library.skill("sample").tools.sort(), [
      "claude",
      "claude:work",
    ]);
    assert.throws(() => library.removeAccount("claude:work"), /Remove this/);
    library.setEnabled(
      "sample",
      "claude:work",
      false,
      library.skill("sample").revision,
    );
    assert.equal(fs.existsSync(link), false);
    library.setEnabled(
      "sample",
      "claude:work",
      true,
      library.skill("sample").revision,
    );
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    library.setEnabled(
      "sample",
      "claude:work",
      false,
      library.skill("sample").revision,
    );
    assert.deepEqual(library.removeAccount("claude:work"), { removed: true });
    assert.equal(library.accounts().length, 0);
  } finally {
    fs.rmSync(home, { recursive: true });
    fs.rmSync(outside, { recursive: true });
  }
});

test("accounts must be new config folders inside the home folder", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "accounts-test-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "accounts-outside-"));
  try {
    fs.mkdirSync(path.join(home, ".claude"));
    fs.mkdirSync(path.join(home, ".work"));
    const library = new SkillLibrary(home);
    assert.throws(
      () => library.addAccount("claude", "x", outside),
      /inside your home/,
    );
    assert.throws(
      () => library.addAccount("claude", "x", "~/.claude"),
      /already used/,
    );
    assert.throws(
      () => library.addAccount("claude", "x", "~/missing"),
      /does not exist/,
    );
    assert.throws(
      () => library.addAccount("claude", "a b", "~/.work"),
      /account name/,
    );
    library.addAccount("claude", "work", "~/.work");
    assert.throws(
      () => library.addAccount("codex", "other", "~/.work"),
      /already used/,
    );
    assert.throws(
      () => library.addAccount("claude", "work", "~/.work"),
      /already used/,
    );
  } finally {
    fs.rmSync(home, { recursive: true });
    fs.rmSync(outside, { recursive: true });
  }
});

test("labels name an app, its account, and a skill folder", () => {
  assert.equal(toolName("codex"), "Codex");
  assert.equal(toolName("claude:work"), "Claude Code · work");
  assert.equal(sourceName("codex"), "Codex · legacy folder");
  assert.equal(sourceName("codex:team"), "Codex · team");
  assert.equal(sourceName("shared"), "Shared library");
});
