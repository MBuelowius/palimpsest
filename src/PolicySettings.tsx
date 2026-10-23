import { useRef, useState } from "react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./components/ui/dialog";
import { api, type PolicyState, type PolicyPreview } from "./api";
import { toolName } from "../shared/harnesses";
import { ScanFindings } from "./ScanFindings";

export function PolicySettings({
  policy,
  onPolicyChange,
  onChanged,
  onNotice,
}: {
  policy: PolicyState;
  onPolicyChange: (policy: PolicyState) => void;
  onChanged: (message: string) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PolicyPreview>();
  const reviewButton = useRef<HTMLButtonElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const connected = "policy" in policy ? policy : undefined;
  const count =
    connected?.drift.filter(
      (item) => item.kind === "missing" || item.kind === "version",
    ).length ?? 0;
  const summary = connected
    ? [
        connected.policy.sources.github !== undefined &&
          `Allows ${connected.policy.sources.github.length} ${connected.policy.sources.github.length === 1 ? "collection" : "collections"}.`,
        !connected.policy.sources.skillsMd && "skills.md is off.",
        !!connected.policy.skills.length &&
          `Requires ${connected.policy.skills.length} ${connected.policy.skills.length === 1 ? "skill" : "skills"}.`,
        !!connected.policy.blocked.length &&
          `Blocks ${connected.policy.blocked.length}.`,
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  async function connect(repository?: string) {
    setBusy(true);
    setError("");
    try {
      onPolicyChange(await api.connectPolicy(repository));
      setRepo("");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      onPolicyChange(await api.disconnectPolicy());
      onNotice(`Disconnected ${connected!.repo}. Your skills are unchanged.`);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function review() {
    setBusy(true);
    setError("");
    try {
      setPreview(await api.policyPreview());
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setError("");
    try {
      await api.applyPolicy(preview!);
      await onChanged(
        "Skill policy applied. You can restore this change from Backups.",
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPreview(undefined);
      setBusy(false);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="policy-title">
      <h2 id="policy-title">Skill policy</h2>
      {connected ? (
        <>
          <div className="maintenance-row">
            <div className="min-w-0 wrap-anywhere">
              <h3>{connected.repo}</h3>
              <p>
                Commit {connected.commit.slice(0, 7)}, checked{" "}
                {new Date(connected.checkedAt).toLocaleString()}.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                ref={refreshButton}
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void connect()}
              >
                Refresh
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                Disconnect
              </Button>
            </div>
          </div>
          {summary && <p>{summary}</p>}
          {connected.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          {connected.drift.length ? (
            <>
              <h3>Differences on this computer</h3>
              <div className="app-overview">
                {connected.drift.map((item, index) => (
                  <div className="app-overview-row" key={index}>
                    <div className="min-w-0 wrap-anywhere">
                      <strong>{item.name ?? item.repo}</strong>
                      <small>{item.reason}</small>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p>This computer matches the policy.</p>
          )}
          <div className="maintenance-row">
            <div>
              <h3>Install required skills</h3>
              <p>
                {count
                  ? `${count} ${count === 1 ? "skill" : "skills"} to install or move to the pinned commit.`
                  : connected.drift.some((item) => item.kind === "name-taken")
                    ? "Required skills need review above."
                    : "Required skills match the policy."}
              </p>
            </div>
            <Button
              ref={reviewButton}
              variant="outline"
              size="sm"
              disabled={busy || !count}
              onClick={() => void review()}
            >
              {busy ? "Working…" : "Review changes"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p>
            Follow a policy file from a GitHub repository. It sets which
            collections are allowed, which skills to install and at which
            commit, and which skills are blocked.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void connect(repo);
            }}
          >
            <label htmlFor="policy-repository">Policy repository</label>
            <div className="maintenance-row">
              <Input
                id="policy-repository"
                placeholder="owner/repository"
                value={repo}
                disabled={busy}
                onChange={(event) => setRepo(event.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                type="submit"
                disabled={busy || !repo.trim()}
              >
                {busy ? "Connecting…" : "Connect"}
              </Button>
            </div>
          </form>
          <p>
            Public repositories only. Palimpsest reads palimpsest-policy.yaml
            and runs nothing from the repository.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open && !busy) setPreview(undefined);
        }}
      >
        <DialogContent
          className="sync-dialog wrap-anywhere"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (reviewButton.current?.disabled
              ? refreshButton
              : reviewButton
            ).current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Apply skill policy</DialogTitle>
            <DialogDescription>
              Adds these skills to{" "}
              {preview?.tools.map((tool) => toolName(tool)).join(", ")}. You can
              restore this change from Backups.
            </DialogDescription>
          </DialogHeader>
          {preview?.changes.map((change) => (
            <div key={change.name}>
              <div className="app-overview-row">
                <div>
                  <strong>{change.name}</strong>
                  <small>
                    {change.action === "install"
                      ? "Install"
                      : `Update to ${change.commit.slice(0, 7)}`}
                  </small>
                </div>
                {change.edited && (
                  <Badge variant="outline">Replaces local edits</Badge>
                )}
              </div>
              <ScanFindings scan={change.scan} />
            </div>
          ))}
          {!!preview?.skipped.length && (
            <section aria-label="Skills not included">
              <h3>Skills not included</h3>
              {preview.skipped.map((item) => (
                <p key={item.name}>
                  <strong>{item.name}</strong>: {item.reason}
                </p>
              ))}
            </section>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setPreview(undefined)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy || !preview?.changes.length}
              onClick={() => void apply()}
            >
              {busy ? "Applying…" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
