import { useImperativeHandle, useRef, type Ref } from "react";
import { Bold, Italic, Heading2, List, Link2, Code2 } from "lucide-react";
import { Button } from "./components/ui/button";

const formats = [
  {
    label: "Bold",
    icon: Bold,
    before: "**",
    after: "**",
    placeholder: "bold text",
  },
  {
    label: "Italic",
    icon: Italic,
    before: "_",
    after: "_",
    placeholder: "italic text",
  },
  {
    label: "Heading",
    icon: Heading2,
    before: "## ",
    after: "",
    placeholder: "Heading",
    block: true,
  },
  {
    label: "List",
    icon: List,
    before: "- ",
    after: "",
    placeholder: "List item",
    block: true,
  },
  {
    label: "Link",
    icon: Link2,
    before: "[",
    after: "](https://example.com)",
    placeholder: "link text",
  },
  {
    label: "Code block",
    icon: Code2,
    before: "```\n",
    after: "\n```",
    placeholder: "code",
    block: true,
  },
];
export function SkillEditor({
  ref,
  fileName,
  value,
  onChange,
  readOnly = false,
}: {
  ref?: Ref<HTMLTextAreaElement>;
  fileName: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => input.current!);
  const markdown = /\.(md|markdown|mdown)$/i.test(fileName);
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  function format(index: number) {
    const editor = input.current;
    if (!editor || readOnly) return;
    const { before, after, placeholder, block } = formats[index];
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = value.slice(start, end) || placeholder;
    const formatted =
      formats[index].label === "List"
        ? selected.replace(/\n(?=[^\n]*\S)/g, "\n- ")
        : selected;
    const prefix = block && start > 0 && value[start - 1] !== "\n" ? "\n" : "";
    const suffix =
      block && end < value.length && value[end] !== "\n" ? "\n" : "";
    onChange(
      value.slice(0, start) +
        prefix +
        before +
        formatted +
        after +
        suffix +
        value.slice(end),
    );
    requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(
        start + prefix.length + before.length,
        start + prefix.length + before.length + formatted.length,
      );
    });
  }
  return (
    <div className="skill-source-editor">
      {markdown && (
        <div
          className="format-toolbar"
          role="group"
          aria-label="Markdown source formatting"
        >
          {formats.map(({ label, icon: Icon }, index) => (
            <Button
              key={label}
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              title={label}
              disabled={readOnly}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format(index)}
            >
              <Icon size={15} aria-hidden="true" />
            </Button>
          ))}
        </div>
      )}
      <textarea
        ref={input}
        aria-label={`Edit ${fileName}`}
        className="code-editor"
        value={value}
        spellCheck={false}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (
            markdown &&
            (event.metaKey || event.ctrlKey) &&
            ["b", "i"].includes(event.key.toLowerCase())
          ) {
            event.preventDefault();
            format(event.key.toLowerCase() === "b" ? 0 : 1);
          }
        }}
      />
      <div className="editor-status">
        <span>{markdown ? "Markdown" : "Plain text"}</span>
        <span>
          {words.toLocaleString()} words ·{" "}
          {value.split("\n").length.toLocaleString()} lines
        </span>
      </div>
    </div>
  );
}
