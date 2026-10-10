import { MarketplacesPage } from "./Marketplaces";
import { SetupReview } from "./SetupReview";
import { SettingsPage } from "./SettingsPage";
import { SkillEditor } from "./SkillEditor";
import {
  useEffect,
  useState,
  useCallback,
  useRef,
  useImperativeHandle,
  lazy,
  Suspense,
  type Ref,
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
  ArrowLeftRight,
  ArrowLeft,
  Save,
  Undo2,
  X,
  Loader2,
  Table2,
  List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  type InventoryView,
  type Detail,
  type Plan,
  type FileContent,
  type History,
} from "./api";
import type { Harness, Tool } from "../server/harnesses";
import { toolLabel, sourceLabel } from "../shared/harnesses";
import { HarnessChoice } from "./HarnessChoice";
import { cn } from "@/lib/utils";
import { changeDescription, skillIssueText } from "./skillCopy";

const MarkdownContent = lazy(() =>
  import("./MarkdownContent").then((module) => ({
    default: module.MarkdownContent,
  })),
);
const MarkdownEditor = lazy(() =>
  import("./MarkdownEditor").then((module) => ({
    default: module.MarkdownEditor,
  })),
);
type View = "library" | "history" | "settings" | "marketplaces";
type SkillNavigation = { requestLeave: (action: () => void) => void };

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Folder size={26} />
      <p>{children}</p>
    </div>
  );
}
export function App() {
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const skillNavigation = useRef<SkillNavigation>(null);
  const [skillBusy, setSkillBusy] = useState(false);
  const [layout, setLayout] = useState<"table" | "list">("table");
  const [setupReviewOpen, setSetupReviewOpen] = useState(false);
  const [inventory, setInventory] = useState<InventoryView>(),
    [view, setView] = useState<View>("library");
  const [search, setSearch] = useState(""),
    [toolFilter, setToolFilter] = useState("all"),
    [attentionOnly, setAttentionOnly] = useState(false);
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
      if (attentionOnly && skill.status !== "conflict" && !skill.issues.length)
        return false;
      if (toolFilter !== "all" && !skill.tools.includes(toolFilter as Tool))
        return false;
      return `${skill.title} ${skill.name} ${skill.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase());
    }) ?? [];
  const title = {
    library: "Your skills",
    history: "Backups",
    settings: "Settings",
    marketplaces: "Discover skills",
  }[view];
  const filtersActive =
    search.trim() !== "" || toolFilter !== "all" || attentionOnly;
  function clearFilters() {
    setSearch("");
    setToolFilter("all");
    setAttentionOnly(false);
  }
  function navigate(action: () => void) {
    if (skillNavigation.current) skillNavigation.current.requestLeave(action);
    else action();
  }
  function changeView(next: View) {
    navigate(() => {
      setSelected(undefined);
      setView(next);
      setNotice("");
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0 });
        pageHeading.current?.focus({ preventScroll: true });
      });
    });
  }
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
            changeView("library");
          }}
        >
          <span>Palimpsest</span>
        </a>
        <nav aria-label="Library navigation">
          <button
            className={cn("nav-item", view === "library" && "nav-active")}
            onClick={() => changeView("library")}
            disabled={skillBusy}
            aria-current={view === "library" ? "page" : undefined}
          >
            <Folder size={17} />
            <span>Skills</span>
            <span className="nav-count">{inventory?.counts.total ?? "—"}</span>
          </button>
          <button
            className={cn("nav-item", view === "marketplaces" && "nav-active")}
            onClick={() => changeView("marketplaces")}
            disabled={skillBusy}
            aria-current={view === "marketplaces" ? "page" : undefined}
          >
            <Store size={17} />
            <span>Discover</span>
          </button>
          <div className="nav-divider" />
          <button
            className={cn("nav-item", view === "history" && "nav-active")}
            onClick={() => changeView("history")}
            disabled={skillBusy}
            aria-current={view === "history" ? "page" : undefined}
          >
            <HistoryIcon size={17} />
            <span>Backups</span>
          </button>
          <button
            className={cn("nav-item", view === "settings" && "nav-active")}
            onClick={() => changeView("settings")}
            disabled={skillBusy}
            aria-current={view === "settings" ? "page" : undefined}
          >
            <Settings2 size={17} />
            <span>Settings</span>
          </button>
        </nav>
      </aside>
      <main
        className="main-panel"
        data-skill-open={view === "library" && !!selected}
      >
        <header className="page-header">
          <div>
            <h1 ref={pageHeading} tabIndex={-1}>
              {title}
            </h1>
            <p>
              {view === "history"
                ? "Recover an earlier version of a skill or undo an app change."
                : view === "settings"
                  ? "Choose where to use your skills and keep them up to date."
                  : view === "marketplaces"
                    ? "Find a skill for the task you want to do."
                    : "Search by name or what you want to do."}
            </p>
          </div>
          <div className="header-actions">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void refresh()}
              disabled={loading || skillBusy}
              aria-label="Refresh library"
              title="Refresh library"
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} />
            </Button>
            {view === "library" && (
              <Button
                disabled={!inventory || skillBusy}
                onClick={() => navigate(() => setNewOpen(true))}
              >
                <Plus size={15} />
                New skill
              </Button>
            )}
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
        {view === "library" && !selected && (
          <div className="library-layout" data-layout={layout}>
            <section className="skills-browser" aria-label="Browse skills">
              <div className="library-toolbar">
                <div className="search-field">
                  <Search size={17} />
                  <Input
                    ref={searchInput}
                    aria-label="Search skills"
                    placeholder="Search skills…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <div
                  className="layout-choice"
                  role="group"
                  aria-label="Skill layout"
                >
                  <Button
                    variant={layout === "table" ? "secondary" : "ghost"}
                    aria-pressed={layout === "table"}
                    onClick={() => setLayout("table")}
                  >
                    <Table2 size={16} />
                    Table
                  </Button>
                  <Button
                    variant={layout === "list" ? "secondary" : "ghost"}
                    aria-pressed={layout === "list"}
                    onClick={() => setLayout("list")}
                  >
                    <List size={16} />
                    List
                  </Button>
                </div>
              </div>
              <div className="library-results">
                <p className="muted" role="status">
                  {loading && !inventory
                    ? "Reading your library…"
                    : `${skills.length} ${skills.length === 1 ? "skill" : "skills"}`}
                </p>
                {filtersActive && (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
              </div>
              {(toolFilter !== "all" || attentionOnly) && (
                <p className="browse-context">
                  {attentionOnly
                    ? "Skills needing review"
                    : `${toolLabel[toolFilter as Tool]} skills`}
                </p>
              )}
              <section
                className={layout === "table" ? "skill-table" : "skill-list"}
                aria-label="Skills"
              >
                {layout === "table" && (
                  <div className="table-heading" aria-hidden="true">
                    <span>Skill</span>
                    <span>Added to apps</span>
                    <span />
                  </div>
                )}
                {skills.map((skill) => (
                  <button
                    className={
                      layout === "table" ? "skill-row" : "skill-choice"
                    }
                    key={skill.name}
                    onClick={() => {
                      setSelected(skill.name);
                      setNotice("");
                    }}
                    aria-label={`Open ${skill.name}`}
                    data-skill-name={skill.name}
                    aria-describedby={`skill-description-${skill.name}`}
                  >
                    <span className="skill-name">
                      <strong>{skill.title}</strong>
                      <small id={`skill-description-${skill.name}`}>
                        {skill.description || "No description yet."}
                      </small>
                    </span>
                    {layout === "table" && (
                      <span className="skill-apps">
                        {skill.tools.length
                          ? skill.tools
                              .map((tool) => toolLabel[tool])
                              .join(", ")
                          : "Not added to an app yet"}
                      </span>
                    )}
                    <ChevronRight size={16} className="row-arrow" />
                  </button>
                ))}
                {!skills.length && (
                  <Empty>
                    {loading && !inventory
                      ? "Reading your skills…"
                      : inventory?.counts.total === 0
                        ? "Create a skill or find one in Discover to get started."
                        : "No matching skills. Try another search."}
                  </Empty>
                )}
              </section>
              {!!inventory?.scanIssues.length && (
                <p className="muted">
                  Some folders could not be read.{" "}
                  <button
                    className="text-action"
                    onClick={() => changeView("settings")}
                  >
                    View in Settings
                  </button>
                </p>
              )}
            </section>
          </div>
        )}
        {view === "library" && selected && inventory && (
          <SkillPage
            key={selected}
            ref={skillNavigation}
            name={selected}
            harnesses={inventory.harnesses}
            changed={changed}
            onBusyChange={setSkillBusy}
            close={() => {
              setSelected(undefined);
              setNotice("");
              requestAnimationFrame(() => {
                const target = document.querySelector<HTMLButtonElement>(
                  `[data-skill-name="${CSS.escape(selected)}"]`,
                );
                (target ?? searchInput.current)?.focus();
              });
            }}
          />
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
                No backups yet. Your previous version is saved when you edit a
                skill or change its apps.
              </Empty>
            ) : (
              history.map((operation) => (
                <div className="history-row" key={operation.id}>
                  <span className="skill-icon">
                    <HistoryIcon size={18} />
                  </span>
                  <div>
                    <strong>{operation.name}</strong>
                    <p>{changeDescription(operation.label)}</p>
                    <small>
                      {new Date(operation.at).toLocaleString()} ·{" "}
                      {
                        {
                          pending: "Change in progress",
                          committed: "Backup saved",
                          restored: "Restored",
                          failed: "Change failed",
                        }[operation.status]
                      }
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
          <SettingsPage
            inventory={inventory}
            onChanged={changed}
            onBrowse={(tool) => {
              setToolFilter(tool);
              setAttentionOnly(false);
              setSearch("");
              changeView("library");
            }}
            onReviewSkills={() => {
              setSearch("");
              setToolFilter("all");
              setAttentionOnly(true);
              changeView("library");
            }}
            onReviewSetup={() => setSetupReviewOpen(true)}
            onBackups={() => changeView("history")}
          />
        )}
      </main>
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
              Undo “{restore && changeDescription(restore.label)}” for this
              skill. If it has changed since then, the restore will stop to
              protect your newer edits.
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
                  await changed(
                    "The previous skill version and app choices were restored.",
                  );
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

function SkillPage({
  name,
  harnesses,
  close,
  changed,
  ref,
  onBusyChange,
}: {
  name: string;
  harnesses: Harness[];
  close: () => void;
  changed: (message: string) => Promise<void>;
  ref: Ref<SkillNavigation>;
  onBusyChange: (busy: boolean) => void;
}) {
  const shareButton = useRef<HTMLButtonElement>(null);
  const sharingTitle = useRef<HTMLHeadingElement>(null);
  const readerTitle = useRef<HTMLHeadingElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const editorRoot = useRef<HTMLDivElement>(null);
  const [editorMode, setEditorMode] = useState<"rendered" | "source">(
    "rendered",
  );
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
  useImperativeHandle(ref, () => ({ requestLeave: guard }));
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    readerTitle.current?.focus();
  }, [name]);
  useEffect(() => {
    if (pending) keepEditing.current?.focus();
  }, [pending]);
  useEffect(() => {
    if (plan) sharingTitle.current?.focus();
  }, [plan]);
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
    if (busy) return;
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
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
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
  async function changeAppLink(tool: Tool, enabled: boolean) {
    if (!detail) return;
    const updated = await run(
      () => api.enabled(name, tool, enabled, detail.revision),
      `${name} ${enabled ? "added to" : "removed from"} ${toolLabel[tool]}.`,
    );
    if (updated) {
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLButtonElement>(
            `[data-app-action="${tool}-${enabled ? "remove" : "add"}"]`,
          )
          ?.focus();
      });
    }
  }
  const chosen = detail?.variants.find((v) => v.id === source);
  const editableVersions =
    detail?.variants.filter(
      (variant) => detail.status !== "shared" || variant.tool === "shared",
    ) ?? [];
  const otherApps = harnesses.filter(
    (harness) => !detail?.tools.includes(harness.id),
  );
  const isMarkdown = /\.(md|markdown|mdown)$/i.test(fileName);
  return (
    <section className="skill-reader" aria-labelledby="skill-title">
      {pending && (
        <section
          className="unsaved-warning"
          role="alert"
          aria-labelledby="unsaved-title"
        >
          <h3 id="unsaved-title">Unsaved changes</h3>
          <p>Save your edits to {fileName} before leaving, or discard them.</p>
          <div className="inline-actions">
            <Button
              ref={keepEditing}
              variant="outline"
              onClick={() => {
                setPending(undefined);
                if (editorMode === "source" || !isMarkdown)
                  editor.current?.focus();
                else
                  editorRoot.current
                    ?.querySelector<HTMLElement>('[contenteditable="true"]')
                    ?.focus();
              }}
            >
              Keep editing
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const action = pending;
                setPending(undefined);
                setDraft(file?.content ?? "");
                action();
              }}
            >
              Discard changes
            </Button>
          </div>
        </section>
      )}
      <div className="reader-actions">
        <Button
          className="skill-back"
          variant="ghost"
          disabled={busy}
          onClick={() => guard(close)}
        >
          <ArrowLeft size={16} />
          <span className="back-label">Back to skills</span>
        </Button>
        <nav className="reader-actions-end" aria-label="Skill views">
          {(
            [
              ["overview", "Read"],
              ["files", "Edit"],
              ["settings", "Use in apps"],
            ] as const
          ).map(([mode, label]) => (
            <Button
              key={mode}
              variant={tab === mode && !plan ? "secondary" : "ghost"}
              aria-pressed={tab === mode && !plan}
              disabled={!detail || busy}
              onClick={() => {
                if (tab === mode && !plan) return;
                guard(() => {
                  setPlan(undefined);
                  setTab(mode);
                });
              }}
            >
              {label}
            </Button>
          ))}
        </nav>
      </div>
      <header className="detail-header">
        <div className="detail-title">
          <h1 id="skill-title" ref={readerTitle} tabIndex={-1}>
            {detail?.title ?? name}
          </h1>
          <p className="skill-description">
            {detail
              ? detail.description || "No description yet."
              : "Reading skill…"}
          </p>
        </div>
      </header>
      {error && (
        <div className="message error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}
      {!detail ? (
        <Empty>Reading skill…</Empty>
      ) : (
        !plan && (
          <Suspense fallback={<p className="muted">Rendering Markdown…</p>}>
            <div className="detail-content">
              {tab === "overview" && (
                <section
                  className="overview-tab"
                  aria-label="Skill instructions"
                >
                  {detail.status === "conflict" && (
                    <div className="skill-conflict-note">
                      <p>
                        <AlertCircle size={16} /> This skill has different
                        versions. You’re reading {sourceLabel[source]}.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTab("compare")}
                      >
                        <ArrowLeftRight size={15} /> Compare versions
                      </Button>
                    </div>
                  )}
                  <section
                    className="instructions-section"
                    aria-labelledby="instructions-title"
                  >
                    <div className="section-heading">
                      <h2 id="instructions-title">Instructions</h2>
                    </div>
                    <MarkdownContent
                      content={chosen?.content ?? ""}
                      files={files}
                      fileName="SKILL.md"
                      openFile={(next) =>
                        guard(() => {
                          setFileName(next);
                          setTab("files");
                        })
                      }
                    />
                  </section>
                </section>
              )}
              {tab === "files" && (
                <section className="files-tab" aria-label="Edit skill files">
                  <div className="file-toolbar">
                    {isMarkdown && (
                      <div
                        className="editor-modes"
                        role="group"
                        aria-label="Editing mode"
                      >
                        {(["rendered", "source"] as const).map((mode) => (
                          <Button
                            key={mode}
                            size="sm"
                            variant={
                              editorMode === mode ? "secondary" : "ghost"
                            }
                            aria-pressed={editorMode === mode}
                            disabled={busy || fileLoading}
                            onClick={() => setEditorMode(mode)}
                          >
                            {mode === "rendered" ? "Write" : "Source"}
                          </Button>
                        ))}
                      </div>
                    )}
                    {editableVersions.length > 1 && (
                      <label>
                        Version
                        <select
                          aria-label="Choose file version"
                          value={source}
                          disabled={busy}
                          onChange={(e) =>
                            guard(() => {
                              setSource(e.target.value);
                              setFileName("SKILL.md");
                            })
                          }
                        >
                          {editableVersions.map((v) => (
                            <option key={v.id} value={v.id}>
                              {sourceLabel[v.id]}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <span role="status">
                      {dirty ? "Unsaved edits" : "Saved"}
                    </span>
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
                          setPending(undefined);
                        }, "Changes saved. Your previous version is in Backups.")
                      }
                    >
                      <Save size={14} />
                      Save changes
                    </Button>
                  </div>
                  <div
                    className="file-workspace"
                    data-single-file={files.length <= 1}
                  >
                    {files.length > 1 && (
                      <nav aria-label="Skill files" className="file-list">
                        {files.map((f) => (
                          <button
                            key={f}
                            className={cn(fileName === f && "file-selected")}
                            aria-current={fileName === f ? "page" : undefined}
                            disabled={busy}
                            onClick={() => guard(() => setFileName(f))}
                            title={f}
                          >
                            <FileText size={13} />
                            <span>{f}</span>
                          </button>
                        ))}
                      </nav>
                    )}
                    <div className="editor-grid">
                      <div className="editor" ref={editorRoot}>
                        {(!isMarkdown ||
                          editorMode === "source" ||
                          fileLoading ||
                          !file) && (
                          <div className="editor-label">
                            <code>{fileName}</code>
                            <small>{sourceLabel[source]}</small>
                          </div>
                        )}
                        {fileLoading ? (
                          <Empty>Reading file…</Empty>
                        ) : file && isMarkdown && editorMode === "rendered" ? (
                          <MarkdownEditor
                            key={`${source}-${fileName}-${file.revision}`}
                            content={draft}
                            fileName={fileName}
                            label={`Edit ${fileName}`}
                            disabled={busy}
                            onChange={setDraft}
                            onError={(message) => {
                              setError(
                                `The rendered editor could not open this file: ${message}`,
                              );
                              setEditorMode("source");
                            }}
                          />
                        ) : file ? (
                          <SkillEditor
                            ref={editor}
                            fileName={fileName}
                            value={draft}
                            readOnly={busy}
                            onChange={setDraft}
                          />
                        ) : (
                          <Empty>Select a text file to edit.</Empty>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              )}
              {tab === "compare" && (
                <section
                  className="compare-tab"
                  aria-label="Compare skill versions"
                >
                  <p className="muted">
                    Choose the version you want to use in your apps. Other
                    versions will be backed up before they’re replaced.
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
                          disabled={busy}
                          aria-pressed={source === variant.id}
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
                              {variant.files}{" "}
                              {variant.files === 1 ? "file" : "files"}
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
                        <MarkdownContent
                          content={variant.content}
                          files={files}
                          fileName="SKILL.md"
                          openFile={(next) =>
                            guard(() => {
                              setSource(variant.id);
                              setFileName(next);
                              setTab("files");
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" onClick={() => setTab("settings")}>
                    Continue with this version
                  </Button>
                  {detail.packageDiffs
                    .filter((diff) => diff.files.length)
                    .map((diff) => (
                      <details key={diff.to} className="diff-panel">
                        <summary>
                          {sourceLabel[diff.from]} → {sourceLabel[diff.to]}:{" "}
                          {diff.files.length} other files changed
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
                      <summary>Show exact instruction changes</summary>
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
                </section>
              )}
              {tab === "settings" && (
                <section
                  className="overview-tab"
                  aria-label="Use this skill in apps"
                >
                  {detail.issues.length > 0 && (
                    <div className="review-notes">
                      <h3>Check before adding to apps</h3>
                      {detail.issues.map((issue) => (
                        <p key={issue}>{skillIssueText(issue)}</p>
                      ))}
                    </div>
                  )}
                  {detail.managed && detail.status === "shared" ? (
                    <section aria-labelledby="app-links-title">
                      <h3 id="app-links-title">Use this skill in your apps</h3>
                      <p className="muted">
                        Edit this skill once and keep the same instructions in
                        each app. Restart the app to pick up your changes.
                      </p>
                      {detail.tools.length ? (
                        <ul className="linked-apps">
                          {harnesses
                            .filter((harness) =>
                              detail.tools.includes(harness.id),
                            )
                            .map((harness) => (
                              <li key={harness.id}>
                                <span>{harness.name}</span>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  aria-label={`Remove from ${harness.name}`}
                                  disabled={busy}
                                  data-app-action={`${harness.id}-remove`}
                                  onClick={() =>
                                    void changeAppLink(harness.id, false)
                                  }
                                >
                                  Remove
                                </Button>
                              </li>
                            ))}
                        </ul>
                      ) : (
                        <p className="muted app-empty">
                          Choose an app below to use this skill. Your saved copy
                          stays in the library.
                        </p>
                      )}
                      {otherApps.length > 0 && (
                        <section
                          className="add-apps"
                          aria-labelledby="add-app-title"
                        >
                          <h3 id="add-app-title">Add to another app</h3>
                          <div className="app-buttons">
                            {otherApps.map((harness) => (
                              <Button
                                key={harness.id}
                                variant="outline"
                                aria-label={`Add to ${harness.name}`}
                                disabled={busy}
                                data-app-action={`${harness.id}-add`}
                                onClick={() =>
                                  void changeAppLink(harness.id, true)
                                }
                              >
                                <Plus size={14} />
                                {harness.name}
                              </Button>
                            ))}
                          </div>
                        </section>
                      )}
                      <p className="muted discovery-note">
                        Apps may also find this skill elsewhere. Removing an app
                        here keeps your saved copy and doesn’t turn the skill
                        off inside that app.
                      </p>
                    </section>
                  ) : (
                    <section aria-labelledby="share-title">
                      <h3 id="share-title">Use this skill in your apps</h3>
                      <p className="muted">
                        Choose where you want to use the {sourceLabel[source]}
                        version. You’ll review any replacements before they
                        happen.
                      </p>
                      <HarnessChoice
                        harnesses={harnesses}
                        tools={tools}
                        setTools={setTools}
                        disabled={busy}
                      />
                      <p className="muted discovery-note">
                        Edits will stay consistent across the apps you choose.
                        Restart each app to pick up changes.
                      </p>
                    </section>
                  )}
                </section>
              )}
            </div>
          </Suspense>
        )
      )}
      {detail &&
        !plan &&
        tab === "settings" &&
        !(detail.managed && detail.status === "shared") && (
          <div className="detail-footer">
            <div>
              <strong>
                {detail.status === "shared"
                  ? "Keep the same instructions in each app"
                  : "Use this version in your apps"}
              </strong>
              <small>
                {detail.status === "shared"
                  ? "Edit once to update every app you’ve added."
                  : `Keep ${sourceLabel[source] ?? "this version"}; previous versions are backed up.`}
              </small>
            </div>
            <div className="share-controls">
              <span className="muted">
                {tools.length} {tools.length === 1 ? "app" : "apps"} selected
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
                Review app choices
              </Button>
            </div>
          </div>
        )}
      {plan && (
        <section className="sharing-preview" aria-labelledby="sharing-title">
          <div>
            <h3 id="sharing-title" ref={sharingTitle} tabIndex={-1}>
              Review app choices
            </h3>
            <p className="muted">
              Add the {sourceLabel[plan.source]} version to{" "}
              {new Intl.ListFormat("en", {
                style: "long",
                type: "conjunction",
              }).format(plan.tools.map((t) => toolLabel[t]))}
              .
            </p>
          </div>
          <div className="share-review">
            <p>
              <strong>
                {plan.files} {plan.files === 1 ? "file" : "files"}
              </strong>{" "}
              stay together, including any references and scripts.
            </p>
            {!!plan.replaced.length && (
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
              Previous versions are saved in Backups before anything is
              replaced.
            </p>
          </div>
          <div className="inline-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPlan(undefined);
                requestAnimationFrame(() => shareButton.current?.focus());
              }}
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
                  `${name} added to ${plan.tools.map((tool) => toolLabel[tool]).join(" and ")}.`,
                );
              }}
            >
              {busy && <Loader2 size={14} className="spin" />}Add to selected
              apps
            </Button>
          </div>
        </section>
      )}
    </section>
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
          <DialogTitle>Create a skill</DialogTitle>
          <DialogDescription>
            Describe a task you want help with and how you want it done.
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
                `${name} created and added to ${tools.map((tool) => toolLabel[tool]).join(", ")}.`,
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field-label" htmlFor="new-name">
            Skill name
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
            When should your app use this skill?
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
          <div className="field-label">Use in these apps</div>
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
