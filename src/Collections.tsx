import { useId, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, type Marketplace } from "./api";
import { SuggestedCollections } from "./SuggestedCollections";

export function Collections({
  sources,
  onSourcesChange,
  onMessage,
  onAdded,
}: {
  sources: Marketplace[];
  onSourcesChange: (sources: Marketplace[]) => Promise<void>;
  onMessage: (message: string) => void;
  onAdded?: () => void;
}) {
  const urlId = useId();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function add(value: string) {
    setBusy(true);
    setError("");
    onMessage("");
    const entries = [
      ...new Set(
        value
          .split(/[\n,]+/)
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    ];
    const failed: string[] = [];
    let lastSource: Marketplace | undefined;
    try {
      for (const entry of entries) {
        try {
          lastSource = await api.addMarketplace(entry);
        } catch (error) {
          failed.push(entry);
          setError((error as Error).message);
        }
      }
      await onSourcesChange(await api.marketplaces());
      if (lastSource) {
        const ready = entries.length - failed.length;
        onMessage(
          `${ready} ${ready === 1 ? "collection" : "collections"} ready to browse.`,
        );
      }
      setUrl(failed.join("\n"));
      if (!failed.length) onAdded?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refreshSource(source: Marketplace) {
    setBusy(true);
    setError("");
    onMessage("");
    try {
      const updated = await api.refreshMarketplace(source.id);
      await onSourcesChange(await api.marketplaces());
      const outdated = (await api.updates()).filter((item) => item.update);
      onMessage(
        outdated.length
          ? `${outdated.length} of your skills ${outdated.length === 1 ? "has an update" : "have updates"}. Open My skills to review ${outdated.length === 1 ? "it" : "them"}.`
          : updated.commit === source.commit
            ? "This collection is up to date."
            : "New skills are ready to browse. Skills you’ve already added stay as they are.",
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="collection-management" aria-label="Added collections">
        {sources.map((source) => (
          <div className="collection-management-row" key={source.id}>
            <span>
              {source.repo}
              <small>
                Checked{" "}
                {new Date(
                  source.refreshedAt ?? source.addedAt,
                ).toLocaleDateString()}
              </small>
            </span>
            <div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void refreshSource(source)}
              >
                <RefreshCw size={14} />
                Refresh
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await api.removeMarketplace(source.id);
                    await onSourcesChange(await api.marketplaces());
                  } catch (error) {
                    setError((error as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </section>
      <SuggestedCollections
        sources={sources}
        busy={busy}
        onAdd={(repo) => void add(repo)}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add(url);
        }}
      >
        <label className="field-label" htmlFor={urlId}>
          Collection links
        </label>
        <Textarea
          id={urlId}
          aria-label="Collection links"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={"https://github.com/owner/repository\nopenai/skills"}
          rows={4}
          required
          disabled={busy}
        />
        <p className="field-hint">
          Links that work are saved. Any that couldn’t be added stay here so you
          can correct them.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="inline-actions">
          <Button type="submit" disabled={busy || !url.trim()}>
            {busy && <Loader2 className="spin" size={15} />}{" "}
            {busy ? "Loading…" : "Add collection"}
          </Button>
        </div>
      </form>
    </>
  );
}
