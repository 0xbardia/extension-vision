# Architecture

```text
Alt + Q / Manual Solve
          ↓
Side Panel command/message flow
          ↓
Target visible tab
          ↓
captureVisibleTab
          ↓
OpenRouter or OpenAI Direct
          ↓
Structured JSON parser and Zod schema
          ↓
chrome.storage.session solve state
          ↓
Side Panel result
```

## Modules

- `src/background/service-worker.ts` owns commands, request IDs, session state, cancellation, tab capture, and provider orchestration.
- `src/background/command-flow.ts` keeps command-time Side Panel opening inside the user gesture.
- `src/background/target-tab.ts` resolves the command or active webpage tab and rejects known protected URLs.
- `src/providers/` contains the OpenRouter and OpenAI request implementations behind `VisionProvider`.
- `src/prompt/` contains the immutable output contract and local preset instructions.
- `src/vision/` parses and validates provider responses.
- `src/storage/` merges persistent settings and stores transient solve state.
- `src/sidepanel/` contains the semantic HTML, responsive CSS, and UI state rendering.

API keys are read from local extension storage and are never included in logs or committed files. Screenshots are request-scoped memory values only.
