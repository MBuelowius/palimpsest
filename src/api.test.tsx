import test from "node:test";
import assert from "node:assert/strict";
import { api, type PolicyPreview } from "./api";

test("policy API sends the reviewed hashes and tools, and 409 keeps the session", async (t) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return url === "/api/session"
        ? Response.json({ token: "test-session" })
        : url === "/api/policy/apply"
          ? Response.json(
              { error: "The policy or your skills changed. Preview again." },
              { status: 409 },
            )
          : Response.json({ connected: false });
    },
  );
  const preview: PolicyPreview = {
    repo: "team/policy",
    commit: "a".repeat(40),
    tools: ["claude"],
    changes: [
      {
        name: "sample",
        action: "update",
        repo: "team/skills",
        path: "sample",
        commit: "b".repeat(40),
        hash: "reviewed-hash",
        edited: true,
        scan: { findings: [], truncated: false },
      },
    ],
    skipped: [],
  };
  await api.policy();
  await api.connectPolicy("team/policy");
  await api.connectPolicy();
  await api.policyPreview(["claude"]);
  await assert.rejects(api.applyPolicy(preview), /Preview again/);
  await api.disconnectPolicy();
  assert.equal(calls.filter(({ url }) => url === "/api/session").length, 1);
  const writes = calls.filter(
    ({ init }) => init?.method !== "GET" && init?.method !== undefined,
  );
  assert.deepEqual(
    writes.map(({ url, init }) => [
      url,
      init!.method,
      init!.body === undefined ? undefined : JSON.parse(String(init!.body)),
    ]),
    [
      ["/api/policy", "POST", { repo: "team/policy" }],
      ["/api/policy", "POST", {}],
      ["/api/policy/plan", "POST", { tools: ["claude"] }],
      [
        "/api/policy/apply",
        "POST",
        {
          changes: [{ name: "sample", hash: "reviewed-hash" }],
          tools: ["claude"],
        },
      ],
      ["/api/policy", "DELETE", undefined],
    ],
  );
  for (const { init } of writes) {
    assert.equal(
      (init!.headers as Record<string, string>)["X-Skill-Library-Token"],
      "test-session",
    );
    assert.equal(
      (init!.headers as Record<string, string>)["Content-Type"],
      "application/json",
    );
  }
});
