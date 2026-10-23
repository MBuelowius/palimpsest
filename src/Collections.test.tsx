import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { api, type InventoryView, type Marketplace } from "./api";

const source: Marketplace = {
  id: "0123456789abcdef",
  repo: "owner/skills",
  url: "https://github.com/owner/skills",
  commit: "abc",
  addedAt: "2026-10-21",
};
const inventory: InventoryView = {
  skills: [],
  scanIssues: [],
  roots: [],
  harnesses: [],
  shared: "/disposable/.harnesses-shared/skills",
  state: "/disposable/.local/share/skill-library/state",
  counts: { total: 0, shared: 0, conflicts: 0, identical: 0 },
};

function renderDom() {
  const dom = new JSDOM("<div id='root'></div>", {
    url: "http://localhost",
    pretendToBeVisual: true,
  });
  Object.assign(dom.window, {
    scrollTo: () => {},
    palimpsestAppearance: { get: () => "system", set: () => {} },
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLFormElement: dom.window.HTMLFormElement,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    fetch: async () => {
      throw new Error("UI tests must stub api methods.");
    },
  };
  const previous = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Reflect.get(globalThis, key)]),
  );
  Object.assign(globalThis, globals, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById("root")!);
  return {
    root,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      Object.assign(globalThis, previous);
      dom.window.close();
    },
  };
}

function checkCollections(container: ParentNode, sources: Marketplace[]) {
  const section = container.querySelector('[aria-label="Added collections"]');
  assert.ok(section);
  const rows = [...section.querySelectorAll(".collection-management-row")];
  assert.equal(rows.length, sources.length);
  sources.forEach((source, index) => {
    assert.ok(rows[index].textContent?.includes(source.repo));
    assert.deepEqual(
      [...rows[index].querySelectorAll("button")].map(
        (button) => button.textContent,
      ),
      ["Refresh", "Remove"],
    );
  });
  assert.ok(
    [...container.querySelectorAll("h3")].some(
      (heading) => heading.textContent === "Suggested collections",
    ),
  );
  assert.ok(container.querySelector('textarea[aria-label="Collection links"]'));
}

const settingsProps = {
  inventory,
  sources: [source],
  skillsMd: true,
  onSourcesChange: async () => {},
  onSkillsMdChange: () => {},
  onBrowse: () => {},
  onReviewSkills: () => {},
  onReviewSetup: () => {},
  onBackups: () => {},
  onChanged: async () => {},
  onNotice: () => {},
};

test("Settings shares the collection controls and removal updates App's sources", async (t) => {
  const { root, cleanup } = renderDom();
  const { SettingsPage } = await import("./SettingsPage");
  const changes: Marketplace[][] = [];
  t.mock.method(api, "removeMarketplace", async (id: string) => {
    assert.equal(id, source.id);
  });
  t.mock.method(api, "marketplaces", async () => []);
  try {
    await act(async () =>
      root.render(
        <SettingsPage
          {...settingsProps}
          onSourcesChange={async (list) => {
            changes.push(list);
          }}
        />,
      ),
    );
    checkCollections(document.getElementById("root")!, [source]);
    assert.deepEqual(
      [...document.querySelectorAll(".settings-section > h2")].map(
        (heading) => heading.textContent,
      ),
      ["Appearance", "Your apps", "Marketplace", "Keep your skills consistent"],
    );
    await act(async () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[aria-label="Added collections"] button',
        ),
      ]
        .find((button) => button.textContent === "Remove")!
        .click(),
    );
    assert.deepEqual(changes, [[]]);
  } finally {
    await cleanup();
  }
});

