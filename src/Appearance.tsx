import { useState } from "react";

type Appearance = "light" | "dark" | "system";

declare global {
  interface Window {
    palimpsestAppearance: {
      get: () => Appearance;
      set: (choice: Appearance) => void;
    };
  }
}

export function Appearance() {
  const [choice, setChoice] = useState(window.palimpsestAppearance.get);
  return (
    <div className="tools-choice" role="radiogroup" aria-label="Appearance">
      {(["light", "dark", "system"] as const).map((value) => (
        <label className="check-label" key={value}>
          <input
            type="radio"
            name="appearance"
            value={value}
            checked={choice === value}
            onChange={() => {
              window.palimpsestAppearance.set(value);
              setChoice(value);
            }}
          />
          {value[0].toUpperCase() + value.slice(1)}
        </label>
      ))}
    </div>
  );
}
