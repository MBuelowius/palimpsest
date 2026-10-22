import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "./http.ts";
import { SkillLibrary } from "./library.ts";

test("served appearance bootstrap has a matching CSP nonce on each response", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "appearance-http-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.copyFileSync(
    new URL("../index.html", import.meta.url),
    path.join(home, "index.html"),
  );
  const server = createServer(new SkillLibrary(home), home);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as { port: number };
  let previous: string | undefined;
  for (let request = 0; request < 2; request++) {
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    const nonce = html.match(
      /<script id="appearance-init" nonce="([^"]+)">/,
    )?.[1];
    assert.ok(nonce);
    assert.notEqual(nonce, previous);
    const policy = response.headers.get("content-security-policy")!;
    assert.ok(policy.includes(`script-src 'self' 'nonce-${nonce}'`));
    assert.ok(!policy.includes("script-src 'self' 'unsafe-inline'"));
    previous = nonce;
  }
});
