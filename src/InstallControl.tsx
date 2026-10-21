import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { toolName } from "../shared/harnesses";
import type { Harness, Tool } from "../server/harnesses";

const list = (items: string[]) =>
  items.length < 2
    ? items.join("")
    : items.slice(0, -1).join(", ") + " and " + items.at(-1);

export function InstallControl({
  harnesses,
  tools,
  setTools,
  busy,
  installable,
  onInstall,
}: {
  harnesses: Harness[];
  tools: Tool[];
  setTools: (tools: Tool[]) => void;
  busy: boolean;
  installable: boolean;
  onInstall: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ordered = [
    ...harnesses.filter((harness) => harness.detected),
    ...harnesses.filter((harness) => !harness.detected),
  ];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="install-actions">
          <Button
            className="store-add"
            disabled={busy || !installable}
            aria-describedby="install-summary"
            onClick={() => (tools.length ? onInstall() : setOpen(true))}
          >
            {busy && <Loader2 size={15} className="spin" />}
            {tools.length ? "Get" : "Choose apps"}
          </Button>
          <p id="install-summary" className="muted">
            {!installable
              ? "This package cannot be installed. Check its metadata and symlinks."
              : tools.length
                ? `Adds to ${list(tools.map((tool) => toolName(tool)))}.`
                : "Pick where you want to use it."}
          </p>
          {installable && tools.length > 0 && (
            <Popover.Trigger asChild>
              <button className="text-action" disabled={busy}>
                Change
              </button>
            </Popover.Trigger>
          )}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="discover-source-filter"
          align="start"
          sideOffset={8}
          aria-label="Choose apps"
        >
          <h4>Use in</h4>
          {ordered.map((harness) => (
            <label key={harness.id}>
              <input
                type="checkbox"
                aria-label={`Use in ${harness.name}`}
                checked={tools.includes(harness.id)}
                onChange={(event) =>
                  setTools(
                    event.target.checked
                      ? [...tools, harness.id]
                      : tools.filter((tool) => tool !== harness.id),
                  )
                }
              />
              <span>
                {harness.name}
                {!harness.detected && <small>Not found</small>}
              </span>
            </label>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
