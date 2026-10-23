import type {
  Marketplace,
  CatalogueSkill,
  Marketplaces,
} from "../server/marketplaces";
import type { HostedSkill } from "../server/skillsMd";
import type { Settings } from "../server/library";
import type { Policy } from "../server/policy";
export type PolicyState = ReturnType<Policy["show"]>;
export type PolicyPreview = Awaited<ReturnType<Policy["preview"]>>;
export type { Settings };
export type MarketplacePreview = ReturnType<Marketplaces["preview"]>;
export type SkillUpdate = ReturnType<Marketplaces["updates"]>[number];
export type UpdatePreview = ReturnType<Marketplaces["updatePreview"]>;
export type { Marketplace, CatalogueSkill };
import type { Skill, SkillLibrary, Tool, Operation } from "../server/library";
import type { installedAgents, runReview } from "../server/review";
export type ReviewReport = Awaited<ReturnType<typeof runReview>>;
export type ReviewAgent = ReturnType<typeof installedAgents>[number];
export type Inventory = ReturnType<SkillLibrary["inventory"]>;
export type Detail = ReturnType<SkillLibrary["detail"]>;
export type Plan = ReturnType<SkillLibrary["plan"]>;
export type SyncPlan = ReturnType<SkillLibrary["syncPlan"]>;
export type FileContent = ReturnType<SkillLibrary["readFile"]>;
export type SkillRow = Omit<Skill, "variants"> & {
  variants: Omit<Skill["variants"][number], "content">[];
};
export type InventoryView = Omit<Inventory, "skills"> & { skills: SkillRow[] };
export type History = Omit<Operation, "snapshots" | "manifestBefore">[];
let token: Promise<string> | undefined;
async function request<T>(
  url: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    token ??= fetch("/api/session").then(async (response) => {
      if (!response.ok) throw new Error("Cannot open the local session.");
      return ((await response.json()) as { token: string }).token;
    });
    headers["X-Skill-Library-Token"] = await token;
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(url, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 403) token = undefined;
    throw new Error(result.error ?? "Request failed.");
  }
  return result as T;
}
const skillUrl = (name: string) => "/api/skills/" + encodeURIComponent(name);
export const api = {
  policy: () => request<PolicyState>("/api/policy"),
  connectPolicy: (repo?: string) =>
    request<PolicyState>("/api/policy", "POST", { repo }),
  disconnectPolicy: () => request<PolicyState>("/api/policy", "DELETE"),
  policyPreview: (tools?: Tool[]) =>
    request<PolicyPreview>("/api/policy/plan", "POST", { tools }),
  applyPolicy: (preview: PolicyPreview) =>
    request<ReturnType<Policy["apply"]>>("/api/policy/apply", "POST", {
      changes: preview.changes.map(({ name, hash }) => ({ name, hash })),
      tools: preview.tools,
    }),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (settings: Settings) =>
    request<Settings>("/api/settings", "PUT", settings),
  skillsMdCatalogue: () => request<HostedSkill[]>("/api/skills-md"),
  skillsMdInstructions: (slug: string) =>
    request<{ content: string }>("/api/skills-md/" + encodeURIComponent(slug)),
  installs: (repo: string, skills: string[]) =>
    request<Record<string, number>>(
      "/api/installs?repo=" +
        encodeURIComponent(repo) +
        "&skills=" +
        encodeURIComponent(skills.join(",")),
    ),
  reviewAgents: () => request<ReviewAgent[]>("/api/review/agents"),
  reviewSetup: (agent: Tool) =>
    request<ReviewReport>("/api/review", "POST", { agent }),
  syncPlan: (tools: Tool[]) =>
    request<SyncPlan>("/api/sync/plan", "POST", { tools }),
  sync: (plans: SyncPlan["plans"], tools: Tool[]) =>
    request<ReturnType<SkillLibrary["sync"]>>("/api/sync", "POST", {
      plans,
      tools,
    }),
  marketplaces: () => request<Marketplace[]>("/api/marketplaces"),
  addMarketplace: (url: string) =>
    request<Marketplace>("/api/marketplaces", "POST", { url }),
  removeMarketplace: (id: string) =>
    request("/api/marketplaces/" + id, "DELETE"),
  refreshMarketplace: (id: string) =>
    request<Marketplace>("/api/marketplaces/" + id + "/refresh", "POST", {}),
  catalogue: (id: string) =>
    request<CatalogueSkill[]>("/api/marketplaces/" + id),
  marketplacePreview: (id: string, skillId: string) =>
    request<MarketplacePreview>(
      "/api/marketplaces/" + id + "/skills/" + skillId,
    ),
  installMarketplaceSkill: (preview: MarketplacePreview, tools: Tool[]) =>
    request(
      "/api/marketplaces/" + preview.source.id + "/skills/" + preview.id,
      "POST",
      { hash: preview.hash, tools },
    ),
  addAccount: (tool: string, name: string, folder: string) =>
    request("/api/accounts", "POST", { tool, name, folder }),
  removeAccount: (id: string) =>
    request("/api/accounts/" + encodeURIComponent(id), "DELETE"),
  updates: () => request<SkillUpdate[]>("/api/updates"),
  updatePreview: (name: string) =>
    request<UpdatePreview>("/api/updates/" + encodeURIComponent(name)),
  applyUpdates: (updates: { name: string; hash: string }[]) =>
    request<ReturnType<Marketplaces["applyUpdates"]>>("/api/updates", "POST", {
      updates,
    }),
  inventory: () => request<InventoryView>("/api/inventory"),
  detail: (name: string) => request<Detail>(skillUrl(name)),
  files: (name: string, source: string) =>
    request<string[]>(
      skillUrl(name) + "/files?" + new URLSearchParams({ source }),
    ),
  file: (name: string, source: string, file: string) =>
    request<FileContent>(
      skillUrl(name) + "/file?" + new URLSearchParams({ source, file }),
    ),
  plan: (name: string, source: string, revision: string, tools: Tool[]) =>
    request<Plan>(skillUrl(name) + "/plan", "POST", {
      source,
      revision,
      tools,
    }),
  share: (plan: Plan) => request(skillUrl(plan.name) + "/share", "POST", plan),
  enabled: (name: string, tool: Tool, enabled: boolean, revision: string) =>
    request(skillUrl(name) + "/enabled", "POST", { tool, enabled, revision }),
  save: (
    name: string,
    source: string,
    file: string,
    content: string,
    revision: string,
  ) =>
    request(skillUrl(name) + "/file", "PUT", {
      source,
      file,
      content,
      revision,
    }),
  create: (name: string, description: string, body: string, tools: Tool[]) =>
    request("/api/skills", "POST", { name, description, body, tools }),
  history: () => request<History>("/api/history"),
  restore: (id: string) => request("/api/restore", "POST", { id }),
};
