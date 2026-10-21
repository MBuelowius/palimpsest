export type BaseTool =
  | "claude"
  | "codex"
  | "cursor"
  | "gemini"
  | "opencode"
  | "copilot"
  | "windsurf";

// An account is another config folder for the same app, written "claude:work".
export type Tool = BaseTool | `${BaseTool}:${string}`;
export const baseTool = (tool: string) => tool.split(":")[0] as BaseTool;

type HarnessDefinition = {
  id: BaseTool;
  name: string;
  config: string;
  commands: string[];
  apps: string[];
  requiresName: boolean;
};

export const harnessDefinitions: HarnessDefinition[] = [
  {
    id: "claude",
    name: "Claude Code",
    config: ".claude",
    commands: ["claude"],
    apps: ["Claude.app"],
    requiresName: false,
  },
  {
    id: "codex",
    name: "Codex",
    config: ".codex",
    commands: ["codex"],
    apps: ["Codex.app"],
    requiresName: true,
  },
  {
    id: "cursor",
    name: "Cursor",
    config: ".cursor",
    commands: ["cursor", "cursor-agent"],
    apps: ["Cursor.app"],
    requiresName: true,
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    config: ".gemini",
    commands: ["gemini"],
    apps: [],
    requiresName: true,
  },
  {
    id: "opencode",
    name: "OpenCode",
    config: ".config/opencode",
    commands: ["opencode"],
    apps: ["OpenCode.app"],
    requiresName: true,
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    config: ".copilot",
    commands: ["copilot"],
    apps: ["GitHub Copilot.app"],
    requiresName: true,
  },
  {
    id: "windsurf",
    name: "Windsurf / Devin",
    config: ".codeium/windsurf",
    commands: ["windsurf", "devin"],
    apps: ["Windsurf.app", "Devin.app"],
    requiresName: true,
  },
];

export const harnesses = harnessDefinitions.map((harness) => ({
  id: harness.id,
  label: harness.name,
  directory:
    harness.id === "codex" ? ".agents/skills" : harness.config + "/skills",
  root: harness.id === "codex" ? "agents" : harness.id,
}));
export const toolLabel = Object.fromEntries(
  harnesses.map((harness) => [harness.id, harness.label]),
) as Record<BaseTool, string>;
const folderLabel: Record<string, string> = {
  ...toolLabel,
  codex: "Codex · legacy folder",
  agents: "Common agents folder",
  devin: "Devin",
  shared: "Shared library",
};
const named = (labels: Record<string, string>) => (id: string) => {
  const [base, ...account] = id.split(":");
  return labels[base]
    ? account.length
      ? `${labels[base]} · ${account.join(":")}`
      : labels[base]
    : id;
};
// An app or one of its accounts, and the same for a skill folder.
export const toolName = named(toolLabel);
const folderName = named(folderLabel);
// An account's skill folder is named after the account, not the app's folders.
export const sourceName = (id: string) =>
  id.includes(":") ? toolName(id) : folderName(id);
