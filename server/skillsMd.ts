import { LibraryError } from "./library.ts";

export type HostedSkill = {
  slug: string;
  name: string;
  description: string;
  category: string;
  price: string;
  availability: string;
};

export class SkillsMd {
  constructor(private readonly fetchRemote: typeof fetch = fetch) {}

  private async read(endpoint: string) {
    try {
      const response = await this.fetchRemote(
        "https://skills.md/api/v1/skills" + endpoint,
        { signal: AbortSignal.timeout(15000), redirect: "error" },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Empty response");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 8 * 1024 * 1024) throw new Error("Response is too large");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return Buffer.concat(chunks).toString("utf8");
    } catch (error) {
      throw new LibraryError(
        "Could not load skills.md: " + (error as Error).message,
        502,
      );
    }
  }

  async catalogue(): Promise<HostedSkill[]> {
    const text = await this.read("");
    try {
      const entries: unknown = JSON.parse(text);
      if (!Array.isArray(entries)) throw new Error("Expected a catalog list");
      return entries.map((entry) => {
        if (
          !entry ||
          typeof entry.slug !== "string" ||
          !/^[a-zA-Z0-9_-]+$/.test(entry.slug) ||
          typeof entry.description !== "string"
        )
          throw new Error("Invalid catalog entry");
        return {
          slug: entry.slug,
          name:
            typeof entry.displayName === "string"
              ? entry.displayName
              : entry.slug,
          description: entry.description,
          category:
            typeof entry.category === "string"
              ? entry.category
              : "Uncategorized",
          price:
            typeof entry.pricing?.formattedCost === "string"
              ? entry.pricing.formattedCost
              : "See skills.md for pricing",
          availability:
            entry.availability?.status === "available"
              ? "Available"
              : typeof entry.availability?.message === "string"
                ? entry.availability.message
                : "Check availability on skills.md",
        };
      });
    } catch (error) {
      throw new LibraryError(
        "Could not read skills.md catalog: " + (error as Error).message,
        502,
      );
    }
  }

  async instructions(slug: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(slug))
      throw new LibraryError("Invalid skills.md skill name.");
    return { content: await this.read("/" + slug + "/skill.md") };
  }
}
