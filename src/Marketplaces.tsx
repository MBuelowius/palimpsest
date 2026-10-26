import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Collections } from "./Collections";

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
  sources,
  skillsMd,
  onSourcesChange,
  harnesses,
  skills,
  updates,
  onInstalled,
  onOpenSkill,
  onUpdate,
}: {
  sources: Marketplace[];
  skillsMd: boolean;
  onSourcesChange: (sources: Marketplace[]) => Promise<void>;
  harnesses: Harness[];
  skills: InventoryView["skills"];
  updates: SkillUpdate[];
  onInstalled: () => Promise<void>;
  onOpenSkill: (name: string) => void;
  onUpdate: (name: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string>();
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
  async function addCollection(repo: string) {
    setAdding(repo);
    setError("");
    setMessage("");
    try {
      await api.addMarketplace(repo);
      await onSourcesChange(await api.marketplaces());
      setMessage("1 collection ready to browse.");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setAdding(undefined);
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
          skillsMd={skillsMd}
          skills={skills}
          updates={updates}
          adding={adding}
          onAddCollection={(repo) => void addCollection(repo)}
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
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="marketplace-add">
            <DialogHeader>
              <DialogTitle>Manage collections</DialogTitle>
              <DialogDescription>
                Paste the public GitHub link for a collection of skills. You can
                add several links, one per line.
              </DialogDescription>
            </DialogHeader>
            <Collections
              sources={sources}
              onSourcesChange={onSourcesChange}
              onMessage={setMessage}
              onAdded={() => setAddOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </section>
    </>
  );
}
