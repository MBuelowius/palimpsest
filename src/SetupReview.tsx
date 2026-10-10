import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { api, type ReviewAgent, type ReviewReport } from "./api";
import type { Tool } from "../server/library";

export function SetupReview({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [agents, setAgents] = useState<ReviewAgent[]>([]);
  const [agent, setAgent] = useState<Tool>("codex");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReviewReport>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    api
      .reviewAgents()
      .then((items) => {
        if (!active) return;
        setAgents(items);
        const available = items.find((item) => item.executable);
        if (available) setAgent(available.id);
        setError("");
      })
      .catch((error: Error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);
  async function review() {
    setRunning(true);
    setError("");
    setCopied(false);
    try {
      setResult(await api.reviewSetup(agent));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setRunning(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="setup-review-dialog">
        <DialogHeader>
          <DialogTitle>Improve your skills</DialogTitle>
          <DialogDescription>
            Get suggestions from Codex or Claude Code. The review uses your
            existing account, sends the skill content to that app’s provider,
            and may incur usage charges.
          </DialogDescription>
        </DialogHeader>
        <div className="setup-review-controls">
          <label htmlFor="review-agent">Review with</label>
          <select
            id="review-agent"
            value={agent}
            disabled={loading || running}
            onChange={(event) => setAgent(event.target.value as Tool)}
          >
            {agents.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.executable}>
                {item.label}
                {!item.executable ? " · Not installed" : ""}
              </option>
            ))}
          </select>
          <Button
            onClick={() => void review()}
            disabled={
              loading ||
              running ||
              !agents.find((item) => item.id === agent)?.executable
            }
          >
            {running && <Loader2 size={15} className="spin" />}
            {running
              ? "Reviewing…"
              : result
                ? "Review again"
                : "Review my skills"}
          </Button>
        </div>
        <p className="field-hint">
          The review suggests changes without editing your files. It covers your
          personal skills; skills provided by apps or plugins are excluded.
        </p>
        {loading && (
          <p role="status">Checking which app can review your skills…</p>
        )}
        {!loading && !error && !agents.some((item) => item.executable) && (
          <p>
            Install Codex or Claude Code and sign in from its command line app,
            then reopen this review.
          </p>
        )}
        {running && (
          <p role="status">
            Your app is reviewing your skills. Usually 1–3 minutes; stops after
            5 minutes. You can close this dialog and reopen it to see the
            result.
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {result && (
          <section aria-label="Agent review report" aria-busy={running}>
            <div className="setup-review-controls">
              <p className="field-hint">
                {result.agent === "codex" ? "Codex" : "Claude Code"} ·{" "}
                {new Date(result.at).toLocaleString()} · Skills as they were
                when reviewed
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
            <pre className="setup-review-report">{result.report}</pre>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
