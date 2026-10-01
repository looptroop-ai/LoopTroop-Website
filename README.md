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

The CLI reference in `docs/cli.md`, the minimum Node version, and install-command checks use the application commit pinned by `CLI_SOURCE_REF`. It can point to an in-progress application change; docs stay current without waiting for a merge or release. The *Follow LoopTroop main* workflow checks `main` daily and publishes when the CLI reference or Node prerequisites change. To update sooner after changes reach `main`, run it from the Actions tab.

Renew `public/.well-known/security.txt` manually before it expires. Confirm that its GitHub reporting link and published policy URL are still correct, then set `Expires` to 364 days ahead. Run `node --test tests/security-metadata.test.mjs` to check the fields, expiry window, and Vercel headers.

Before opening a pull request, see [CONTRIBUTING.md](CONTRIBUTING.md) for the checks to run.
