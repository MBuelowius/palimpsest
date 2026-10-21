import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, type UpdatePreview } from "./api";

export function UpdateDialog({
  names,
  onClose,
  onDone,
}: {
  names: string[] | null;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [previews, setPreviews] = useState<UpdatePreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = names?.join("\n");
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    if (!names) return;
    opener.current = document.activeElement;
    let active = true;
    setPreviews([]);
    setError("");
    setLoading(true);
    Promise.all(names.map((name) => api.updatePreview(name)))
      .then((list) => active && setPreviews(list))
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [key]);
  async function apply() {
    setBusy(true);
    setError("");
    try {
      const { updated, failed } = await api.applyUpdates(
        previews.map(({ name, hash }) => ({ name, hash })),
      );
      const parts = [];
      if (updated.length)
        parts.push(
          `Updated ${updated.join(", ")}. The previous ${updated.length === 1 ? "version is" : "versions are"} in Backups.`,
        );
      if (failed.length)
        parts.push(failed.map((f) => `${f.name}: ${f.reason}`).join(" "));
      await onDone(parts.join(" "));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const single = previews.length === 1 ? previews[0] : undefined;
  return (
    <Dialog
      open={!!names}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="update-dialog"
        onCloseAutoFocus={(event) => {
          // The button that opened this is gone once the update is applied.
          if (opener.current?.isConnected) return;
          event.preventDefault();
          [...document.querySelectorAll<HTMLElement>('h1[tabindex="-1"]')]
            .find((heading) => heading.offsetParent)
            ?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {names?.length === 1 ? `Update ${names[0]}` : "Update skills"}
          </DialogTitle>
          <DialogDescription>
            Review what changes first. Each skill’s current version is saved in
            Backups before it is replaced.
          </DialogDescription>
        </DialogHeader>
        {loading && <p role="status">Comparing versions…</p>}
        <div className="update-list">
          {previews.map((preview) => (
            <section key={preview.name} className="update-item">
              <h3>{preview.name}</h3>
              <p className="muted">
                From {preview.repo}.{" "}
                {preview.files.length === 1
                  ? "1 file changes."
                  : `${preview.files.length} files change.`}
              </p>
              {preview.edited && (
                <p className="review-notes">
                  You changed this skill after adding it. Updating replaces
                  those changes with the newer version.
                </p>
              )}
              {preview.files.map((file) => (
                <details
                  key={file.file}
                  className="diff-panel"
                  open={file.change === "changed" && file.file === "SKILL.md"}
                >
                  <summary>
                    <code>{file.file}</code> · {file.change}
                  </summary>
                  {file.patch ? (
                    <pre>
                      {file.patch
                        .split("\n")
                        .slice(4)
                        .map((line, index) => (
                          <span
                            key={index}
                            className={
                              line.startsWith("+")
                                ? "diff-added"
                                : line.startsWith("-")
                                  ? "diff-removed"
                                  : ""
                            }
                          >
                            {line}
                            {"\n"}
                          </span>
                        ))}
                    </pre>
                  ) : (
                    <p className="muted">This file can’t be shown as text.</p>
                  )}
                </details>
              ))}
            </section>
          ))}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || loading || !previews.length}
            onClick={() => void apply()}
          >
            {busy && <Loader2 size={15} className="spin" />}
            {single ? "Update skill" : `Update ${previews.length} skills`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
