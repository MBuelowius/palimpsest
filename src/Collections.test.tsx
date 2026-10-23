import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import {
  api,
  type InventoryView,
  type Marketplace,
  type PolicyState,
  type PolicyPreview,
} from "./api";

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

async function renderDom() {
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
  const { createRoot } = await import("react-dom/client");
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
  policy: { connected: false } as PolicyState,
  onPolicyChange: () => {},
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
  const { root, cleanup } = await renderDom();
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
      [
        "Appearance",
        "Your apps",
        "Marketplace",
        "Skill policy",
        "Keep your skills consistent",
      ],
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
  const { root, cleanup } = await renderDom();
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
  const { root, cleanup } = await renderDom();
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
  const { root, cleanup } = await renderDom();
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
  t.mock.method(api, "policy", async () => ({ connected: false }));
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
  const { root, cleanup } = await renderDom();
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
  t.mock.method(api, "policy", async () => ({ connected: false }));
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

const connectedPolicy: PolicyState = {
  repo: "team/policy",
  commit: "a".repeat(40),
  checkedAt: "2026-10-23T10:00:00Z",
  policy: {
    version: 1,
    sources: { github: ["team/skills"], skillsMd: false },
    skills: [
      {
        name: "sample",
        source: "team/skills",
        path: "sample",
        commit: "b".repeat(40),
      },
    ],
    blocked: ["blocked"],
  },
  warnings: ["Ignored unknown setting: note"],
  drift: [
    {
      kind: "version",
      name: "sample",
      reason: "Not the pinned version. Edited on this computer.",
    },
    {
      kind: "blocked",
      name: "blocked",
      reason: "Blocked by the policy. Turn it off in each app to match.",
    },
    {
      kind: "source",
      repo: "other/skills",
      reason: "From a collection the policy doesn't allow.",
    },
  ],
};
const policyPreview: PolicyPreview = {
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
      scan: {
        findings: [{ kind: "script", file: "run.sh" }],
        truncated: false,
      },
    },
    {
      name: "new-skill",
      action: "install",
      repo: "team/skills",
      path: "new-skill",
      commit: "b".repeat(40),
      hash: "install-hash",
      edited: false,
      scan: { findings: [], truncated: false },
    },
  ],
  skipped: [
    {
      name: "taken",
      reason: "Another skill uses this name. Palimpsest won't replace it.",
    },
  ],
};

function button(text: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === text,
  )!;
}

test("policy connection is labelled, disables skills.md, retains policy on failed refresh and disconnects without confirmation", async (t) => {
  const { root, cleanup } = await renderDom();
  const { SettingsPage } = await import("./SettingsPage");
  let policy: PolicyState = { connected: false };
  const notices: string[] = [];
  const render = () =>
    root.render(
      <SettingsPage
        {...settingsProps}
        policy={policy}
        onPolicyChange={(next) => {
          policy = next;
          render();
        }}
        onNotice={(message) => notices.push(message)}
      />,
    );
  t.mock.method(api, "connectPolicy", async (repo?: string) => {
    assert.equal(repo, "team/policy");
    return connectedPolicy;
  });
  t.mock.method(api, "disconnectPolicy", async () => ({ connected: false }));
  try {
    await act(async () => render());
    const input =
      document.querySelector<HTMLInputElement>("#policy-repository")!;
    assert.equal(
      document.querySelector('label[for="policy-repository"]')?.textContent,
      "Policy repository",
    );
    assert.equal(input.placeholder, "owner/repository");
    assert.match(document.body.textContent!, /Public repositories only/);
    assert.equal(button("Connect").disabled, true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "team/policy");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await act(async () => button("Connect").click());
    const toggle =
      document.querySelector<HTMLButtonElement>("#skills-md-switch")!;
    assert.equal(toggle.disabled, true);
    assert.equal(toggle.getAttribute("aria-checked"), "false");
    assert.match(
      document.querySelector("#skills-md-hint")!.textContent!,
      /Turned off by your skill policy/,
    );
    assert.match(document.body.textContent!, /Ignored unknown setting: note/);
    assert.match(document.body.textContent!, /Edited on this computer/);
    assert.match(document.body.textContent!, /other\/skills/);
    t.mock.method(api, "connectPolicy", async (repo?: string) => {
      assert.equal(repo, undefined);
      throw new Error("Kept the previous policy. Invalid file.");
    });
    await act(async () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[aria-labelledby="policy-title"] button',
        ),
      ]
        .find((item) => item.textContent === "Refresh")!
        .click(),
    );
    assert.match(
      document.querySelector('[role="alert"]')!.textContent!,
      /Kept the previous policy/,
    );
    assert.equal(toggle.disabled, true);
    await act(async () => button("Disconnect").click());
    assert.deepEqual(policy, { connected: false });
    assert.deepEqual(notices, [
      "Disconnected team/policy. Your skills are unchanged.",
    ]);
    assert.equal(toggle.disabled, false);
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally {
    await cleanup();
  }
});

