import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createContext, useContext } from "react";
import type { Element, ElementContent } from "hast";

const ChecklistText = createContext("");

function markdownText(node: Element | ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(markdownText).join("");
  return "";
}

export function MarkdownContent({
  content,
  files,
  fileName,
  openFile,
  resourceBaseUrl,
}: {
  content: string;
  files: string[];
  fileName: string;
  openFile?: (file: string) => void;
  resourceBaseUrl?: string;
}) {
  const body = content
    .replace(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .trim();
  return (
    <div className="markdown-content">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          h1: "h2",
          h2: "h3",
          h3: "h4",
          h4: "h5",
          h5: "h6",
          img: ({ alt }) => (
            <span className="muted">Image: {alt || "Untitled image"}</span>
          ),
          li: ({ node, children, ...props }) => (
            <ChecklistText.Provider value={markdownText(node!).trim()}>
              <li {...props}>{children}</li>
            </ChecklistText.Provider>
          ),
          input: function ChecklistInput({ node, ...props }) {
            const label = useContext(ChecklistText);
            return <input {...props} aria-label={label || "Checklist item"} />;
          },
          a: ({ href, children, title }) => {
            if (!href) return <span>{children}</span>;
            let url: URL;
            try {
              url = new URL(
                href,
                resourceBaseUrl ?? `https://skill.local/${fileName}`,
              );
            } catch {
              return <span>{children}</span>;
            }
            if (url.origin === "https://skill.local" && !href.startsWith("#")) {
              let resource: string;
              try {
                resource = decodeURIComponent(url.pathname.slice(1));
              } catch {
                return <span>{children}</span>;
              }
              if (openFile && files.includes(resource)) {
                return (
                  <button
                    type="button"
                    className="markdown-file-link"
                    title={title}
                    onClick={() => openFile(resource)}
                  >
                    {children}
                  </button>
                );
              }
            }
            return (
              <a
                href={resourceBaseUrl ? url.href : href}
                title={title}
                target={
                  url.origin !== "https://skill.local" ? "_blank" : undefined
                }
                rel="noreferrer"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {body || "This file has no Markdown content yet."}
      </Markdown>
    </div>
  );
}
