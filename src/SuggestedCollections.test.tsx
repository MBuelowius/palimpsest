import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SuggestedCollections } from "./SuggestedCollections";

test("suggestions hide added collections regardless of repository casing", () => {
  const render = (repos: string[]) =>
    renderToStaticMarkup(
      <SuggestedCollections
        sources={repos.map((repo) => ({ repo }))}
        busy={false}
        onAdd={() => {}}
      />,
    );
  assert.match(render([]), /Add anthropics\/skills/);
  assert.match(render([]), /Add openai\/skills/);
  const remaining = render(["Anthropics/Skills", "someone/else"]);
  assert.doesNotMatch(remaining, /anthropics\/skills/);
  assert.match(remaining, /Add openai\/skills/);
  assert.equal(render(["anthropics/skills", "OPENAI/SKILLS"]), "");
});

test("the collection being added shows Adding… and disables both buttons", () => {
  const html = renderToStaticMarkup(
    <SuggestedCollections
      sources={[]}
      busy={true}
      adding="anthropics/skills"
      onAdd={() => {}}
    />,
  );
  assert.match(
    html,
    /aria-label="Add anthropics\/skills"[^>]*>Adding…<\/button>/,
  );
  assert.match(html, /aria-label="Add openai\/skills"[^>]*>Add<\/button>/);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
});
