import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillEditor } from "./SkillEditor.tsx";

test("non-Markdown files remain plain source and saving locks editing", () => {
  const plain = renderToStaticMarkup(
    <SkillEditor fileName="script.sh" value="echo hello" onChange={() => {}} />,
  );
  assert.match(plain, /aria-label="Edit script.sh"/);
  assert.doesNotMatch(plain, /Markdown source formatting/);
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
