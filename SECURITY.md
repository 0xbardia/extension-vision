# Security Policy

## Supported versions

The latest release on the default branch is supported. Older releases may be archived and should be upgraded when practical.

## Reporting a vulnerability

Do not open a public issue for an exploitable security problem. Contact the repository maintainers privately through the GitHub repository's security contact or private vulnerability reporting flow. Include reproduction steps, affected version, impact, and a suggested mitigation when available.

## Responsible disclosure

Allow maintainers reasonable time to investigate and release a fix before public disclosure. Do not access data that is not yours, exfiltrate API keys, or test against third-party services without permission.

## Security principles

- API keys remain local to the browser and are never hardcoded or logged.
- Screenshots remain in memory and are sent only to the selected provider.
- No remote scripts, analytics, telemetry, hidden requests, or account backend are used.
- Model responses are validated before rendering and model content is rendered as text.