test("Manage collections shares the controls and shows both suggestions with no collections", async () => {
  const { root, cleanup } = renderDom();
  const { MarketplacesPage } = await import("./Marketplaces");
  try {
    await act(async () =>
      root.render(
        <MarketplacesPage
          sources={[]}
          skillsMd={false}
          harnesses={[]}
          skills={[]}
          updates={[]}
          onSourcesChange={async () => {}}
          onInstalled={async () => {}}
          onOpenSkill={() => {}}
          onUpdate={() => {}}
        />,
      ),
    );
    assert.match(
      document.querySelector(".empty")!.textContent!,
      /Add a collection to browse skills. The skills.md catalog is turned off in Settings./,
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>(".empty button")!.click(),
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    checkCollections(dialog, []);
    assert.ok(dialog.querySelector('[aria-label="Add anthropics/skills"]'));
    assert.ok(dialog.querySelector('[aria-label="Add openai/skills"]'));
    assert.doesNotMatch(dialog.textContent!, /Built-in catalog/);
  } finally {
    await cleanup();
  }
});

test("the skills.md switch waits for saved settings and retains the saved value on failure", async (t) => {
  const { root, cleanup } = renderDom();
  const { SettingsPage } = await import("./SettingsPage");
  const changes: boolean[] = [];
  let fail!: (error: Error) => void;
  t.mock.method(
    api,
    "saveSettings",
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  try {
    await act(async () =>
      root.render(
        <SettingsPage
          {...settingsProps}
          onSkillsMdChange={(on) => changes.push(on)}
        />,
      ),
    );
    const toggle =
      document.querySelector<HTMLButtonElement>("#skills-md-switch")!;
    await act(async () => toggle.click());
    assert.equal(toggle.disabled, true);
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    await act(async () => fail(new Error("Could not save settings.")));
    assert.equal(toggle.disabled, false);
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    assert.deepEqual(changes, []);
    assert.equal(
      document.querySelector('[role="alert"]')?.textContent,
      "Could not save settings.",
    );
    t.mock.method(
      api,
      "saveSettings",
      async (saved: { skillsMd: boolean }) => saved,
    );
    await act(async () => toggle.click());
    assert.deepEqual(changes, [false]);
    assert.equal(document.querySelector('[role="alert"]'), null);
  } finally {
    await cleanup();
  }
});

test("a settings load failure keeps the marketplace unrendered and survives a later inventory refresh", async (t) => {
  const { root, cleanup } = renderDom();
  const { App } = await import("./App");
  let resolveInventory!: (value: InventoryView) => void;
  let hostedCalls = 0;
  t.mock.method(
    api,
    "inventory",
    () =>
      new Promise((resolve) => {
        resolveInventory = resolve;
      }),
  );
  t.mock.method(api, "history", async () => []);
  t.mock.method(api, "updates", async () => []);
  t.mock.method(api, "marketplaces", async () => []);
  t.mock.method(api, "settings", async () => {
    throw new Error("Could not load settings.");
  });
  t.mock.method(api, "skillsMdCatalogue", async () => {
    hostedCalls++;
    return [];
  });
  try {
    await act(async () => root.render(<App />));
    await act(async () => resolveInventory(inventory));
    assert.match(
      document.querySelector('[role="alert"]')!.textContent!,
      /Could not load settings/,
    );
    assert.equal(document.querySelector('[aria-label="Skill catalog"]'), null);
    assert.equal(hostedCalls, 0);
  } finally {
    await cleanup();
  }
});

test("Settings collection add and refresh each scan inventory once and report notices", async (t) => {
  const { root, cleanup } = renderDom();
  const { App } = await import("./App");
  const addedSource = {
    ...source,
    repo: "anthropics/skills",
    url: "https://github.com/anthropics/skills",
  };
  let sources: Marketplace[] = [];
  let scans = 0;
  t.mock.method(api, "inventory", async () => {
    scans++;
    return inventory;
  });
  t.mock.method(api, "history", async () => []);
  t.mock.method(api, "updates", async () => []);
  t.mock.method(api, "marketplaces", async () => sources);
  t.mock.method(api, "settings", async () => ({ skillsMd: false }));
  t.mock.method(api, "catalogue", async () => []);
  t.mock.method(api, "addMarketplace", async (repo: string) => {
    assert.equal(repo, "anthropics/skills");
    sources = [addedSource];
    return addedSource;
  });
  t.mock.method(api, "refreshMarketplace", async (id: string) => {
    assert.equal(id, addedSource.id);
    return addedSource;
  });
  try {
    await act(async () => root.render(<App />));
    assert.equal(scans, 1);
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>("nav button")]
        .find((button) => button.textContent === "Settings")!
        .click(),
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[aria-label="Add anthropics/skills"]',
        )!
        .click(),
    );
    assert.equal(scans, 2, "adding a collection scans inventory once");
    assert.match(
      document.querySelector(".message.success")!.textContent!,
      /1 collection ready to browse/,
    );
    await act(async () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[aria-label="Added collections"] button',
        ),
      ]
        .find((button) => button.textContent === "Refresh")!
        .click(),
    );
    assert.equal(scans, 3, "refreshing a collection scans inventory once");
    assert.match(
      document.querySelector(".message.success")!.textContent!,
      /This collection is up to date/,
    );
  } finally {
    await cleanup();
  }
});
