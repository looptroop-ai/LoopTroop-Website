import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CACHE_TTL_MS,
  STALE_CACHE_TTL_MS,
  fetchProjectStats,
  formatProjectCount,
  loadAndRenderProjectStats,
  loadProjectStats,
  normalizeProjectStats,
  writeProjectStatsCache,
} from '../public/project-stats.js'

const stats = {
  schemaVersion: 2,
  updatedAt: '2026-08-16T12:00:00.000Z',
  repository: { stars: 119 },
  downloads: {
    total: 1_075,
    npmRegistry: 522,
    dockerHub: 525,
    github: {
      bundle: 7,
      standalone: 15,
      npmTarball: 6,
      installerScripts: { posix: 67, powershell: 36, total: 103 },
    },
  },
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

function cacheValue(fetchedAt, value = stats) {
  return JSON.stringify({ stats: value, fetchedAt })
}

test('accepts only complete, internally consistent statistics', () => {
  assert.deepEqual(normalizeProjectStats(stats), stats)
  assert.equal(normalizeProjectStats({ ...stats, schemaVersion: 1 }), null, 'a superseded schema is not read')
  assert.equal(normalizeProjectStats({ ...stats, schemaVersion: 3 }), null)
  assert.equal(normalizeProjectStats({ ...stats, repository: {} }), null)
  assert.equal(normalizeProjectStats({
    ...stats,
    downloads: { ...stats.downloads, total: stats.downloads.total + 103 },
  }), null, 'installer fetches must not be folded into the total')
  assert.equal(normalizeProjectStats({
    ...stats,
    downloads: {
      ...stats.downloads,
      github: {
        ...stats.downloads.github,
        installerScripts: { ...stats.downloads.github.installerScripts, total: 0 },
      },
    },
  }), null)
})

test('uses an hour-fresh browser cache without fetching', async () => {
  const now = CACHE_TTL_MS + 1_000
  let fetchCalls = 0
  const result = await loadProjectStats({
    now,
    storage: createStorage({ 'looptroop.project-stats.v1': cacheValue(1_500) }),
    fetchImpl: async () => { fetchCalls += 1 },
  })

  assert.equal(fetchCalls, 0)
  assert.deepEqual(result, { stats, stale: false })
})

test('falls back to a cached value for up to seven days when refresh fails', async () => {
  const now = CACHE_TTL_MS + 10_000
  const result = await loadProjectStats({
    now,
    storage: createStorage({ 'looptroop.project-stats.v1': cacheValue(1) }),
    fetchImpl: async () => { throw new Error('offline') },
  })

  assert.deepEqual(result, { stats, stale: true })
})

test('does not render an expired or malformed cache as zero', async () => {
  const now = STALE_CACHE_TTL_MS + 10_000
  const expired = await loadProjectStats({
    now,
    storage: createStorage({ 'looptroop.project-stats.v1': cacheValue(1) }),
    fetchImpl: async () => ({ ok: false, status: 502 }),
  })
  const malformed = await loadProjectStats({
    now,
    storage: createStorage({
      'looptroop.project-stats.v1': cacheValue(now - 1, {
        ...stats,
        downloads: { ...stats.downloads, npmRegistry: undefined },
      }),
    }),
    fetchImpl: async () => ({ ok: false, status: 502 }),
  })

  assert.equal(expired, null)
  assert.equal(malformed, null)
})

test('fetches project statistics successfully with correct URL and options', async () => {
  let requestedUrl = null
  let requestedOptions = null

  const mockFetch = async (url, options) => {
    requestedUrl = url
    requestedOptions = options
    return {
      ok: true,
      status: 200,
      json: async () => stats,
    }
  }

  const result = await fetchProjectStats(mockFetch)
  assert.equal(requestedUrl, '/api/project-stats')
  assert.deepEqual(requestedOptions, {
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  })
  assert.deepEqual(result, stats)
})

test('throws error when fetch request fails with non-OK HTTP status', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 500,
  })

  await assert.rejects(
    fetchProjectStats(mockFetch),
    {
      name: 'Error',
      message: 'Project statistics request failed with 500',
    },
  )
})

test('throws error when project statistics response has invalid shape', async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ schemaVersion: 1 }),
  })

  await assert.rejects(
    fetchProjectStats(mockFetch),
    {
      name: 'Error',
      message: 'Project statistics response had an invalid shape',
    },
  )
})

test('propagates network errors from fetch implementation', async () => {
  const mockFetch = async () => {
    throw new Error('Network failure')
  }

  await assert.rejects(
    fetchProjectStats(mockFetch),
    {
      name: 'Error',
      message: 'Network failure',
    },
  )
})

test('renders exact localized downloads and stars after a live response', async () => {
  const targets = {
    downloads: [{ textContent: 'Download stats' }],
    stars: [{ textContent: '', hidden: true }],
  }
  const documentRef = {
    querySelectorAll(selector) {
      return selector === '[data-project-downloads]' ? targets.downloads : targets.stars
    },
  }
  const result = await loadAndRenderProjectStats({
    documentRef,
    storage: createStorage(),
    fetchImpl: async () => ({ ok: true, json: async () => stats }),
    now: 1,
  })

  assert.equal(result?.stale, false)
  assert.equal(targets.downloads[0].textContent, `${formatProjectCount(1_075)} downloads`)
  assert.equal(targets.stars[0].textContent, formatProjectCount(119), 'the count carries no separator; it leads the button')
  assert.equal(targets.stars[0].hidden, false)
  assert.equal(formatProjectCount(123_456, 'en-US'), '123,456')
})

test('writes stats payload and timestamp to storage cache', () => {
  const storage = createStorage()
  const customNow = 1_234_567_890

  writeProjectStatsCache(storage, stats, customNow)

  assert.equal(
    storage.getItem('looptroop.project-stats.v1'),
    JSON.stringify({ stats, fetchedAt: customNow }),
  )
})

test('defaults to current timestamp when now parameter is omitted', () => {
  const storage = createStorage()
  const before = Date.now()

  writeProjectStatsCache(storage, stats)

  const after = Date.now()
  const cached = JSON.parse(storage.getItem('looptroop.project-stats.v1') ?? '{}')

  assert.deepEqual(cached.stats, stats)
  assert.ok(typeof cached.fetchedAt === 'number')
  assert.ok(cached.fetchedAt >= before && cached.fetchedAt <= after)
})

test('handles missing storage or storage write errors gracefully', () => {
  assert.doesNotThrow(() => {
    writeProjectStatsCache(null, stats)
  })

  assert.doesNotThrow(() => {
    writeProjectStatsCache(undefined, stats)
  })

  const failingStorage = {
    setItem() {
      throw new Error('QuotaExceededError: Storage limit reached')
    },
  }

  assert.doesNotThrow(() => {
    writeProjectStatsCache(failingStorage, stats)
  })
})

test('writeProjectStatsCache suppresses storage write errors without throwing', async () => {
  const throwingStorage = {
    setItem() {
      throw new Error('QuotaExceededError: Storage unavailable')
    },
  }

  assert.doesNotThrow(() => {
    writeProjectStatsCache(throwingStorage, stats, 1_000)
  })

  assert.doesNotThrow(() => {
    writeProjectStatsCache(null, stats, 1_000)
  })

  const result = await loadProjectStats({
    now: 1_000,
    storage: throwingStorage,
    fetchImpl: async () => ({ ok: true, json: async () => stats }),
  })
  assert.deepEqual(result, { stats, stale: false })
})
