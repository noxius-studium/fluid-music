# Security policy

Please report suspected vulnerabilities privately using [GitHub private vulnerability reporting](https://github.com/noxius-studium/fluid-music/security/advisories/new). Do not publish working exploits, tokens, cookies, private library paths or personal listening history in public issues.

The latest published version is the supported release. No response-time guarantee is implied.

## Boundaries

- Spotify credentials remain in Hermes-managed backend credential storage.
- Indexed music uses user-approved scan roots and stable catalog references.
- Radio URLs are untrusted inputs; FluidMusic does not offer a media proxy.
- Browser-opened files are session-only and excluded from durable playlists.
- Visualization does not require broadening Hermes custom-protocol access.

See [provider limitations](docs/limitations.md) and [architecture](docs/architecture.md) for the scope of the current implementation.
