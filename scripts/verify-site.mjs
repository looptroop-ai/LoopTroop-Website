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
]

for (const file of requiredFiles) await access(file)

const indexHtml = await readFile('site/index.html', 'utf8')
if (indexHtml.includes('{{VERSION}}')) throw new Error('Marketing output still contains a build-time version placeholder.')
if (!indexHtml.includes('data-release-version')) throw new Error('Marketing output is missing release-version targets.')
if (!indexHtml.includes('/release-version.js')) throw new Error('Marketing output is missing the GitHub release client.')

const sitemap = await readFile('site/sitemap.xml', 'utf8')
for (const url of ['https://www.looptroop.ovh/', 'https://www.looptroop.ovh/docs/', 'https://www.looptroop.ovh/docs/changelog']) {
  if (!sitemap.includes(url)) throw new Error(`Sitemap is missing ${url}.`)
}

console.log(`PASS: verified ${requiredFiles.length} required site outputs and public metadata.`)
