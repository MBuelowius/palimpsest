import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
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
  const root = createRoot(document.getElementById("root")!);
  const opened: string[] = [];
  const sources = [source];
  try {
    await act(async () => {
      root.render(
        <MarketplaceCatalog
          skillsMd={true}
          sources={sources}
          onManageSources={() => {}}
          onRepositorySkill={async (id, skill) => {
            opened.push(id + "/" + skill);
          }}
        />,
      );
    });
    assert.equal(document.querySelectorAll(".store-tile").length, 2);
    assert.match(document.body.textContent!, /skills.md/);
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
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => {
      root.render(
        <MarketplaceCatalog
          skillsMd={true}
          sources={[source]}
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
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => {
      root.render(
        <MarketplaceCatalog
          skillsMd={true}
          sources={[]}
          onManageSources={() => {}}
          onRepositorySkill={async () => {}}
        />,
      );
    });
    assert.equal(document.querySelectorAll(".store-tile").length, 12);
    await act(async () => {
      (
        [...document.querySelectorAll("button")].find((button) =>
          /See all 14/.test(button.textContent!),
        ) as HTMLButtonElement
      ).click();
    });
    assert.equal(document.querySelectorAll(".store-shelf").length, 0);
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

test("an empty marketplace points to suggestions when skills.md is unavailable", async () => {
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
  const root = createRoot(document.getElementById("root")!);
  let opened = false;
  try {
    await act(async () => {
      root.render(
        <MarketplaceCatalog
          skillsMd={true}
          sources={[]}
          onManageSources={() => {
            opened = true;
          }}
          onRepositorySkill={async () => {}}
        />,
      );
    });
    const button = document.querySelector<HTMLButtonElement>(".empty button");
    assert.equal(button?.textContent, "Browse suggested collections");
    await act(async () => button!.click());
    assert.equal(opened, true);
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
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () =>
      root.render(
        <MarketplaceCatalog
          skillsMd={false}
          sources={[source]}
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
