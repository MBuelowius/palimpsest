import { Button } from "@/components/ui/button";

const collections = ["anthropics/skills", "openai/skills"];

export function SuggestedCollections({
  sources,
  busy,
  adding,
  onAdd,
}: {
  sources: { repo: string }[];
  busy: boolean;
  adding?: string;
  onAdd: (repo: string) => void;
}) {
  const suggestions = collections.filter(
    (repo) => !sources.some((source) => source.repo.toLowerCase() === repo),
  );
  if (!suggestions.length) return null;
  return (
    <section
      className="collection-management"
      aria-labelledby="suggested-collections"
    >
      <h3 id="suggested-collections">Suggested collections</h3>
      {suggestions.map((repo) => (
        <div className="collection-management-row" key={repo}>
          <span>{repo}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !!adding}
            aria-label={`Add ${repo}`}
            onClick={() => onAdd(repo)}
          >
            {adding === repo ? "Adding…" : "Add"}
          </Button>
        </div>
      ))}
    </section>
  );
}
