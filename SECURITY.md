# Security policy

## Supported versions

During early development, security fixes target the current `main` branch. Older snapshots are not maintained. Update to the current source and rebuild when a fix is available.

## Report a vulnerability

Use [GitHub's private vulnerability report form](https://github.com/MBuelowius/palimpsest/security/advisories/new). Do not publish exploit details, personal skill content, backups, or credentials in an issue.

Include the affected commit, operating system, Node.js version, reproduction steps using a disposable home, and the expected impact. Examples of relevant findings include writes outside the selected home, symlink escapes, unauthorized HTTP mutations, unsafe repository downloads, or lost data during restoration.

The maintainer will assess the report and coordinate a fix and disclosure with the reporter. There is no guaranteed response time or bug bounty. If the private form is unavailable, open an issue asking for a private reporting channel without including vulnerability details.

## Security boundaries

The server binds to `127.0.0.1`; keep it local. Exposing it through a tunnel, reverse proxy, or public interface is unsupported. It checks hosts and origins and requires a session token for HTTP mutations. Other processes with access to your account can still access your files and local server.

Palimpsest manages local files and symlinks. Backups and logs remain in the selected home's `.local/share/skill-library/state`. Operation backups do not replace independent backups, and restoration is limited to the latest operation with conflict checks.

Marketplace sources are public GitHub repositories downloaded with Git. Palimpsest does not execute skill scripts, but the tools that consume those skills may do so. Review instructions, scripts, and licensing before installation. Do not use a personal home directory for security testing.
