import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Plus, Loader2, RefreshCw, ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  api,
  type InventoryView,
  type Marketplace,
  type MarketplacePreview,
  type SkillUpdate,
} from "./api";
import { toolName } from "../shared/harnesses";
import type { Tool } from "../server/library";
import type { Harness } from "../server/harnesses";
import { defaultTools } from "./HarnessChoice";
import { InstallControl } from "./InstallControl";
import { skillIssueText } from "./skillCopy";
import { MarketplaceCatalog, packageFacts } from "./MarketplaceCatalog";
import { ProductHeader } from "./ProductHeader";
import { ScanFindings } from "./ScanFindings";

const MarkdownContent = lazy(() =>
  import("./MarkdownContent").then((module) => ({
    default: module.MarkdownContent,
  })),
);

const list = (items: string[]) =>
  items.length < 2
    ? items.join("")
    : items.slice(0, -1).join(", ") + " and " + items.at(-1);

export function MarketplacesPage({
  harnesses,
  skills,
  updates,
  onInstalled,
  onOpenSkill,
  onUpdate,
}: {
  harnesses: Harness[];
  skills: InventoryView["skills"];
  updates: SkillUpdate[];
  onInstalled: () => Promise<void>;
  onOpenSkill: (name: string) => void;
  onUpdate: (name: string) => void;
}) {
  const [sources, setSources] = useState<Marketplace[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<MarketplacePreview | null>(null);
  const [installs, setInstalls] = useState<number>();
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const openedSkill = useRef<string | undefined>(undefined);
  const openLink = useRef<HTMLButtonElement>(null);
  const [tools, setTools] = useState<Tool[]>(() => defaultTools(harnesses));
  useEffect(() => {
    if (preview) previewHeading.current?.focus();
    else if (openedSkill.current)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>(
            `[data-catalogue-skill="${CSS.escape(openedSkill.current!)}"]`,
          )
          ?.focus(),
      );
  }, [preview?.id]);
  useEffect(() => {
    setInstalls(undefined);
    if (!preview) return;
    let active = true;
    api
      .installs(preview.source.repo, [preview.path.split("/").pop()!])
      .then((counts) => active && setInstalls(Object.values(counts)[0]))
      // Install counts are an extra, so a failed lookup just omits the figure.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [preview?.id]);
  useEffect(() => {
    api
      .marketplaces()
      .then((list) => {
        setSources(list);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function add(value: string) {
    setBusy(true);
    setError("");
    setMessage("");
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
      setSources(await api.marketplaces());
      if (lastSource) {
        const ready = entries.length - failed.length;
        setMessage(
          `${ready} ${ready === 1 ? "collection" : "collections"} ready to browse.`,
        );
      }
      setUrl(failed.join("\n"));
      if (!failed.length) setAddOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refreshSource(source: Marketplace) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const updated = await api.refreshMarketplace(source.id);
      setSources(await api.marketplaces());
      await onInstalled();
      const outdated = (await api.updates()).filter((item) => item.update);
      setMessage(
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
  async function install() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await api.installMarketplaceSkill(preview, tools);
      await onInstalled();
      // The install button is replaced by the installed state, so focus follows it.
      requestAnimationFrame(() => openLink.current?.focus());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const existing =
      preview && skills.find((skill) => skill.name === preview.name),
    origin = preview && updates.find((item) => item.name === preview.name),
    fromHere =
      !!origin &&
      origin.source === preview?.source.id &&
      origin.skillId === preview?.id;
  const fileUrl = preview
    ? new URL(
        preview.path.split("/").map(encodeURIComponent).join("/") + "/SKILL.md",
        `https://github.com/${preview.source.repo}/blob/${preview.source.commit}/`,
      ).href
    : "";
  const skillPreview = preview ? (
    <section
      className="skill-reader marketplace-skill-page"
      aria-labelledby="discovered-skill-title"
    >
      <div className="reader-actions">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => setPreview(null)}
        >
          <ArrowLeft size={16} />
          Back to marketplace
        </Button>
      </div>
      <ProductHeader
        name={preview.name}
        description={preview.description}
        source={
          <>
            From{" "}
            <a
              className="text-action"
              href={preview.source.url}
              target="_blank"
              rel="noreferrer"
            >
              {preview.source.repo}
            </a>
          </>
        }
        facts={[
          [
            "Installs",
            installs === undefined
              ? ""
              : new Intl.NumberFormat("en", { notation: "compact" }).format(
                  installs,
                ),
          ],
          ["Files", String(preview.files.length)],
          ...packageFacts(preview, preview.source),
          [
            "To check",
            preview.issues.length ? String(preview.issues.length) : "",
          ],
        ]}
        headingRef={previewHeading}
        headingId="discovered-skill-title"
        action={
          existing ? (
            <div className="install-panel">
              <ScanFindings scan={preview.scan} />
              <p role="status" className="install-status">
                {fromHere ? (
                  <>
                    <Check size={15} />
                    Installed
                  </>
                ) : (
                  "A skill with this name is already in your library"
                )}
                {existing.tools.length > 0 &&
                  ` · ${list(existing.tools.map((tool) => toolName(tool)))}`}
              </p>
              {fromHere && origin.update && (
                <p className="install-update">
                  <Badge variant="secondary">Update available</Badge>
                  The collection has a newer version.
                </p>
              )}
              <div className="install-actions">
                {fromHere && origin.update && (
                  <Button
                    className="store-add"
                    onClick={() => onUpdate(preview.name)}
                  >
                    Review update
                  </Button>
                )}
                <Button
                  ref={openLink}
                  className="store-add"
                  variant={fromHere && origin.update ? "secondary" : "default"}
                  onClick={() => onOpenSkill(preview.name)}
                >
                  Open in My skills
                </Button>
              </div>
            </div>
          ) : (
            <div className="install-panel">
              <ScanFindings scan={preview.scan} />
              <InstallControl
                harnesses={harnesses}
                tools={tools}
                setTools={setTools}
                busy={busy}
                installable={preview.installable}
                onInstall={() => void install()}
              />
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
            </div>
          )
        }
      />
      {!!preview.issues.length && (
        <div className="review-notes">
          <h2>Check before adding</h2>
          {preview.issues.map((issue) => (
            <p key={issue}>{skillIssueText(issue)}</p>
          ))}
        </div>
      )}
      <section
        className="instructions-section"
        aria-labelledby="discovered-instructions-title"
      >
        <div className="section-heading">
          <h2 id="discovered-instructions-title">What this skill does</h2>
        </div>
        <Suspense fallback={<p className="muted">Loading instructions…</p>}>
          <MarkdownContent
            content={preview.content}
            files={[]}
            fileName="SKILL.md"
            resourceBaseUrl={fileUrl}
          />
        </Suspense>
      </section>
      <section
        className="included-files"
        aria-labelledby="included-files-title"
      >
        <h2 id="included-files-title">Included files</h2>
        <ul>
          {preview.files.map((file) => (
            <li key={file}>
              <a
                href={
                  new URL(
                    file.split("/").map(encodeURIComponent).join("/"),
                    fileUrl,
                  ).href
                }
                target="_blank"
                rel="noreferrer"
              >
                {file}
              </a>
            </li>
          ))}
        </ul>
        <p className="muted">Adding a skill does not run its scripts.</p>
      </section>
    </section>
  ) : null;
  return (
    <>
      {skillPreview}
      <section className="marketplaces" hidden={!!preview}>
        {error && !addOpen && !preview && (
          <p role="alert" className="message error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="message success">
            {message}
          </p>
        )}
        <MarketplaceCatalog
          sources={sources}
          skills={skills}
          updates={updates}
          onManageSources={() => {
            setError("");
            setAddOpen(true);
          }}
          onRepositorySkill={async (sourceId, skillId) => {
            openedSkill.current = skillId;
            setTools(defaultTools(harnesses));
            setPreview(await api.marketplacePreview(sourceId, skillId));
          }}
        />
        <Dialog
          open={addOpen}
          onOpenChange={(open) => {
            if (!busy) setAddOpen(open);
          }}
        >
          <DialogContent className="marketplace-add">
            <DialogHeader>
              <DialogTitle>Manage collections</DialogTitle>
              <DialogDescription>
                Paste the public GitHub link for a collection of skills. You can
                add several links, one per line.
              </DialogDescription>
            </DialogHeader>
            <section
              className="collection-management"
              aria-label="Added collections"
            >
              <div className="collection-management-row">
                <span>
                  skills.md<small>Built-in catalog</small>
                </span>
              </div>
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
                          setSources(await api.marketplaces());
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
              <div className="inline-actions">
                {!sources.some(
                  (source) => source.repo.toLowerCase() === "anthropics/skills",
                ) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void add("anthropics/skills")}
                  >
                    <Plus size={14} />
                    Add Anthropic
                  </Button>
                )}
                {!sources.some(
                  (source) => source.repo.toLowerCase() === "openai/skills",
                ) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void add("openai/skills")}
                  >
                    <Plus size={14} />
                    Add OpenAI
                  </Button>
                )}
              </div>
            </section>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void add(url);
              }}
            >
              <label className="field-label" htmlFor="marketplace-url">
                Collection links
              </label>
              <Textarea
                id="marketplace-url"
                aria-label="Collection links"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={
                  "https://github.com/owner/repository\nopenai/skills"
                }
                rows={4}
                required
                disabled={busy}
              />
              <p className="field-hint">
                Links that work are saved. Any that couldn’t be added stay here
                so you can correct them.
              </p>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button type="submit" disabled={busy || !url.trim()}>
                  {busy && <Loader2 className="spin" size={15} />}{" "}
                  {busy ? "Loading…" : "Add collection"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </section>
    </>
  );
}
