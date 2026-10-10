import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Plus,
  Search,
  Loader2,
  ChevronRight,
  Store,
  RefreshCw,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  type Marketplace,
  type CatalogueSkill,
  type MarketplacePreview,
} from "./api";
import type { Tool } from "../server/library";
import type { Harness } from "../server/harnesses";
import { HarnessChoice } from "./HarnessChoice";
import { skillIssueText } from "./skillCopy";

const MarkdownContent = lazy(() =>
  import("./MarkdownContent").then((module) => ({
    default: module.MarkdownContent,
  })),
);

export function MarketplacesPage({
  harnesses,
  onInstalled,
}: {
  harnesses: Harness[];
  onInstalled: () => Promise<void>;
}) {
  const [sources, setSources] = useState<Marketplace[]>([]);
  const [selected, setSelected] = useState("");
  const [skills, setSkills] = useState<CatalogueSkill[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<MarketplacePreview | null>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const openedSkill = useRef<string | undefined>(undefined);
  const [tools, setTools] = useState<Tool[]>(() =>
    harnesses
      .filter((harness) => harness.detected)
      .map((harness) => harness.id),
  );
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
    api
      .marketplaces()
      .then((list) => {
        setSources(list);
        setSelected(list[0]?.id ?? "");
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let active = true;
    setSkills([]);
    setCatalogueLoading(!!selected);
    if (selected)
      api
        .catalogue(selected)
        .then((list) => {
          if (active) setSkills(list);
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setCatalogueLoading(false);
        });
    return () => {
      active = false;
    };
  }, [selected]);
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
        setSelected(lastSource.id);
        setSkills(await api.catalogue(lastSource.id));
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
      setSkills(await api.catalogue(source.id));
      setMessage(
        updated.commit === source.commit
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
      setMessage(preview.name + " added to your library and selected apps.");
      setPreview(null);
      await onInstalled();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const current = sources.find((source) => source.id === selected);
  const filtered = skills.filter((skill) =>
    (skill.name + " " + skill.description)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  if (preview) {
    const fileUrl = new URL(
      preview.path.split("/").map(encodeURIComponent).join("/") + "/SKILL.md",
      `https://github.com/${preview.source.repo}/blob/${preview.source.commit}/`,
    ).href;
    return (
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
            Back to Discover
          </Button>
        </div>
        <header className="detail-header">
          <h1 id="discovered-skill-title" ref={previewHeading} tabIndex={-1}>
            {preview.name}
          </h1>
          <p className="skill-description">
            {preview.description || "No description yet."}
          </p>
          <p className="muted">
            From{" "}
            <a
              className="text-action"
              href={preview.source.url}
              target="_blank"
              rel="noreferrer"
            >
              {preview.source.repo}
            </a>
          </p>
        </header>
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
        <section className="install-apps" aria-labelledby="install-apps-title">
          <h2 id="install-apps-title">Use in these apps</h2>
          <HarnessChoice
            harnesses={harnesses}
            tools={tools}
            setTools={setTools}
            disabled={busy}
          />
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="inline-actions">
            <Button
              disabled={busy || !preview.installable || !tools.length}
              onClick={() => void install()}
            >
              {busy && <Loader2 size={15} className="spin" />}Add to library
            </Button>
          </div>
        </section>
      </section>
    );
  }
  return (
    <section className="marketplaces">
      <div className="marketplace-actions">
        <p className="muted">
          Browse a collection, find a useful skill, and add it to your apps.
        </p>
        <Button
          onClick={() => {
            setError("");
            setAddOpen(true);
          }}
          size="sm"
        >
          <Plus size={15} />
          Add collection
        </Button>
      </div>
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
      <div className="marketplace-layout">
        <aside className="marketplace-sources" aria-label="Skill collections">
          {sources.map((source) => (
            <button
              key={source.id}
              className={selected === source.id ? "source-selected" : ""}
              disabled={busy}
              aria-pressed={selected === source.id}
              onClick={() => {
                setSelected(source.id);
                setError("");
                setMessage("");
              }}
            >
              <Store size={16} />
              <span>{source.repo}</span>
            </button>
          ))}
          <h3>Collections to try</h3>
          <button
            disabled={
              busy ||
              sources.some((s) => s.repo.toLowerCase() === "anthropics/skills")
            }
            onClick={() => void add("anthropics/skills")}
          >
            Anthropic skills
            <Plus size={14} />
          </button>
          <button
            disabled={
              busy ||
              sources.some((s) => s.repo.toLowerCase() === "openai/skills")
            }
            onClick={() => void add("openai/skills")}
          >
            OpenAI skills
            <Plus size={14} />
          </button>
          {busy && !preview && (
            <p className="muted">
              <Loader2 size={14} className="spin" /> Loading collection…
            </p>
          )}
        </aside>
        <div className="marketplace-catalogue">
          {current ? (
            <>
              <div className="catalogue-heading">
                <div>
                  <h2>{current.repo}</h2>
                  <p className="muted">
                    {skills.length} {skills.length === 1 ? "skill" : "skills"} ·
                    Checked{" "}
                    {new Date(
                      current.refreshedAt ?? current.addedAt,
                    ).toLocaleDateString()}
                  </p>
                </div>
                <div className="catalogue-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || catalogueLoading}
                    onClick={() => void refreshSource(current)}
                  >
                    <RefreshCw size={14} className={busy ? "spin" : ""} />
                    Check for new skills
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        await api.removeMarketplace(current.id);
                        const list = await api.marketplaces();
                        setSources(list);
                        setSelected(list[0]?.id ?? "");
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Remove collection
                  </Button>
                </div>
              </div>
              <div className="search-field">
                <Search size={16} />
                <Input
                  aria-label="Search skills in this collection"
                  placeholder="What do you want help with?"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="marketplace-skill-list">
                {filtered.map((skill) => (
                  <button
                    key={skill.id}
                    data-catalogue-skill={skill.id}
                    disabled={busy}
                    onClick={async () => {
                      openedSkill.current = skill.id;
                      setError("");
                      try {
                        setTools(
                          harnesses
                            .filter((harness) => harness.detected)
                            .map((harness) => harness.id),
                        );
                        setPreview(
                          await api.marketplacePreview(current.id, skill.id),
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <span>
                      <strong>{skill.name}</strong>
                      <small>
                        {skill.description || "No description yet."}
                      </small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
                {!filtered.length && (
                  <p className="empty" role="status">
                    {catalogueLoading
                      ? "Loading skills…"
                      : "No matching skills."}
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="empty">
              <Store size={24} />
              <p>
                Choose a collection to find skills, or add one you already know.
              </p>
            </div>
          )}
        </div>
      </div>
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!busy) setAddOpen(open);
        }}
      >
        <DialogContent className="marketplace-add">
          <DialogHeader>
            <DialogTitle>Add a skill collection</DialogTitle>
            <DialogDescription>
              Paste the public GitHub link for a collection of skills. You can
              add several links, one per line.
            </DialogDescription>
          </DialogHeader>
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
              placeholder={"https://github.com/owner/repository\nopenai/skills"}
              rows={4}
              required
              disabled={busy}
            />
            <p className="field-hint">
              Links that work are saved. Any that couldn’t be added stay here so
              you can correct them.
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
  );
}
