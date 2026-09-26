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

A few things here come from the application and follow it on their own: the CLI reference in `docs/cli.md`, the minimum Node version the pages state, and `CLI_SOURCE_REF`, the application commit the pages are checked against. The *Follow LoopTroop main* workflow updates all three once a day. To update them sooner, run it from the Actions tab.

Renew `public/.well-known/security.txt` manually before it expires. Confirm that its GitHub reporting link and published policy URL are still correct, then set `Expires` to 364 days ahead. Run `node --test tests/security-metadata.test.mjs` to check the fields, expiry window, and Vercel headers.

Before opening a pull request, see [CONTRIBUTING.md](CONTRIBUTING.md) for the checks to run.
