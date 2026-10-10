import { useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { api, type SyncPlan } from "./api";
import type { Tool } from "../server/library";
import type { Harness } from "../server/harnesses";
import { toolLabel, sourceLabel } from "../shared/harnesses";
import { HarnessChoice } from "./HarnessChoice";

export function SyncSkills({
  harnesses,
  onSynced,
}: {
  harnesses: Harness[];
  onSynced: (message: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [tools, setTools] = useState<Tool[]>([]);
  const [preview, setPreview] = useState<SyncPlan>();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function review() {
    setBusy(true);
    setError("");
    try {
      const plan = await api.syncPlan(tools);
      setPreview(plan);
      setSelected(plan.plans.map((p) => p.name));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sync() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.sync(
        preview.plans.filter((p) => selected.includes(p.name)),
        preview.tools,
      );
      const status = `${result.synced.length} skills synced. ${result.failed.length ? `${result.failed.length} failed; review the errors below.` : "Future edits use the same files in the selected harnesses."}`;
      setMessage(status);
      setPreview(undefined);
      await onSynced(status);
      if (result.failed.length) {
        setError(result.failed.map((p) => `${p.name}: ${p.reason}`).join("\n"));
      } else {
        setOpen(false);
      }
    } catch (error) {
      setError((error as Error).message);
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setTools(
            harnesses
              .filter((harness) => harness.detected)
              .map((harness) => harness.id),
          );
          setOpen(true);
          setPreview(undefined);
          setError("");
          setMessage("");
        }}
      >
        <Link2 size={15} />
        Sync existing skills
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="sync-dialog">
          <DialogHeader>
            <DialogTitle>Sync existing skills</DialogTitle>
            <DialogDescription>
              Share your personal skill packages with the selected harnesses.
              Conflicting versions need individual review. Already shared skills
              keep their folder links.
            </DialogDescription>
          </DialogHeader>
          <HarnessChoice
            harnesses={harnesses}
            tools={tools}
            disabled={busy}
            action="Sync with"
            setTools={(tools) => {
              setTools(tools);
              setPreview(undefined);
            }}
          />
          {message && (
            <p role="status" className="message success">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {preview && (
            <>
              <p className="muted">
                {selected.length} selected · full packages, including references
                and scripts. Each change has a backup in Backups.
              </p>
              <div className="sync-list">
                {preview.plans.map((plan) => (
                  <label key={plan.name} className="sync-item">
                    <Checkbox
                      aria-label={`Sync ${plan.name}`}
                      disabled={busy}
                      checked={selected.includes(plan.name)}
                      onCheckedChange={(checked) =>
                        setSelected(
                          checked
                            ? [...selected, plan.name]
                            : selected.filter((name) => name !== plan.name),
                        )
                      }
                    />
                    <span>
                      <strong>{plan.name}</strong>
                      <small>
                        {plan.files} {plan.files === 1 ? "file" : "files"} ·
                        from {sourceLabel[plan.source]} →{" "}
                        {preview.tools
                          .map((tool) => toolLabel[tool])
                          .join(", ")}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              {!preview.plans.length && (
                <p className="empty">
                  No skills need syncing to the selected harnesses.
                </p>
              )}
              {!!preview.skipped.length && (
                <details>
                  <summary>{preview.skipped.length} skills skipped</summary>
                  {preview.skipped.map((skill) => (
                    <p key={skill.name}>
                      <strong>{skill.name}</strong>: {skill.reason}
                    </p>
                  ))}
                </details>
              )}
            </>
          )}
          <DialogFooter>
            {preview ? (
              <Button
                disabled={busy || !selected.length}
                onClick={() => void sync()}
              >
                {busy && <Loader2 size={15} className="spin" />}Sync{" "}
                {selected.length} skills
              </Button>
            ) : (
              <Button
                disabled={busy || !tools.length}
                onClick={() => void review()}
              >
                {busy && <Loader2 size={15} className="spin" />}Review sync
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
