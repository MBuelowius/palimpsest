import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownPreview, SkillEditor } from "./SkillEditor.tsx";

test("preview separates CRLF frontmatter and renders Markdown and GFM", () => {
  const content =
    "---\r\nname: example\r\ndescription: Test\r\n---\r\n# Instructions\n\n**Start here**\n\n- [x] Done\n\n| Step | Result |\n| --- | --- |\n| Read | Ready |\n\n```sh\necho hello\n```";
  const html = renderToStaticMarkup(<MarkdownPreview content={content} />);
  assert.match(html, /aria-label="Skill metadata"/);
  assert.match(html, /<h1>Instructions<\/h1>/);
  assert.match(html, /<strong>Start here<\/strong>/);
  assert.match(html, /<table>/);
  assert.match(html, /type="checkbox" disabled="" checked=""/);
  assert.match(html, /class="language-sh"/);
  assert.doesNotMatch(html, /<hr/);
  assert.match(
    renderToStaticMarkup(
      <MarkdownPreview content={"---\nname: example\n---"} />,
    ),
    /Write Markdown/,
  );
  assert.doesNotMatch(
    renderToStaticMarkup(
      <MarkdownPreview content={"---\nUnclosed metadata"} />,
    ),
    /aria-label="Skill metadata"/,
  );
});

test("untrusted Markdown cannot render active HTML, unsafe links or image requests", () => {
  const html = renderToStaticMarkup(
    <MarkdownPreview
      content={
        "<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)\n\n[good](https://example.com)\n\n[local](references/guide.md)\n\n![Example](https://example.com/tracker.png)"
      }
    />,
  );
  assert.doesNotMatch(html, /<script|<img|href="javascript:|href="references/);
  assert.match(
    html,
    /href="https:\/\/example.com" target="_blank" rel="noopener noreferrer"/,
  );
  assert.match(html, /Image: Example/);
});

test("non-Markdown files remain plain source and saving locks editing", () => {
  const plain = renderToStaticMarkup(
    <SkillEditor fileName="script.sh" value="echo hello" onChange={() => {}} />,
  );
  assert.match(plain, /aria-label="Edit script.sh"/);
  assert.doesNotMatch(
    plain,
    /Markdown view|Markdown formatting|Markdown preview/,
  );
  const locked = renderToStaticMarkup(
    <SkillEditor
      fileName="SKILL.md"
      value="# Hello"
      onChange={() => {}}
      readOnly
    />,
  );
  assert.match(locked, /readOnly=""/);
  assert.match(locked, /aria-label="Bold"[^>]*disabled=""/);
});
