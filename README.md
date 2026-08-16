# LoopTroop Website

This repository owns the marketing website and published documentation served at [looptroop.ovh](https://www.looptroop.ovh/). The LoopTroop application source, releases, issues, and canonical changelog live in the [LoopTroop application repository](https://github.com/looptroop-ai/LoopTroop).

## Development

```bash
npm ci
npm run dev
```

The documentation development server runs at `http://localhost:5174/docs/`.

Build the complete Vercel output with:

```bash
npm run build
```

The generated marketing page and documentation are assembled in `site/`.

## Deployment

The existing LoopTroop Vercel project deploys this repository's `main` branch. `vercel.json` defines the install command, build command, output directory, clean URLs, and immutable asset headers.

The marketing page reads the latest stable LoopTroop version from the public GitHub Releases API in the visitor's browser. No release token or cross-repository synchronization is required.

`GET /api/project-stats` supplies the live GitHub-star and distribution counters used by the marketing page and installation documentation. The Vercel function aggregates public npm-registry downloads, Docker Hub pulls, and GitHub release-asset downloads without a database, secret, analytics event, or application telemetry. Successful responses are cached at the CDN for one hour and may be served stale for up to 24 hours while Vercel refreshes them; the browser client can retain the last valid response for seven days as an outage fallback. Installer-script asset downloads are displayed separately and excluded from the aggregate because the scripts subsequently use npm or a standalone archive already counted in the total.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Product bugs and application feature requests belong in the [LoopTroop issue tracker](https://github.com/looptroop-ai/LoopTroop/issues).
