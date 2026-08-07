import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CACHE_TTL_MS,
  loadReleaseVersion,
  normalizeReleaseTag,
  readReleaseCache,
} from '../public/release-version.js'

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

function createDocument() {
  const elements = [{ hidden: true, textContent: '' }, { hidden: true, textContent: '' }]
  return { elements, querySelectorAll: () => elements }
}

test('normalizes stable SemVer release tags', () => {
  assert.equal(normalizeReleaseTag('v1.2.3'), '1.2.3')
  assert.equal(normalizeReleaseTag('1.2.3'), '1.2.3')
  assert.equal(normalizeReleaseTag('release-1.2.3'), null)
  assert.equal(normalizeReleaseTag(undefined), null)
})

test('uses a fresh cached release without fetching', async () => {
  const now = 10_000
  const storage = createStorage({
    'looptroop.latest-release': JSON.stringify({ version: '0.4.1', fetchedAt: now - 100 }),
  })
  const documentRef = createDocument()
  let fetchCalls = 0
  const version = await loadReleaseVersion({
    documentRef,
    storage,
    now,
    fetchImpl: async () => { fetchCalls += 1 },
  })

  assert.equal(version, '0.4.1')
  assert.equal(fetchCalls, 0)
  assert.deepEqual(documentRef.elements.map((element) => element.textContent), [' · v0.4.1', ' · v0.4.1'])
})

test('refreshes an expired cache from the latest GitHub release', async () => {
  const now = CACHE_TTL_MS + 100
  const storage = createStorage({
    'looptroop.latest-release': JSON.stringify({ version: '0.4.1', fetchedAt: 0 }),
  })
  const documentRef = createDocument()
  const version = await loadReleaseVersion({
    documentRef,
    storage,
    now,
    fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: 'v0.5.0' }) }),
  })

  assert.equal(version, '0.5.0')
  assert.equal(readReleaseCache(storage, now)?.version, '0.5.0')
  assert.deepEqual(documentRef.elements.map((element) => element.textContent), [' · v0.5.0', ' · v0.5.0'])
})

test('keeps a stale cache when GitHub is unavailable', async () => {
  const now = CACHE_TTL_MS + 100
  const storage = createStorage({
    'looptroop.latest-release': JSON.stringify({ version: '0.4.1', fetchedAt: 0 }),
  })
  const documentRef = createDocument()
  const version = await loadReleaseVersion({
    documentRef,
    storage,
    now,
    fetchImpl: async () => { throw new Error('offline') },
  })

  assert.equal(version, '0.4.1')
  assert.equal(documentRef.elements[0].textContent, ' · v0.4.1')
})

test('leaves the version hidden when no valid source is available', async () => {
  const documentRef = createDocument()
  const version = await loadReleaseVersion({
    documentRef,
    storage: createStorage(),
    fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: 'latest' }) }),
  })

  assert.equal(version, null)
  assert.equal(documentRef.elements[0].hidden, true)
})
