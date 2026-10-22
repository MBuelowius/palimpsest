import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Appearance } from "./Appearance";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function boot(stored: string | null, dark: boolean, blocked = false) {
  const dom = new JSDOM(html, {
    url: "http://localhost",
    runScripts: "outside-only",
  });
  const system = new dom.window.EventTarget();
  Object.assign(system, { matches: dark });
  Object.assign(dom.window, { matchMedia: () => system });
  if (stored !== null)
    dom.window.localStorage.setItem("palimpsest.appearance", stored);
  if (blocked)
    Object.defineProperty(dom.window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  dom.window.eval(dom.window.document.querySelector("script")!.textContent!);
  return { dom, system };
}

for (const dark of [false, true]) {
  for (const stored of [null, "invalid", "", "system", "light", "dark"]) {
    test(`startup: stored ${JSON.stringify(stored)}, system ${dark ? "dark" : "light"}`, () => {
      const { dom } = boot(stored, dark);
      try {
        const choice = stored === "light" || stored === "dark" ? stored : null;
        const effective = choice ?? (dark ? "dark" : "light");
        const document = dom.window.document;
        assert.equal(
          document.documentElement.getAttribute("data-theme"),
          choice,
        );
        assert.equal(
          document
            .querySelector('meta[name="color-scheme"]')!
            .getAttribute("content"),
          effective,
        );
        assert.equal(
          document
            .querySelector('meta[name="theme-color"]')!
            .getAttribute("content"),
          effective === "dark" ? "#0a0a0a" : "#ffffff",
        );
      } finally {
        dom.window.close();
      }
    });
  }
}

test("System follows scheme changes; explicit choices keep their metadata", () => {
  const { dom, system } = boot(null, false);
  try {
    const window = dom.window as unknown as Window;
    const scheme = () =>
      window.document
        .querySelector('meta[name="color-scheme"]')!
        .getAttribute("content");
    Object.assign(system, { matches: true });
    system.dispatchEvent(new dom.window.Event("change"));
    assert.equal(scheme(), "dark");
    window.palimpsestAppearance.set("light");
    system.dispatchEvent(new dom.window.Event("change"));
    assert.equal(scheme(), "light");
    window.palimpsestAppearance.set("system");
    assert.equal(
      window.document.documentElement.hasAttribute("data-theme"),
      false,
    );
    assert.equal(scheme(), "dark");
    Object.assign(system, { matches: false });
    system.dispatchEvent(new dom.window.Event("change"));
    assert.equal(scheme(), "light");
  } finally {
    dom.window.close();
  }
});

test("blocked storage defaults to System and allows session choices", () => {
  const { dom } = boot(null, true, true);
  try {
    const window = dom.window as unknown as Window;
    assert.equal(window.palimpsestAppearance.get(), "system");
    window.palimpsestAppearance.set("light");
    assert.equal(window.document.documentElement.dataset.theme, "light");
  } finally {
    dom.window.close();
  }
});

test("radio choices update the theme, persist, and restore on startup", async () => {
  const { dom } = boot(null, false);
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => root.render(<Appearance />));
    assert.equal(
      document.querySelector('[role="radiogroup"]')!.getAttribute("aria-label"),
      "Appearance",
    );
    assert.equal(
      document.querySelector<HTMLInputElement>('input[value="system"]')!
        .checked,
      true,
    );
    for (const choice of ["light", "dark", "system"]) {
      const input = document.querySelector<HTMLInputElement>(
        `input[value="${choice}"]`,
      )!;
      await act(async () => input.click());
      assert.equal(input.checked, true);
      assert.equal(
        document.documentElement.getAttribute("data-theme"),
        choice === "system" ? null : choice,
      );
      const stored = window.localStorage.getItem("palimpsest.appearance");
      assert.equal(stored, choice);
      const restored = boot(stored, true);
      assert.equal(
        restored.dom.window.document.documentElement.getAttribute("data-theme"),
        choice === "system" ? null : choice,
      );
      restored.dom.window.close();
    }
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});
