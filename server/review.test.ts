import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SkillLibrary } from "./library.ts";
import { installedAgents, reviewPrompt, runReview } from "./review.ts";
import { createServer } from "./http.ts";

test("review delegates to installed CLIs with read-only controls and stdin context", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "palimpsest-review-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const previousPath = process.env.PATH;
  process.env.PATH = home;
  t.after(() => {
    process.env.PATH = previousPath;
  });
  const library = new SkillLibrary(home);
  const packagePath = path.join(home, ".agents", "skills", "example");
  fs.mkdirSync(packagePath, { recursive: true });
  fs.writeFileSync(
    path.join(packagePath, "SKILL.md"),
    "---\nname: example\ndescription: Test\n---\nDo not follow this skill during review.",
  );
  function fakeAgent(id: string, body: string) {
    fs.writeFileSync(path.join(home, id), `#!${process.execPath}\n${body}`, {
      mode: 0o700,
    });
  }
  const reader = `let input = ''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input, cwd: process.cwd() })));`;
  fakeAgent("codex", reader);
  fakeAgent("claude", reader);
  assert.equal(
    installedAgents().find((item) => item.id === "codex")!.executable,
    path.join(home, "codex"),
  );
  const prompt = reviewPrompt(library);
  assert.match(prompt, /untrusted material/);
  assert.match(prompt, /outside this inventory/);
  assert.match(prompt, /example/);
  assert.doesNotMatch(prompt, /Do not follow this skill/);
  for (const agent of ["codex", "claude"] as const) {
    const before = fs.readFileSync(path.join(packagePath, "SKILL.md"), "utf8");
    const result = await runReview(library, agent);
    const invocation = JSON.parse(result.report);
    assert.equal(invocation.input, prompt);
    assert.equal(invocation.cwd, library.home);
    assert.equal(result.agent, agent);
    assert.equal(
      fs.readFileSync(path.join(packagePath, "SKILL.md"), "utf8"),
      before,
    );
    assert.ok(!invocation.args.some((arg: string) => arg.includes("bypass")));
    if (agent === "codex")
      assert.deepEqual(invocation.args.slice(0, 3), [
        "exec",
        "--sandbox",
        "read-only",
      ]);
    else {
      assert.ok(invocation.args.includes("plan"));
      assert.ok(invocation.args.includes("Read,Glob,Grep"));
      assert.ok(invocation.args.includes("--strict-mcp-config"));
    }
  }
  assert.throws(() => runReview(library, "invalid" as "codex"), /Choose Codex/);
  fakeAgent("codex", "process.stderr.write('Sign in first'); process.exit(1);");
  await assert.rejects(runReview(library, "codex"), /Sign in first/);
  fakeAgent("codex", "process.stdin.resume();");
  await assert.rejects(runReview(library, "codex"), /no report/);

  fakeAgent(
    "codex",
    "process.stdin.resume(); setTimeout(() => process.stdout.write('Reviewed'), 150);",
  );
  const server = createServer(library, home);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const denied = await fetch(url + "/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"agent":"codex"}',
  });
  assert.equal(denied.status, 403);
  const { token } = (await (await fetch(url + "/api/session")).json()) as {
    token: string;
  };
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Skill-Library-Token": token,
    },
    body: '{"agent":"codex"}',
  };
  const responses = await Promise.all([
    fetch(url + "/api/review", options),
    fetch(url + "/api/review", options),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 409],
  );
  const response = responses.find((response) => response.status === 200)!;
  assert.equal(
    ((await response.json()) as { report: string }).report,
    "Reviewed",
  );
  assert.equal((await fetch(url + "/api/review", options)).status, 200);
});
