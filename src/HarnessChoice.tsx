import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { Harness, Tool } from "../server/harnesses";

// Accounts are never ticked by default, so a skill doesn't reach an account unasked.
export const defaultTools = (harnesses: Harness[]) =>
  harnesses
    .filter((harness) => harness.detected && !harness.base)
    .map((harness) => harness.id);

export function HarnessChoice({
  harnesses,
  tools,
  setTools,
  disabled = false,
  action = "Use in",
}: {
  harnesses: Harness[];
  tools: Tool[];
  setTools: (tools: Tool[]) => void;
  disabled?: boolean;
  action?: string;
}) {
  const detected = harnesses.filter((harness) => harness.detected),
    others = harnesses.filter((harness) => !harness.detected);
  // Decided once so a toggle inside the disclosure doesn't move under the pointer.
  const [othersOpen] = useState(
    () =>
      !detected.length || others.some((harness) => tools.includes(harness.id)),
  );
  const chosen = others.filter((harness) => tools.includes(harness.id)).length;
  const toggle = (harness: Harness) => (
    <label key={harness.id} className="check-label">
      <Checkbox
        aria-label={`${action} ${harness.name}`}
        checked={tools.includes(harness.id)}
        disabled={disabled}
        onCheckedChange={(checked) =>
          setTools(
            checked
              ? [...tools, harness.id]
              : tools.filter((tool) => tool !== harness.id),
          )
        }
      />
      {harness.name}
    </label>
  );
  return (
    <div className="harness-choice">
      {!!detected.length && (
        <div className="tools-choice">{detected.map(toggle)}</div>
      )}
      {!!others.length && (
        <details className="other-apps" open={othersOpen || undefined}>
          <summary>
            {detected.length ? "Other apps" : "Choose apps"}
            {chosen > 0 && ` (${chosen} selected)`}
          </summary>
          <p className="field-hint">
            {detected.length
              ? "Not found on this computer yet. You can still add skills for them."
              : "No apps found on this computer yet. You can still add skills for the ones you plan to use."}
          </p>
          <div className="tools-choice">{others.map(toggle)}</div>
        </details>
      )}
    </div>
  );
}
