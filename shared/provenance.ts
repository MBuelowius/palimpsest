import type { Origin } from "../server/library";

export function provenance(origin?: Origin) {
  if (!origin?.repo) return [];
  const versions = [
    { label: `Added from ${origin.repo}`, ...(origin.added ?? origin) },
    ...(origin.added ? [{ label: "Updated to", ...origin }] : []),
  ];
  return versions.map(({ label, commit, installedAt }) => ({
    label,
    commit: commit?.slice(0, 7),
    url: commit
      ? `https://github.com/${origin.repo}/commit/${commit}`
      : undefined,
    date: installedAt?.slice(0, 10),
  }));
}
