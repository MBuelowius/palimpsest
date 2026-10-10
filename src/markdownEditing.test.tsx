import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});
before(() => {
  for (const name of [
    "window",
    "document",
    "navigator",
    "Node",
    "Element",
    "HTMLElement",
    "MutationObserver",
    "DOMParser",
    "CustomEvent",
    "Event",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: dom.window[name as keyof Window],
    });
  }
  for (const name of [
    "addEventListener",
    "removeEventListener",
    "dispatchEvent",
  ] as const) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: dom.window[name].bind(dom.window),
    });
  }
});
after(() => dom.window.close());

const metadata =
  "\uFEFF---\r\nname: sample\r\ndescription: Keep metadata exactly.\r\n# metadata comment\r\n---\r\n";

test("rendered edits preserve frontmatter, Markdown structures, comments, and line endings", async () => {
  const { createMarkdownEditor } = await import("./markdownEditing");
  const { editorViewCtx } = await import("@milkdown/kit/core");
  const root = document.createElement("div");
  document.body.append(root);
  const content =
    metadata +
    "# Instructions\r\n\r\nKeep **bold** and `code`.\r\n\r\n- [x] Done\r\n- [ ] Open\r\n\r\n| Check | Result |\r\n| --- | --- |\r\n| Focus | Visible |\r\n\r\n<!-- keep this comment -->\r\n\r\n```ts\r\nconst ready = true;\r\n```\r\n\r\n[Reference](references/guide.md)\r\n";
  let output = content;
  const editor = createMarkdownEditor(
    root,
    content,
    "Edit SKILL.md",
    (next) => {
      output = next;
    },
  );
  await editor.create();
  try {
    assert.equal(output, content);
    assert.equal(
      root.querySelector('[role="textbox"]')?.getAttribute("aria-label"),
      "Edit SKILL.md",
    );
    assert.equal(root.querySelector("h1")?.textContent, "Instructions");
    assert.equal(root.querySelectorAll('input[type="checkbox"]').length, 2);
    assert.ok(root.querySelector("table"));
    const view = editor.ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText("Updated ", 1));
    assert.ok(output.startsWith(metadata));
    assert.match(output, /# Updated Instructions/);
    assert.match(output, /\*\*bold\*\*/);
    assert.match(output, /`code`/);
    assert.match(output, /\[x\] Done/);
    assert.match(output, /\[ \] Open/);
    assert.match(output, /\| Focus\s*\| Visible/);
    assert.match(output, /<!-- keep this comment -->/);
    assert.match(output, /```ts\r\nconst ready = true;/);
    assert.match(output, /\[Reference\]\(references\/guide.md\)/);
    assert.equal(output.replaceAll("\r\n", "").includes("\n"), false);
  } finally {
    await editor.destroy();
    root.remove();
  }
});

test("undo returns the exact original file and checkbox edits serialize immediately", async () => {
  const { createMarkdownEditor } = await import("./markdownEditing");
  const { editorViewCtx } = await import("@milkdown/kit/core");
  const { undo } = await import("@milkdown/kit/prose/history");
  const root = document.createElement("div");
  document.body.append(root);
  const content = "# Original\n\n* [ ] Review the page\n";
  let output = content;
  const editor = createMarkdownEditor(
    root,
    content,
    "Edit notes.md",
    (next) => {
      output = next;
    },
  );
  await editor.create();
  try {
    const view = editor.ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText("New ", 1));
    assert.match(output, /# New Original/);
    assert.ok(undo(view.state, view.dispatch));
    assert.equal(output, content);
    const checkbox = root.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    assert.equal(checkbox.getAttribute("aria-label"), "Review the page");
    checkbox.click();
    assert.match(output, /\[x\] Review the page/);
  } finally {
    await editor.destroy();
    root.remove();
  }
});

test("unsafe links and raw HTML remain inert in the rendered editor", async () => {
  const { createMarkdownEditor } = await import("./markdownEditing");
  const root = document.createElement("div");
  document.body.append(root);
  const editor = createMarkdownEditor(
    root,
    "[Unsafe](javascript:alert(1))\n\n<script>alert(1)</script>\n",
    "Edit file",
    () => {},
  );
  await editor.create();
  try {
    assert.ok(root.querySelector("a"));
    assert.equal(root.querySelector('a[href^="javascript:"]'), null);
    assert.equal(root.querySelector("script"), null);
    assert.match(root.textContent!, /<script>alert\(1\)<\/script>/);
  } finally {
    await editor.destroy();
    root.remove();
  }
});

test("rendered editing preserves image Markdown without loading the image", async () => {
  const { createMarkdownEditor } = await import("./markdownEditing");
  const { editorViewCtx } = await import("@milkdown/kit/core");
  const root = document.createElement("div");
  document.body.append(root);
  const content =
    "# Instructions\n\n![Example](https://example.com/tracker.png)\n";
  let output = content;
  const editor = createMarkdownEditor(root, content, "Edit file", (next) => {
    output = next;
  });
  await editor.create();
  try {
    assert.ok(root.querySelector("img[src]") === null);
    assert.match(root.textContent!, /Image: Example/);
    const view = editor.ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText("Updated ", 1));
    assert.match(output, /!\[Example\]\(https:\/\/example.com\/tracker.png\)/);
  } finally {
    await editor.destroy();
    root.remove();
  }
});
