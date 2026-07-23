# Release process

1. Confirm the working tree and version are intentional.
2. Run `npm run check`.
3. Build and run `npm run verify:dist`.
4. Load the exact dist in Chromium and exercise the release checklist.
5. Run `npm run package` and inspect the ZIP root and contents.
6. Review README, CHANGELOG, privacy, security, and permissions.
7. Confirm no keys, screenshots, logs, node_modules, or generated artifacts are tracked.
8. Commit, tag the version, and create a GitHub release with the verified ZIP.

Rollback by loading the previous verified dist directory unpacked. Never overwrite the archived stable artifact.
