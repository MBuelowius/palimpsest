import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { api, type Marketplace } from "./api";

const source: Marketplace = {
  id: "0123456789abcdef",
  repo: "owner/skills",
  url: "https://github.com/owner/skills",
  commit: "abc",
  addedAt: "2026-10-21",
};

test("marketplace combines sources and opens repository packages through the existing preview flow", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const hosted = api.skillsMdCatalogue,
    catalogue = api.catalogue;
  api.skillsMdCatalogue = async () => [
    {
      slug: "logo",
      name: "Logo",
      description: "Make a logo",
      category: "Design",
      price: "Free",
      availability: "Available",
    },
  ];
  api.catalogue = async () => [
    {
      id: "sample",
      name: "Sample",
      path: "skills/sample",
      description: "Repository package",
      issues: [],
      license: "",
      scripts: 2,
      otherFiles: 0,
    },
  ];
  const installs = api.installs;
  api.installs = async () => ({});
  const { MarketplaceCatalog } = await import("./MarketplaceCatalog");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const opened: string[] = [];
  const sources = [source];
  try {
    await act(async () => {
      root.render(
        <MarketplaceCatalog
          skillsMd={true}
          sources={sources}
          onAddCollection={() => {}}
          onManageSources={() => {}}
          onRepositorySkill={async (id, skill) => {
            opened.push(id + "/" + skill);
          }}
        />,
      );
    });
    assert.equal(document.querySelectorAll(".store-tile").length, 2);
    assert.equal(
      document.querySelector(
        '[data-hosted-skill="skills.md/logo"] .store-tile-source',
      )?.textContent,
      "skills.md · Can’t be added to apps",
    );
    assert.equal(
      document.querySelector('[data-hosted-skill="skills.md/logo"] .store-get')
        ?.textContent,
      "View",
    );
    assert.equal(
      document.querySelector(".store-shelf h2")?.textContent,
      "GitHub packages",
    );
    assert.ok(!document.querySelector("#suggested-collections"));
    assert.match(document.body.textContent!, /owner\/skills/);
    assert.match(document.body.textContent!, /Includes scripts/);
    await act(async () => {
      (
        document.querySelector(
          '[data-catalogue-skill="sample"]',
        ) as HTMLButtonElement
      ).click();
    });
    assert.deepEqual(opened, [source.id + "/sample"]);
  } finally {
    await act(async () => root.unmount());
    api.installs = installs;
    api.skillsMdCatalogue = hosted;
    api.catalogue = catalogue;
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});

test("an unavailable source leaves skills from other sources browsable", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const hosted = api.skillsMdCatalogue,
    catalogue = api.catalogue;
  api.skillsMdCatalogue = async () => {
    throw new Error("Service unavailable");
  };
  api.catalogue = async () => [
    {
      id: "sample",
      name: "Sample",
      path: "sample",
      description: "Still accessible",
      issues: [],
      license: "",
      scripts: 0,
      otherFiles: 0,
    },
  ];
  const installs = api.installs;
  api.installs = async () => ({});
  const { MarketplaceCatalog } = await import("./MarketplaceCatalog");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => {
      root.render(
        <MarketplaceCatalog
          skillsMd={true}
          sources={[source]}
          onAddCollection={() => {}}
          onManageSources={() => {}}
          onRepositorySkill={async () => {}}
        />,
      );
    });
    assert.match(
      document.querySelector('[role="alert"]')!.textContent!,
      /skills.md: Service unavailable/,
    );
    assert.equal(document.querySelectorAll(".store-tile").length, 1);
    assert.equal(
      document.querySelector(".store-tile strong")?.textContent,
      "Sample",
    );
  } finally {
    await act(async () => root.unmount());
    api.installs = installs;
    api.skillsMdCatalogue = hosted;
    api.catalogue = catalogue;
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});

test("home shows capped category shelves and See all opens that category", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const hosted = api.skillsMdCatalogue;
  api.skillsMdCatalogue = async () =>
    Array.from({ length: 14 }, (_, index) => ({
      slug: "skill-" + index,
      name: "Skill " + String(index).padStart(2, "0"),
      description: "Does thing " + index,
      category: "Design",
      price: "Free",
      availability: "Available",
    }));
  const installs = api.installs;
  api.installs = async () => ({});
  const { MarketplaceCatalog } = await import("./MarketplaceCatalog");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => {
      root.render(
        <MarketplaceCatalog
          skillsMd={true}
          sources={[]}
          onAddCollection={() => {}}
          onManageSources={() => {}}
          onRepositorySkill={async () => {}}
        />,
      );
    });
    assert.equal(document.querySelectorAll(".store-tile").length, 12);
    assert.ok(document.querySelector("#suggested-collections"));
    await act(async () => {
      (
        [...document.querySelectorAll("button")].find((button) =>
          /See all 14/.test(button.textContent!),
        ) as HTMLButtonElement
      ).click();
    });
    assert.equal(document.querySelectorAll(".store-shelf").length, 0);
    assert.equal(document.querySelector("#suggested-collections"), null);
    assert.equal(document.querySelectorAll(".store-tile").length, 14);
    assert.match(document.querySelector("h2")!.textContent!, /Design/);
    await act(async () => {
      (
        document.querySelector(".store-tabs button") as HTMLButtonElement
      ).click();
    });
    assert.equal(document.querySelectorAll(".store-shelf").length, 1);
  } finally {
    await act(async () => root.unmount());
    api.installs = installs;
    api.skillsMdCatalogue = hosted;
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});

