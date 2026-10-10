import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownContent } from "./MarkdownContent";

test("skill Markdown renders headings, lists, code, and tables without frontmatter", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      content: `---
name: review
description: Private metadata
---
# Review

1. Read **the change**.
2. Check \`tests\`.

| Area | Result |
| --- | --- |
| Tests | Passed |

- [x] Review complete

\`\`\`js
const ready = true;
\`\`\``,
      files: ["SKILL.md"],
      fileName: "SKILL.md",
      openFile: () => undefined,
    }),
  );
  assert.match(html, /<h2>Review<\/h2>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<strong>the change<\/strong>/);
  assert.match(html, /<code>tests<\/code>/);
  assert.match(html, /<table>/);
  assert.match(html, /<input[^>]*type="checkbox"[^>]*checked/);
  assert.match(html, /aria-label="Review complete"/);
  assert.match(html, /<pre><code class="language-js">/);
  assert.doesNotMatch(html, /Private metadata|name: review/);
});

test("Markdown leaves unsafe and malformed links inert and does not render raw HTML", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      content: `<script>alert('test')</script>

[Unsafe](javascript:alert%281%29) [Malformed](https://%)`,
      files: [],
      fileName: "SKILL.md",
      openFile: () => undefined,
    }),
  );
  assert.doesNotMatch(html, /<script|javascript:|<a/);
  assert.match(html, /Unsafe/);
  assert.match(html, /Malformed/);
});

test("package references open files in the skill and external links open separately", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      content: `[Reference](../references/guide.md) [Docs](https://example.com/docs)`,
      files: ["references/guide.md", "notes/readme.md"],
      fileName: "notes/readme.md",
      openFile: () => undefined,
    }),
  );
  assert.match(
    html,
    /<button[^>]*class="markdown-file-link"[^>]*>Reference<\/button>/,
  );
  assert.match(
    html,
    /<a href="https:\/\/example.com\/docs" target="_blank" rel="noreferrer">Docs<\/a>/,
  );
});

test("collection references open the matching files on GitHub", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      content: "[Guide](references/guide.md) [Other](../other/SKILL.md)",
      files: [],
      fileName: "SKILL.md",
      resourceBaseUrl:
        "https://github.com/example/skills/blob/abc123/skills/review/SKILL.md",
    }),
  );
  assert.match(
    html,
    /href="https:\/\/github.com\/example\/skills\/blob\/abc123\/skills\/review\/references\/guide.md" target="_blank"/,
  );
  assert.match(
    html,
    /href="https:\/\/github.com\/example\/skills\/blob\/abc123\/skills\/other\/SKILL.md"/,
  );
  assert.doesNotMatch(html, /<button/);
});
