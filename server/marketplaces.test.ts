import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { harnesses } from "./harnesses.ts";
import { SkillLibrary } from "./library.ts";
import { Marketplaces, githubRepository } from "./marketplaces.ts";
import { provenance } from "../shared/provenance.ts";

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

test("provenance retains the added version, latest update, and removed collection", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.home, { recursive: true }));
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-10-20T12:00:00Z"),
  });
  let commit = "abc123456789";
  const marketplaces = new Marketplaces(f.library, async (_repo, directory) => {
    fs.cpSync(path.dirname(f.directory), path.join(directory, "skills"), {
      recursive: true,
    });
    return commit;
  });
  const source = await marketplaces.add("test/provenance");
  const skill = marketplaces.catalogue(source.id)[0];
  marketplaces.install(
    source.id,
    skill.id,
    marketplaces.preview(source.id, skill.id).hash,
    ["codex"],
  );
  const added = f.library.detail("sample").origin!;
  assert.equal(added.repo, "test/provenance");
  assert.equal(added.commit, commit);
  assert.equal(added.installedAt, "2026-10-20T12:00:00.000Z");
  assert.deepEqual(provenance(added), [
    {
      label: "Added from test/provenance",
      commit: "abc1234",
      url: "https://github.com/test/provenance/commit/abc123456789",
      date: "2026-10-20",
    },
  ]);

  for (const next of ["def567890123", "fed987654321"]) {
    t.mock.timers.tick(86400000);
    commit = next;
    fs.appendFileSync(path.join(f.directory, "SKILL.md"), `${next}\n`);
    await marketplaces.refresh(source.id);
    marketplaces.update("sample", marketplaces.updatePreview("sample").hash);
    const origin = f.library.detail("sample").origin!;
    assert.equal(origin.repo, source.repo);
    assert.equal(origin.commit, next);
    assert.equal(origin.installedAt, new Date().toISOString());
    assert.deepEqual(origin.added, {
      commit: added.commit,
      installedAt: added.installedAt,
    });
  }
  const updated = f.library.detail("sample").origin!;
  marketplaces.remove(source.id);
  const reopened = new SkillLibrary(f.home);
  assert.deepEqual(reopened.detail("sample").origin, updated);
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(reopened.state, "manifest.json"), "utf8"),
    ).schema,
    1,
  );
  const inspected = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "server/cli.ts",
        "inspect",
        "sample",
        "--home",
        f.home,
      ],
      { encoding: "utf8" },
    ),
  );
  assert.deepEqual(inspected.origin, updated);
  assert.deepEqual(inspected.provenance, [
    "Added from test/provenance at abc1234 on 2026-10-20",
    "Updated to fed9876 on 2026-10-22",
  ]);
});

test("schema 1 origins without provenance still load and can be updated", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.home, { recursive: true }));
  const skill = f.marketplaces.catalogue(f.id)[0];
  const preview = f.marketplaces.preview(f.id, skill.id);
  f.marketplaces.install(f.id, skill.id, preview.hash, ["codex"]);
  const file = path.join(f.library.state, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  const origin = { source: f.id, path: skill.path, hash: preview.hash };
  manifest.skills.sample.origin = origin;
  fs.writeFileSync(file, JSON.stringify(manifest));
  const library = new SkillLibrary(f.home);
  assert.deepEqual(library.detail("sample").origin, origin);
  assert.deepEqual(provenance(origin), []);
  fs.appendFileSync(
    path.join(f.directory, "SKILL.md"),
    "Updated instructions\n",
  );
  const marketplaces = new Marketplaces(library);
  marketplaces.update("sample", marketplaces.updatePreview("sample").hash);
  assert.equal(library.detail("sample").origin?.repo, "owner/repo");
  assert.equal(library.detail("sample").origin?.commit, "abc123");
  assert.deepEqual(library.detail("sample").origin?.added, {});
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).schema, 1);
});
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

test("refresh replaces the catalogue snapshot while preserving installed packages", async () => {
  const f = fixture();
  let commit = "first",
    fail = false;
  const marketplaces = new Marketplaces(f.library, async (_repo, directory) => {
    if (fail) throw new Error("Network unavailable");
    fs.cpSync(path.dirname(f.directory), path.join(directory, "skills"), {
      recursive: true,
    });
    return commit;
  });
  try {
    const source = await marketplaces.add("test/skills");
    const preview = marketplaces.preview(
      source.id,
      marketplaces.catalogue(source.id)[0].id,
    );
    marketplaces.install(source.id, preview.id, preview.hash, ["codex"]);
    const installed = f.library.skill("sample").variants[0].hash;
    fs.appendFileSync(
      path.join(f.directory, "SKILL.md"),
      "New upstream instructions",
    );
    commit = "second";
    const updated = await marketplaces.refresh(source.id);
    assert.equal(updated.commit, "second");
    assert.equal(updated.addedAt, source.addedAt);
    assert.ok(updated.refreshedAt);
    assert.match(
      marketplaces.preview(source.id, preview.id).content,
      /New upstream/,
    );
    assert.equal(f.library.skill("sample").variants[0].hash, installed);
    assert.throws(
      () =>
        marketplaces.install(source.id, preview.id, preview.hash, ["codex"]),
      /changed/,
    );
    fail = true;
    await assert.rejects(
      marketplaces.refresh(source.id),
      /Network unavailable/,
    );
    assert.equal(
      marketplaces.list().find((s) => s.id === source.id)?.commit,
      "second",
    );
    assert.match(
      marketplaces.preview(source.id, preview.id).content,
      /New upstream/,
    );
    assert.deepEqual(
      fs
        .readdirSync(marketplaces.root)
        .filter((name) => name.startsWith(source.id + "-")),
      [],
    );
  } finally {
    fs.rmSync(f.home, { recursive: true });
  }
});

