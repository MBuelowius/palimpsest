import { toolLabel, type Tool } from "../shared/harnesses";

export function skillIssueText(issue: string): string {
  if (issue === "Missing YAML frontmatter.")
    return "Add a name and description in Source before using this skill in another app.";
  if (
    issue.startsWith("Invalid YAML:") ||
    issue === "Frontmatter must be a mapping."
  )
    return "The skill’s saved details couldn’t be read. Check the name and description in Source.";
  if (issue === "Missing description.")
    return "Add a description so your app knows when to use this skill.";
  if (issue.startsWith("No name field;"))
    return "Add a skill name before using it in another app.";
  if (issue === "Contains app-specific instructions; review before sharing.")
    return "Check these instructions before using this skill in a different app.";
  if (issue === "Choose a version before syncing.")
    return "Choose which version to keep before adding this skill to your apps.";
  if (
    issue ===
    "Fix the selected version’s YAML frontmatter and description before sharing."
  )
    return "Add a name and description to this version before using it in other apps.";
  return issue;
}

export function changeDescription(label: string): string {
  const appChange = label.match(/^(Enable|Disable) in (.+)$/);
  if (appChange)
    return `${appChange[1] === "Enable" ? "Added to" : "Removed from"} ${toolLabel[appChange[2] as Tool] ?? appChange[2]}`;
  if (label === "Edit SKILL.md") return "Edited instructions";
  if (label === "Install marketplace skill") return "Added from a collection";
  if (label === "Create skill") return "Created skill";
  if (label.startsWith("Edit ")) return "Edited " + label.slice("Edit ".length);
  if (label.startsWith("Share with "))
    return "Added to " + label.slice("Share with ".length);
  return label;
}
