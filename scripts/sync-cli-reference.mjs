#!/usr/bin/env node
/**
 * Keeps the CLI reference page equal to the text the CLI actually prints.
 *
 *   node scripts/sync-cli-reference.mjs           # rewrite docs/cli.md
 *   node scripts/sync-cli-reference.mjs --check   # fail if it has drifted
 *
 * The commands and options in `docs/cli.md` are not transcribed by hand. They
 * are the `USAGE` string from `server/cli/cli.ts` in the application repository,
 * read at the latest merged application commit over HTTPS — a public repo, so no
 * token — and substituted into the fenced block below the marker.
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
import { pathToFileURL } from 'node:url'

/**
 * The latest merged application revision the documentation describes — an
 * immutable ref, never a moving branch name.
 *
 * Update this to the latest application `main` commit whenever CLI behavior
 * changes, including before a release tag, so published docs stay current.
 */
export const CLI_SOURCE_REF = '10888081de5a4ac46af30810ede613b56d83fda4'

const PAGE = path.join(process.cwd(), 'docs', 'cli.md')
const MARKER = '<!-- generated from server/cli/cli.ts; run npm run sync:cli -->'
const GENERATED_BLOCK_PATTERN = new RegExp(
  `${MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\n\`\`\`text\\n[\\s\\S]*?\\n\`\`\``,
)

export function sourceUrl(relativePath) {
  return `https://raw.githubusercontent.com/looptroop-ai/LoopTroop/${CLI_SOURCE_REF}/${relativePath}`
}

function fail(message) {
  throw new Error(message)
}

/**
 * The `USAGE` template literal, with or without `export` — older revisions did
 * not export it, and those revisions must still work when selected explicitly.
 */
export async function fetchSourceText(relativePath) {
  let source
  try {
    const url = sourceUrl(relativePath)
    const response = await fetch(url)
    if (!response.ok) fail(`${url} answered ${response.status}.`)
    source = await response.text()
  } catch (error) {
    fail(`Could not read ${sourceUrl(relativePath)}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return source
}

export function extractUsage(cliSource) {
  const match = cliSource.match(/(?:export )?const USAGE = `([\s\S]*?)`\n/)
  if (match === null) fail(`No USAGE template literal in cli.ts at ${CLI_SOURCE_REF}.`)
  // Backticks are the only thing a template literal escapes that a fenced code
  // block does not, so unescaping them is the whole conversion.
  return match[1].replace(/\\`/g, '`').trimEnd()
}

export async function readUsage() {
  return extractUsage(await fetchSourceText('server/cli/cli.ts'))
}

export function rewriteCliPage(page, usage) {
  if (!page.includes(MARKER)) fail(`${PAGE} is missing the generated-block marker.`)

  const block = `${MARKER}\n\n\`\`\`text\n${usage}\n\`\`\``
  return page.replace(GENERATED_BLOCK_PATTERN, () => block)
}

export async function syncCliReference({ check = false } = {}) {
  const usage = await readUsage()

  let page
  try {
    page = await readFile(PAGE, 'utf8')
  } catch {
    fail(`${PAGE} does not exist.`)
  }

  const rewritten = rewriteCliPage(page, usage)

  if (rewritten === page) return `PASS: docs/cli.md matches cli.ts at ${CLI_SOURCE_REF}.`

  if (check) {
    fail(
      `docs/cli.md has drifted from cli.ts at ${CLI_SOURCE_REF}.\n`
      + '       Run `npm run sync:cli` and commit the result.',
    )
  }

  await writeFile(PAGE, rewritten)
  return `Rewrote docs/cli.md from cli.ts at ${CLI_SOURCE_REF}.`
}

async function main() {
  try {
    const message = await syncCliReference({ check: process.argv.includes('--check') })
    process.stdout.write(`${message}\n`)
  } catch (error) {
    process.stderr.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
