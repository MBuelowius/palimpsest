import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { HarnessChoice } from "./HarnessChoice";
import type { Harness } from "../server/harnesses";

const harness = (id: Harness["id"], name: string, detected: boolean) =>
  ({ id, name, detected, evidence: [] }) as Harness;
const all = [
  harness("claude", "Claude Code", true),
  harness("codex", "Codex", false),
  harness("cursor", "Cursor", false),
];

async function render(tools: Harness["id"][]) {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    getComputedStyle: dom.window.getComputedStyle,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const root = createRoot(document.getElementById("root")!);
  await act(async () => {
    root.render(
      <HarnessChoice harnesses={all} tools={tools} setTools={() => {}} />,
    );
  });
  const cleanup = async () => {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    Reflect.deleteProperty(globalThis, "getComputedStyle");
    dom.window.close();
  };
  return { cleanup, details: document.querySelector("details")! };
}

test("detected apps are shown and the rest wait under Other apps", async () => {
  const { cleanup, details } = await render(["claude"]);
  try {
    const inline = document.querySelectorAll(
      ".harness-choice > .tools-choice [role=checkbox]",
    );
    assert.deepEqual(
      [...inline].map((box) => box.getAttribute("aria-label")),
      ["Use in Claude Code"],
    );
    assert.equal(details.open, false);
    assert.match(details.textContent!, /Codex/);
  } finally {
    await cleanup();
  }
});

test("Other apps opens when an undetected app is already chosen", async () => {
  const { cleanup, details } = await render(["claude", "cursor"]);
  try {
    assert.equal(details.open, true);
    assert.match(details.querySelector("summary")!.textContent!, /1 selected/);
  } finally {
    await cleanup();
  }
});
