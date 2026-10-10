import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import lockfile from "proper-lockfile";
import { SkillLibrary } from "./library.ts";
import { reviewPrompt, reviewSnapshot, type runReview } from "./review.ts";
import { SkillReviews } from "./skillReviews.ts";

const day = 24 * 60 * 60 * 1000;
const exec = promisify(execFile);

function fixture(t: TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "palimpsest-lifecycle-"));
  const originalPath = process.env.PATH;
  process.env.PATH = home;
  t.after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(home, { recursive: true, force: true });
  });
  const library = new SkillLibrary(home);
  const skillFile = path.join(home, ".agents", "skills", "example", "SKILL.md");
  fs.mkdirSync(path.dirname(skillFile), { recursive: true });
  fs.writeFileSync(
    skillFile,
    "---\nname: example\ndescription: Use for a specific task.\n---\nSpecific domain rules.\n",
  );
  fs.writeFileSync(
    path.join(home, "codex"),
    `#!${process.execPath}\nprocess.stdin.resume(); process.stdin.on('end', () => process.stdout.write('Keep example.'));`,
    { mode: 0o700 },
  );
  let time = Date.parse("2026-10-10T10:00:00Z"),
    calls = 0;
  const runner: typeof runReview = async (_library, agent) => {
    calls++;
    return { agent, report: "Keep example.", at: new Date(time).toISOString() };
  };
  const reviews = new SkillReviews(library, () => time, runner);
  return {
    home,
    library,
    skillFile,
    reviews,
    runner,
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
    calls: () => calls,
  };
}

test("lifecycle prompt uses a captured snapshot and requires evidence before retirement", (t) => {
  const { library, skillFile } = fixture(t);
  const snapshot = reviewSnapshot(library);
  fs.writeFileSync(
    skillFile,
    "---\nname: example\ndescription: Changed after capture\n---\nNew content",
  );
  const prompt = reviewPrompt(library, {
    snapshot,
    model: "model-next",
    context: "Task-specific target models",
  });
  assert.match(prompt, /Keep.*Refine.*Consolidate.*Retire candidate/);
  assert.match(prompt, /No usage telemetry/);
  assert.match(
    prompt,
    /no skill, the current skill, and the proposed revision/,
  );
  assert.match(prompt, /do not execute these evaluations or claim they passed/);
  assert.match(prompt, /actual safety or account boundaries/);
  assert.match(prompt, /model-next/);
  assert.doesNotMatch(
    prompt,
    /Changed after capture|Specific domain rules|New content/,
  );
  assert.notEqual(snapshot.fingerprint, reviewSnapshot(library).fingerprint);
});

test("review preferences validate input and status reads do not create state", (t) => {
  const { reviews, library } = fixture(t);
  const settings = reviews.status().settings;
  assert.equal(settings.schedule, "off");
  assert.equal(settings.onChange, false);
  assert.equal(fs.existsSync(library.state), false);
  for (const invalid of [
    { agent: "external" },
    { schedule: "daily" },
    { onChange: "yes" },
    { model: "--unsafe" },
    { model: null },
    { context: "x".repeat(2001) },
  ])
    assert.throws(() =>
      reviews.saveSettings({ ...settings, ...invalid } as typeof settings),
    );
  const saved = reviews.saveSettings({
    ...settings,
    model: "model-next",
    context: "  My workflows  ",
  });
  assert.equal(
    new SkillReviews(library).status().settings.context,
    "My workflows",
  );
  assert.equal(saved.model, "model-next");
  assert.equal(
    fs.statSync(path.join(library.state, "review-settings.json")).mode & 0o777,
    0o600,
  );
  assert.throws(() => reviews.report("missing"), /not found/);
});

test("reports persist across restarts with private permissions and bounded history", async (t) => {
  const { reviews, library, skillFile } = fixture(t);
  const original = fs.readFileSync(skillFile, "utf8");
  const first = await reviews.run();
  assert.equal(new SkillReviews(library).report(first.id).report, first.report);
  assert.equal(reviews.status().reports[0].stale, false);
  for (let i = 0; i < 10; i++) await reviews.run();
  assert.equal(reviews.status().reports.length, 10);
  assert.throws(() => reviews.report(first.id), /not found/);
  assert.equal(
    fs.statSync(path.join(library.state, "reviews.json")).mode & 0o777,
    0o600,
  );
  assert.equal(fs.readFileSync(skillFile, "utf8"), original);
});