test("tiles show Installed and Update for skills added from that collection", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const hosted = api.skillsMdCatalogue,
    catalogue = api.catalogue;
  api.skillsMdCatalogue = async () => [];
  api.catalogue = async () =>
    ["current", "outdated", "fresh"].map((id) => ({
      id,
      name: id,
      path: "skills/" + id,
      description: id,
      issues: [],
      license: "",
      scripts: 0,
      otherFiles: 0,
    }));
  const installs = api.installs;
  api.installs = async () => ({});
  const { MarketplaceCatalog } = await import("./MarketplaceCatalog");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const entry = (name: string, update: boolean) => ({
    name,
    source: source.id,
    repo: source.repo,
    skillId: name,
    update,
    edited: false,
    hash: "",
  });
  try {
    await act(async () => {
      root.render(
        <MarketplaceCatalog
          skillsMd={true}
          sources={[source]}
          skills={[{ name: "current" }, { name: "outdated" }]}
          updates={[entry("current", false), entry("outdated", true)]}
          onAddCollection={() => {}}
          onManageSources={() => {}}
          onRepositorySkill={async () => {}}
        />,
      );
    });
    const state = (id: string) =>
      document.querySelector(`[data-catalogue-skill="${id}"] .store-get`)!
        .textContent;
    assert.deepEqual(["current", "outdated", "fresh"].map(state), [
      "Installed",
      "Update",
      "Get",
    ]);
  } finally {
    await act(async () => root.unmount());
    api.installs = installs;
    api.skillsMdCatalogue = hosted;
    api.catalogue = catalogue;
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});

test("an unavailable skills.md catalogue keeps suggestions and Add calls onAddCollection", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const hosted = api.skillsMdCatalogue;
  api.skillsMdCatalogue = async () => {
    throw new Error("Service unavailable");
  };
  const installs = api.installs;
  api.installs = async () => ({});
  const { MarketplaceCatalog } = await import("./MarketplaceCatalog");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const added: string[] = [];
  try {
    await act(async () => {
      root.render(
        <MarketplaceCatalog
          skillsMd={true}
          sources={[]}
          onAddCollection={(repo) => added.push(repo)}
          onManageSources={() => {}}
          onRepositorySkill={async () => {}}
        />,
      );
    });
    assert.ok(document.querySelector("#suggested-collections"));
    assert.equal(document.querySelector(".empty"), null);
    assert.match(
      document.querySelector('[role="alert"]')!.textContent!,
      /Service unavailable/,
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[aria-label="Add anthropics/skills"]',
        )!
        .click(),
    );
    assert.deepEqual(added, ["anthropics/skills"]);
  } finally {
    await act(async () => root.unmount());
    api.installs = installs;
    api.skillsMdCatalogue = hosted;
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});

test("skills.md off makes no hosted request and leaves only repository tiles and source options", async () => {
  const dom = new JSDOM("<div id='root'></div>", {
    url: "http://localhost",
    pretendToBeVisual: true,
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    NodeFilter: dom.window.NodeFilter,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle,
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  };
  const previous = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Reflect.get(globalThis, key)]),
  );
  Object.assign(globalThis, globals, { IS_REACT_ACT_ENVIRONMENT: true });
  const hosted = api.skillsMdCatalogue,
    catalogue = api.catalogue,
    installs = api.installs;
  let calls = 0;
  api.skillsMdCatalogue = async () => {
    calls++;
    return [];
  };
  api.catalogue = async () => [
    {
      id: "sample",
      name: "Sample",
      path: "skills/sample",
      description: "Repository package",
      issues: [],
      license: "",
      scripts: 0,
      otherFiles: 0,
    },
  ];
  api.installs = async () => ({});
  const { MarketplaceCatalog } = await import("./MarketplaceCatalog");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () =>
      root.render(
        <MarketplaceCatalog
          skillsMd={false}
          sources={[source]}
          onAddCollection={() => {}}
          onManageSources={() => {}}
          onRepositorySkill={async () => {}}
        />,
      ),
    );
    assert.equal(calls, 0);
    assert.equal(document.querySelectorAll(".store-tile").length, 1);
    assert.doesNotMatch(document.body.textContent!, /skills\.md/);
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Filter sources"]')!
        .click(),
    );
    assert.deepEqual(
      [...document.querySelectorAll(".discover-source-filter label")].map(
        (label) => label.textContent,
      ),
      ["All sources", "owner/skills"],
    );
  } finally {
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    api.skillsMdCatalogue = hosted;
    api.catalogue = catalogue;
    api.installs = installs;
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});

