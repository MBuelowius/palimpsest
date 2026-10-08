# Contributing

Bug reports, documentation fixes, tests, and focused pull requests are welcome. Discuss changes to filesystem behavior, supported tools, or storage layout in an issue before implementing a large change.

## Set up

1. Fork and clone the repository, then create a branch for your change.
2. Use Node.js 24 and run `npm ci`.
3. Follow the isolated-library setup in [README.md](README.md). Never develop against your personal skill directories.

## Make a change

Keep changes focused and preserve concurrent user edits. For filesystem changes, cover path boundaries, symlinks, stale revisions, backups, and restoration when relevant. Tests must create their own disposable homes and must not access a contributor's real skills or require network downloads.

Use TypeScript's existing strict settings and the project's flat UI surfaces and colors. Use accessible controls and icon components; avoid decorative gradients, curves, and emoji. Explain why in comments when the reason is not apparent from the code.

## Validate

```sh
npm run format
npm run format:check
npm test
npm run build
```

For UI changes, also check the affected flow in an isolated library at wide and narrow viewport sizes. Describe the result in your pull request. Keep unrelated formatting changes out of the patch.

## Submit

Describe the problem, resulting behavior, and validation performed. Link the relevant issue when one exists. Include a screenshot for a visible UI change, with personal paths and skill content removed. Maintainers review changes before merging; automated checks alone do not establish that filesystem behavior is safe.

Maximilian Bülowius (@MBuelowius) maintains the project and makes merge and release decisions. There is no guaranteed response time or release schedule. Release versions and notes should identify user-visible changes and migration requirements; a version in `package.json` does not mean a release has been published.

Contributions are accepted under the project's [MIT license](LICENSE). Only submit material you have the right to contribute. No contributor license agreement is required.
