import test from "node:test";
import assert from "node:assert/strict";
import { SkillsMd } from "./skillsMd.ts";

const remote =
  (response: () => Response): typeof fetch =>
  async () =>
    response();

test("skills.md maps public catalog metadata without treating hosted skills as local packages", async () => {
  const catalog = new SkillsMd(
    remote(() =>
      Response.json([
        {
          slug: "logo-design",
          displayName: "Logo Design",
          description: "Make logos",
          category: "Design",
          pricing: { formattedCost: "50 credits/run" },
          availability: { status: "available" },
        },
        {
          slug: "deploy",
          description: "Deploy code",
          availability: {
            status: "unavailable",
            message: "Hosted execution is not enabled",
          },
        },
      ]),
    ),
  );
  const skills = await catalog.catalogue();
  assert.equal(skills[0].price, "50 credits/run");
  assert.equal(skills[0].availability, "Available");
  assert.equal(skills[1].availability, "Hosted execution is not enabled");
  assert.equal(skills[1].price, "See skills.md for pricing");
  assert.equal("installable" in skills[0], false);
});

test("instruction requests use only the fixed upstream and reject path injection", async () => {
  const urls: string[] = [];
  const catalog = new SkillsMd(async (url, options) => {
    urls.push(String(url));
    assert.equal(options?.redirect, "error");
    return new Response("# Logo Design");
  });
  assert.deepEqual(await catalog.instructions("logo-design"), {
    content: "# Logo Design",
  });
  for (const slug of ["../secrets", "x?y=z", "https://example.com", ""])
    await assert.rejects(catalog.instructions(slug), /Invalid/);
  assert.deepEqual(urls, [
    "https://skills.md/api/v1/skills/logo-design/skill.md",
  ]);
});

test("upstream failures and malformed catalogs produce actionable errors", async () => {
  for (const response of [
    () => new Response("denied", { status: 401 }),
    () => new Response("not json"),
    () => Response.json({ skills: [] }),
    () => Response.json([{ slug: "../bad", description: "bad" }]),
  ]) {
    await assert.rejects(
      new SkillsMd(remote(response)).catalogue(),
      /Could not/,
    );
  }
  await assert.rejects(
    new SkillsMd(
      remote(() => new Response("x".repeat(8 * 1024 * 1024 + 1))),
    ).instructions("large"),
    /too large/,
  );
});
