import { MarketplacesPage } from "./Marketplaces";
import { SetupReview } from "./SetupReview";
import { SyncSkills } from "./SyncSkills";
import {
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  Store,
  Search,
  RefreshCw,
  Plus,
  Link2,
  AlertCircle,
  Folder,
  History as HistoryIcon,
  Settings2,
  Check,
  ChevronRight,
  FileText,
  Terminal,
  ArrowLeftRight,
  Save,
  Undo2,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  api,
  type InventoryView,
  type Detail,
  type Plan,
  type FileContent,
  type History,
} from "./api";
import type { Harness, Tool } from "../server/harnesses";
import {
  harnesses as supportedHarnesses,
  toolLabel,
  sourceLabel,
} from "../shared/harnesses";
import { HarnessChoice } from "./HarnessChoice";
import { cn } from "@/lib/utils";

type View = "library" | "history" | "settings" | "marketplaces";
const statusLabel: Record<string, string> = {
  local: "Local copy",
  identical: "Ready to share",
  conflict: "Versions differ",
  shared: "Shared",
};
const shorten = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

function Status({ status }: { status: string }) {
  return (
    <Badge variant="outline" className="status-badge">
      {status === "shared" ? (
        <Link2 size={12} />
      ) : status === "conflict" ? (
        <AlertCircle size={12} />
      ) : null}
      {statusLabel[status]}
    </Badge>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Folder size={26} />
      <p>{children}</p>
    </div>
  );
}
export function App() {
  const [setupReviewOpen, setSetupReviewOpen] = useState(false);
  const [inventory, setInventory] = useState<InventoryView>(),
    [view, setView] = useState<View>("library");
  const [search, setSearch] = useState(""),
    [toolFilter, setToolFilter] = useState("all"),
    [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<string>(),
    [newOpen, setNewOpen] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<History>([]),
    [restore, setRestore] = useState<History[number]>(),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [items, operations] = await Promise.all([
        api.inventory(),
        api.history(),
      ]);
      setInventory(items);
      setHistory(operations);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const changed = async (message: string) => {
    setNotice(message);
    await refresh();
  };
  const skills =
    inventory?.skills.filter((skill) => {
      if (
        statusFilter === "review" &&
        skill.status !== "conflict" &&
        !skill.issues.length
      )
        return false;
      if (toolFilter !== "all" && !skill.tools.includes(toolFilter as Tool))
        return false;
      if (
        statusFilter !== "all" &&
        statusFilter !== "review" &&
        skill.status !== statusFilter
      )
        return false;
      return `${skill.name} ${skill.description}`
        .toLowerCase()
        .includes(search.toLowerCase());
    }) ?? [];
  const title = {
    library: "Your skills",
    history: "Backups",
    settings: "Harnesses & locations",
    marketplaces: "Marketplaces",
  }[view];
  const latest = history.find((h) => h.status === "committed")?.id;
  return (
    <div className="app-shell">
      <SetupReview open={setupReviewOpen} onOpenChange={setSetupReviewOpen} />
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setView("library");
          }}
        >
          <span>Palimpsest</span>
        </a>
        <nav aria-label="Library navigation">
          <button
            className={cn("nav-item", view === "library" && "nav-active")}
            onClick={() => setView("library")}
            aria-current={view === "library" ? "page" : undefined}
          >
            <Folder size={17} />
            <span>Skills</span>
            <span className="nav-count">{inventory?.counts.total ?? "—"}</span>
          </button>
          <button
            className={cn("nav-item", view === "marketplaces" && "nav-active")}
            onClick={() => setView("marketplaces")}
          >
            <Store size={17} />
            <span>Marketplaces</span>
          </button>
          <div className="nav-divider" />
          <button
            className={cn("nav-item", view === "history" && "nav-active")}
            onClick={() => setView("history")}
          >
            <HistoryIcon size={17} />
            <span>Backups</span>
          </button>
          <button
            className={cn("nav-item", view === "settings" && "nav-active")}
            onClick={() => setView("settings")}
          >
            <Settings2 size={17} />
            <span>Harnesses</span>
          </button>
        </nav>
      </aside>
      <main className="main-panel">
        <header className="page-header">
          <div>
            <h1>{title}</h1>
            <p>
              {view === "history"
                ? "Every change has a backup. Restore the latest operation first."
                : view === "settings"
                  ? "One shared package, linked to the harnesses you choose."
                  : view === "marketplaces"
                    ? "Browse and install skills from GitHub."
                    : `${inventory?.counts.total ?? 0} skills on this Mac`}
            </p>
          </div>
          <div className="header-actions">
            {view === "library" && inventory && (
              <SyncSkills harnesses={inventory.harnesses} onSynced={changed} />
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSetupReviewOpen(true)}
            >
              Review setup
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="Refresh library"
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} />
              <span className="refresh-label">Refresh</span>
            </Button>
            <Button
              size="sm"
              disabled={!inventory}
              onClick={() => setNewOpen(true)}
            >
              <Plus size={15} />
              New skill
            </Button>
          </div>
        </header>
        {error && (
          <div className="message error" role="alert">
            <AlertCircle size={17} />
            <span>{error}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={15} />
            </Button>
          </div>
        )}
        {notice && (
          <div className="message success" role="status">
            <Check size={17} />
            <span>{notice}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={15} />
            </Button>
          </div>
        )}
        {view === "library" && (
          <>
            <div className="toolbar">
              <div className="search-field">
                <Search size={17} />
                <Input
                  aria-label="Search skills"
                  placeholder="Search skills or descriptions…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                aria-label="Filter by harness"
                value={toolFilter}
                onChange={(e) => setToolFilter(e.target.value)}
              >
                <option value="all">All harnesses</option>
                {inventory?.harnesses.map((harness) => (
                  <option key={harness.id} value={harness.id}>
                    {harness.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter skills"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All skills</option>
                <option value="review">Needs review</option>
                {Object.entries(statusLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="result-count">{skills.length} skills</span>
            </div>
            <section className="skill-table" aria-label="Skills">
              <div className="table-heading">
                <span>Skill</span>
                <span>Harness folders</span>
                <span>Status</span>
                <span />
              </div>
              {loading && !inventory ? (
                <Empty>Reading your skill folders…</Empty>
              ) : !skills.length ? (
                <Empty>
                  {search
                    ? "No skills match this search."
                    : "No skills match these filters."}
                </Empty>
              ) : (
                skills.map((skill) => (
                  <button
                    className="skill-row"
                    key={skill.name}
                    onClick={() => setSelected(skill.name)}
                    aria-label={`Open ${skill.name}`}
                  >
                    <span className="skill-name">
                      <span>
                        <strong>{skill.name}</strong>
                        <small>
                          {skill.description ||
                            "No description. Open to review the metadata."}
                        </small>
                      </span>
                    </span>
                    <span className="harness-tags">
                      {skill.tools.length ? (
                        skill.tools.map((tool) => (
                          <span key={tool} className="harness-tag">
                            {toolLabel[tool]}
                          </span>
                        ))
                      ) : (
                        <span className="muted">Library only</span>
                      )}
                    </span>
                    <Status status={skill.status} />
                    <ChevronRight size={16} className="row-arrow" />
                  </button>
                ))
              )}
            </section>
            <div className="table-footnote">
              <Terminal size={14} />
              <span>
                Personal skill folders only. App-managed plugins, synced skills,
                system skills, and trash stay with their apps.
              </span>
            </div>
            {!!inventory?.scanIssues.length && (
              <div className="message error">
                <AlertCircle size={16} />
                <details>
                  <summary>
                    {inventory.scanIssues.length} folders could not be read
                  </summary>
                  {inventory.scanIssues.map((issue) => (
                    <p key={issue}>{shorten(issue)}</p>
                  ))}
                </details>
              </div>
            )}
          </>
        )}
        {view === "marketplaces" && inventory && (
          <MarketplacesPage
            harnesses={inventory.harnesses}
            onInstalled={refresh}
          />
        )}
        {view === "history" && (
          <section className="history-list">
            {!history.length ? (
              <Empty>
                No changes yet. Backups appear here after your first edit or
                shared skill.
              </Empty>
            ) : (
              history.map((operation) => (
                <div className="history-row" key={operation.id}>
                  <span className="skill-icon">
                    <HistoryIcon size={18} />
                  </span>
                  <div>
                    <strong>{operation.name}</strong>
                    <p>{operation.label}</p>
                    <small>
                      {new Date(operation.at).toLocaleString()} ·{" "}
                      {operation.status}
                    </small>
                  </div>
                  {operation.id === latest && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRestore(operation)}
                    >
                      <Undo2 size={14} />
                      Restore
                    </Button>
                  )}
                </div>
              ))
            )}
          </section>
        )}
        {view === "settings" && inventory && (
          <section className="locations">
            <h2>Shared library</h2>
            <p>Edit one package here; enabled apps read the same files.</p>
            <code>{shorten(inventory.shared)}</code>
            <h2>Harness detection and folders</h2>
            <p>
              Detection is refreshed with the library. Configuration folders can
              remain after an uninstall.
            </p>
            <p>
              Manage personal skills for each harness. Counts show files in
              these folders, not installed apps or loaded skills.
            </p>
            <div className="harness-locations">
              {supportedHarnesses.map((harness) => {
                const roots = inventory.roots.filter(
                  (root) => root.tool === harness.id,
                );
                const count = inventory.skills.filter((skill) =>
                  skill.tools.includes(harness.id),
                ).length;
                return (
                  <div className="harness-location" key={harness.id}>
                    <div>
                      <strong>{harness.label}</strong>
                      <Badge variant="outline">
                        {inventory.harnesses.find(
                          (item) => item.id === harness.id,
                        )!.detected
                          ? "Detected"
                          : "Not detected"}
                      </Badge>
                      <span>
                        {count} {count === 1 ? "skill" : "skills"}
                      </span>
                    </div>
                    {inventory.harnesses
                      .find((item) => item.id === harness.id)!
                      .evidence.map((evidence) => (
                        <p className="harness-evidence" key={evidence.path}>
                          {evidence.kind}: <code>{shorten(evidence.path)}</code>
                        </p>
                      ))}
                    {roots.map((root) => (
                      <code key={root.id}>{shorten(root.path)}</code>
                    ))}
                    <button
                      className="harness-browse"
                      aria-label={`Browse ${harness.label} skills`}
                      onClick={() => {
                        setToolFilter(harness.id);
                        setStatusFilter("all");
                        setSearch("");
                        setView("library");
                      }}
                    >
                      Browse skills <ChevronRight size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="locations-note">
              The common ~/.agents/skills folder is also read by several
              harnesses. Harness folder links do not control those discovery
              rules.
            </p>
            <h2>Backups</h2>
            <p>
              Original files are retained before each change. Restores refuse to
              overwrite newer edits.
            </p>
            <code>{shorten(inventory.state)}/history</code>
            <h2>Command line</h2>
            <p>The CLI uses this same library and backup history.</p>
            <code>
              palimpsest list
              <br />
              palimpsest ui
              <br />
              palimpsest share-identical
            </code>
            <p className="locations-note">
              Folder availability does not prove an app has loaded a skill.
              Restart an existing app session to refresh its skill discovery.
              Some harnesses also discover skills in other apps’ folders. These
              controls manage the links shown here. App-specific instructions
              still need review before sharing.
            </p>
          </section>
        )}
      </main>
      {selected && inventory && (
        <SkillDialog
          name={selected}
          harnesses={inventory.harnesses}
          close={() => setSelected(undefined)}
          changed={changed}
        />
      )}
      {inventory && (
        <CreateDialog
          open={newOpen}
          harnesses={inventory.harnesses}
          close={() => setNewOpen(false)}
          changed={changed}
        />
      )}
      <Dialog
        open={!!restore}
        onOpenChange={(open) => {
          if (!open && !busy) setRestore(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore {restore?.name}?</DialogTitle>
            <DialogDescription>
              Return the files and app links to their state before “
              {restore?.label}”. Newer edits will block the restore.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRestore(undefined)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!restore) return;
                setBusy(true);
                try {
                  await api.restore(restore.id);
                  setRestore(undefined);
                  await changed("Original files and app links restored.");
                } catch (e) {
                  setError((e as Error).message);
                  setRestore(undefined);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Loader2 className="spin" size={14} />}Restore backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SkillDialog({
  name,
  harnesses,
  close,
  changed,
}: {
  name: string;
  harnesses: Harness[];
  close: () => void;
  changed: (message: string) => Promise<void>;
}) {
  const shareButton = useRef<HTMLButtonElement>(null);
  const [detail, setDetail] = useState<Detail>(),
    [tab, setTab] = useState("overview"),
    [source, setSource] = useState("");
  const [files, setFiles] = useState<string[]>([]),
    [fileName, setFileName] = useState("SKILL.md"),
    [file, setFile] = useState<FileContent>(),
    [draft, setDraft] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [plan, setPlan] = useState<Plan>(),
    [tools, setTools] = useState<Tool[]>(() =>
      harnesses
        .filter((harness) => harness.detected)
        .map((harness) => harness.id),
    );
  const [pending, setPending] = useState<(() => void) | undefined>(),
    [fileLoading, setFileLoading] = useState(false);
  const dirty = !!file && file.content !== draft;
  const refresh = useCallback(async () => {
    const next = await api.detail(name);
    setDetail(next);
    setSource((current) =>
      next.variants.some((v) => v.id === current)
        ? current
        : (next.variants.find((v) => v.tool === "shared")?.id ??
          next.variants[0].id),
    );
    return next;
  }, [name]);
  useEffect(() => {
    let active = true;
    api
      .detail(name)
      .then((next) => {
        if (active) {
          setDetail(next);
          setTools(
            next.managed
              ? next.tools
              : harnesses
                  .filter((harness) => harness.detected)
                  .map((harness) => harness.id),
          );
          setSource(
            next.variants.find((v) => v.tool === "shared")?.id ??
              next.variants[0].id,
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [name]);
  useEffect(() => {
    if (!source) return;
    let active = true;
    setFileLoading(true);
    setFile(undefined);
    Promise.all([api.files(name, source), api.file(name, source, fileName)])
      .then(([names, content]) => {
        if (active) {
          setFiles(names);
          setFile(content);
          setDraft(content.content);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setFileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [name, source, fileName]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  function guard(action: () => void) {
    if (dirty) setPending(() => action);
    else action();
  }
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
      await changed(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reviewShare() {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      setPlan(await api.plan(name, source, detail.revision, tools));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const chosen = detail?.variants.find((v) => v.id === source);
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) guard(close);
        }}
      >
        <DialogContent
          className="skill-dialog"
          onInteractOutside={(event) => {
            if (dirty || busy) event.preventDefault();
          }}
        >
          <DialogHeader className="detail-header">
            <div className="detail-title">
              <span className="skill-icon">
                <FileText size={21} />
              </span>
              <div>
                <DialogTitle>{name}</DialogTitle>
                <DialogDescription>
                  {detail
                    ? `${detail.variants.length} location${detail.variants.length === 1 ? "" : "s"} · ${chosen?.files ?? 0} files in selected version`
                    : "Reading skill…"}
                </DialogDescription>
              </div>
            </div>
            {detail && <Status status={detail.status} />}
          </DialogHeader>
          {error && (
            <div className="message error" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          {!detail ? (
            <Empty>Reading skill…</Empty>
          ) : (
            <Tabs
              value={tab}
              onValueChange={(value) => guard(() => setTab(value))}
              className="detail-tabs"
            >
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="files">
                  Files {dirty && <span className="unsaved-dot" />}
                </TabsTrigger>
                <TabsTrigger value="compare">Compare</TabsTrigger>
                <TabsTrigger value="sharing">Sharing</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="overview-tab">
                <h3>When to use it</h3>
                <p className="skill-description">
                  {detail.description ||
                    "Add a description in SKILL.md so the app knows when to use this skill."}
                </p>
                {detail.issues.length > 0 && (
                  <div className="review-notes">
                    <h3>
                      <AlertCircle size={16} />
                      Review before sharing
                    </h3>
                    {detail.issues.map((issue) => (
                      <p key={issue}>{issue}</p>
                    ))}
                  </div>
                )}
                <h3>Harness folders</h3>
                <p className="muted">
                  {detail.managed
                    ? "These switches manage links in each harness folder. The shared package is retained when a link is removed."
                    : "Share this skill to manage its folder links from one place."}
                </p>
                <div className="availability">
                  {harnesses.map(({ id: tool }) => (
                    <div key={tool}>
                      <span>
                        <strong>{toolLabel[tool]}</strong>
                        <small>
                          {detail.tools.includes(tool)
                            ? "Present in folder"
                            : "Not linked"}
                        </small>
                      </span>
                      <Switch
                        aria-label={`Link ${name} to ${toolLabel[tool]}`}
                        checked={detail.tools.includes(tool)}
                        disabled={
                          !detail.managed ||
                          busy ||
                          detail.status === "conflict"
                        }
                        onCheckedChange={(enabled) =>
                          void run(
                            () =>
                              api.enabled(name, tool, enabled, detail.revision),
                            `${name}: ${toolLabel[tool]} folder link ${enabled ? "added" : "removed"}.`,
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
                <p className="muted discovery-note">
                  Harnesses can also discover skills in common folders such as
                  ~/.agents/skills. Removing a link here does not disable a
                  skill inside the harness.
                </p>
                <h3>Versions on disk</h3>
                <div className="version-list">
                  {detail.variants.map((variant) => (
                    <button
                      key={variant.id}
                      className={cn(
                        "version-row",
                        source === variant.id && "version-selected",
                      )}
                      onClick={() =>
                        guard(() => {
                          setSource(variant.id);
                          setFileName("SKILL.md");
                        })
                      }
                    >
                      <span className="version-radio">
                        {source === variant.id && <span />}
                      </span>
                      <span>
                        <strong>
                          {sourceLabel[variant.id]}{" "}
                          {variant.version && (
                            <Badge variant="secondary">
                              v{variant.version}
                            </Badge>
                          )}
                        </strong>
                        <code>{shorten(variant.path)}</code>
                        <small>
                          {variant.linked ? "Linked folder" : "Folder"} ·{" "}
                          {variant.files} files · {variant.hash.slice(0, 10)}
                        </small>
                      </span>
                      {source === variant.id && <Check size={16} />}
                    </button>
                  ))}
                </div>
                {detail.status === "conflict" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTab("compare")}
                  >
                    <ArrowLeftRight size={15} />
                    Compare before choosing
                  </Button>
                )}
              </TabsContent>
              <TabsContent value="files" className="files-tab">
                <div className="file-toolbar">
                  <label>
                    Version
                    <select
                      aria-label="Choose file version"
                      value={source}
                      onChange={(e) =>
                        guard(() => {
                          setSource(e.target.value);
                          setFileName("SKILL.md");
                        })
                      }
                    >
                      {detail.variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {sourceLabel[v.id]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>{dirty ? "Unsaved changes" : "Saved on disk"}</span>
                  <Button
                    size="sm"
                    disabled={!dirty || busy || fileLoading}
                    onClick={() =>
                      void run(async () => {
                        if (!file) return;
                        await api.save(
                          name,
                          source,
                          fileName,
                          draft,
                          file.revision,
                        );
                        const next = await api.file(name, source, fileName);
                        setFile(next);
                        setDraft(next.content);
                      }, `${fileName} saved. A backup is available in Activity.`)
                    }
                  >
                    <Save size={14} />
                    Save
                  </Button>
                </div>
                <div className="file-workspace">
                  <nav aria-label="Skill files" className="file-list">
                    {files.map((f) => (
                      <button
                        key={f}
                        className={cn(fileName === f && "file-selected")}
                        onClick={() => guard(() => setFileName(f))}
                        title={f}
                      >
                        <FileText size={13} />
                        <span>{f}</span>
                      </button>
                    ))}
                  </nav>
                  <div className="editor">
                    <div className="editor-label">
                      <code>{fileName}</code>
                      <small>{sourceLabel[source]}</small>
                    </div>
                    {fileLoading ? (
                      <Empty>Reading file…</Empty>
                    ) : file ? (
                      <Textarea
                        aria-label={`Edit ${fileName}`}
                        className="code-editor"
                        value={draft}
                        spellCheck={false}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                    ) : (
                      <Empty>Select a text file to edit.</Empty>
                    )}
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="compare" className="compare-tab">
                <p className="muted">
                  Choose the version to keep as the shared package. Package
                  hashes also include scripts and references.
                </p>
                <div className="compare-grid">
                  {detail.variants.map((variant) => (
                    <div
                      className={cn(
                        "compare-version",
                        source === variant.id && "compare-selected",
                      )}
                      key={variant.id}
                    >
                      <button
                        className="compare-heading"
                        onClick={() =>
                          guard(() => {
                            setSource(variant.id);
                            setFileName("SKILL.md");
                          })
                        }
                      >
                        <span>
                          <strong>{sourceLabel[variant.id]}</strong>
                          <small>
                            {variant.version ? `v${variant.version} · ` : ""}
                            {variant.files} files · {variant.hash.slice(0, 10)}
                          </small>
                        </span>
                        {source === variant.id ? (
                          <Badge variant="secondary">
                            <Check size={12} />
                            Selected
                          </Badge>
                        ) : (
                          <span className="choose-version">
                            Choose
                            <ChevronRight size={14} />
                          </span>
                        )}
                      </button>
                      <pre>{variant.content}</pre>
                    </div>
                  ))}
                </div>
                {detail.packageDiffs
                  .filter((diff) => diff.files.length)
                  .map((diff) => (
                    <details key={diff.to} className="diff-panel">
                      <summary>
                        {sourceLabel[diff.from]} → {sourceLabel[diff.to]}:{" "}
                        {diff.files.length} package files differ
                      </summary>
                      <ul>
                        {diff.files.map((item) => (
                          <li key={item.file}>
                            <code>{item.file}</code> · {item.change}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                {detail.diffs.some(
                  (diff) => diff.patch.split("\n").length > 5,
                ) && (
                  <details className="diff-panel">
                    <summary>Show SKILL.md changes</summary>
                    {detail.diffs.map((diff) => (
                      <div key={diff.to}>
                        <h3>
                          {sourceLabel[diff.from]} → {sourceLabel[diff.to]}
                        </h3>
                        <pre>
                          {diff.patch.split("\n").map((line, index) => (
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
                      </div>
                    ))}
                  </details>
                )}
              </TabsContent>
              <TabsContent value="sharing" className="overview-tab">
                <h3>Choose harness folders</h3>
                <p className="muted">
                  Share the {sourceLabel[source]} version with the harnesses
                  selected below. Review the file changes before applying them.
                </p>
                <HarnessChoice
                  harnesses={harnesses}
                  tools={tools}
                  setTools={setTools}
                  disabled={busy}
                />
                <p className="muted discovery-note">
                  Common folders may be read by other harnesses too. These
                  choices control where Palimpsest places links.
                </p>
              </TabsContent>
            </Tabs>
          )}
          {detail && (
            <div className="detail-footer">
              <div>
                <strong>
                  {detail.status === "shared"
                    ? "One package, shared files"
                    : "Share the selected version"}
                </strong>
                <small>
                  {detail.status === "shared"
                    ? "Edits reach every linked app."
                    : `Keep ${sourceLabel[source] ?? "the selected version"}; original folders are backed up.`}
                </small>
              </div>
              <div className="share-controls">
                <span className="muted">
                  {tools.length} {tools.length === 1 ? "harness" : "harnesses"}{" "}
                  selected
                </span>
                <Button
                  ref={shareButton}
                  disabled={busy || dirty || !tools.length}
                  onClick={() => void reviewShare()}
                >
                  {busy ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <Link2 size={15} />
                  )}
                  Review sharing
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!plan}
        onOpenChange={(open) => {
          if (!open && !busy) setPlan(undefined);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            shareButton.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Share {name}</DialogTitle>
            <DialogDescription>
              Use the {sourceLabel[plan?.source ?? ""]} version as the single
              package for {plan?.tools.map((t) => toolLabel[t]).join(" and ")}.
            </DialogDescription>
          </DialogHeader>
          <div className="share-review">
            <p>
              <strong>{plan?.files} files</strong> including scripts and
              references will live together.
            </p>
            <code>{plan && shorten(plan.canonical)}</code>
            {!!plan?.replaced.length && (
              <div className="review-notes">
                <strong>Different versions will be backed up</strong>
                {plan.replaced.map((item) => (
                  <p key={item.path}>
                    {toolLabel[item.tool as Tool] ?? sourceLabel[item.tool]}
                    {item.version ? ` v${item.version}` : ""}
                  </p>
                ))}
              </div>
            )}
            <p className="muted">
              A complete backup is saved before any folder is replaced. Restore
              it from Backups.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setPlan(undefined)}
            >
              Back
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (!plan) return;
                void run(
                  async () => {
                    await api.share(plan);
                    setPlan(undefined);
                    setSource("shared");
                    setFileName("SKILL.md");
                  },
                  `${name} now uses shared files in ${plan.tools.join(" and ")}.`,
                );
              }}
            >
              {busy && <Loader2 size={14} className="spin" />}Share skill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) setPending(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              Your edits to {fileName} have not been saved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(undefined)}>
              Keep editing
            </Button>
            <Button
              onClick={() => {
                const action = pending;
                setPending(undefined);
                setDraft(file?.content ?? "");
                action?.();
              }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateDialog({
  open,
  harnesses,
  close,
  changed,
}: {
  open: boolean;
  harnesses: Harness[];
  close: () => void;
  changed: (message: string) => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [body, setBody] = useState(""),
    [tools, setTools] = useState<Tool[]>(() =>
      harnesses
        .filter((harness) => harness.detected)
        .map((harness) => harness.id),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (open)
      setTools(
        harnesses
          .filter((harness) => harness.detected)
          .map((harness) => harness.id),
      );
  }, [open, harnesses]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) close();
      }}
    >
      <DialogContent className="create-dialog">
        <DialogHeader>
          <DialogTitle>New shared skill</DialogTitle>
          <DialogDescription>
            Create one package and choose where it is available.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api.create(name, description, body, tools);
              close();
              setName("");
              setDescription("");
              setBody("");
              await changed(
                `${name} created and linked to ${tools.map((tool) => toolLabel[tool]).join(", ")}.`,
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field-label" htmlFor="new-name">
            Folder name
          </label>
          <Input
            id="new-name"
            placeholder="review-pull-request"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            pattern={"[a-z0-9][a-z0-9_\\-]{0,127}"}
          />
          <p className="field-hint">
            Lowercase letters, numbers, hyphens, or underscores.
          </p>
          <label className="field-label" htmlFor="new-description">
            When should the harness use it?
          </label>
          <Textarea
            id="new-description"
            placeholder="Use when reviewing a pull request for correctness and missing tests."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            maxLength={1024}
          />
          <label className="field-label" htmlFor="new-body">
            Instructions
          </label>
          <Textarea
            id="new-body"
            className="new-body"
            placeholder="Describe the steps and the result you expect."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
          <div className="field-label">Harness folders</div>
          <HarnessChoice
            harnesses={harnesses}
            tools={tools}
            setTools={setTools}
            disabled={busy}
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !tools.length}>
              {busy && <Loader2 size={14} className="spin" />}Create skill
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
