import type { Skill, SkillLibrary, Tool, Operation } from "../server/library";
export type Inventory = ReturnType<SkillLibrary["inventory"]>;
export type Detail = ReturnType<SkillLibrary["detail"]>;
export type Plan = ReturnType<SkillLibrary["plan"]>;
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
