#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { CLI_SOURCE_REF, fetchSourceText } from './sync-cli-reference.mjs'

const requiredFiles = [
  'site/index.html',
  'site/project-stats.js',
  'site/project-stats-history.js',
  'site/release-version.js',
  'site/robots.txt',
  'site/.well-known/security.txt',
  'site/sitemap.xml',
  'site/og-image.png',
  'site/fonts/inter-latin.woff2',
  'site/media/projects.webp',
  'site/media/20260619104032-26sec-captions.gif',
  'site/docs/index.html',
  'site/docs/changelog.html',
  'site/docs/roadmap.html',
  'site/docs/installation.html',
  'site/docs/cli.html',
]

const API_ROUTE_ROW = /^\| `([A-Z]+)` \| `([^`]+)` \| ?(.*)$/gm
const SSE_EVENT_ROW = /^\| `([^`]+)` \| /gm
const RESERVED_ROUTE_ROW = /\b(?:deprecated|tombstone)\b/i
const INTERNAL_PR_LABEL = /\bPR\d+\b(?:\s*\(unreleased\))?/g
const RELEASE_MARKER = /<!--\s*release[- ]marker\b[^>]*-->/gi
const FUTURE_RELEASE_LANGUAGE = /\b(?:next|upcoming)\s+release\b|\bnext-release\b|\bcurrently published (?:release|client)\b/gi
const SOURCE_REPO_ROOT = path.resolve(
  process.env.LOOPTROOP_SOURCE_ROOT || path.resolve(process.cwd(), '..', 'LoopTroop'),
)
const SOURCE_PACKAGE_JSON = path.join(SOURCE_REPO_ROOT, 'package.json')
const INSTALL_CATALOG_SCRIPT = path.join(SOURCE_REPO_ROOT, 'scripts', 'docs-install-catalog.mjs')

function fail(message) {
  throw new Error(message)
}

export function decodeHtmlText(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

export function extractFloorVersion(spec) {
  const match = /^\s*(?:>=\s*)?v?(\d+\.\d+\.\d+)\s*$/.exec(String(spec))
  if (match === null) fail(`Unreadable version floor: ${JSON.stringify(spec)}.`)
  return match[1]
}

export function compareSemverTriples(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    const diff = leftParts[index] - rightParts[index]
    if (diff !== 0) return diff
  }
  return 0
}

export function findDocumentedPrerequisiteVersions(markdown, tool) {
  const matcher = new RegExp(`\\b${tool}\\s+(\\d+\\.\\d+\\.\\d+)\\+`, 'gi')
  return [...markdown.matchAll(matcher)].map((match) => match[1])
}

/**
 * A floor the CLI does not declare must not be documented either. The CLI
 * declares no npm floor: it has no install scripts, so the npm that came with
 * the reader's Node is the one it needs, and every npm version this page ever
 * named was one no Node release bundled. A page still naming one would be
 * telling readers to go and install something before they can start.
 */
export function assertDocumentedPrerequisiteFloors(markdown, packageManifest, page = 'Getting Started') {
  for (const tool of ['node', 'npm']) {
    const declared = packageManifest.engines?.[tool]
    const label = tool === 'node' ? 'Node' : 'npm'
    const documented = findDocumentedPrerequisiteVersions(markdown, label)

    if (declared === undefined) {
      if (documented.length > 0) {
        fail(`${page} documents ${label} ${documented[0]}+ while the CLI declares no ${label} floor.`)
      }
      continue
    }

    const floor = extractFloorVersion(declared)
    if (documented.length === 0) fail(`${page} documents no ${label} prerequisite versions.`)

    for (const version of documented) {
      if (compareSemverTriples(version, floor) < 0) {
        fail(`${page} documents ${label} ${version}+ below the CLI floor ${floor}.`)
      }
    }
  }
}

export function parseDocumentedApiRoutes(markdown) {
  return [...markdown.matchAll(API_ROUTE_ROW)].map((match) => ({
    method: match[1],
    route: match[2].replace(/\?.*/, ''),
    notes: match[3] ?? '',
  }))
}

export function auditApiRouteCoverage(liveRoutes, documentedRoutes) {
  const documentedLiveSet = new Set()
  const unexpectedRows = []

  for (const row of documentedRoutes) {
    const key = `${row.method} ${row.route}`
    if (liveRoutes.includes(key)) {
      documentedLiveSet.add(key)
      continue
    }

    if (!RESERVED_ROUTE_ROW.test(row.notes)) unexpectedRows.push(key)
  }

  return {
    missing: liveRoutes.filter((route) => !documentedLiveSet.has(route)),
    unexpected: unexpectedRows.sort(),
  }
}

export function parseDocumentedSseEvents(markdown) {
  const tableMatch = markdown.match(
    /\| Event type \| When emitted \| Key payload fields \|\n\| --- \| --- \| --- \|\n((?:\| `[^`]+` \| .*\n)+)/,
  )
  const reservedMatch = markdown.match(/also declares ([^.\n]+), but no broadcaster call site emits them today/)

  return {
    documented: tableMatch === null ? [] : [...tableMatch[1].matchAll(SSE_EVENT_ROW)].map((match) => match[1]),
    reserved: reservedMatch === null
      ? []
      : [...reservedMatch[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]),
  }
}

export function auditSseEventCoverage({ liveEvents, documentedEvents, reservedEvents }) {
  const documentedSet = new Set(documentedEvents)
  const reservedSet = new Set(reservedEvents)
  const missing = []

  for (const event of liveEvents) {
    if (documentedSet.has(event)) continue
    if (!reservedSet.has(event)) missing.push(event)
  }

  const unexpected = documentedEvents.filter((event) => !liveEvents.includes(event) && !reservedSet.has(event))

  return { missing, unexpected: [...new Set(unexpected)].sort() }
}

export function findReleaseLeakage(markdown) {
  const findings = []
  for (const match of markdown.matchAll(INTERNAL_PR_LABEL)) findings.push(match[0])
  for (const match of markdown.matchAll(RELEASE_MARKER)) findings.push(match[0])
  return [...new Set(findings)].sort()
}

export function findFutureReleaseLanguage(markdown) {
  return [...new Set([...markdown.matchAll(FUTURE_RELEASE_LANGUAGE)].map(([match]) => match))].sort()
}

async function pathExists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function readInstallCatalog() {
  if (!await pathExists(INSTALL_CATALOG_SCRIPT)) {
    fail(
      `Install catalog missing at ${INSTALL_CATALOG_SCRIPT}. `
      + `Check out LoopTroop at the immutable source ref ${CLI_SOURCE_REF}.`,
    )
  }

  try {
    return JSON.parse(execFileSync(process.execPath, [INSTALL_CATALOG_SCRIPT], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30_000,
    }))
  } catch (error) {
    fail(`Could not read install catalog from ${INSTALL_CATALOG_SCRIPT}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function readSourcePackageManifest() {
  if (await pathExists(SOURCE_PACKAGE_JSON)) {
    return JSON.parse(await readFile(SOURCE_PACKAGE_JSON, 'utf8'))
  }

  return JSON.parse(await fetchSourceText('package.json'))
}

async function verifyLandingInstallOrder() {
  /**
   * The regression that made a whole phase of work necessary.
   *
   * For four releases LoopTroop installed from seven channels and ran as a
   * background service, and every page of the published documentation still opened
   * with `git clone` and `npm run dev`. Nothing was wrong with the docs as
   * development docs; they had simply never been told the product had shipped.
   *
   * `npm run dev` is deliberately not banned — it is the correct instruction on the
   * pages about working on LoopTroop itself. What must stay true is that the page
   * people arrive at leads with installing it.
   */
  // Against the rendered text, never the markup: syntax highlighting splits a
  // shell command across a span per token, so searching the HTML for the command
  // finds nothing even when the page shows it.
  const [gettingStarted, installCatalog] = await Promise.all([
    readFile('site/docs/getting-started.html', 'utf8').then(decodeHtmlText),
    readInstallCatalog(),
  ])

  // Both the default channel and npm. The install block is a tab group, and every
  // panel is rendered into the HTML whether or not it is the visible one — so
  // this asserts the commands are on the page, not which tab happens to be open.
  // Checking only npm would let the curl default disappear silently; checking
  // only curl would let the tab group lose every other channel.
  const requiredChannels = [
    ['installer-sh', 'the one-line installer'],
    ['npm', 'npm'],
  ]

  let installedAt = Infinity
  for (const [channelId, label] of requiredChannels) {
    const channel = installCatalog.channels.find((entry) => entry.id === channelId && entry.live)
    if (!channel) fail(`Install catalog does not provide the live ${channelId} channel.`)
    // Transport restrictions work with the released installer too; do not
    // advance the immutable CLI source pin just to strengthen its download.
    const command = channel.documentedInstall
    const at = gettingStarted.indexOf(command)
    if (at === -1) throw new Error(`Getting Started never shows how to install LoopTroop with ${label}.`)
    installedAt = Math.min(installedAt, at)
  }

  const devStackAt = gettingStarted.indexOf('npm run dev')
  if (devStackAt !== -1 && devStackAt < installedAt) {
    throw new Error('Getting Started leads with the development stack instead of installing LoopTroop.')
  }
}

/**
 * Both pages a reader decides from. The homepage states prerequisites on every
 * install tab, and it was the one this check never read — so it went on
 * advertising a Node release and an npm version the CLI no longer asked for,
 * while Getting Started beside it had been corrected and passed.
 */
async function verifyLandingPrerequisiteFloors() {
  const [gettingStartedMarkdown, landingPage, sourcePackageManifest] = await Promise.all([
    readFile('docs/getting-started.md', 'utf8'),
    readFile('web.html', 'utf8'),
    readSourcePackageManifest(),
  ])

  assertDocumentedPrerequisiteFloors(gettingStartedMarkdown, sourcePackageManifest)
  assertDocumentedPrerequisiteFloors(landingPage, sourcePackageManifest, 'The homepage')
}

async function verifyDocumentationIsLive() {
  const files = (await readdir('docs', { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  const findings = []

  for (const file of files) {
    const language = findFutureReleaseLanguage(await readFile(path.join('docs', file.name), 'utf8'))
    for (const phrase of language) findings.push(`${file.name}: ${phrase}`)
  }

  if (findings.length > 0) {
    fail(`Published documentation contains forward-looking release wording: ${findings.join(', ')}`)
  }
}

/**
 * Every channel whose publish joins somebody else's queue says so on the page.
 *
 * Chocolatey and WinGet install the previous release for a few days after each
 * release, because a human reviews every submission. That is a promise about
 * how LoopTroop publishes, and the source repository states it in the install
 * catalog — so the page is checked against that rather than against a list kept
 * by hand here, which is how those two channels stayed marked as unavailable
 * for weeks after they went live.
 *
 * The catalog comes from the pinned source ref, so this checks nothing until a
 * release carries the field. That is the right way round: the page is verified
 * against the version people can install, not against an unreleased contract.
 */
async function verifyModeratedChannelsAreExplained() {
  const [installation, catalog] = await Promise.all([
    readFile('site/docs/installation.html', 'utf8').then(decodeHtmlText),
    readInstallCatalog(),
  ])

  for (const channel of catalog.channels) {
    if (!channel.live || !channel.moderated) continue
    if (!installation.includes(channel.documentedInstall)) {
      fail(`The installation page never shows ${channel.documentedInstall}, which the catalog lists as a live channel.`)
    }
    // The wording is the page's to choose; what it must not do is present a
    // moderated channel as though it published like every other one.
    if (!/arrives? later|reviews? every version|days after/i.test(installation)) {
      fail(`The installation page does not say that ${channel.id} reaches its feed later than the other channels.`)
    }
  }
}

export async function verifySite() {
  await Promise.all(requiredFiles.map((file) => access(file)))
  await verifyDocumentationIsLive()
  await verifyLandingInstallOrder()
  await verifyLandingPrerequisiteFloors()
  await verifyModeratedChannelsAreExplained()

  const [sourceSecurityTxt, builtSecurityTxt] = await Promise.all([
    readFile('public/.well-known/security.txt', 'utf8'),
    readFile('site/.well-known/security.txt', 'utf8'),
  ])
  if (sourceSecurityTxt !== builtSecurityTxt) {
    throw new Error('The built security.txt does not match public/.well-known/security.txt.')
  }

  const operationsHtml = await readFile('site/docs/operations.html', 'utf8')
  if (!operationsHtml.includes('id="vulnerability-disclosure"')) {
    throw new Error('Operations Guide output is missing the vulnerability-disclosure anchor.')
  }

  const indexHtml = await readFile('site/index.html', 'utf8')
  if (indexHtml.includes('{{VERSION}}')) throw new Error('Marketing output still contains a build-time version placeholder.')
  if (!indexHtml.includes('data-release-version')) throw new Error('Marketing output is missing release-version targets.')
  if (!indexHtml.includes('/release-version.js')) throw new Error('Marketing output is missing the GitHub release client.')
  if (!indexHtml.includes('/project-stats.js')) throw new Error('Marketing output is missing the project-statistics client.')
  if (!indexHtml.includes('data-project-downloads')) throw new Error('Marketing output is missing the download counter target.')
  if (!indexHtml.includes('data-project-stars')) throw new Error('Marketing output is missing the GitHub star counter target.')
  if (!indexHtml.includes('/docs/installation#download-statistics')) {
    throw new Error('The marketing download counter does not link to its installation-page breakdown.')
  }

  await access('api/project-stats.js')

  const installationHtml = await readFile('site/docs/installation.html', 'utf8')
  if (!installationHtml.includes('id="download-statistics"')) {
    throw new Error('Installation output is missing the download-statistics anchor.')
  }
  if (!installationHtml.includes('project-stats')) {
    throw new Error('Installation output is missing the project-statistics component.')
  }
  if (!installationHtml.includes('id="download-history"')) {
    throw new Error('Installation output is missing the download-history subsection.')
  }
  if (!installationHtml.includes('download-history__controls')) {
    throw new Error('Installation output is missing the interactive download-history component.')
  }

  const sitemap = await readFile('site/sitemap.xml', 'utf8')
  for (const url of ['https://www.looptroop.ovh/', 'https://www.looptroop.ovh/docs/', 'https://www.looptroop.ovh/docs/changelog']) {
    if (!sitemap.includes(url)) throw new Error(`Sitemap is missing ${url}.`)
  }

  return `PASS: verified ${requiredFiles.length} required site outputs, security metadata, and landing prerequisite floors.`
}

async function main() {
  try {
    const message = await verifySite()
    console.log(message)
  } catch (error) {
    process.stderr.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
