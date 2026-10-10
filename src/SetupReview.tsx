import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  api,
  type ReviewAgent,
  type ReviewReport,
  type ReviewSettings,
  type ReviewStatus,
} from "./api";
import type { Tool } from "../server/library";

const triggerLabels = {
  manual: "Manual",
  schedule: "Scheduled",
  change: "Library or model context changed",
};

export function SetupReview({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [agents, setAgents] = useState<ReviewAgent[]>([]);
  const [settings, setSettings] = useState<ReviewSettings>();
  const [status, setStatus] = useState<ReviewStatus>();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [result, setResult] = useState<ReviewReport>();
  const [reportLoading, setReportLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    Promise.all([api.reviewAgents(), api.reviewStatus()])
      .then(([items, next]) => {
        if (!active) return;
        setAgents(items);
        setStatus(next);
        setSettings(next.settings);
        setSelectedId((current) =>
          next.reports.some((report) => report.id === current)
            ? current
            : (next.reports[0]?.id ?? ""),
        );
        setError("");
        setNotice("");
      })
      .catch((error: Error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const timer = setInterval(() => {
      api
        .reviewStatus()
        .then((next) => {
          if (!active) return;
          setStatus(next);
          setSelectedId((current) =>
            next.reports.some((report) => report.id === current)
              ? current
              : (next.reports[0]?.id ?? ""),
          );
        })
        .catch((error: Error) => {
          if (active) setError(error.message);
        });
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !selectedId) return;
    let active = true;
    setReportLoading(true);
    setResult(undefined);
    setCopied(false);
    api
      .reviewReport(selectedId)
      .then((report) => {
        if (active) setResult(report);
      })
      .catch((error: Error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setReportLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, selectedId]);

  const running = submitting || status?.running;
  const dirty =
    settings &&
    status &&
    JSON.stringify(settings) !== JSON.stringify(status.settings);
  const selected = status?.reports.find((report) => report.id === selectedId);
  const update = (patch: Partial<ReviewSettings>) =>
    setSettings((current) => (current ? { ...current, ...patch } : current));

  async function review() {
    if (!settings) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const report = await api.reviewSetup(
        settings.agent,
        settings.model,
        settings.context,
      );
      setResult(report);
      setSelectedId(report.id);
      setStatus(await api.reviewStatus());
      setNotice("Review complete. The report is saved below.");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      setSettings(await api.saveReviewSettings(settings));
      setStatus(await api.reviewStatus());
      setNotice("Review preferences saved.");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="setup-review-dialog">
        <DialogHeader>
          <DialogTitle>Review skill setup</DialogTitle>
          <DialogDescription>
            Find skills to keep, refine, combine, or consider retiring. Reviews
            propose changes only. Skill paths and inspected content go to the
            selected agent’s configured provider and may use paid tokens.
          </DialogDescription>
        </DialogHeader>
        {running && (
          <p role="status">
            Review in progress. Usually 1–3 minutes; stops after 5 minutes. You
            can close this dialog or reload; completed reports are saved.
          </p>
        )}
        {status?.attempt?.status === "failed" && (
          <p role="alert" className="form-error">
            Last review failed: {status.attempt.error}
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {loading && <p role="status">Loading review preferences…</p>}
        {settings && (
          <>
            <div className="setup-review-controls">
              <label htmlFor="review-agent">Reviewer</label>
              <select
                id="review-agent"
                value={settings.agent}
                disabled={loading || saving}
                onChange={(event) =>
                  update({ agent: event.target.value as Tool, model: "" })
                }
              >
                {agents.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={!item.executable}
                  >
                    {item.label}
                    {!item.executable ? " · Not installed" : ""}
                  </option>
                ))}
              </select>
              <Button
                onClick={() => void review()}
                disabled={
                  loading ||
                  saving ||
                  running ||
                  !!dirty ||
                  !agents.find((item) => item.id === settings.agent)?.executable
                }
              >
                {running && (
                  <Loader2 size={15} className="spin" aria-hidden="true" />
                )}
                {running ? "Reviewing…" : "Run review"}
              </Button>
              <Button
                variant="outline"
                className="review-save-button"
                onClick={() => void save()}
                disabled={!dirty || saving || loading}
              >
                {saving
                  ? "Saving…"
                  : (settings.schedule !== "off" || settings.onChange) &&
                      status?.settings.schedule === "off" &&
                      !status.settings.onChange
                    ? "Save and enable automatic reviews"
                    : "Save preferences"}
              </Button>
            </div>
            {dirty && (
              <p className="field-hint">
                Save preferences before running a review.
              </p>
            )}
            <div className="review-settings-grid">
              <section
                className="review-preferences"
                aria-labelledby="review-model-heading"
              >
                <h3 id="review-model-heading">Model context</h3>
                <label className="field-label" htmlFor="review-model">
                  Reviewer model (optional)
                </label>
                <Input
                  id="review-model"
                  value={settings.model}
                  disabled={saving}
                  maxLength={128}
                  placeholder="Use the agent CLI’s configured default"
                  onChange={(event) => update({ model: event.target.value })}
                />
                <p className="field-hint">
                  An empty model uses your CLI configuration; its actual model
                  is unverified.
                </p>
                <label className="field-label" htmlFor="review-context">
                  Models and workflows these skills should support
                </label>
                <Textarea
                  id="review-context"
                  value={settings.context}
                  disabled={saving}
                  maxLength={2000}
                  placeholder="Name your target models and the tasks where skills should help."
                  onChange={(event) => update({ context: event.target.value })}
                />
              </section>
              <section
                className="review-preferences"
                aria-labelledby="review-automatic-heading"
              >
                <h3 id="review-automatic-heading">Automatic reviews</h3>
                <div className="setup-review-controls review-schedule">
                  <label htmlFor="review-schedule">Repeat review</label>
                  <select
                    id="review-schedule"
                    value={settings.schedule}
                    disabled={saving}
                    onChange={(event) =>
                      update({
                        schedule: event.target
                          .value as ReviewSettings["schedule"],
                      })
                    }
                  >
                    <option value="off">Off</option>
                    <option value="weekly">Every 7 days</option>
                    <option value="monthly">Every 30 days</option>
                  </select>
                </div>
                <div className="review-change-control">
                  <div>
                    <label htmlFor="review-on-change">
                      Review after library or model context changes
                    </label>
                    <p className="field-hint">
                      Includes added, edited, removed, and enabled skills.
                    </p>
                  </div>
                  <Switch
                    id="review-on-change"
                    checked={settings.onChange}
                    disabled={saving}
                    onCheckedChange={(onChange) => update({ onChange })}
                  />
                </div>
                <p className="field-hint">
                  Automatic reviews use this reviewer while the local server is
                  running. Changes must settle for 60 seconds; automatic
                  attempts are at least 24 hours apart, including after
                  failures. Saving enabled triggers authorizes unattended
                  provider use. Nothing is edited or deleted automatically.
                </p>
                {status?.scheduledAt && (
                  <p className="field-hint">
                    Next recurring review:{" "}
                    {new Date(status.scheduledAt).toLocaleString()} (subject to
                    the 24-hour limit).
                  </p>
                )}
              </section>
            </div>
          </>
        )}
        <p className="field-hint">
          Codex uses its read-only sandbox; Claude uses planning mode with
          file-reading tools. Plugins and system skills are outside this review.
          Usage and model performance are not measured; retirement and
          refinement proposals need evidence from representative tasks.
        </p>
        {!loading && !error && !agents.some((item) => item.executable) && (
          <p>
            Install Codex or Claude Code and sign in through its CLI, then
            reopen this review.
          </p>
        )}
        {!!status?.reports.length && (
          <div className="setup-review-controls">
            <label htmlFor="review-history">Saved reports</label>
            <select
              id="review-history"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {status.reports.map((report) => (
                <option key={report.id} value={report.id}>
                  {new Date(report.at).toLocaleString()} ·{" "}
                  {triggerLabels[report.trigger]}
                </option>
              ))}
            </select>
            <span className="field-hint">Last 10 reports kept locally.</span>
          </div>
        )}
        {reportLoading && <p role="status">Loading report…</p>}
        {result && result.id === selectedId && !reportLoading && selected && (
          <section aria-label="Agent review report" aria-busy={!!running}>
            <div className="setup-review-controls">
              <p className="field-hint">
                {result.agent === "codex" ? "Codex" : "Claude Code"} ·{" "}
                {result.model || "Configured default (unverified)"} ·{" "}
                {selected.skillCount} skills · {triggerLabels[result.trigger]}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(result.report);
                    setCopied(true);
                  } catch {
                    setError(
                      "Could not copy the report. Select its text and copy manually.",
                    );
                  }
                }}
              >
                {copied ? "Copied" : "Copy report"}
              </Button>
            </div>
            {selected.stale && (
              <p className="review-stale" role="status">
                {selected.libraryChanged
                  ? "The library changed since this review started."
                  : "The reviewer or model context changed since this review."}{" "}
                Run a new review before acting on its proposals.
              </p>
            )}
            {result.context && (
              <p className="field-hint">Reviewed for: {result.context}</p>
            )}
            <pre className="setup-review-report">{result.report}</pre>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
