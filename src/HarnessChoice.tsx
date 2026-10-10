import { Checkbox } from "@/components/ui/checkbox";
import { harnesses as supportedHarnesses } from "../shared/harnesses";
import type { Harness, Tool } from "../server/harnesses";

export function HarnessChoice({
  harnesses,
  tools,
  setTools,
  disabled = false,
  action = "Share with",
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
              <small>
                ~/
                {
                  supportedHarnesses.find((item) => item.id === harness.id)!
                    .directory
                }
              </small>
              {!harness.detected && (
                <small className="harness-undetected">Not detected</small>
              )}
            </span>
          </label>
        ))}
      </div>
      {!harnesses.some((harness) => harness.detected) && (
        <p className="field-hint">
          No harness detected. Select one manually to continue.
        </p>
      )}
    </div>
  );
}
