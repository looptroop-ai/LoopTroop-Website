import { access, readFile } from 'node:fs/promises'

const requiredFiles = [
  'site/index.html',
  'site/release-version.js',
  'site/robots.txt',
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

for (const file of requiredFiles) await access(file)

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
const gettingStarted = (await readFile('site/docs/getting-started.html', 'utf8'))
  .replace(/<[^>]+>/g, '')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')

// Both the default channel and npm. The install block is a tab group, and every
// panel is rendered into the HTML whether or not it is the visible one — so
// this asserts the commands are on the page, not which tab happens to be open.
// Checking only npm would let the curl default disappear silently; checking
// only curl would let the tab group lose every other channel.
const installCommands = {
  'the one-line installer': 'curl -fsSL https://www.looptroop.ovh/install',
  npm: 'npm install -g looptroop',
}

let installedAt = Infinity
for (const [channel, command] of Object.entries(installCommands)) {
  const at = gettingStarted.indexOf(command)
  if (at === -1) throw new Error(`Getting Started never shows how to install LoopTroop with ${channel}.`)
  installedAt = Math.min(installedAt, at)
}

const devStackAt = gettingStarted.indexOf('npm run dev')
if (devStackAt !== -1 && devStackAt < installedAt) {
  throw new Error('Getting Started leads with the development stack instead of installing LoopTroop.')
}

const indexHtml = await readFile('site/index.html', 'utf8')
if (indexHtml.includes('{{VERSION}}')) throw new Error('Marketing output still contains a build-time version placeholder.')
if (!indexHtml.includes('data-release-version')) throw new Error('Marketing output is missing release-version targets.')
if (!indexHtml.includes('/release-version.js')) throw new Error('Marketing output is missing the GitHub release client.')

const sitemap = await readFile('site/sitemap.xml', 'utf8')
for (const url of ['https://www.looptroop.ovh/', 'https://www.looptroop.ovh/docs/', 'https://www.looptroop.ovh/docs/changelog']) {
  if (!sitemap.includes(url)) throw new Error(`Sitemap is missing ${url}.`)
}

console.log(`PASS: verified ${requiredFiles.length} required site outputs and public metadata.`)
