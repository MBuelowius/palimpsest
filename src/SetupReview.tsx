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
          <DialogTitle>Review skill setup</DialogTitle>
          <DialogDescription>
            Review personal skills with an installed agent. Its CLI handles your
            account and model. Skill paths and reviewed content are sent to that
            agent’s configured provider. A run may use paid tokens.
          </DialogDescription>
        </DialogHeader>
        <div className="setup-review-controls">
          <label htmlFor="review-agent">Agent</label>
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
            {running ? "Reviewing…" : result ? "Run again" : "Run review"}
          </Button>
        </div>
        <p className="field-hint">
          Reviews propose changes only. Codex uses its read-only sandbox; Claude
          uses planning mode with file-reading tools. Plugins and system skills
          are outside this review.
        </p>
        {loading && <p role="status">Checking installed agents…</p>}
        {!loading && !error && !agents.some((item) => item.executable) && (
          <p>
            Install Codex or Claude Code and sign in through its CLI, then
            reopen this review.
          </p>
        )}
        {running && (
          <p role="status">
            Your agent is reviewing the current setup. Usually 1–3 minutes;
            stops after 5 minutes. You can close this dialog and reopen it to
            see the result.
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
                {new Date(result.at).toLocaleString()} · Snapshot at run time
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
