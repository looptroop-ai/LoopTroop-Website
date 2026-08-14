#!/usr/bin/env node
/**
 * Keeps the CLI reference page equal to the text the CLI actually prints.
 *
 *   node scripts/sync-cli-reference.mjs           # rewrite docs/cli.md
 *   node scripts/sync-cli-reference.mjs --check   # fail if it has drifted
 *
 * The commands and options in `docs/cli.md` are not transcribed by hand. They
 * are the `USAGE` string from `server/cli/cli.ts` in the application repository,
 * read at a pinned release tag over HTTPS — a public repo, so no token — and
 * substituted into the fenced block below the marker.
 *
 * `--check` is the point. A generator nobody remembers to run is a hand
 * transcription with extra steps: the page drifts and the build stays green. It
 * runs as part of `npm run verify:site`, which is what CI runs.
 *
 * The application repository has the same arrangement between
 * `scripts/installer-core.mjs` and the two installer wrappers it is copied into,
 * and that single-source has never drifted, because the check fails the build.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * The release the documentation describes — a tag, never a branch.
 *
 * The published docs describe the version people can install, so this moves when
 * a release ships, not when `main` changes. Bumping it is part of the release
 * checklist; running this script without `--check` is the other part.
 */
const CLI_SOURCE_REF = 'v0.5.4'

const SOURCE_URL = `https://raw.githubusercontent.com/looptroop-ai/LoopTroop/${CLI_SOURCE_REF}/server/cli/cli.ts`
const PAGE = path.join(process.cwd(), 'docs', 'cli.md')
const MARKER = '<!-- generated from server/cli/cli.ts; run npm run sync:cli -->'

const check = process.argv.includes('--check')

function fail(message) {
  process.stderr.write(`FAIL: ${message}\n`)
  process.exit(1)
}

/**
 * The `USAGE` template literal, with or without `export` — releases before the
 * page existed did not export it, and pinning to one of those must still work.
 */
async function readUsage() {
  let source
  try {
    const response = await fetch(SOURCE_URL)
    if (!response.ok) fail(`${SOURCE_URL} answered ${response.status}.`)
    source = await response.text()
  } catch (error) {
    fail(`Could not read ${SOURCE_URL}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const match = source.match(/(?:export )?const USAGE = `([\s\S]*?)`\n/)
  if (match === null) fail(`No USAGE template literal in cli.ts at ${CLI_SOURCE_REF}.`)
  // Backticks are the only thing a template literal escapes that a fenced code
  // block does not, so unescaping them is the whole conversion.
  return match[1].replace(/\\`/g, '`').trimEnd()
}

const usage = await readUsage()

let page
try {
  page = await readFile(PAGE, 'utf8')
} catch {
  fail(`${PAGE} does not exist.`)
}

if (!page.includes(MARKER)) fail(`${PAGE} is missing the generated-block marker.`)

const block = `${MARKER}\n\n\`\`\`text\n${usage}\n\`\`\``
const rewritten = page.replace(
  new RegExp(`${MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\n\`\`\`text\\n[\\s\\S]*?\\n\`\`\``),
  () => block,
)

if (rewritten === page) {
  process.stdout.write(`PASS: docs/cli.md matches cli.ts at ${CLI_SOURCE_REF}.\n`)
  process.exit(0)
}

if (check) {
  fail(
    `docs/cli.md has drifted from cli.ts at ${CLI_SOURCE_REF}.\n`
    + '       Run `npm run sync:cli` and commit the result.',
  )
}

await writeFile(PAGE, rewritten)
process.stdout.write(`Rewrote docs/cli.md from cli.ts at ${CLI_SOURCE_REF}.\n`)
