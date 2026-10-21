import test from "node:test";
import assert from "node:assert/strict";
import { SkillInstalls } from "./installs.ts";

test("install counts come from the repository search first, then one search per missing skill", async () => {
  const queries: string[] = [];
  const installs = new SkillInstalls(async (input) => {
    const query = new URL(String(input)).searchParams.get("q")!;
    queries.push(query);
    return Response.json({
      skills: [
        { id: "owner/repo/pdf", installs: 12 },
        { id: "other/repo/pdf", installs: 99 },
        ...(query === "rare" ? [{ id: "Owner/Repo/rare", installs: 3 }] : []),
      ],
    });
  });
  const counts = await installs.lookup("owner/repo", ["pdf", "rare", "none"]);
  assert.deepEqual(counts, { pdf: 12, rare: 3 });
  assert.deepEqual(queries.sort(), ["none", "owner/repo", "rare"]);
  await installs.lookup("owner/repo", ["pdf", "rare", "none"]);
  assert.equal(queries.length, 3, "results, including misses, are cached");
});

test("install lookups reject malformed repositories", async () => {
  await assert.rejects(
    new SkillInstalls(async () => Response.json({})).lookup("../x", ["a"]),
  );
});
