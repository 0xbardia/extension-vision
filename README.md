# Extension Vision

<!-- Logo placeholder: add the project logo at assets/logo.png. -->

<!-- Banner placeholder: add a repository banner at assets/banner.png. -->

[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/develop)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![OpenRouter](https://img.shields.io/badge/provider-OpenRouter-6B4EFF)](https://openrouter.ai/)
[![OpenAI](https://img.shields.io/badge/provider-OpenAI-000000?logo=openai&logoColor=white)](https://platform.openai.com/)
[![MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Extension Vision is a local-first Chrome Manifest V3 AI Vision extension. It captures the visible browser tab, sends the screenshot to a configured OpenRouter or OpenAI Vision model, validates the structured response, and displays the result in the Chrome Side Panel.

> Personal-use note: API keys are entered and stored in the browser. Do not distribute a configured profile or expose your keys.

## Features

- Alt + Q shortcut and manual Side Panel solving
- Visible-tab screenshots only
- OpenRouter and OpenAI Direct providers
- Provider-specific API keys and models
- Prompt presets and custom instructions
- Mandatory structured JSON output
- Response timing and provider/model metadata
- Copy answer, cancellation, processing stages, and retry
- Persistent local settings with no account, backend, analytics, or telemetry
- Light/dark system appearance and keyboard-accessible controls

## Architecture

```text
Alt + Q / Manual Solve
          ↓
Chrome Side Panel + MV3 service worker
          ↓
Visible-tab screenshot
          ↓
OpenRouter or OpenAI provider
          ↓
Mandatory JSON contract + Zod validation
          ↓
Structured result in chrome.storage.session
          ↓
Side Panel result card
```

See [docs/architecture.md](docs/architecture.md).

## Screenshots and demo

Real product screenshots and a short GIF belong in `assets/`. They are intentionally not fabricated in this repository.

- `assets/screenshot-1.png` — main result view
- `assets/screenshot-2.png` — presets/settings view
- `assets/demo.gif` — short workflow recording

## Installation

### Build locally

Requirements: Node.js 20 or newer and Chrome 116 or newer.

```bash
npm install
npm run check
npm run package
```

### Load unpacked

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the built `dist/` directory.
5. Open the Side Panel, choose a provider, enter a current image-capable model and API key, then save settings.

The ZIP must be extracted before using **Load unpacked**.

### Shortcut

Press **Alt + Q** on a normal webpage. Change the shortcut at `chrome://extensions/shortcuts`. Browser or operating-system shortcuts may conflict.

## Providers and configuration

OpenRouter and OpenAI Direct use separate API keys and model fields. Model availability changes; enter a currently available image-capable model for the selected provider. Keys stay in `chrome.storage.local` and are never committed or logged.

Prompt presets are local instructions for quiz solving, page summaries, translation, screenshot explanation, information extraction, and custom work. JSON rules are applied automatically and cannot be removed by the editable instruction. **Reset selected preset** restores its factory instruction.

## Project structure

```text
public/manifest.json       # MV3 metadata
src/background/            # service-worker command and solve lifecycle
src/providers/             # provider request implementations
src/prompt/                # mandatory prompt contract and presets
src/sidepanel/             # accessible HTML, CSS, and TypeScript UI
src/storage/               # local settings and session state
src/vision/                # response schema and parser
tests/                     # unit and integration-oriented tests
scripts/                   # dist verification and ZIP packaging
docs/                      # contributor and release documentation
```

## Development

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run verify:dist
npm run package
```

See [docs/development.md](docs/development.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Privacy and security

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md). Screenshots are held in memory for the active request only and sent only to the selected provider. No screenshots, telemetry, tracking data, or analytics are stored.

## Roadmap

Current v0.2.0 includes presets and UX improvements. Possible future work includes a local knowledge base, area selection, history, offline retrieval, and verification. See [docs/roadmap.md](docs/roadmap.md).

## FAQ

**Does this solve protected Chrome pages?** No. Chrome-protected pages cannot be captured.

**Where do I get a model name?** Use the selected provider's current documentation and choose an image-capable model.

**Can I publish my API key with the extension?** No. Configure keys locally and keep them private.

**Does the extension submit answers or click webpages?** No. It only displays the model result.

## Suggested GitHub topics

`chrome-extension` `manifest-v3` `ai` `vision` `openrouter` `openai` `typescript` `sidebar` `screenshot`

## Contributing

Bug reports, focused improvements, tests, and documentation are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

Released under the [MIT License](LICENSE).

## Acknowledgements

Built with Chrome Extension APIs, TypeScript, Vite, Vitest, Zod, OpenRouter, and OpenAI.
