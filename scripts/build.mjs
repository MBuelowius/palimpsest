import { build } from "esbuild";
import { chmodSync, copyFileSync } from "node:fs";
await build({
  entryPoints: ["server/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/cli.mjs",
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
chmodSync("dist/cli.mjs", 0o755);
copyFileSync("LICENSE", "dist/LICENSE");
