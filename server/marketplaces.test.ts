import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { harnesses } from "./harnesses.ts";
import { SkillLibrary } from "./library.ts";
import { Marketplaces, githubRepository } from "./marketplaces.ts";

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "marketplace-test-"));
  const library = new SkillLibrary(home),
    marketplaces = new Marketplaces(library);
  const id = "0123456789abcdef",
    directory = path.join(marketplaces.root, id, "skills", "sample");
  fs.mkdirSync(path.join(directory, "references"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    "---\nname: sample\ndescription: Sample skill\n---\n\nRead references/example.txt\n",
  );
  fs.writeFileSync(
    path.join(directory, "references", "example.txt"),
    "Full package reference",
  );
  fs.writeFileSync(
    path.join(marketplaces.root, "sources.json"),
    JSON.stringify([
      {
        id,
        repo: "owner/repo",
        url: "https://github.com/owner/repo",
        commit: "abc123",
        addedAt: new Date().toISOString(),
      },
    ]),
  );
  return { home, library, marketplaces, id, directory };
}
test("GitHub sources reject arbitrary hosts and arguments", () => {
  assert.equal(
    githubRepository("https://github.com/anthropics/skills.git"),
    "anthropics/skills",
  );
  for (const value of [
    "https://example.com/a/b",
    "file:///tmp/x",
    "--upload-pack=evil",
    "a/b/tree/main",
    "a/..",
    "a/b?x=y",
  ])
    assert.throws(() => githubRepository(value));
});
test("marketplace install copies references, links all harnesses, and restores", () => {
  const f = fixture();
  try {
    const skills = f.marketplaces.catalogue(f.id);
    assert.equal(skills.length, 1);
    const preview = f.marketplaces.preview(f.id, skills[0].id);
    const operation = f.marketplaces.install(
      f.id,
      preview.id,
      preview.hash,
      harnesses.map((harness) => harness.id),
    );
    for (const harness of harnesses) {
      assert.equal(
        fs.realpathSync(path.join(f.home, harness.directory, "sample")),
        path.join(f.library.shared, "sample"),
      );
    }
    assert.equal(
      fs.readFileSync(
        path.join(f.library.shared, "sample", "references", "example.txt"),
        "utf8",
      ),
      "Full package reference",
    );
    assert.equal(f.library.detail("sample").status, "shared");
    f.marketplaces.remove(f.id);
    assert.equal(f.library.inventory().counts.total, 1);
    f.library.restore(operation.operation.id);
    assert.equal(f.library.inventory().counts.total, 0);
  } finally {
    fs.rmSync(f.home, { recursive: true });
  }
});
test("stale previews and packages containing symlinks cannot install", () => {
  const f = fixture();
  try {
    const preview = f.marketplaces.preview(
      f.id,
      f.marketplaces.catalogue(f.id)[0].id,
    );
    fs.appendFileSync(
      path.join(f.directory, "references", "example.txt"),
      "Changed",
    );
    assert.throws(
      () => f.marketplaces.install(f.id, preview.id, preview.hash, ["codex"]),
      /changed/,
    );
    fs.symlinkSync(f.home, path.join(f.directory, "external"));
    assert.equal(f.marketplaces.preview(f.id, preview.id).installable, false);
    assert.throws(
      () => f.marketplaces.install(f.id, preview.id, preview.hash, ["codex"]),
      /cannot be installed/,
    );
    assert.equal(f.library.inventory().counts.total, 0);
  } finally {
    fs.rmSync(f.home, { recursive: true });
  }
});
