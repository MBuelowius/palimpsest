import { LibraryError } from "./library.ts";

type Hit = { id: string; installs: number };

// skills.sh has no per-skill endpoint, so a repository is looked up with one
// search for "owner/repo" and the remaining names by a search each.
export class SkillInstalls {
  private readonly cache = new Map<
    string,
    { count: number | null; at: number }
  >();

  constructor(private readonly fetchRemote: typeof fetch = fetch) {}

  private async search(query: string): Promise<Hit[]> {
    const response = await this.fetchRemote(
      "https://skills.sh/api/search?limit=200&q=" + encodeURIComponent(query),
      { signal: AbortSignal.timeout(15000), redirect: "error" },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body: unknown = await response.json();
    const skills = (body as { skills?: unknown })?.skills;
    return (Array.isArray(skills) ? skills : []).filter(
      (entry): entry is Hit =>
        typeof entry?.id === "string" && Number.isFinite(entry.installs),
    );
  }

  async lookup(repo: string, names: string[]) {
    if (!/^\w[\w.-]*\/\w[\w.-]*$/.test(repo) || names.length > 100)
      throw new LibraryError("Invalid skill lookup.");
    const key = (name: string) => `${repo}/${name}`.toLowerCase();
    const fresh = (name: string) => {
      const hit = this.cache.get(key(name));
      return hit && Date.now() - hit.at < 3600_000 ? hit : undefined;
    };
    const record = (hits: Hit[]) => {
      for (const hit of hits)
        if (names.some((name) => key(name) === hit.id.toLowerCase()))
          this.cache.set(hit.id.toLowerCase(), {
            count: hit.installs,
            at: Date.now(),
          });
    };
    try {
      if (names.some((name) => !fresh(name))) record(await this.search(repo));
      const queue = names.filter((name) => !fresh(name));
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          for (let name = queue.shift(); name; name = queue.shift()) {
            record(await this.search(name));
            if (!fresh(name))
              this.cache.set(key(name), { count: null, at: Date.now() });
          }
        }),
      );
    } catch (error) {
      throw new LibraryError(
        "Could not load install counts: " + (error as Error).message,
        502,
      );
    }
    return Object.fromEntries(
      names.flatMap((name) => {
        const count = fresh(name)?.count;
        return typeof count === "number" ? [[name, count]] : [];
      }),
    );
  }
}
