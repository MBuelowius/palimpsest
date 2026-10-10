import { Checkbox } from "@/components/ui/checkbox";
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
  const visible = harnesses.filter(
    (harness) => harness.detected || tools.includes(harness.id),
  );
  const otherApps = harnesses.filter(
    (harness) => !harness.detected && !tools.includes(harness.id),
  );
  return (
    <div>
      <div className="tools-choice">
        {visible.map((harness) => (
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
                <small className="harness-undetected">Not detected</small>
              )}
            </span>
          </label>
        ))}
      </div>
      {otherApps.length > 0 && (
        <label className="additional-app">
          {visible.length ? "Add another app" : "Choose an app"}
          <select
            aria-label={`${action} another app`}
            disabled={disabled}
            value=""
            onChange={(event) =>
              setTools([...tools, event.target.value as Tool])
            }
          >
            <option value="" disabled>
              Select app…
            </option>
            {otherApps.map((harness) => (
              <option key={harness.id} value={harness.id}>
                {harness.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!harnesses.some((harness) => harness.detected) && (
        <p className="field-hint">
          No app detected. Choose an app to continue.
        </p>
      )}
    </div>
  );
}
