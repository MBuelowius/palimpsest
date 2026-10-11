import { useEffect, useRef, useState } from "react";
import { type Editor, commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
} from "@milkdown/kit/preset/commonmark";
import { createMarkdownEditor } from "./markdownEditing";
import { Bold, Italic, Heading2, List } from "lucide-react";
import { Button } from "./components/ui/button";
import "@milkdown/kit/prose/view/style/prosemirror.css";

export function MarkdownEditor({
  content,
  fileName,
  label,
  disabled,
  onChange,
  onError,
}: {
  content: string;
  fileName: string;
  label: string;
  disabled: boolean;
  onChange: (content: string) => void;
  onError: (message: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const instance = useRef<Editor | undefined>(undefined);
  const callbacks = useRef({ onChange, onError });
  callbacks.current = { onChange, onError };
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const editor = createMarkdownEditor(
      root.current!,
      content,
      label,
      (next) => {
        if (active) callbacks.current.onChange(next);
      },
    );
    const created = editor
      .create()
      .then(() => {
        if (active) {
          instance.current = editor;
          setReady(true);
        }
      })
      .catch((error: Error) => {
        if (active) callbacks.current.onError(error.message);
      });
    return () => {
      active = false;
      instance.current = undefined;
      void created.then(() => editor.destroy());
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    instance
      .current!.ctx.get(editorViewCtx)
      .setProps({ editable: () => !disabled });
    root
      .current!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .forEach((checkbox) => {
        checkbox.disabled = disabled;
      });
  }, [disabled, ready]);
  return (
    <div className="rich-editor">
      <div
        className="format-toolbar"
        role="group"
        aria-label="Markdown formatting"
      >
        <code className="format-file-name">{fileName}</code>
        {[
          { label: "Bold", Icon: Bold, command: toggleStrongCommand.key },
          { label: "Italic", Icon: Italic, command: toggleEmphasisCommand.key },
          {
            label: "Heading",
            Icon: Heading2,
            command: wrapInHeadingCommand.key,
            payload: 2,
          },
          {
            label: "Bullet list",
            Icon: List,
            command: wrapInBulletListCommand.key,
          },
        ].map(({ label, Icon, command, payload }) => (
          <Button
            key={label}
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            title={label}
            disabled={disabled || !ready}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              instance.current!.action((ctx) =>
                ctx.get(commandsCtx).call(command, payload),
              );
              instance.current!.ctx.get(editorViewCtx).focus();
            }}
          >
            <Icon size={16} />
          </Button>
        ))}
      </div>
      <div ref={root} className="markdown-editor-root" />
    </div>
  );
}
