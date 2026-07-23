# Release checklist

- [ ] Update `package.json`, `public/manifest.json`, README, and CHANGELOG versions.
- [ ] Run typecheck, lint, formatting, and tests.
- [ ] Build and verify `dist/`.
- [ ] Load the unpacked extension in Chromium and inspect the service worker.
- [ ] Test Alt + Q, manual Solve, Retry, and Stop.
- [ ] Test light/dark mode, 100%/125% zoom, keyboard focus, and narrow Side Panel width.
- [ ] Verify permissions and ZIP contents.
- [ ] Confirm no secrets, screenshots, logs, node_modules, or temporary files are tracked.
- [ ] Update README and CHANGELOG.
- [ ] Create the release tag and attach the verified ZIP.