async function marketplaceDom() {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const globals = {
    window: dom.window,
    document: dom.window.document,
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
      await act(async () => root.unmount());
      Object.assign(globalThis, previous);
      dom.window.close();
    },
  };
}

test("Discover shows suggestions before loading finishes and hides them for a search", async (t) => {
  const { root, cleanup } = await marketplaceDom();
  let finish!: (
    skills: Awaited<ReturnType<typeof api.skillsMdCatalogue>>,
  ) => void;
  t.mock.method(
    api,
    "skillsMdCatalogue",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { MarketplaceCatalog } = await import("./MarketplaceCatalog");
  try {
    await act(async () =>
      root.render(
        <MarketplaceCatalog
          skillsMd={true}
          sources={[]}
          onAddCollection={() => {}}
          onManageSources={() => {}}
          onRepositorySkill={async () => {}}
        />,
      ),
    );
    assert.ok(document.querySelector("#suggested-collections"));
    assert.equal(document.querySelectorAll(".store-placeholder").length, 6);
    assert.equal(
      document
        .querySelector(".store-tabs")
        ?.nextElementSibling?.getAttribute("aria-labelledby"),
      "suggested-collections",
    );
    await act(async () => finish([]));
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Search marketplace"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "missing");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    assert.equal(document.querySelector("#suggested-collections"), null);
    assert.equal(
      document.querySelector(".empty h3")?.textContent,
      "No skills found",
    );
  } finally {
    await cleanup();
  }
});

test("with skills.md off and no sources, Discover shows suggestions without an empty state", async (t) => {
  const { root, cleanup } = await marketplaceDom();
  const hosted = t.mock.method(api, "skillsMdCatalogue", async () => []);
  const { MarketplaceCatalog } = await import("./MarketplaceCatalog");
  try {
    await act(async () =>
      root.render(
        <MarketplaceCatalog
          skillsMd={false}
          sources={[]}
          onAddCollection={() => {}}
          onManageSources={() => {}}
          onRepositorySkill={async () => {}}
        />,
      ),
    );
    assert.ok(document.querySelector("#suggested-collections"));
    assert.equal(document.querySelector(".empty"), null);
    assert.equal(document.querySelectorAll(".store-tile").length, 0);
    assert.equal(hosted.mock.callCount(), 0);
    assert.doesNotMatch(
      document.body.textContent!,
      /No skills found|No collections added/,
    );
  } finally {
    await cleanup();
  }
});

test("Discover Add reports failures, then refreshes sources and announces a successful retry", async (t) => {
  const { root, cleanup } = await marketplaceDom();
  const { MarketplacesPage } = await import("./Marketplaces");
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const added = t.mock.method(
    api,
    "addMarketplace",
    () =>
      new Promise<Marketplace>((resolve, reject) => {
        finish = () => resolve(source);
        fail = reject;
      }),
  );
  const listed = t.mock.method(api, "marketplaces", async () => [source]);
  t.mock.method(api, "catalogue", async () => []);
  t.mock.method(api, "installs", async () => ({}));
  const changes: Marketplace[][] = [];
  const props = {
    skillsMd: false,
    harnesses: [],
    skills: [],
    updates: [],
    onSourcesChange: async (sources: Marketplace[]) => {
      changes.push(sources);
      root.render(<MarketplacesPage {...props} sources={sources} />);
    },
    onInstalled: async () => {},
    onOpenSkill: () => {},
    onUpdate: () => {},
  };
  try {
    await act(async () =>
      root.render(<MarketplacesPage {...props} sources={[]} />),
    );
    const add = document.querySelector<HTMLButtonElement>(
      '[aria-label="Add anthropics/skills"]',
    )!;
    await act(async () => add.click());
    assert.equal(add.textContent, "Adding…");
    assert.equal(add.disabled, true);
    assert.equal(
      document.querySelector<HTMLButtonElement>(
        '[aria-label="Add openai/skills"]',
      )!.disabled,
      true,
    );
    assert.deepEqual(added.mock.calls[0].arguments, ["anthropics/skills"]);
    await act(async () => fail(new Error("Could not add collection.")));
    assert.equal(
      document.querySelector('[role="alert"]')?.textContent,
      "Could not add collection.",
    );
    assert.ok(document.querySelector("#suggested-collections"));
    assert.equal(add.disabled, false);
    assert.equal(listed.mock.callCount(), 0);
    await act(async () => add.click());
    await act(async () => finish());
    assert.deepEqual(changes, [[source]]);
    assert.equal(listed.mock.callCount(), 1);
    assert.equal(document.querySelector("#suggested-collections"), null);
    assert.equal(document.querySelector('[role="alert"]'), null);
    assert.equal(
      document.querySelector('[role="status"]')?.textContent,
      "1 collection ready to browse.",
    );
  } finally {
    await cleanup();
  }
});
