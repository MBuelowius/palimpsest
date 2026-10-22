import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  api,
  type CatalogueSkill,
  type Marketplace,
  type SkillUpdate,
} from "./api";
import type { HostedSkill } from "../server/skillsMd";
import { ProductHeader, SkillIcon } from "./ProductHeader";

const MarkdownContent = lazy(() =>
  import("./MarkdownContent").then((module) => ({
    default: module.MarkdownContent,
  })),
);

const PAGE_SIZE = 24;
const compact = new Intl.NumberFormat("en", { notation: "compact" });
const SHELF_COUNT = 6;
const day = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

// License, last change and contents for a GitHub package page. The page
// header already links the repository.
export function packageFacts(
  skill: CatalogueSkill,
  source: Marketplace,
): [string, ReactNode][] {
  const file = skill.licenseFile;
  const label = skill.license || file?.split("/").pop();
  const contents = [
    skill.scripts && plural(skill.scripts, "script"),
    skill.otherFiles && plural(skill.otherFiles, "other file"),
  ].filter(Boolean);
  return [
    [
      "License",
      file ? (
        <a
          className="text-action"
          href={
            new URL(
              file.split("/").map(encodeURIComponent).join("/"),
              `https://github.com/${source.repo}/blob/${source.commit}/`,
            ).href
          }
          target="_blank"
          rel="noreferrer"
        >
          {label}
        </a>
      ) : (
        label || "No license found"
      ),
    ],
    [
      "Last changed",
      skill.changedAt &&
        (skill.changedBefore ? "On or before " : "") +
          day.format(new Date(skill.changedAt)),
    ],
    [
      "Contents",
      contents.length ? "Includes " + contents.join(" and ") : "Markdown only",
    ],
  ];
}

type CatalogSkill = HostedSkill & {
  key: string;
  source: string;
  repository?: Marketplace;
  folder?: string;
  scripts?: number;
};

