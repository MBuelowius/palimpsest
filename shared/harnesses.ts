export type Tool =
  | "claude"
  | "codex"
  | "cursor"
  | "gemini"
  | "opencode"
  | "copilot"
  | "windsurf";

type HarnessDefinition = {
  id: Tool;
  name: string;
  config: string;
  commands: string[];
  apps: string[];
  requiresName: boolean;
};

export const harnessDefinitions: HarnessDefinition[] = [
  {
    id: "claude",
    name: "Claude",
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
    requiresName: false,
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
