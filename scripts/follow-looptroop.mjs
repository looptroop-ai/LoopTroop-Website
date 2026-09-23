#!/usr/bin/env node
/**
 * Moves the documentation to a newer LoopTroop commit.
 *
 *   node scripts/follow-looptroop.mjs <commit>
 *
 * Three things on this site come from the application source, and all three
 * follow it here: the Node floor the pages state, from `engines.node`;
 * `docs/cli.md`, from `server/cli/cli.ts`; and `CLI_SOURCE_REF`, which records
 * the commit both were read at and which CI verifies the pages against.
 *
 * `.github/workflows/follow-looptroop.yml` runs this once a day against the head
 * of the application's `main`. Its publishing job runs it with a write token and
 * no `npm ci`, so this uses Node built-ins and this repository's scripts only.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { CLI_SOURCE_REF, fetchSourceText, syncCliReference } from './sync-cli-reference.mjs'
import { extractFloorVersion } from './verify-site.mjs'

const PIN_FILE = path.join('scripts', 'sync-cli-reference.mjs')
const PIN_LINE = /^export const CLI_SOURCE_REF = '[0-9a-f]{40}'$/m
const COMMIT = /^[0-9a-f]{40}$/

/**
 * Every way a page states the floor, as the text on either side of the version:
 * "Node 24.18.0+", "**24.18.0+**", "Node `24.18.0`", and "Node 24.18.0 or",
 * which is where a line breaks inside "or newer". A version written any other
 * way is left alone, so it is not taken for the floor by accident, and
 * tests/docs-drift-guards.test.mjs fails if a page states the floor another way.
 */
export const FLOOR_PHRASES = [
  ['Node ', '+'],
  ['**', '+**'],
  ['Node `', '`'],
  ['Node ', ' or'],
]

function fail(message) {
  throw new Error(message)
}

/** The floor written into every phrase that states it, and the Homebrew keg's major. */
export function rewriteFloor(text, from, to) {
  let rewritten = text
  for (const [before, after] of FLOOR_PHRASES) {
    rewritten = rewritten.replaceAll(`${before}${from}${after}`, `${before}${to}${after}`)
  }
  const major = (version) => version.split('.')[0]
  return rewritten.replaceAll(`\`node@${major(from)}\``, `\`node@${major(to)}\``)
}

export function rewritePin(source, commit) {
  if (!COMMIT.test(commit)) fail(`Not a full commit: ${JSON.stringify(commit)}.`)
  if (!PIN_LINE.test(source)) fail(`${PIN_FILE} has no CLI_SOURCE_REF line to move.`)
  return source.replace(PIN_LINE, `export const CLI_SOURCE_REF = '${commit}'`)
}

/** Every page that can state the floor: the Markdown pages under docs/, and the homepage. */
export async function floorPages(root = '.') {
  const docs = (await readdir(path.join(root, 'docs'), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join('docs', entry.name))
  return [...docs.sort(), 'web.html']
}

async function floorAt(ref) {
  const manifest = JSON.parse(await fetchSourceText('package.json', ref))
  return extractFloorVersion(manifest.engines?.node)
}

export async function follow(commit) {
  if (!COMMIT.test(commit)) fail(`Not a full commit: ${JSON.stringify(commit)}.`)
  if (commit === CLI_SOURCE_REF) return `Already following LoopTroop ${commit}.`

  const [from, to] = await Promise.all([floorAt(CLI_SOURCE_REF), floorAt(commit)])
  const moved = []
  if (from !== to) {
    for (const page of await floorPages()) {
      const text = await readFile(page, 'utf8')
      const rewritten = rewriteFloor(text, from, to)
      if (rewritten === text) continue
      await writeFile(page, rewritten)
      moved.push(page)
    }
  }

  await writeFile(PIN_FILE, rewritePin(await readFile(PIN_FILE, 'utf8'), commit))
  const cli = await syncCliReference({ ref: commit })

  return [
    `Following LoopTroop ${commit}, from ${CLI_SOURCE_REF}.`,
    from === to
      ? `The Node floor is still ${to}.`
      : `The Node floor moved from ${from} to ${to}, in ${moved.length > 0 ? moved.join(', ') : 'no page'}.`,
    cli,
  ].join('\n')
}

async function main() {
  try {
    process.stdout.write(`${await follow(process.argv[2] ?? '')}\n`)
  } catch (error) {
    process.stderr.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
