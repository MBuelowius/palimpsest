(() => {
  const key = "palimpsest.appearance";
  const system = matchMedia("(prefers-color-scheme: dark)");
  let choice = "system";
  try {
    const stored = localStorage.getItem(key);
    if (stored === "light" || stored === "dark") choice = stored;
  } catch {
    // Storage can be unavailable in private or restricted browsers.
  }
  const apply = () => {
    const theme =
      choice === "system" ? (system.matches ? "dark" : "light") : choice;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="color-scheme"]').content = theme;
    document.querySelector('meta[name="theme-color"]').content =
      theme === "dark" ? "#0a0a0a" : "#ffffff";
  };
  window.palimpsestAppearance = {
    get: () => choice,
    set: (value) => {
      choice = value;
      apply();
      try {
        localStorage.setItem(key, choice);
      } catch {
        // Keep the current session usable when persistence is blocked.
      }
    },
  };
  system.addEventListener("change", apply);
  apply();
})();
