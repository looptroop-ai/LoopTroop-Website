import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

/**
 * `curl -fsSL https://www.looptroop.ovh/install | sh` is a documented command
 * in the LoopTroop README, and these three redirects are the only thing that
 * makes it work. Nothing else on this site would notice if they were removed,
 * renamed, or pointed somewhere that does not exist — the pages would all still
 * build and every other check would still pass.
 */
const RELEASE_DOWNLOADS = 'https://github.com/looptroop-ai/LoopTroop/releases/latest/download'

const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
const redirects = config.redirects ?? []

function redirectFor(source) {
  return redirects.find((redirect) => redirect.source === source)
}

test('serves the install scripts the documented commands ask for', () => {
  for (const [source, file] of [
    ['/install', 'install.sh'],
    ['/install.sh', 'install.sh'],
    ['/install.ps1', 'install.ps1'],
  ]) {
    const redirect = redirectFor(source)
    assert.ok(redirect, `${source} has no redirect`)
    assert.equal(redirect.destination, `${RELEASE_DOWNLOADS}/${file}`)
  }
})

/**
 * `releases/latest`, never a pinned tag. The installer resolves the version to
 * install by itself, so pinning here would only mean serving an older copy of
 * the script — and one nobody would think to update.
 */
test('follows the latest release rather than a pinned version', () => {
  for (const redirect of redirects) {
    assert.match(redirect.destination, /\/releases\/latest\/download\//)
    assert.doesNotMatch(redirect.destination, /\/download\/v\d/)
  }
})

/**
 * Temporary, not permanent. A 308 is cached by browsers and proxies more or
 * less forever, and this destination is expected to move — to a different host,
 * or to a versioned URL — long before those caches would expire.
 */
test('redirects temporarily, so a moved destination is not cached forever', () => {
  for (const redirect of redirects) {
    assert.equal(redirect.permanent, false, `${redirect.source} would be cached permanently`)
  }
})