test("in-flight review preserves concurrent preferences and starting provenance", async (t) => {
  const { library, skillFile, now } = fixture(t);
  let finish!: () => void;
  let received: Parameters<typeof runReview>[2];
  const runner: typeof runReview = async (_library, agent, options) => {
    received = options;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return {
      agent,
      report: "Starting snapshot reviewed.",
      at: new Date(now()).toISOString(),
    };
  };
  const reviews = new SkillReviews(library, now, runner);
  const starting = reviewSnapshot(library);
  const pending = reviews.run();
  assert.equal(reviews.status().running, true);
  await assert.rejects(
    new SkillReviews(library, now, runner).run(),
    /already running/,
  );
  const settings = {
    ...reviews.status().settings,
    model: "new-model",
    context: "New target models",
  };
  reviews.saveSettings(settings);
  fs.appendFileSync(skillFile, "An external edit.\n");
  finish();
  const report = await pending;
  assert.equal(received?.snapshot?.fingerprint, starting.fingerprint);
  assert.equal(report.snapshot.fingerprint, starting.fingerprint);
  assert.deepEqual(reviews.status().settings, settings);
  assert.equal(reviews.status().reports[0].stale, true);
  assert.equal(reviews.status().reports[0].libraryChanged, true);
  assert.equal(reviews.status().running, false);
});

test("change trigger establishes a baseline, persists debounce, and enforces a daily limit", async (t) => {
  const f = fixture(t);
  assert.match((await f.reviews.runDue()).skipped!, /off/);
  f.reviews.saveSettings({ ...f.reviews.status().settings, onChange: true });
  assert.match((await f.reviews.runDue()).skipped!, /60 seconds/);
  f.advance(60_000);
  assert.match((await f.reviews.runDue()).skipped!, /No review/);
  fs.appendFileSync(f.skillFile, "Changed\n");
  assert.match((await f.reviews.runDue()).skipped!, /60 seconds/);
  f.advance(59_000);
  const restarted = new SkillReviews(f.library, f.now, f.runner);
  assert.match((await restarted.runDue()).skipped!, /60 seconds/);
  f.advance(1000);
  assert.equal((await restarted.runDue()).report?.trigger, "change");
  assert.equal(f.calls(), 1);
  fs.appendFileSync(f.skillFile, "Another change\n");
  await f.reviews.runDue();
  f.advance(60_000);
  assert.match((await f.reviews.runDue()).skipped!, /24 hours/);
  f.advance(day);
  assert.equal((await f.reviews.runDue()).report?.trigger, "change");
  assert.equal(f.calls(), 2);
});

test("model context changes make reports stale and trigger an opt-in review", async (t) => {
  const f = fixture(t);
  f.reviews.saveSettings({ ...f.reviews.status().settings, onChange: true });
  const first = await f.reviews.run();
  f.advance(day);
  f.reviews.saveSettings({
    ...f.reviews.status().settings,
    model: "model-next",
    context: "Evaluate for the new generation",
  });
  assert.equal(f.reviews.status().reports[0].stale, true);
  assert.equal(f.reviews.status().reports[0].libraryChanged, false);
  await f.reviews.runDue();
  f.advance(60_000);
  const result = (await f.reviews.runDue()).report!;
  assert.equal(result.trigger, "change");
  assert.equal(result.model, "model-next");
  assert.equal(result.snapshot.fingerprint, first.snapshot.fingerprint);
  assert.equal(f.reviews.status().reports[0].stale, false);
});

test("recurring reviews honor their interval and failures do not retry every minute", async (t) => {
  const f = fixture(t);
  let fail = true,
    calls = 0;
  const runner: typeof runReview = async (_library, agent) => {
    calls++;
    if (fail) throw new Error("Sign in first");
    return {
      agent,
      report: "Keep example.",
      at: new Date(f.now()).toISOString(),
    };
  };
  const reviews = new SkillReviews(f.library, f.now, runner);
  reviews.saveSettings({ ...reviews.status().settings, schedule: "weekly" });
  const firstDue = reviews.status().scheduledAt!;
  await reviews.runDue();
  f.advance(7 * day - 1);
  assert.match((await reviews.runDue()).skipped!, /No review/);
  f.advance(1);
  assert.equal(new Date(f.now()).toISOString(), firstDue);
  await assert.rejects(reviews.runDue(), /Sign in first/);
  assert.equal(reviews.status().attempt?.status, "failed");
  f.advance(60_000);
  assert.match((await reviews.runDue()).skipped!, /24 hours/);
  assert.equal(calls, 1);
  fail = false;
  // Manual retries bypass the automatic cooldown.
  const manual = await reviews.run();
  assert.equal(manual.trigger, "manual");
  assert.equal(calls, 2);
  reviews.saveSettings({ ...reviews.status().settings, schedule: "monthly" });
  await reviews.runDue();
  f.advance(30 * day);
  assert.equal((await reviews.runDue()).report?.trigger, "schedule");
  reviews.saveSettings({
    ...reviews.status().settings,
    schedule: "off",
    onChange: false,
  });
  f.advance(30 * day);
  assert.match((await reviews.runDue()).skipped!, /off/);
});