export function MarketplaceCatalog({
  sources,
  skillsMd,
  skills: library = [],
  updates = [],
  onManageSources,
  onRepositorySkill,
}: {
  sources: Marketplace[];
  skillsMd: boolean;
  skills?: { name: string }[];
  updates?: SkillUpdate[];
  onManageSources: () => void;
  onRepositorySkill: (sourceId: string, skillId: string) => Promise<void>;
}) {
  const [skills, setSkills] = useState<CatalogSkill[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string[] | null>(null);
  const [sort, setSort] = useState("name");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<HostedSkill | null>(null);
  const [content, setContent] = useState("");
  const [revision, setRevision] = useState(0);
  const [installs, setInstalls] = useState<Record<string, number>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const more = useRef<HTMLDivElement>(null);
  const opened = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const requests = [
      ...(skillsMd
        ? [
            {
              name: "skills.md",
              load: api.skillsMdCatalogue().then((list): CatalogSkill[] =>
                list.map((skill) => ({
                  ...skill,
                  key: "skills.md/" + skill.slug,
                  source: "skills.md",
                })),
              ),
            },
          ]
        : []),
      ...sources.map((source) => ({
        name: source.repo,
        load: api.catalogue(source.id).then((list): CatalogSkill[] =>
          list.map((skill) => ({
            key: source.id + "/" + skill.id,
            slug: skill.id,
            name: skill.name,
            description: skill.description,
            category: "GitHub packages",
            price: "",
            availability: "",
            source: source.repo,
            repository: source,
            folder: skill.path.split("/").pop(),
            scripts: skill.scripts,
          })),
        ),
      })),
    ];
    Promise.allSettled(requests.map((request) => request.load)).then(
      (results) => {
        if (!active) return;
        const entries: CatalogSkill[] = [];
        const failures: string[] = [];
        results.forEach((result, index) => {
          if (result.status === "fulfilled") entries.push(...result.value);
          else
            failures.push(
              requests[index].name + ": " + (result.reason as Error).message,
            );
        });
        setSkills(entries);
        setError(failures.join(" "));
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [revision, sources, skillsMd]);
  useEffect(() => {
    let active = true;
    (async () => {
      for (const source of sources) {
        const own = skills.filter(
          (skill) => skill.repository?.id === source.id,
        );
        const ids = own.map((skill) => skill.folder!);
        for (let start = 0; start < ids.length; start += 25) {
          // Install counts are an extra: a failed lookup leaves tiles without one.
          const counts = await api
            .installs(source.repo, ids.slice(start, start + 25))
            .catch(() => ({}) as Record<string, number>);
          if (!active) return;
          setInstalls((current) => ({
            ...current,
            ...Object.fromEntries(
              Object.entries(counts).map(([id, count]) => [
                own.find((skill) => skill.folder === id)!.key,
                count,
              ]),
            ),
          }));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [skills, sources]);
  useEffect(() => {
    if (!selected) {
      if (opened.current)
        document
          .querySelector<HTMLButtonElement>(
            `[data-hosted-skill="${CSS.escape(opened.current)}"]`,
          )
          ?.focus();
      return;
    }
    heading.current?.focus();
    let active = true;
    setContent("");
    setError("");
    api
      .skillsMdInstructions(selected.slug)
      .then((result) => {
        if (active) setContent(result.content);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [selected]);
  useEffect(() => {
    setSelected(null);
    setCategory("");
    setSourceFilter(null);
  }, [skillsMd]);
  const sourceOptions = [
    ...(skillsMd ? [{ id: "skills.md", name: "skills.md" }] : []),
    ...sources.map((source) => ({ id: source.id, name: source.repo })),
  ];
  const activeSources =
    sourceFilter === null
      ? sourceOptions.map((source) => source.id)
      : sourceFilter;
  const allSources = sourceOptions.every((source) =>
    activeSources.includes(source.id),
  );
  const catalog = skills.filter((skill) =>
    activeSources.includes(skill.repository?.id ?? "skills.md"),
  );
  const filtered = catalog.filter(
    (skill) =>
      (!category || skill.category === category) &&
      `${skill.name} ${skill.slug} ${skill.description} ${skill.category} ${skill.source}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const sorted = [...filtered].sort((a, b) =>
    sort === "installs"
      ? (installs[b.key] ?? -1) - (installs[a.key] ?? -1) ||
        a.name.localeCompare(b.name)
      : sort === "name-desc"
        ? b.name.localeCompare(a.name)
        : a.name.localeCompare(b.name),
  );
  const visible = sorted.slice(0, limit);
  const hasMore = visible.length < sorted.length;
  const browsing = !!category || !!query.trim();
  useEffect(() => setLimit(PAGE_SIZE), [query, category, sort, sourceFilter]);
  useEffect(() => {
    const node = more.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        entry.isIntersecting && setLimit((value) => value + PAGE_SIZE),
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [browsing, hasMore, limit]);
  const counts = new Map<string, number>();
  catalog.forEach((skill) =>
    counts.set(skill.category, (counts.get(skill.category) ?? 0) + 1),
  );
  const categories = [...counts.keys()].sort();
  const shelves = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, SHELF_COUNT)
    .map(([name, total]) => ({
      name,
      total,
      skills: sorted.filter((skill) => skill.category === name).slice(0, 12),
    }));
  function open(skill: CatalogSkill) {
    return async () => {
      opened.current = skill.key;
      if (skill.repository) {
        try {
          await onRepositorySkill(skill.repository.id, skill.slug);
        } catch (error) {
          setError((error as Error).message);
        }
      } else setSelected(skill);
    };
  }
  function tileState(skill: CatalogSkill) {
    if (!skill.repository) return "View";
    const origin = updates.find((item) => item.name === skill.folder);
    if (origin)
      return origin.source === skill.repository.id &&
        origin.skillId === skill.slug
        ? origin.update
          ? "Update"
          : "Installed"
        : "Get";
    return library.some((item) => item.name === skill.folder)
      ? "Installed"
      : "Get";
  }
  function tile(skill: CatalogSkill) {
    return (
      <button
        className="store-tile"
        key={skill.key}
        data-hosted-skill={skill.key}
        data-catalogue-skill={skill.repository ? skill.slug : undefined}
        onClick={open(skill)}
      >
        <SkillIcon name={skill.name} />
        <span className="store-tile-body">
          <strong>{skill.name}</strong>
          <span className="store-tile-description">{skill.description}</span>
          <span className="store-tile-source">
            {skill.source}
            {!!skill.scripts && " · Includes scripts"}
            {installs[skill.key] !== undefined &&
              ` · ${compact.format(installs[skill.key])} installs`}
          </span>
        </span>
        <span
          className="store-get"
          data-state={tileState(skill)}
          aria-hidden="true"
        >
          {tileState(skill)}
        </span>
      </button>
    );
  }
  const emptyState =
    !loading && !skills.length && !sources.length ? (
      <div className="empty">
        <h3>No collections added</h3>
        <p>
          {skillsMd
            ? "Browse suggested collections in Sources to add skills."
            : "Add a collection to browse skills. The skills.md catalog is turned off in Settings."}
        </p>
        <Button variant="outline" onClick={onManageSources}>
          Browse suggested collections
        </Button>
      </div>
    ) : !filtered.length && !error ? (
      <div className="empty">
        <h3>No skills found</h3>
        <p>Try another search or clear your filters.</p>
        <Button
          variant="outline"
          onClick={() => {
            setQuery("");
            setCategory("");
            setSourceFilter(null);
          }}
        >
          Clear filters
        </Button>
      </div>
    ) : null;
  if (selected)
    return (
      <section
        className="skill-reader marketplace-skill-page"
        aria-label="Skill details"
      >
        <div className="reader-actions">
          <Button
            variant="ghost"
            onClick={() => {
              setSelected(null);
              setError("");
            }}
          >
            <ArrowLeft size={16} />
            Back to marketplace
          </Button>
        </div>
        <ProductHeader
          name={selected.name}
          description={selected.description}
          source="skills.md"
          facts={[
            ["Category", selected.category],
            ["Price", selected.price],
            ["Availability", selected.availability],
          ]}
          headingRef={heading}
          action={
            <a
              className="store-open"
              href={`https://skills.md/api/v1/skills/${selected.slug}/skill.md`}
              target="_blank"
              rel="noreferrer"
            >
              View SKILL.md source <ArrowUpRight size={14} />
            </a>
          }
        />
        <section className="instructions-section">
          <div className="section-heading">
            <h2>What this skill does</h2>
          </div>
          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : content ? (
            <Suspense fallback={<p role="status">Loading instructions…</p>}>
              <MarkdownContent
                content={content}
                files={[]}
                fileName="SKILL.md"
                resourceBaseUrl={`https://skills.md/api/v1/skills/${selected.slug}/skill.md`}
              />
            </Suspense>
          ) : (
            <p role="status">Loading instructions…</p>
          )}
        </section>
      </section>
    );
  return (
    <section className="store" aria-label="Skill catalog">
      <div className="store-toolbar">
        <div className="store-search search-field">
          <Search size={18} />
          <Input
            aria-label="Search marketplace"
            placeholder="Search skills by name or task…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button variant="outline" aria-label="Filter sources">
              <SlidersHorizontal size={14} />
              Sources
              {!allSources &&
                ` (${sourceOptions.filter((source) => activeSources.includes(source.id)).length})`}
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="discover-source-filter"
              align="end"
              sideOffset={8}
              aria-label="Filter by source"
            >
              <h4>Sources</h4>
              <label>
                <input
                  type="checkbox"
                  checked={allSources}
                  onChange={(event) => {
                    setSourceFilter(event.target.checked ? null : []);
                  }}
                />
                All sources
              </label>
              {sourceOptions.map((source) => (
                <label key={source.id}>
                  <input
                    type="checkbox"
                    checked={activeSources.includes(source.id)}
                    onChange={(event) => {
                      setSourceFilter(
                        event.target.checked
                          ? [...activeSources, source.id]
                          : activeSources.filter((id) => id !== source.id),
                      );
                    }}
                  />
                  {source.name}
                </label>
              ))}
              <Popover.Close asChild>
                <Button variant="ghost" size="sm" onClick={onManageSources}>
                  Manage collections
                </Button>
              </Popover.Close>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh catalog"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </Button>
      </div>
      <nav className="store-tabs" aria-label="Skill categories">
        <button
          aria-pressed={!category}
          onClick={() => {
            setCategory("");
          }}
        >
          Discover
        </button>
        {categories.map((value) => (
          <button
            key={value}
            aria-pressed={category === value}
            onClick={() => {
              setCategory(value);
            }}
          >
            {value}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="form-error">
          {error} Try refreshing the catalog.
        </p>
      )}
      {loading ? (
        <div className="store-list" aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="store-tile store-placeholder" key={index} />
          ))}
          <p role="status" className="sr-only">
            Loading catalog…
          </p>
        </div>
      ) : browsing ? (
        <>
          <div className="store-results-heading">
            <div>
              <h2>{category || "Search results"}</h2>
              <p role="status" className="muted">
                {filtered.length} {filtered.length === 1 ? "skill" : "skills"}
                {query.trim() && ` matching “${query.trim()}”`}
              </p>
            </div>
            <label className="discover-sort">
              Sort by
              <select
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value);
                }}
              >
                <option value="name">Name: A–Z</option>
                <option value="name-desc">Name: Z–A</option>
                <option value="installs">Most installed</option>
              </select>
            </label>
          </div>
          <div className="store-list">{visible.map(tile)}</div>
          {emptyState}
          {hasMore && <div ref={more} aria-hidden="true" />}
        </>
      ) : shelves.length === 0 ? (
        emptyState
      ) : (
        shelves.map((shelf) => (
          <section className="store-shelf" key={shelf.name}>
            <div className="store-shelf-heading">
              <h2>{shelf.name}</h2>
              {shelf.total > shelf.skills.length && (
                <button
                  className="text-action"
                  onClick={() => {
                    setCategory(shelf.name);
                  }}
                >
                  See all {shelf.total}
                </button>
              )}
            </div>
            <div className="store-row">{shelf.skills.map(tile)}</div>
          </section>
        ))
      )}
    </section>
  );
}
