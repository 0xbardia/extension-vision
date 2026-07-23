# Development

## Requirements

- Node.js 20+
- Chrome 116+

## Setup

```bash
npm install
```

## Checks

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
```

## Build and package

```bash
npm run build
npm run verify:dist
npm run package
```

Load `dist/` through `chrome://extensions` with Developer mode enabled. Extract the ZIP before loading it.
