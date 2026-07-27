# Changelog

## [1.1.0] - 2026-07-27

### Added

- Local TXT knowledge import and management
- Local document chunking and retrieval
- Secure Local Knowledge integration with Solve
- Per-document enable and disable controls
- Local Knowledge usage status for Solve requests
- Document processing status and Retry controls
- Safe Delete All confirmation and atomic cleanup
- Storage, document, and chunk usage indicators
- Improved Persian and mixed RTL/LTR filename support

### Improved

- Local Knowledge privacy transparency
- Side Panel accessibility and keyboard navigation
- Responsive behavior at narrow, normal, and wide panel sizes
- Light and dark mode presentation
- Safe user-facing error messages
- Non-blocking Solve usage notifications

### Security and privacy

- Imported documents remain stored in browser IndexedDB
- Processing, search, and ranking occur locally
- Only relevant excerpts may be included in an active AI request
- Credentials are excluded from Local Knowledge retrieval queries
- Document content is not stored in chrome.storage.local
- No background upload occurs during import or document management

### Validation

- 423 automated tests passed
- Real Chromium functional certification passed
- Keyboard and focus-management flows passed
- Side Panel and Service Worker consoles verified clean
- Production dependency audit reported 0 vulnerabilities

### Known development-tooling note

Five high-severity npm audit findings remain in pre-existing ESLint transitive
development dependencies. They were present in the v1.0.0 baseline, were not
introduced by v1.1.0, do not affect production dependencies, and currently
require a breaking ESLint major upgrade to remediate.
