import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Appearance } from "./Appearance";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = readFileSync(
  new URL("../public/appearance.js", import.meta.url),
  "utf8",
);

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
  dom.window.eval(script);
  return { dom, system };
}

for (const stored of [null, "invalid", "light", "dark"]) {
  test(`startup: stored ${JSON.stringify(stored)}`, () => {
    const { dom } = boot(stored, true);
    try {
      const choice =
        stored === "light" || stored === "dark" ? stored : "system";
      const effective = choice === "system" ? "dark" : choice;
      const document = dom.window.document;
      assert.equal(
        (dom.window as unknown as Window).palimpsestAppearance.get(),
        choice,
      );
      assert.equal(
        document.documentElement.getAttribute("data-theme"),
        effective,
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

test("System follows scheme changes without changing the stored choice", () => {
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
    assert.equal(window.document.documentElement.dataset.theme, "dark");
    assert.equal(window.palimpsestAppearance.get(), "system");
    Object.assign(system, { matches: false });
    system.dispatchEvent(new dom.window.Event("change"));
    assert.equal(scheme(), "light");
    assert.equal(window.document.documentElement.dataset.theme, "light");
    assert.equal(window.palimpsestAppearance.get(), "system");
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

test("radio group persists a choice", async () => {
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
    const input = document.querySelector<HTMLInputElement>(
      'input[value="dark"]',
    )!;
    await act(async () => input.click());
    assert.equal(input.checked, true);
    assert.equal(document.documentElement.getAttribute("data-theme"), "dark");
    const stored = window.localStorage.getItem("palimpsest.appearance");
    assert.equal(stored, "dark");
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});
