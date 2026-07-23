# Contributing

## Development workflow

1. Fork the repository and create a focused branch such as `feat/prompt-presets`, `fix/capture-error`, or `docs/release-guide`.
2. Install dependencies with `npm install`.
3. Make the smallest change that solves the issue.
4. Run `npm run check` before opening a pull request.
5. Describe behavior, tests, and any Chromium verification in the pull request.

## Style

Use TypeScript, existing vanilla DOM patterns, Prettier, and the existing provider/storage architecture. Do not add secrets, screenshots, telemetry, broad permissions, or unrelated refactors.

## Commits and pull requests

Use concise imperative commit messages, preferably Conventional Commit style (`fix:`, `feat:`, `docs:`, `test:`, `chore:`). Pull requests should explain the problem, the minimal solution, regression coverage, and user-visible impact.

## Reports and requests

Use the bug and feature templates. Do not include API keys, screenshots containing private information, or raw provider payloads. Security issues belong in [SECURITY.md](SECURITY.md), not public issues.
