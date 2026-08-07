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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Product bugs and application feature requests belong in the [LoopTroop issue tracker](https://github.com/looptroop-ai/LoopTroop/issues).
