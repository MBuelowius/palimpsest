import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = os.homedir();
const target = path.join(home, ".local", "share", "skill-library", "app");
const bin = path.join(home, ".local", "bin", "palimpsest");
const source = path.join(home, "src", "repos", "palimpsest");
if (!fs.existsSync(path.join(root, "dist", "cli.mjs")))
  throw new Error("Run npm run build before installing.");
if (fs.existsSync(bin)) {
  const contents = fs.readFileSync(bin, "utf8");
  if (!contents.includes("/skill-library/app/cli.mjs"))
    throw new Error("Another command already owns " + bin);
}
fs.mkdirSync(path.dirname(target), { recursive: true });
const staging = target + ".new-" + Date.now();
fs.cpSync(path.join(root, "dist"), staging, { recursive: true });
if (fs.existsSync(target))
  fs.renameSync(target, target + ".backup-" + Date.now());
fs.renameSync(staging, target);
fs.mkdirSync(path.dirname(bin), { recursive: true });
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
fs.writeFileSync(
  bin,
  `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(target, "cli.mjs"))} "$@"\n`,
  { mode: 0o755 },
);
if (!fs.existsSync(source)) {
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.cpSync(root, source, {
    recursive: true,
    filter: (p) =>
      !["node_modules", "dist", ".DS_Store"].includes(path.basename(p)),
  });
}
process.stdout.write(
  `Installed: ${bin}\nSource: ${source}\nOpen: palimpsest ui\n`,
);
