import fs from "node:fs";
import path from "node:path";
import { isUtf8 } from "node:buffer";

export type Finding = {
  kind:
    | "script"
    | "binary"
    | "hidden-character"
    | "download-and-run"
    | "credential-path";
  file: string;
  line?: number;
  detail?: string;
};
export type PackageScan = { findings: Finding[]; truncated: boolean };

const findingLimit = 100;
export const scriptExtension = /\.(?:sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|ps1)$/i;
const hiddenCharacters =
  /[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\u{e0000}-\u{e007f}]/gu;
const credentialPath =
  /(?:~\/\.ssh\b|~\/\.aws\/credentials\b|(?:^|[\s/\\'"`=])\.env\b|\bid_rsa\b|\bsecurity\s+find-generic-password\b)/i;
const downloadAndRun =
  /\b(?:curl|wget|iwr|Invoke-WebRequest)(?:\.exe)?\b[^\r\n]*\|\s*(?:sh|bash|zsh|ksh|fish|pwsh|powershell|iex|Invoke-Expression)\b|\beval\s+["']?\$\(\s*(?:curl|wget)\b|\b(?:iex|Invoke-Expression)\s*\(\s*(?:iwr|Invoke-WebRequest|curl|wget)\b/gi;

export function scanPackage(directory: string, files: string[]): PackageScan {
  const findings: Finding[] = [];
  const locations = new Set<string>();
  function add(finding: Finding) {
    const key = `${finding.file}\0${finding.kind}\0${finding.line ?? ""}`;
    if (locations.has(key)) return;
    locations.add(key);
    findings.push(finding);
  }
  for (const file of files) {
    const location = path.join(directory, file);
    if (
      scriptExtension.test(file) ||
      (fs.statSync(location).mode & 0o111) !== 0
    )
      add({ kind: "script", file });
    const bytes = fs.readFileSync(location);
    if (
      bytes.includes(0) ||
      !isUtf8(bytes) ||
      /[\x01-\x08\x0e-\x1f]/.test(bytes.toString("latin1"))
    ) {
      add({ kind: "binary", file });
    } else {
      const content = bytes.toString("utf8");
      const lines = content.split(/\r\n|[\r\n]/);
      for (const [index, line] of lines.entries()) {
        const hidden = [...line.matchAll(hiddenCharacters)].filter(
          (match) =>
            !(index === 0 && match.index === 0 && match[0] === "\ufeff"),
        );
        if (hidden.length)
          add({
            kind: "hidden-character",
            file,
            line: index + 1,
            detail: [
              ...new Set(
                hidden.map(
                  ([character]) =>
                    "U+" +
                    character
                      .codePointAt(0)!
                      .toString(16)
                      .toUpperCase()
                      .padStart(4, "0"),
                ),
              ),
            ].join(", "),
          });
        if (credentialPath.test(line))
          add({ kind: "credential-path", file, line: index + 1 });
        if (findings.length > findingLimit) break;
      }
      // Keep offsets intact so continued shell commands retain their source line.
      const commands = content.replace(/\\\r?\n/g, (match) =>
        " ".repeat(match.length),
      );
      for (const match of commands.matchAll(downloadAndRun)) {
        add({
          kind: "download-and-run",
          file,
          line: content.slice(0, match.index).split(/\r\n|[\r\n]/).length,
        });
        if (findings.length > findingLimit) break;
      }
    }
    if (findings.length > findingLimit) break;
  }
  return {
    findings: findings.slice(0, findingLimit),
    truncated: findings.length > findingLimit,
  };
}
