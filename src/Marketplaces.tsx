import { useEffect, useState } from "react";
import { Plus, Search, Loader2, ChevronRight, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type { Tool } from "../server/library";

export function MarketplacesPage({
  onInstalled,
}: {
  onInstalled: () => Promise<void>;
}) {
  const [sources, setSources] = useState<Marketplace[]>([]);
  const [selected, setSelected] = useState("");
  const [skills, setSkills] = useState<CatalogueSkill[]>([]);
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
    if (selected)
      api
        .catalogue(selected)
        .then((list) => {
          if (active) setSkills(list);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [selected]);
  async function add(value: string) {
    setBusy(true);
    setError("");
    try {
      const source = await api.addMarketplace(value);
      setSources(await api.marketplaces());
      setSelected(source.id);
      setAddOpen(false);
      setUrl("");
    } catch (e) {
      setError((e as Error).message);
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
              onClick={() => setSelected(source.id)}
            >
              <Store size={16} />
              <span>{source.repo}</span>
            </button>
          ))}
          <h3>Suggested sources</h3>
          <button disabled={busy} onClick={() => void add("anthropics/skills")}>
            Anthropic skills
            <Plus size={14} />
          </button>
          <button disabled={busy} onClick={() => void add("openai/skills")}>
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
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await api.removeMarketplace(current.id);
                      const list = await api.marketplaces();
                      setSources(list);
                      setSelected(list[0]?.id ?? "");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Remove source
                </Button>
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
                  <p className="empty">No matching skills.</p>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add marketplace</DialogTitle>
            <DialogDescription>
              Paste a public GitHub repository URL. Repositories containing
              SKILL.md packages are supported, including skill folders in plugin
              marketplaces.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void add(url);
            }}
          >
            <label className="field-label" htmlFor="marketplace-url">
              Repository URL
            </label>
            <Input
              id="marketplace-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repository"
              required
              disabled={busy}
            />
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
                {(["claude", "codex"] as const).map((tool) => (
                  <label className="check-label" key={tool}>
                    <Checkbox
                      aria-label={"Install for " + tool}
                      checked={tools.includes(tool)}
                      onCheckedChange={(checked) =>
                        setTools((current) =>
                          checked
                            ? [...current, tool]
                            : current.filter((t) => t !== tool),
                        )
                      }
                    />
                    {tool === "claude" ? "Claude" : "Codex"}
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
