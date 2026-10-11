import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { LibraryError, SkillLibrary, type Tool } from "./library.ts";
import { installedAgents, reviewSnapshot, runReview } from "./review.ts";

export type ReviewSettings = {
  agent: Tool;
  model: string;
  context: string;
  schedule: "off" | "weekly" | "monthly";
  onChange: boolean;
};
type Trigger = "manual" | "schedule" | "change";
export type SavedReview = Awaited<ReturnType<typeof runReview>> & {
  id: string;
  startedAt: string;
  trigger: Trigger;
  model: string;
  context: string;
  reviewFingerprint: string;
  snapshot: {
    fingerprint: string;
    skills: { name: string; revision: string }[];
    scanIssues: string[];
  };
};
type SettingsFile = {
  schema: 1;
  settings: ReviewSettings;
  scheduledFrom: string | null;
  baseline: string | null;
  baselineAt: string | null;
  baselineReportId: string | null;
};
type ReviewState = {
  schema: 1;
  observed: { fingerprint: string; at: string } | null;
  attempt: {
    at: string;
    trigger: Trigger;
    status: "running" | "completed" | "failed";
    error?: string;
  } | null;
  reports: SavedReview[];
};
const day = 24 * 60 * 60 * 1000;
const lockOptions = { realpath: false, stale: 10 * 60 * 1000, update: 30_000 };
const defaults: ReviewSettings = {
  agent: "codex",
  model: "",
  context: "",
  schedule: "off",
  onChange: false,
};

function validateSettings(value: ReviewSettings): ReviewSettings {
  if (!value || (value.agent !== "codex" && value.agent !== "claude"))
    throw new LibraryError("Choose Codex or Claude Code.");
  if (!["off", "weekly", "monthly"].includes(value.schedule))
    throw new LibraryError("Choose off, weekly, or monthly reviews.");
  if (typeof value.onChange !== "boolean")
    throw new LibraryError("Choose whether library changes trigger reviews.");
  if (
    typeof value.model !== "string" ||
    (value.model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value.model))
  )
    throw new LibraryError("Use a model ID supported by your agent CLI.");
  if (typeof value.context !== "string" || value.context.length > 2000)
    throw new LibraryError("Review context must be at most 2000 characters.");
  return {
    agent: value.agent,
    model: value.model,
    context: value.context.trim(),
    schedule: value.schedule,
    onChange: value.onChange,
  };
}

function contextFingerprint(snapshot: string, settings: ReviewSettings) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        snapshot,
        settings.agent,
        settings.model,
        settings.context,
      ]),
    )
    .digest("hex");
}

export class SkillReviews {
  private readonly settingsPath: string;
  private readonly statePath: string;
  constructor(
    private readonly library: SkillLibrary,
    private readonly now: () => number = Date.now,
    private readonly runner: typeof runReview = runReview,
  ) {
    this.settingsPath = path.join(library.state, "review-settings.json");
    this.statePath = path.join(library.state, "reviews.json");
  }

