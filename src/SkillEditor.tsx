import { memo, useDeferredValue, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bold, Italic, Heading2, List, Link2, Code2 } from "lucide-react";

export const MarkdownPreview = memo(function MarkdownPreview({
  content,
}: {
  content: string;
}) {
  const frontmatter = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(
    content,
  );
  const body = frontmatter ? content.slice(frontmatter[0].length) : content;
  return (
    <div className="markdown-document">
      {frontmatter && (
        <section className="markdown-metadata" aria-label="Skill metadata">
          <h3>Skill metadata</h3>
          <pre>{frontmatter[1]}</pre>
        </section>
      )}
      {body.trim() ? (
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) =>
              href && /^(https?:|mailto:)/i.test(href) ? (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ) : (
                <span title={href}>{children}</span>
              ),
            img: ({ alt }) => (
              <span className="markdown-image">
                Image: {alt || "Untitled image"}
              </span>
            ),
          }}
        >
          {body}
        </Markdown>
      ) : (
        <p className="markdown-placeholder">Write Markdown to see it here.</p>
      )}
    </div>
  );
});

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
type Mode = "source" | "split" | "preview";

export function SkillEditor({
  fileName,
  value,
  onChange,
  readOnly = false,
}: {
  fileName: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("split");
  const input = useRef<HTMLTextAreaElement>(null);
  const markdown = /\.(md|markdown|mdown)$/i.test(fileName);
  const preview = useDeferredValue(value);
  const effectiveMode = markdown ? mode : "source";
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
    <div className="skill-editor">
      {markdown && (
        <div className="markdown-toolbar">
          <div className="editor-modes" role="group" aria-label="Markdown view">
            {(["source", "split", "preview"] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={effectiveMode === item}
                onClick={() => setMode(item)}
              >
                {item === "source"
                  ? "Source"
                  : item === "split"
                    ? "Split"
                    : "Preview"}
              </button>
            ))}
          </div>
          {effectiveMode !== "preview" && (
            <div
              className="format-actions"
              role="group"
              aria-label="Markdown formatting"
            >
              {formats.map(({ label, icon: Icon }, index) => (
                <button
                  key={label}
                  type="button"
                  aria-label={label}
                  title={label}
                  disabled={readOnly}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => format(index)}
                >
                  <Icon size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className={`editor-panes editor-${effectiveMode}`}>
        {effectiveMode !== "preview" && (
          <section className="editor-pane" aria-label="Source editor">
            {effectiveMode === "split" && (
              <div className="pane-heading">Source</div>
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
          </section>
        )}
        {effectiveMode !== "source" && (
          <section
            className="editor-pane preview-pane"
            aria-label="Markdown preview"
          >
            <div className="pane-heading">
              Preview <span>Updates as you type</span>
            </div>
            <div className="markdown-scroll" tabIndex={0}>
              <MarkdownPreview content={preview} />
            </div>
          </section>
        )}
      </div>
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
