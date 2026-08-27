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

`GET /api/project-stats` supplies the live GitHub-star and distribution counters used by the marketing page and installation documentation. The Vercel function aggregates public npm-registry downloads, Docker Hub pulls, and GitHub release-asset downloads without a database, secret, analytics event, or application telemetry. Successful responses are cached at the CDN for one hour and may be served stale for up to 24 hours while Vercel refreshes them; the browser client can retain the last valid response for seven days as an outage fallback. The GitHub release-asset side counts the bundle, the standalone archives and the package tarball — the last of these because the installer script in its default mode downloads that file and hands it to `npm install -g`, so the registry's own figure never sees those installs. Installer-script downloads are displayed separately and excluded from the aggregate: fetching a script is not installing, and a run that gets as far as installing then downloads the tarball or a standalone archive already counted. Upstream failures are cached for one minute, so an outage cannot turn every page view into another fan-out against GitHub's limit of 60 unauthenticated requests an hour.

### Historical download data

The download-history chart stores one snapshot at five minutes past every UTC
hour. History starts with the first successful snapshot. It does not estimate
earlier activity or combine an npm backfill with newer data from the other
sources.

The production Vercel project needs an Upstash Redis integration and these
environment variables:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, supplied by the
  integration, give server-side functions access to the history store.
- `CRON_SECRET` protects the scheduled collector. Vercel sends it as a bearer
  token when it requests `/api/cron/project-stats`.

`GET /api/project-stats-history` reads the stored history. Its `range` parameter
accepts `24h`, `7d`, `30d`, `1y` or `all`; `bucket` accepts `hour`, `day`,
`week`, `month` or `year`. The endpoint rejects combinations that would return
more than 400 points. Successful responses are briefly cached at the CDN and
can be served stale while Redis recovers. The existing live statistics endpoint
does not depend on Redis, so the lifetime cards continue to work if history is
unavailable.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Product bugs and application feature requests belong in the [LoopTroop issue tracker](https://github.com/looptroop-ai/LoopTroop/issues).
