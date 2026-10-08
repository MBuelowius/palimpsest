import { useEffect, useState } from "react";
import {
  Plus,
  Search,
  Loader2,
  ChevronRight,
  Store,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { harnesses, toolLabel, type Tool } from "../server/harnesses";

export function MarketplacesPage({
  onInstalled,
}: {
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
  const [tools, setTools] = useState<Tool[]>(["claude", "codex"]);
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
          `${ready} marketplace ${ready === 1 ? "source" : "sources"} ready.`,
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
          ? "This marketplace is up to date."
          : "Marketplace refreshed. Installed skill files are preserved.",
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
      setMessage(
        preview.name +
          " installed. Its files are shared with the selected apps.",
      );
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
  return (
    <section className="marketplaces">
      <div className="marketplace-actions">
        <p className="muted">
          Add a public GitHub repository. Skill files stay on this Mac.
        </p>
        <Button
          onClick={() => {
            setError("");
            setAddOpen(true);
          }}
          size="sm"
        >
          <Plus size={15} />
          Add marketplace
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
        <aside className="marketplace-sources" aria-label="Marketplace sources">
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
          <h3>Suggested sources</h3>
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
              <Loader2 size={14} className="spin" /> Downloading repository…
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
                    {skills.length} skills · snapshot{" "}
                    {current.commit.slice(0, 7)}
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
                    Refresh source
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
                    Remove source
                  </Button>
                </div>
              </div>
              <div className="search-field">
                <Search size={16} />
                <Input
                  aria-label="Search marketplace skills"
                  placeholder="Search skills…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="marketplace-skill-list">
                {filtered.map((skill) => (
                  <button
                    key={skill.id}
                    disabled={busy}
                    onClick={async () => {
                      setError("");
                      try {
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
                        {skill.description || "Missing description"}
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
                Add a marketplace or choose a suggested source to browse skills.
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
            <DialogTitle>Add marketplace</DialogTitle>
            <DialogDescription>
              Paste public GitHub repository URLs or owner/repository names, one
              per line. Repositories containing SKILL.md packages are supported,
              including skill folders in plugin marketplaces.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void add(url);
            }}
          >
            <label className="field-label" htmlFor="marketplace-url">
              Repositories
            </label>
            <Textarea
              id="marketplace-url"
              aria-label="Marketplace repositories"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={"https://github.com/owner/repository\nopenai/skills"}
              rows={4}
              required
              disabled={busy}
            />
            <p className="field-hint">
              One repository per line. Successful entries are saved; failed
              entries stay here for correction.
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={busy || !url.trim()}>
                {busy && <Loader2 className="spin" size={15} />}{" "}
                {busy ? "Downloading…" : "Add marketplace"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open && !busy) setPreview(null);
        }}
      >
        <DialogContent className="marketplace-preview">
          <DialogHeader>
            <DialogTitle>{preview?.name}</DialogTitle>
            <DialogDescription>
              {preview?.source.repo} / {preview?.path}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <>
              <p className="muted">
                {preview.files.length} files · full package will be installed.
                Hooks and skill scripts are never run by this manager.
              </p>
              {preview.issues.length > 0 && (
                <div className="review-notes">
                  {preview.issues.map((issue) => (
                    <p key={issue}>{issue}</p>
                  ))}
                </div>
              )}
              <pre>{preview.content}</pre>
              <details>
                <summary>Package files</summary>
                <ul>
                  {preview.files.map((file) => (
                    <li key={file}>
                      <code>{file}</code>
                    </li>
                  ))}
                </ul>
              </details>
              <div className="tools-choice">
                {harnesses.map(({ id: tool, directory }) => (
                  <label className="check-label" key={tool}>
                    <Checkbox
                      aria-label={"Install for " + toolLabel[tool]}
                      checked={tools.includes(tool)}
                      onCheckedChange={(checked) =>
                        setTools((current) =>
                          checked
                            ? [...current, tool]
                            : current.filter((t) => t !== tool),
                        )
                      }
                    />
                    <span className="harness-choice-text">
                      {toolLabel[tool]}
                      <small>~/{directory}</small>
                    </span>
                  </label>
                ))}
              </div>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button
                  disabled={busy || !preview.installable || !tools.length}
                  onClick={() => void install()}
                >
                  {busy && <Loader2 size={15} className="spin" />}Install skill
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
