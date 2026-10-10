export const harnesses = [
  {
    id: "claude",
    label: "Claude Code",
    directory: ".claude/skills",
    root: "claude",
  },
  { id: "codex", label: "Codex", directory: ".agents/skills", root: "agents" },
  {
    id: "cursor",
    label: "Cursor",
    directory: ".cursor/skills",
    root: "cursor",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    directory: ".gemini/skills",
    root: "gemini",
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    directory: ".copilot/skills",
    root: "copilot",
  },
  {
    id: "opencode",
    label: "OpenCode",
    directory: ".config/opencode/skills",
    root: "opencode",
  },
] as const;

export type Tool = (typeof harnesses)[number]["id"];
export const toolLabel = Object.fromEntries(
  harnesses.map((harness) => [harness.id, harness.label]),
) as Record<Tool, string>;
export const sourceLabel: Record<string, string> = {
  ...toolLabel,
  codex: "Codex · legacy folder",
  agents: "Common agents folder",
  shared: "Shared library",
};
