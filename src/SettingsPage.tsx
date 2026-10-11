import { useRef, useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { SyncSkills } from "./SyncSkills";
import type { InventoryView } from "./api";
import { harnesses, type Tool } from "../shared/harnesses";

const shorten = (path: string) => path.replace(/^\/Users\/[^/]+/, "~");
const evidenceLabels = {
  config: "App settings",
  command: "Command line app",
  application: "Application",
  extension: "Editor extension",
};

export function SettingsPage({
  inventory,
  onBrowse,
  onReviewSkills,
  onReviewSetup,
  onBackups,
  onChanged,
}: {
  inventory: InventoryView;
  onBrowse: (tool: Tool) => void;
  onReviewSkills: () => void;
  onReviewSetup: () => void;
  onBackups: () => void;
  onChanged: (message: string) => Promise<void>;
}) {
  const [showFiles, setShowFiles] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const filesButton = useRef<HTMLButtonElement>(null);
  const reviewCount = inventory.skills.filter(
    (skill) => skill.status === "conflict" || skill.issues.length,
  ).length;
  if (showFiles)
    return (
      <section className="locations" aria-labelledby="file-locations-title">
        <Button
          variant="ghost"
          onClick={() => {
            setShowFiles(false);
            requestAnimationFrame(() => filesButton.current?.focus());
          }}
        >
          <ArrowLeft size={16} /> Back to settings
        </Button>
        <h2 id="file-locations-title" ref={heading} tabIndex={-1}>
          File locations
        </h2>
        <p>Find the saved files or check why an app appears in your library.</p>
        <h3>Shared skills</h3>
        <p>
          Skills added to multiple apps use one saved copy, so edits stay
          consistent.
        </p>
        <code>{shorten(inventory.shared)}</code>
        <h3>App folders</h3>
        <p>
          Existing app settings, commands, or extensions help identify apps. Old
          settings can remain after an uninstall.
        </p>
        <div className="harness-locations">
          {harnesses.map((harness) => {
            const app = inventory.harnesses.find(
              (item) => item.id === harness.id,
            )!;
            return (
              <section
                className="harness-location"
                key={harness.id}
                aria-label={harness.label}
              >
                <div>
                  <strong>{harness.label}</strong>
                  <Badge variant="outline">
                    {app.detected ? "Setup found" : "No setup found"}
                  </Badge>
                </div>
                {app.evidence.map((evidence) => (
                  <p className="harness-evidence" key={evidence.path}>
                    {evidenceLabels[evidence.kind]}:{" "}
                    <code>{shorten(evidence.path)}</code>
                  </p>
                ))}
                {inventory.roots
                  .filter((root) => root.tool === harness.id)
                  .map((root) => (
                    <code key={root.id}>{shorten(root.path)}</code>
                  ))}
              </section>
            );
          })}
        </div>
        <p>
          Some apps also read skills from shared folders, such as
          ~/.agents/skills. Removing an app from a skill here does not turn it
          off inside that app.
        </p>
        <p>
          Only your personal skills are managed here. Skills provided by an app,
          plugin, or system stay with that app.
        </p>
        {!!inventory.scanIssues.length && (
          <section className="settings-section" aria-labelledby="scan-title">
            <h3 id="scan-title">Some folders could not be read</h3>
            {inventory.scanIssues.map((issue) => (
              <p className="form-error" key={issue}>
                {shorten(issue)}
              </p>
            ))}
          </section>
        )}
        <h3>Saved backups</h3>
        <p>Previous versions are kept here before changes are made.</p>
        <code>{shorten(inventory.state)}/history</code>
        <h3>Work from the command line</h3>
        <p>These commands use the same skills and backups as this app.</p>
        <code>
          palimpsest list
          <br />
          palimpsest ui
          <br />
          palimpsest share-identical
        </code>
      </section>
    );
  return (
    <section className="locations" aria-label="Settings">
      <section className="settings-section" aria-labelledby="apps-title">
        <h2 id="apps-title">Your apps</h2>
        <p>
          See which skills you’ve added to each app. Open a skill to add it to
          another app.
        </p>
        <div className="app-overview">
          {harnesses.map((harness) => {
            const count = inventory.skills.filter((skill) =>
              skill.tools.includes(harness.id),
            ).length;
            return (
              <div className="app-overview-row" key={harness.id}>
                <div>
                  <strong>{harness.label}</strong>
                  <small>
                    {count
                      ? `${count} ${count === 1 ? "skill" : "skills"} added`
                      : "No skills added yet"}
                  </small>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`View ${harness.label} skills`}
                  onClick={() => onBrowse(harness.id)}
                >
                  View skills <ChevronRight size={14} />
                </Button>
              </div>
            );
          })}
        </div>
        <p>
          Restart an app after changing its skills. Some apps also read skills
          from shared folders.
        </p>
      </section>
      <section className="settings-section" aria-labelledby="maintenance-title">
        <h2 id="maintenance-title">Keep your skills consistent</h2>
        <div className="maintenance-row">
          <div>
            <h3>Use the same skills across apps</h3>
            <p>
              Bring existing copies together so you only have to edit a skill
              once.
            </p>
          </div>
          <SyncSkills harnesses={inventory.harnesses} onSynced={onChanged} />
        </div>
        <div className="maintenance-row">
          <div>
            <h3>Resolve skill issues</h3>
            <p>
              {reviewCount
                ? `${reviewCount} ${reviewCount === 1 ? "skill needs" : "skills need"} attention. Choose a version or add the missing details.`
                : "No skill issues found."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!reviewCount}
            onClick={onReviewSkills}
          >
            Review skills
          </Button>
        </div>
        <div className="maintenance-row">
          <div>
            <h3>Get improvement suggestions</h3>
            <p>
              Ask Codex or Claude Code to review your skills and suggest
              changes.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onReviewSetup}>
            Review my skills
          </Button>
        </div>
      </section>
      <div className="maintenance-row">
        <div>
          <h3>Recover earlier changes</h3>
          <p>Restore a skill or its app choices from a saved backup.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onBackups}>
          View backups
        </Button>
      </div>
      <div className="maintenance-row">
        <div>
          <h3>Find files on this computer</h3>
          <p>See skill folders, saved backups, and app setup details.</p>
        </div>
        <Button
          ref={filesButton}
          variant="outline"
          size="sm"
          onClick={() => {
            setShowFiles(true);
            requestAnimationFrame(() => heading.current?.focus());
          }}
        >
          File locations
        </Button>
      </div>
      {!!inventory.scanIssues.length && (
        <p className="form-error">
          Some skill folders could not be read. Check File locations for
          details.
        </p>
      )}
    </section>
  );
}
