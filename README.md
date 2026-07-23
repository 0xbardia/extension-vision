# AI Vision Sidebar

Version 1 is a Manifest V3 Chrome Side Panel that captures the visible tab and sends it to either OpenRouter or OpenAI Direct. It has persistent provider-specific settings, editable prompt, loading/success/error states, retry, Alt+Q, safe Zod parsing, and no backend.

## Requirements

Node.js 20+ for building, and Chrome 116+ for the Side Panel. Enter a currently available image-capable model yourself; availability changes by provider.

## Build and install

Run `npm install`, then `npm run check` and `npm run package`. The unpacked artifact is `dist/`; the transfer archive is `ai-vision-sidebar-v0.1.0.zip`. In Chrome open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select the absolute `dist` directory. To transfer, copy `dist/` or copy the ZIP and extract it first.

Configure a provider, its API key, a current image-capable model, and the prompt, then choose Save settings. OpenRouter uses its API endpoint; OpenAI Direct uses the official OpenAI SDK Responses API. API keys are stored in `chrome.storage.local` for personal local use only and are never logged or bundled. Do not publicly distribute this extension with personal keys.

Press Alt+Q to open the Side Panel and solve the active visible tab. Change the shortcut at `chrome://extensions/shortcuts`; OS/browser shortcuts can conflict. Solve current page performs the same flow. Chrome-protected pages cannot be captured.

For troubleshooting, inspect the Side Panel page from the extension's Inspect views link and the service worker from the Service worker link in `chrome://extensions`. Run `npm run check` to repeat typecheck, lint, formatting, unit tests, build, and dist verification. `npm run test:e2e` runs browser tests when configured.

## Artifacts

`/root/ce/dist` is loadable unpacked. `/root/ce/ai-vision-sidebar-v0.1.0.zip` contains the dist contents at ZIP root. The extension captures only the visible viewport, does not persist screenshots, does not click answers, and does not submit forms.