test("a removed marketplace is not resurrected by an in-flight refresh", async () => {
  const f = fixture();
  let duringClone = () => {};
  const marketplaces = new Marketplaces(f.library, async (_repo, directory) => {
    fs.cpSync(path.dirname(f.directory), path.join(directory, "skills"), {
      recursive: true,
    });
    duringClone();
    return "commit";
  });
  try {
    const source = await marketplaces.add("test/skills");
    duringClone = () => marketplaces.remove(source.id);
    await assert.rejects(
      marketplaces.refresh(source.id),
      /changed during refresh/,
    );
    assert.equal(
      marketplaces.list().some((s) => s.id === source.id),
      false,
    );
  } finally {
    fs.rmSync(f.home, { recursive: true });
  }
});

test("an installed skill reports upstream changes, updates in one step, and restores", () => {
  const f = fixture();
  try {
    const skillId = f.marketplaces.catalogue(f.id)[0].id,
      preview = f.marketplaces.preview(f.id, skillId);
    f.marketplaces.install(f.id, skillId, preview.hash, ["codex"]);
    assert.deepEqual(
      f.marketplaces.updates().map(({ name, update, edited }) => ({
        name,
        update,
        edited,
      })),
      [{ name: "sample", update: false, edited: false }],
    );
    fs.appendFileSync(path.join(f.directory, "SKILL.md"), "New step\n");
    fs.writeFileSync(path.join(f.directory, "extra.md"), "Added file\n");
    fs.rmSync(path.join(f.directory, "references"), { recursive: true });
    const [status] = f.marketplaces.updates();
    assert.equal(status.update, true);
    const review = f.marketplaces.updatePreview("sample");
    assert.deepEqual(
      review.files.map(({ file, change }) => [file, change]),
      [
        ["SKILL.md", "changed"],
        ["extra.md", "added"],
        ["references/example.txt", "removed"],
      ],
    );
    assert.match(review.files[0].patch, /\+New step/);
    assert.deepEqual(
      f.marketplaces.applyUpdates([{ name: "sample", hash: "stale" }]).failed
        .length,
      1,
    );
    const result = f.marketplaces.applyUpdates([
      { name: "sample", hash: review.hash },
    ]);
    assert.deepEqual(result, { updated: ["sample"], failed: [] });
    const canonical = path.join(f.library.shared, "sample");
    assert.match(
      fs.readFileSync(path.join(canonical, "SKILL.md"), "utf8"),
      /New step/,
    );
    assert.equal(fs.existsSync(path.join(canonical, "references")), false);
    assert.equal(
      fs.realpathSync(path.join(f.home, ".agents", "skills", "sample")),
      canonical,
    );
    assert.equal(f.marketplaces.updates()[0].update, false);
    fs.appendFileSync(path.join(canonical, "SKILL.md"), "Local edit\n");
    assert.equal(f.marketplaces.updates()[0].edited, true);
    fs.writeFileSync(
      path.join(canonical, "SKILL.md"),
      fs.readFileSync(path.join(f.directory, "SKILL.md")),
    );
    const latest = f.library.history().find((o) => o.status === "committed")!;
    assert.equal(latest.label, "Update marketplace skill");
    f.library.restore(latest.id);
    assert.match(
      fs.readFileSync(path.join(canonical, "SKILL.md"), "utf8"),
      /^((?!New step)[\s\S])*$/,
    );
    assert.equal(f.marketplaces.updates()[0].update, true);
  } finally {
    fs.rmSync(f.home, { recursive: true });
  }
});

test("a skill that is no longer one shared copy is not offered an update", () => {
  const f = fixture();
  try {
    const skillId = f.marketplaces.catalogue(f.id)[0].id,
      preview = f.marketplaces.preview(f.id, skillId);
    f.marketplaces.install(f.id, skillId, preview.hash, ["codex"]);
    fs.appendFileSync(path.join(f.directory, "SKILL.md"), "New step\n");
    const link = path.join(f.home, ".agents", "skills", "sample");
    fs.rmSync(link);
    fs.cpSync(path.join(f.library.shared, "sample"), link, { recursive: true });
    assert.equal(f.marketplaces.updates()[0].update, false);
  } finally {
    fs.rmSync(f.home, { recursive: true });
  }
});
