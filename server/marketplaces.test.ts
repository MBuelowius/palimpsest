import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
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

function write(root: string, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
}
const skill = (license = "") =>
  `---\nname: x\ndescription: X\n${license}---\n\nBody\n`;

test("listings report the license and non-Markdown files from the download", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "marketplace-test-"));
  const marketplaces = new Marketplaces(
    new SkillLibrary(home),
    async (repo, directory) => {
      write(directory, {
        "skills/front/SKILL.md": skill("license: Apache-2.0\n"),
        "skills/packaged/SKILL.md": skill(),
        "skills/packaged/LICENSE.txt": "Terms",
        "skills/packaged/notes.md": "Notes",
        "skills/packaged/scripts/run.py": "print()",
        "skills/packaged/scripts/tool": "#!/bin/sh",
        "skills/packaged/assets/logo.png": "png",
        "skills/plain/SKILL.md": skill(),
      });
      fs.chmodSync(path.join(directory, "skills/packaged/scripts/tool"), 0o755);
      if (repo === "test/licensed") write(directory, { COPYING: "Terms" });
      return "commit";
    },
  );
  const listing = async (repo: string) => {
    const source = await marketplaces.add(repo);
    return Object.fromEntries(
      marketplaces
        .catalogue(source.id)
        .map(({ name, license, licenseFile, scripts, otherFiles }) => [
          name,
          { license, licenseFile, scripts, otherFiles },
        ]),
    );
  };
  try {
    assert.deepEqual(await listing("test/licensed"), {
      front: {
        license: "Apache-2.0",
        licenseFile: "COPYING",
        scripts: 0,
        otherFiles: 0,
      },
      packaged: {
        license: "",
        licenseFile: "skills/packaged/LICENSE.txt",
        scripts: 2,
        otherFiles: 1,
      },
      plain: {
        license: "",
        licenseFile: "COPYING",
        scripts: 0,
        otherFiles: 0,
      },
    });
    const unlicensed = await listing("test/unlicensed");
    assert.equal(unlicensed.plain.license, "");
    assert.equal(unlicensed.plain.licenseFile, undefined);
    assert.equal(unlicensed.front.license, "Apache-2.0");
    // The listing comes from the download, not from rescanning the snapshot.
    const id = marketplaces.list()[1].id;
    fs.rmSync(path.join(marketplaces.root, id, "skills", "plain"), {
      recursive: true,
    });
    assert.equal(marketplaces.catalogue(id).length, 3);
  } finally {
    fs.rmSync(home, { recursive: true });
  }
});

test("listings date each package by the latest commit that touched it", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "marketplace-test-")),
    upstream = path.join(home, "upstream");
  const git = (cwd: string, args: string[], date?: string) =>
    execFileSync("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    });
  fs.mkdirSync(upstream);
  git(upstream, ["init", "-q"]);
  for (const [folder, date] of [
    ["old", "2026-01-01T00:00:00Z"],
    ["middle", "2026-02-01T00:00:00Z"],
    ["new", "2026-03-01T00:00:00Z"],
  ]) {
    write(upstream, { [folder + "/SKILL.md"]: skill() });
    git(upstream, ["add", "."]);
    git(
      upstream,
      ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", folder],
      date,
    );
  }
  const marketplaces = new Marketplaces(
    new SkillLibrary(home),
    async (_repo, directory) => {
      git(home, [
        "clone",
        "-q",
        "--depth",
        "2",
        "file://" + upstream,
        directory,
      ]);
      return "commit";
    },
  );
  try {
    const source = await marketplaces.add("test/dated");
    assert.deepEqual(
      Object.fromEntries(
        marketplaces
          .catalogue(source.id)
          .map(({ name, changedAt, changedBefore }) => [
            name,
            [new Date(changedAt!).toISOString().slice(0, 10), changedBefore],
          ]),
      ),
      {
        // "middle" is the oldest commit in the depth-2 snapshot.
        old: ["2026-02-01", true],
        middle: ["2026-02-01", true],
        new: ["2026-03-01", false],
      },
    );
  } finally {
    fs.rmSync(home, { recursive: true });
  }
});
