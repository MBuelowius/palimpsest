# Changelog

User-visible changes are recorded here. Entries under Unreleased are not published releases.

## Unreleased

### Added

- Skill policy controls in Settings: connect, refresh, inspect differences, preview and confirm pinned installs, and disconnect. Policy-disabled skills.md stays off without changing the saved preference.
- `policy apply` previews required pinned installs and updates, including scan findings and skipped names. `--apply` saves them as one operation that a single restore undoes.

- Public GitHub skill policy files with CLI connect, offline show, manual refresh and disconnect; server checks for allowed collections, blocked skills and pinned installs/updates, plus local drift reporting.
- Marketplace section in Settings with collections and a switch to hide the skills.md catalog.
- Repository, license, last change date and contents on GitHub marketplace skill pages, and "Includes scripts" on their cards. Discover shelves wrap instead of cutting off cards.
- Light, Dark, and System appearance choices in Settings, remembered in this browser.
- Suggested GitHub skill collections in Sources, with a link from the empty marketplace.
- Repository, commit, and install/update dates in skill details and CLI inspection, retained after collection removal.
- Local static findings for scripts, binary files, hidden characters, download-and-run commands, and credential paths in package and incoming update previews, capped at 100 findings per package.
- Local Claude and Codex skill inventory, whole-package comparisons, and shared-library links.
- File editing, operation backups, and conflict-aware restoration.
- Public GitHub marketplace browsing and package installation previews.
- Local web UI and CLI.
- MIT license, contributor guidance, community and security policies, and GitHub contribution templates.
- Cross-platform checks, formatting checks, and dependency update configuration.
