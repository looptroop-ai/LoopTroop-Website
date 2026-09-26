import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('security.txt contact, policy, expiry, and response headers are current', async () => {
  const [securityTxt, vercelJson] = await Promise.all([
    readFile(new URL('../public/.well-known/security.txt', import.meta.url), 'utf8'),
    readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
  ])
  const lines = securityTxt.trim().split(/\r?\n/)
  const fields = Object.fromEntries(lines.map((line) => {
    const separator = line.indexOf(': ')
    assert.ok(separator > 0, `invalid security.txt field: ${line}`)
    return [line.slice(0, separator), line.slice(separator + 2)]
  }))

  assert.deepEqual(Object.keys(fields), [
    'Contact',
    'Policy',
    'Canonical',
    'Expires',
    'Preferred-Languages',
  ])
  assert.equal(fields.Contact, 'https://github.com/looptroop-ai/LoopTroop/security/advisories/new')
  assert.equal(fields.Policy, 'https://www.looptroop.ovh/docs/operations#vulnerability-disclosure')
  assert.equal(fields.Canonical, 'https://www.looptroop.ovh/.well-known/security.txt')
  assert.equal(fields['Preferred-Languages'], 'en')

  const expiresAt = Date.parse(fields.Expires)
  assert.ok(Number.isFinite(expiresAt), 'Expires must be a valid timestamp')
  assert.match(fields.Expires, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  assert.equal(new Date(expiresAt).toISOString().replace('.000Z', 'Z'), fields.Expires, 'Expires must be a valid UTC timestamp')
  const remaining = expiresAt - Date.now()
  assert.ok(remaining > 30 * 24 * 60 * 60 * 1000, 'Expires must be more than 30 days away')
  assert.ok(remaining < 365 * 24 * 60 * 60 * 1000, 'Expires must be less than one year away')

  const config = JSON.parse(vercelJson)
  const responseHeaders = config.headers.find((entry) => entry.source === '/.well-known/security.txt')?.headers
  assert.ok(responseHeaders, 'Vercel must configure headers for security.txt')
  assert.equal(responseHeaders.find((header) => header.key === 'Content-Type')?.value, 'text/plain; charset=utf-8')
  const cacheControl = responseHeaders.find((header) => header.key === 'Cache-Control')?.value
  assert.match(cacheControl ?? '', /^public, max-age=(\d+)$/)
  assert.ok(Number(cacheControl.match(/max-age=(\d+)/)[1]) <= 3600, 'security.txt should have a short cache lifetime')
})
