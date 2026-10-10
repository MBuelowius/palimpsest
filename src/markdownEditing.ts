import {
  Editor,
  defaultValueCtx,
  editorViewOptionsCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import { commonmark, listItemSchema } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { indent } from "@milkdown/kit/plugin/indent";
import { Plugin } from "@milkdown/kit/prose/state";
import { $prose, $view } from "@milkdown/kit/utils";
export function createMarkdownEditor(
  root: HTMLElement,
  content: string,
  label: string,
  onChange: (content: string) => void,
) {
  const frontmatter =
    content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? "";
  const body = content.slice(frontmatter.length);
  const changes = $prose(
    (ctx) =>
      new Plugin({
        view(view) {
          const original = view.state.doc;
          return {
            update(current, previous) {
              if (current.state.doc.eq(previous.doc)) return;
              // Keep the original file byte-for-byte when an edit is undone.
              if (current.state.doc.eq(original)) {
                onChange(content);
                return;
              }
              const markdown = ctx.get(serializerCtx)(current.state.doc);
              onChange(
                frontmatter +
                  (content.includes("\r\n")
                    ? markdown.replace(/\n/g, "\r\n")
                    : markdown),
              );
            },
          };
        },
      }),
  );
  const taskLists = $view(listItemSchema.node, () => (node, view, getPos) => {
    const dom = document.createElement("li");
    const contentDOM = document.createElement("div");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.contentEditable = "false";
    let current = node;
    function update() {
      const task = current.attrs.checked !== null;
      dom.dataset.task = String(task);
      checkbox.hidden = !task;
      checkbox.checked = Boolean(current.attrs.checked);
      checkbox.disabled = !view.editable;
      checkbox.setAttribute(
        "aria-label",
        current.textContent || "Checklist item",
      );
    }
    checkbox.addEventListener("change", () => {
      const position = getPos();
      if (position !== undefined) {
        view.dispatch(
          view.state.tr.setNodeMarkup(position, undefined, {
            ...current.attrs,
            checked: checkbox.checked,
          }),
        );
      }
    });
    dom.append(checkbox, contentDOM);
    update();
    return {
      dom,
      contentDOM,
      update(next) {
        if (next.type !== current.type) return false;
        current = next;
        update();
        return true;
      },
      stopEvent: (event) => event.target === checkbox,
      ignoreMutation: (mutation) =>
        mutation.type !== "selection" && mutation.target === checkbox,
    };
  });
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, body);
      ctx.set(editorViewOptionsCtx, {
        attributes: {
          role: "textbox",
          "aria-label": label,
          "aria-multiline": "true",
          class: "markdown-content rendered-editor",
        },
        handleClickOn: (_view, _pos, _node, _nodePos, event) => {
          if ((event.target as HTMLElement).closest("a")) {
            event.preventDefault();
            return true;
          }
          return false;
        },
      });
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(clipboard)
    .use(indent)
    .use(taskLists)
    .use(changes);
}
