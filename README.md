# Palimpsest

Palimpsest is a local skill library for Claude, Codex, Cursor, Gemini CLI, OpenCode, GitHub Copilot, and Windsurf / Devin. Compare skill packages, move a chosen version into a shared library, and manage which tools use it through a web UI or CLI.

This is an early project. Review previews before applying changes and keep an independent backup of your skills.

## What it does

- Detects harnesses from configuration folders, executable locations, macOS app bundles, and Copilot extensions. Locations shows the evidence; Refresh checks again.
- Finds personal skills in each supported harness's default skill folders, including `~/.agents/skills` and Devin's additional `~/.config/devin/skills` folder.
- Compares whole packages, including references and scripts, and flags differing versions.
- Shares packages through `~/.harnesses-shared/skills` and tool-specific symlinks.
- Edits skill files with operation backups and checks for changes made elsewhere.
- Browses public GitHub skill repositories and previews packages before installation.

Palimpsest does not execute skill scripts. A tool consuming an installed skill may execute them; inspect third-party instructions and files before enabling a package.

## Run from source

Use Node.js 24 and npm. Git is required to download marketplace repositories. The local installer targets macOS and Linux; Windows installation is not supported.

```sh
git clone https://github.com/MBuelowius/palimpsest.git
cd palimpsest
npm ci
npm run build
node dist/cli.mjs serve
```

Open <http://127.0.0.1:4319>. This uses your real home directory. Sharing, editing, enabling, and installing skills can change its contents.

### Try an isolated library

On macOS or Linux, start with an empty temporary home:

```sh
demo_home=$(mktemp -d)
node dist/cli.mjs serve --home "$demo_home"
```

Open <http://127.0.0.1:4319> and create a skill. All library data for this server stays under the temporary directory. Stop the server with Ctrl+C. Use a different `--port` if 4319 is occupied.

### Install the local command

After building:

```sh
npm run install:local
export PATH="$HOME/.local/bin:$PATH"
palimpsest ui
```

Persist the PATH setting in your shell configuration if needed. The installer copies the build to `~/.local/share/skill-library/app` and writes `~/.local/bin/palimpsest`, tied to the Node executable used during installation. Reinstall after moving or replacing that Node executable. It also copies the source to `~/src/repos/palimpsest` if that directory does not exist, and retains an existing app installation as a timestamped backup.

`ui` starts a background server and opens a browser on macOS. On Linux, open the printed URL yourself. Stop that server with `palimpsest stop`.

## CLI

```sh
palimpsest --help
palimpsest harnesses
palimpsest list
palimpsest inspect example
palimpsest share example --source claude
palimpsest share example --source claude --apply
palimpsest history
```

`share`, `share-identical`, and `marketplace install` preview changes unless `--apply` is supplied. `enable`, `disable`, and `restore` apply immediately. Restoring is limited to the latest operation and refuses to overwrite later external edits.

Sharing, syncing, and marketplace installation default to the detected harnesses. Use `--tools cursor,gemini,opencode` to override detection, or choose harnesses manually in the UI. Configuration folders may remain after an uninstall, so detection is evidence of a local setup rather than a runtime health check. Harnesses can also discover skills in other apps' folders; Palimpsest manages the explicit links shown in its library.

Use `--home <existing-directory>` or `SKILL_LIBRARY_HOME` to select an isolated library. A different home detects only fixtures inside that directory, without scanning the host's PATH or system applications. State, backups, marketplace downloads, and server logs are stored under `<home>/.local/share/skill-library/state`. Local packages may contain private information; do not attach this state directory to a public issue.

## Development

```sh
npm ci
npm test
npm run build
```

For live development, run these in separate terminals with the same temporary home:

```sh
SKILL_LIBRARY_HOME=/path/to/existing/demo-home npm run dev:server
```

```sh
npm run dev
```

Open <http://127.0.0.1:4317>. Vite proxies API requests to the server on port 4318. `npm run format:check` checks formatting; `npm run format` applies it.

The React UI lives in `src/`; filesystem operations, HTTP routes, and the CLI live in `server/`. `scripts/build.mjs` bundles the CLI alongside the built web UI. Tests use disposable directories and Node's test runner.

## Contributing and support

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development and review process and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations. Use [GitHub issues](https://github.com/MBuelowius/palimpsest/issues) for reproducible bugs, feature proposals, and usage questions. See [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

[MIT](LICENSE). Third-party dependencies and skill packages retain their own licenses. Palimpsest's license does not grant rights to downloaded skills.