test("policy apply requires explicit confirmation after edits, scan findings and skipped skills are shown", async (t) => {
  const { root, cleanup } = await renderDom();
  const { PolicySettings } = await import("./PolicySettings");
  const applied: PolicyPreview[] = [],
    messages: string[] = [];
  t.mock.method(api, "policyPreview", async () => policyPreview);
  t.mock.method(api, "applyPolicy", async (preview: PolicyPreview) => {
    applied.push(preview);
  });
  try {
    await act(async () =>
      root.render(
        <PolicySettings
          policy={connectedPolicy}
          onPolicyChange={() => {}}
          onChanged={async (message) => {
            messages.push(message);
          }}
          onNotice={() => {}}
        />,
      ),
    );
    await act(async () => button("Review changes").click());
    const dialog = document.querySelector('[role="dialog"]')!;
    assert.match(dialog.textContent!, /Apply skill policy/);
    assert.match(dialog.textContent!, /Claude Code/);
    assert.match(dialog.textContent!, /Update to bbbbbbb/);
    assert.match(dialog.textContent!, /Install/);
    assert.equal(dialog.querySelectorAll('[data-slot="badge"]').length, 1);
    assert.match(dialog.textContent!, /Replaces local edits/);
    assert.match(dialog.textContent!, /Script or executable file/);
    assert.match(dialog.textContent!, /run.sh/);
    assert.match(dialog.textContent!, /No scripts, binary files/);
    assert.match(dialog.textContent!, /Another skill uses this name/);
    assert.deepEqual(applied, []);
    await act(async () => button("Cancel").click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.activeElement, button("Review changes"));
    assert.deepEqual(applied, []);
    await act(async () => button("Review changes").click());
    await act(async () => button("Apply").click());
    assert.deepEqual(applied, [policyPreview]);
    assert.equal(messages.length, 1);
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally {
    await cleanup();
  }
});

test("matching policy has no changes and failed apply requires a fresh preview", async (t) => {
  const { root, cleanup } = await renderDom();
  const { PolicySettings } = await import("./PolicySettings");
  const props = {
    onPolicyChange: () => {},
    onChanged: async () => {},
    onNotice: () => {},
  };
  t.mock.method(api, "policyPreview", async () => policyPreview);
  t.mock.method(api, "applyPolicy", async () => {
    throw new Error("The policy or your skills changed. Preview again.");
  });
  try {
    await act(async () =>
      root.render(
        <PolicySettings
          {...props}
          policy={{ ...connectedPolicy, drift: [] }}
        />,
      ),
    );
    assert.match(
      document.body.textContent!,
      /This computer matches the policy/,
    );
    assert.equal(button("Review changes").disabled, true);
    await act(async () =>
      root.render(<PolicySettings {...props} policy={connectedPolicy} />),
    );
    await act(async () => button("Review changes").click());
    await act(async () => button("Apply").click());
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.match(
      document.querySelector('[role="alert"]')!.textContent!,
      /Preview again/,
    );
    assert.equal(button("Review changes").disabled, false);
  } finally {
    await cleanup();
  }
});

test("App keeps the saved skills.md preference but never requests its catalog under policy", async (t) => {
  const { root, cleanup } = await renderDom();
  const { App } = await import("./App");
  let hostedCalls = 0;
  t.mock.method(api, "inventory", async () => inventory);
  t.mock.method(api, "history", async () => []);
  t.mock.method(api, "updates", async () => []);
  t.mock.method(api, "marketplaces", async () => []);
  t.mock.method(api, "settings", async () => ({ skillsMd: true }));
  t.mock.method(api, "policy", async () => connectedPolicy);
  t.mock.method(api, "skillsMdCatalogue", async () => {
    hostedCalls++;
    return [];
  });
  try {
    await act(async () => root.render(<App />));
    assert.equal(hostedCalls, 0);
    await act(async () => button("Settings").click());
    assert.equal(
      document.querySelector<HTMLButtonElement>("#skills-md-switch")!.disabled,
      true,
    );
    assert.equal(hostedCalls, 0);
  } finally {
    await cleanup();
  }
});