  private read<T extends { schema: 1 }>(file: string, fallback: T): T {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8")) as T;
      if (value.schema !== 1)
        throw new LibraryError("Unsupported saved review format.", 409);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
      throw error;
    }
  }

  private config() {
    return this.read<SettingsFile>(this.settingsPath, {
      schema: 1,
      settings: { ...defaults },
      scheduledFrom: null,
      baseline: null,
      baselineAt: null,
      baselineReportId: null,
    });
  }

  private state() {
    return this.read<ReviewState>(this.statePath, {
      schema: 1,
      observed: null,
      attempt: null,
      reports: [],
    });
  }

  private write(file: string, value: SettingsFile | ReviewState) {
    fs.mkdirSync(this.library.state, { recursive: true, mode: 0o700 });
    const temp = file + "." + randomUUID() + ".tmp";
    try {
      fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", {
        mode: 0o600,
      });
      fs.renameSync(temp, file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }

  saveSettings(value: ReviewSettings) {
    const settings = validateSettings(value);
    if (
      (settings.schedule !== "off" || settings.onChange) &&
      !installedAgents().find((agent) => agent.id === settings.agent)
        ?.executable
    )
      throw new LibraryError(
        "Install and sign in to the selected agent before enabling automatic reviews.",
        409,
      );
    const previous = this.config();
    const resetBaseline =
      !previous.baseline || (!previous.settings.onChange && settings.onChange);
    const baseline = resetBaseline
      ? contextFingerprint(reviewSnapshot(this.library).fingerprint, settings)
      : previous.baseline;
    this.write(this.settingsPath, {
      schema: 1,
      settings,
      baseline,
      baselineAt: resetBaseline
        ? new Date(this.now()).toISOString()
        : previous.baselineAt,
      baselineReportId: resetBaseline
        ? (this.state().reports[0]?.id ?? null)
        : previous.baselineReportId,
      scheduledFrom:
        settings.schedule === "off"
          ? null
          : previous.settings.schedule === settings.schedule &&
              previous.scheduledFrom
            ? previous.scheduledFrom
            : new Date(this.now()).toISOString(),
    });
    return settings;
  }

  private scheduledAt(config: SettingsFile, state: ReviewState) {
    if (config.settings.schedule === "off" || !config.scheduledFrom)
      return null;
    const latest = state.reports[0];
    const from = Math.max(
      Date.parse(config.scheduledFrom),
      latest ? Date.parse(latest.startedAt) : 0,
    );
    return from + (config.settings.schedule === "weekly" ? 7 : 30) * day;
  }

  status() {
    const config = this.config(),
      state = this.state();
    const snapshot = reviewSnapshot(this.library);
    const fingerprint = contextFingerprint(
      snapshot.fingerprint,
      config.settings,
    );
    const scheduledAt = this.scheduledAt(config, state);
    const running = lockfile.checkSync(this.statePath, lockOptions);
    return {
      settings: config.settings,
      running,
      attempt:
        state.attempt?.status === "running" && !running
          ? {
              ...state.attempt,
              status: "failed" as const,
              error:
                "The previous review was interrupted. Run a new review to retry.",
            }
          : state.attempt,
      scheduledAt:
        scheduledAt === null ? null : new Date(scheduledAt).toISOString(),
      reports: state.reports.map(
        ({ report: _report, snapshot: savedSnapshot, ...report }) => ({
          ...report,
          skillCount: savedSnapshot.skills.length,
          stale: report.reviewFingerprint !== fingerprint,
          libraryChanged: savedSnapshot.fingerprint !== snapshot.fingerprint,
        }),
      ),
    };
  }

  report(id: string) {
    const report = this.state().reports.find((item) => item.id === id);
    if (!report) throw new LibraryError("Review report not found.", 404);
    return report;
  }

  private acquire(signal: AbortController) {
    fs.mkdirSync(this.library.state, { recursive: true, mode: 0o700 });
    try {
      return lockfile.lockSync(this.statePath, {
        ...lockOptions,
        onCompromised: (error) => signal.abort(error),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOCKED")
        throw new LibraryError(
          "A setup review is already running. Wait for it to finish.",
          409,
        );
      throw error;
    }
  }

  private async execute(
    settings: ReviewSettings,
    trigger: Trigger,
    snapshot: ReturnType<typeof reviewSnapshot>,
    signal: AbortSignal,
  ) {
    const state = this.state();
    const startedAt = new Date(this.now()).toISOString();
    state.attempt = { at: startedAt, trigger, status: "running" };
    this.write(this.statePath, state);
    try {
      const result = await this.runner(this.library, settings.agent, {
        ...settings,
        snapshot,
        signal,
      });
      signal.throwIfAborted();
      const report: SavedReview = {
        ...result,
        at: new Date(this.now()).toISOString(),
        id: randomUUID(),
        startedAt,
        trigger,
        model: settings.model,
        context: settings.context,
        reviewFingerprint: contextFingerprint(snapshot.fingerprint, settings),
        snapshot: {
          fingerprint: snapshot.fingerprint,
          skills: snapshot.inventory.skills.map(({ name, revision }) => ({
            name,
            revision,
          })),
          scanIssues: snapshot.inventory.scanIssues,
        },
      };
      state.reports = [report, ...state.reports].slice(0, 10);
      state.attempt = { at: startedAt, trigger, status: "completed" };
      this.write(this.statePath, state);
      return report;
    } catch (error) {
      // A successor may own the state once the lease is lost.
      if (signal.aborted) throw error;
      state.attempt = {
        at: startedAt,
        trigger,
        status: "failed",
        error: (error as Error).message,
      };
      this.write(this.statePath, state);
      throw error;
    }
  }

  async run(agent?: Tool, model?: string, context?: string) {
    const signal = new AbortController(),
      release = this.acquire(signal);
    try {
      const configured = this.config().settings;
      const settings = validateSettings({
        ...configured,
        agent: agent ?? configured.agent,
        model: model ?? configured.model,
        context: context ?? configured.context,
      });
      return await this.execute(
        settings,
        "manual",
        reviewSnapshot(this.library),
        signal.signal,
      );
    } finally {
      if (!signal.signal.aborted) release();
    }
  }

  async runDue() {
    const initial = this.config().settings;
    if (initial.schedule === "off" && !initial.onChange)
      return { skipped: "Automatic reviews are off." };
    const signal = new AbortController();
    let release: () => void;
    try {
      release = this.acquire(signal);
    } catch (error) {
      if (error instanceof LibraryError && error.status === 409)
        return { skipped: error.message };
      throw error;
    }
    try {
      // Eligibility must be checked under the same lock as the agent run.
      const config = this.config(),
        state = this.state(),
        now = this.now();
      if (config.settings.schedule === "off" && !config.settings.onChange)
        return { skipped: "Automatic reviews are off." };
      const snapshot = reviewSnapshot(this.library);
      if (
        !snapshot.inventory.skills.length ||
        snapshot.inventory.scanIssues.length
      )
        return {
          skipped:
            "Automatic review needs a nonempty inventory with no scan errors.",
        };
      const fingerprint = contextFingerprint(
        snapshot.fingerprint,
        config.settings,
      );
      if (state.observed?.fingerprint !== fingerprint) {
        state.observed = { fingerprint, at: new Date(now).toISOString() };
        this.write(this.statePath, state);
        return {
          skipped:
            "Waiting for the library and model context to stay unchanged for 60 seconds.",
        };
      }
      if (now - Date.parse(state.observed.at) < 60_000)
        return {
          skipped:
            "Waiting for the library and model context to stay unchanged for 60 seconds.",
        };
      if (state.attempt && now - Date.parse(state.attempt.at) < day)
        return {
          skipped: "Automatic reviews are limited to one attempt per 24 hours.",
        };
      const scheduledAt = this.scheduledAt(config, state);
      const latest = state.reports[0];
      const latestStarted = latest ? Date.parse(latest.startedAt) : 0;
      const baselineAt = config.baselineAt ? Date.parse(config.baselineAt) : 0;
      const baseline =
        latest &&
        (latestStarted > baselineAt ||
          (latestStarted === baselineAt &&
            latest.id !== config.baselineReportId))
          ? latest.reviewFingerprint
          : config.baseline;
      const trigger =
        config.settings.onChange && baseline && baseline !== fingerprint
          ? "change"
          : scheduledAt !== null && now >= scheduledAt
            ? "schedule"
            : null;
      if (!trigger) return { skipped: "No review is due." };
      return {
        report: await this.execute(
          config.settings,
          trigger,
          snapshot,
          signal.signal,
        ),
      };
    } finally {
      if (!signal.signal.aborted) release();
    }
  }
}
