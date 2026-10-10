import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { harnessDefinitions, type Tool } from "../shared/harnesses.ts";
export {
  harnessDefinitions,
  harnesses,
  toolLabel,
  sourceLabel,
  type Tool,
} from "../shared/harnesses.ts";

export type Harness = {
  id: Tool;
  name: string;
  detected: boolean;
  evidence: {
    kind: "config" | "command" | "application" | "extension";
    path: string;
  }[];
};

function stat(location: string) {
  try {
    return fs.statSync(location);
  } catch (error) {
    if (
      ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      return undefined;
    throw error;
  }
}

export function skillRoots(home: string) {
  const roots = harnessDefinitions.map((harness) => ({
    id: harness.id as string,
    tool: harness.id,
    label: harness.name,
    path: path.join(home, harness.config, "skills"),
  }));
  roots.splice(2, 0, {
    id: "agents",
    tool: "codex",
    label: "Common agents folder",
    path: path.join(home, ".agents", "skills"),
  });
  roots[1].label = "Codex · legacy folder";
  roots.push({
    id: "devin",
    tool: "windsurf",
    label: "Devin",
    path: path.join(home, ".config", "devin", "skills"),
  });
  return roots;
}

export function detectHarnesses(
  home: string,
  options: {
    searchPath?: string;
    applicationDirectories?: string[];
    platform?: NodeJS.Platform;
  } = {},
): Harness[] {
  home = fs.realpathSync(path.resolve(home));
  const platform = options.platform ?? process.platform;
  // A supplied library home must not inherit the host's installed harnesses.
  const hostHome = fs.realpathSync(os.homedir());
  const local = home === hostHome;
  const searchPath =
    options.searchPath ?? (local ? (process.env.PATH ?? "") : "");
  const bins = [
    ...new Set([
      ...searchPath
        .split(platform === "win32" ? ";" : path.delimiter)
        .filter((directory) => path.isAbsolute(directory)),
      path.join(home, ".local", "bin"),
      path.join(home, ".npm-global", "bin"),
      path.join(home, ".bun", "bin"),
      path.join(home, ".opencode", "bin"),
      ...(local && platform !== "win32"
        ? [
            path.dirname(process.execPath),
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
          ]
        : []),
    ]),
  ];
  const appDirectories = options.applicationDirectories ?? [
    path.join(home, "Applications"),
    ...(local ? ["/Applications"] : []),
  ];
  return harnessDefinitions.map((definition) => {
    const evidence: Harness["evidence"] = [];
    const configs = [path.join(home, definition.config)];
    if (definition.id === "windsurf")
      configs.push(path.join(home, ".config", "devin"));
    for (const location of configs) {
      if (stat(location)?.isDirectory())
        evidence.push({ kind: "config", path: location });
    }
    if (definition.id === "claude") {
      const location = path.join(home, ".claude.json");
      if (stat(location)?.isFile())
        evidence.push({ kind: "config", path: location });
    }
    for (const command of definition.commands) {
      const names =
        platform === "win32"
          ? [command + ".exe", command + ".cmd", command + ".bat"]
          : [command];
      const executable = bins
        .flatMap((bin) => names.map((name) => path.join(bin, name)))
        .find((location) => {
          if (!stat(location)?.isFile()) return false;
          try {
            fs.accessSync(
              location,
              platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
            );
            return true;
          } catch (error) {
            if (
              ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes(
                (error as NodeJS.ErrnoException).code ?? "",
              )
            )
              return false;
            throw error;
          }
        });
      if (executable) evidence.push({ kind: "command", path: executable });
    }
    if (platform === "darwin") {
      for (const directory of appDirectories) {
        for (const app of definition.apps) {
          const location = path.join(directory, app);
          if (
            stat(location)?.isDirectory() &&
            stat(path.join(location, "Contents", "Info.plist"))?.isFile()
          )
            evidence.push({ kind: "application", path: location });
        }
      }
    }
    if (definition.id === "copilot") {
      for (const directory of [".vscode", ".vscode-insiders", ".cursor"]) {
        const extensions = path.join(home, directory, "extensions");
        if (!stat(extensions)?.isDirectory()) continue;
        let entries: string[];
        try {
          entries = fs.readdirSync(extensions);
        } catch (error) {
          if (
            ["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(
              (error as NodeJS.ErrnoException).code ?? "",
            )
          )
            continue;
          throw error;
        }
        for (const entry of entries) {
          if (!/^github\.copilot(?:-chat)?-\d/i.test(entry)) continue;
          const location = path.join(extensions, entry);
          if (stat(path.join(location, "package.json"))?.isFile())
            evidence.push({ kind: "extension", path: location });
        }
      }
    }
    return {
      id: definition.id,
      name: definition.name,
      detected: evidence.length > 0,
      evidence,
    };
  });
}