test("separate CLI processes serialize due reviews and recover an expired lease", async (t) => {
  const f = fixture(t);
  const reviews = new SkillReviews(f.library);
  reviews.saveSettings({ ...reviews.status().settings, schedule: "weekly" });
  const configPath = path.join(f.library.state, "review-settings.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.scheduledFrom = new Date(Date.now() - 8 * day).toISOString();
  fs.writeFileSync(configPath, JSON.stringify(config));
  // Prime the persistent observation, then make it older than the debounce.
  await reviews.runDue();
  const statePath = path.join(f.library.state, "reviews.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.observed.at = new Date(Date.now() - 120_000).toISOString();
  fs.writeFileSync(statePath, JSON.stringify(state));
  const staleLock = statePath + ".lock";
  fs.mkdirSync(staleLock);
  const expired = new Date(Date.now() - 11 * 60_000);
  fs.utimesSync(staleLock, expired, expired);
  fs.writeFileSync(
    path.join(f.home, "codex"),
    `#!${process.execPath}\nconst fs = require('node:fs'); process.stdin.resume(); process.stdin.on('end', () => { fs.appendFileSync(${JSON.stringify(path.join(f.home, "calls"))}, 'run\\n'); setTimeout(() => process.stdout.write('Keep example.'), 300); });`,
    { mode: 0o700 },
  );
  const args = [
    "--import",
    "tsx",
    "server/cli.ts",
    "review",
    "--due",
    "--home",
    f.home,
  ];
  const results = await Promise.all([
    exec(process.execPath, args),
    exec(process.execPath, args),
  ]);
  const output = results.map((result) => JSON.parse(result.stdout));
  assert.equal(output.filter((result) => result.report).length, 1);
  assert.equal(output.filter((result) => result.skipped).length, 1);
  assert.equal(fs.readFileSync(path.join(f.home, "calls"), "utf8"), "run\n");
  assert.equal(reviews.status().reports.length, 1);
  assert.equal(reviews.status().running, false);
});

test("a review that loses its lease cannot overwrite a successor's state", async (t) => {
  const f = fixture(t);
  let compromise!: (error: Error) => void;
  let release!: () => void;
  const originalLock = lockfile.lockSync;
  t.mock.method(
    lockfile,
    "lockSync",
    (file: string, options: lockfile.LockOptions) => {
      compromise = options.onCompromised!;
      release = originalLock(file, options);
      return release;
    },
  );
  let finish!: () => void;
  const runner: typeof runReview = async (_library, agent) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return {
      agent,
      report: "Obsolete owner",
      at: new Date(f.now()).toISOString(),
    };
  };
  const pending = new SkillReviews(f.library, f.now, runner).run();
  const statePath = path.join(f.library.state, "reviews.json");
  const successorState = JSON.stringify({
    schema: 1,
    observed: null,
    attempt: {
      at: new Date(f.now()).toISOString(),
      trigger: "manual",
      status: "running",
    },
    reports: [],
    owner: "successor",
  });
  fs.writeFileSync(statePath, successorState);
  compromise(new Error("Lease lost"));
  finish();
  await assert.rejects(pending, /Lease lost/);
  assert.equal(fs.readFileSync(statePath, "utf8"), successorState);
  release();
});

test("enabling and re-enabling change reviews use the current baseline even with prior reports", async (t) => {
  const f = fixture(t);
  await f.reviews.run();
  f.advance(day);
  fs.appendFileSync(f.skillFile, "Before enabling\n");
  f.reviews.saveSettings({ ...f.reviews.status().settings, onChange: true });
  await f.reviews.runDue();
  f.advance(60_000);
  assert.match((await f.reviews.runDue()).skipped!, /No review/);
  assert.equal(f.calls(), 1);
  fs.appendFileSync(f.skillFile, "After enabling\n");
  await f.reviews.runDue();
  f.advance(60_000);
  assert.equal((await f.reviews.runDue()).report?.trigger, "change");
  f.reviews.saveSettings({ ...f.reviews.status().settings, onChange: false });
  f.advance(day);
  fs.appendFileSync(f.skillFile, "While disabled\n");
  f.reviews.saveSettings({ ...f.reviews.status().settings, onChange: true });
  await f.reviews.runDue();
  f.advance(60_000);
  assert.match((await f.reviews.runDue()).skipped!, /No review/);
  assert.equal(f.calls(), 2);
});

test("CLI configuration can clear an explicit reviewer model and target context", async (t) => {
  const f = fixture(t);
  f.reviews.saveSettings({
    ...f.reviews.status().settings,
    model: "model-next",
    context: "Old target",
  });
  const result = await exec(process.execPath, [
    "--import",
    "tsx",
    "server/cli.ts",
    "review",
    "configure",
    "--home",
    f.home,
    "--model",
    "",
    "--context",
    "",
  ]);
  assert.equal(JSON.parse(result.stdout).model, "");
  assert.equal(f.reviews.status().settings.context, "");
});
