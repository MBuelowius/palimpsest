import { Checkbox } from "@/components/ui/checkbox";
import type { Harness, Tool } from "../server/harnesses";

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
  return (
    <div>
      <div className="tools-choice">
        {harnesses.map((harness) => (
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
            <span className="harness-choice-text">
              {harness.name}
              {!harness.detected && (
                <small className="harness-undetected">No setup found</small>
              )}
            </span>
          </label>
        ))}
      </div>
      {!harnesses.some((harness) => harness.detected) && (
        <p className="field-hint">
          Choose the apps you want to use. You can add them before setting them
          up.
        </p>
      )}
    </div>
  );
}
