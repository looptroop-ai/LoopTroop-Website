# LoopTroop Website

The marketing site and documentation served at [looptroop.ovh](https://www.looptroop.ovh/).

**This repository accepts documentation and website contributions only.** Typos, unclear wording, broken links, missing docs, layout and styling problems — those belong here.

Everything about the application itself — bugs, crashes, feature requests, the changelog, the source — belongs in the [LoopTroop application repository](https://github.com/looptroop-ai/LoopTroop/issues). Issues opened here about application behavior will be redirected there.

## Working on the docs

```bash
npm ci
npm run dev     # http://localhost:5174/docs/
```

Documentation pages are Markdown in `docs/`. The marketing page is `web.html` and `src/web.css`.

Before opening a pull request, see [CONTRIBUTING.md](CONTRIBUTING.md) for the checks to run.

## Operations

Deployed from `main` by Vercel; `vercel.json` holds the build and routing config.

The statistics endpoints under `api/` need these production environment variables:

- `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Vercel's Upstash integration), or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` for a database connected directly through Upstash. Use the read-write token — the hourly collector writes.
- `CRON_SECRET` — the same value in both the Vercel production environment and this repository's GitHub Actions secrets, so the hourly `Collect project statistics` workflow can authenticate.
