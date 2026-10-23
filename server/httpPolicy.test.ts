import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SkillLibrary } from "./library.ts";
import { Policy } from "./policy.ts";
import { createServer } from "./http.ts";

const commit = "a".repeat(40);
const yaml = `version: 1
sources:
  skillsMd: false
skills:
  - source: team/skills
    path: sample
    commit: ${commit}
`;

async function fixture(t: TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "http-policy-"));
  const library = new SkillLibrary(home);
  fs.mkdirSync(path.join(home, ".claude"));
  let text = yaml,
    clones = 0,
    downloads = 0;
  const policy = new Policy(
    library,
    async (_repo, directory) => {
      clones++;
      fs.writeFileSync(path.join(directory, "palimpsest-policy.yaml"), text);
      return commit;
    },
    async (_repo, _commit, directory) => {
      downloads++;
      const skill = path.join(directory, "sample");
      fs.mkdirSync(skill);
      fs.writeFileSync(
        path.join(skill, "SKILL.md"),
        "---\nname: sample\ndescription: Test skill\n---\nInstructions\n",
      );
      fs.writeFileSync(path.join(skill, "run.sh"), "echo test\n");
    },
  );
  const server = createServer(library, home, policy);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    fs.rmSync(home, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const originalFetch = globalThis.fetch;
  t.mock.method(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      assert.ok(
        String(input).startsWith(base + "/"),
        "Only the isolated local server may be contacted",
      );
      return originalFetch(input, init);
    },
  );
  const { token } = await (await fetch(base + "/api/session")).json();
  const request = (
    route: string,
    method = "GET",
    body?: unknown,
    authenticated = true,
  ) =>
    fetch(base + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(authenticated ? { "X-Skill-Library-Token": token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    library,
    policy,
    request,
    setText: (value: string) => {
      text = value;
    },
    counts: () => ({ clones, downloads }),
  };
}

test("every policy write route requires a token before doing work", async (t) => {
  const { request, counts, library } = await fixture(t);
  for (const [route, method, body] of [
    ["/api/policy", "POST", { repo: "team/policy" }],
    ["/api/policy", "POST", {}],
    ["/api/policy", "DELETE", undefined],
    ["/api/policy/plan", "POST", {}],
    ["/api/policy/apply", "POST", { changes: [], tools: ["claude"] }],
  ] as const) {
    assert.equal((await request(route, method, body, false)).status, 403);
  }
  assert.deepEqual(counts(), { clones: 0, downloads: 0 });
  assert.equal(library.policy(), undefined);
});

test("policy HTTP connect, refresh, drift, preview, apply and disconnect use the isolated library", async (t) => {
  const { request, counts, library, policy, setText } = await fixture(t);
  assert.deepEqual(await (await request("/api/policy")).json(), {
    connected: false,
  });
  const connected = await request("/api/policy", "POST", {
    repo: "team/policy",
  });
  assert.equal(connected.status, 200);
  assert.deepEqual(await connected.json(), policy.show());
  assert.equal(
    (await request("/api/policy", "POST", { repo: "other/policy" })).status,
    409,
  );
  setText("version: 2");
  const invalid = await request("/api/policy", "POST", {});
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /^Kept the previous policy\./);
  assert.equal(library.policy()!.repo, "team/policy");
  setText(yaml);
  assert.equal((await request("/api/policy", "POST", {})).status, 200);
  const shown = await (await request("/api/policy")).json();
  assert.deepEqual(shown.drift, [
    { kind: "missing", name: "sample", reason: "Not installed." },
  ]);
  assert.deepEqual(counts(), { clones: 3, downloads: 0 });

  for (const route of ["/api/skills-md", "/api/skills-md/logo"]) {
    const blocked = await request(route);
    assert.equal(blocked.status, 409);
    assert.deepEqual(await blocked.json(), {
      error: "Your skill policy turns off skills.md.",
    });
  }
  assert.equal(
    library.settings().skillsMd,
    true,
    "the stored preference is unchanged",
  );
  const planned = await request("/api/policy/plan", "POST", {});
  assert.equal(planned.status, 200);
  const preview = await planned.json();
  assert.deepEqual(preview.tools, ["claude"]);
  assert.equal(preview.changes[0].name, "sample");
  assert.equal(preview.changes[0].edited, false);
  assert.ok(
    preview.changes[0].scan.findings.some(
      (item: { kind: string }) => item.kind === "script",
    ),
  );
  assert.deepEqual(library.inventory().skills, [], "preview does not install");
  for (const body of [
    {},
    { changes: [null], tools: ["claude"] },
    { changes: [], tools: "claude" },
    { changes: [{ name: "sample", hash: "stale" }], tools: preview.tools },
  ]) {
    assert.equal(
      (await request("/api/policy/apply", "POST", body)).status,
      409,
    );
    assert.deepEqual(library.inventory().skills, []);
  }
  const changes = preview.changes.map(
    ({ name, hash }: { name: string; hash: string }) => ({ name, hash }),
  );
  const applied = await request("/api/policy/apply", "POST", {
    changes,
    tools: preview.tools,
  });
  assert.equal(applied.status, 200);
  assert.equal(library.history().length, 1);
  assert.deepEqual((await (await request("/api/policy")).json()).drift, []);
  assert.deepEqual(
    counts(),
    { clones: 3, downloads: 1 },
    "apply and show do not download",
  );
  assert.deepEqual(await (await request("/api/policy", "DELETE")).json(), {
    connected: false,
  });
  assert.equal(library.inventory().skills[0].name, "sample");
  assert.equal(library.history().length, 1);
});
