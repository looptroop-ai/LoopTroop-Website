import assert from 'node:assert/strict'
import test from 'node:test'
import handler, {
  ERROR_CACHE_CONTROL,
  UPSTREAM_ERROR_CACHE_CONTROL,
  GITHUB_PAGE_SIZE,
  SUCCESS_CACHE_CONTROL,
  aggregateGithubReleaseDownloads,
  buildNpmDownloadWindows,
  buildProjectStats,
  classifyReleaseAsset,
  collectProjectStats,
  fetchGithubReleaseDownloads,
  fetchJson,
} from '../api/project-stats.js'

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload }
}

function asset(name, downloadCount) {
  return { name, download_count: downloadCount }
}

function release(assets, overrides = {}) {
  return { draft: false, prerelease: false, assets, ...overrides }
}

function createResponse() {
  const headers = new Map()
  return {
    statusCode: null,
    body: null,
    setHeader(name, value) { headers.set(name.toLowerCase(), value) },
    getHeader(name) { return headers.get(name.toLowerCase()) },
    end(body) { this.body = body },
  }
}

test('classifies only current release artifacts', () => {
  assert.equal(classifyReleaseAsset('looptroop-1.2.3-bundle.tar.gz'), 'bundle')
  assert.equal(classifyReleaseAsset('looptroop-1.2.3-linux-x64.tar.gz'), 'standalone')
  assert.equal(classifyReleaseAsset('looptroop-1.2.3-linux-arm64.tar.gz'), 'standalone')
  assert.equal(classifyReleaseAsset('looptroop-1.2.3-darwin-arm64.tar.gz'), 'standalone')
  assert.equal(classifyReleaseAsset('looptroop-1.2.3-win-x64.zip'), 'standalone')
  assert.equal(classifyReleaseAsset('install.sh'), 'installer-posix')
  assert.equal(classifyReleaseAsset('install.ps1'), 'installer-powershell')

  assert.equal(classifyReleaseAsset('looptroop-1.2.3.tgz'), 'npm-tarball')

  // The bundle ZIP was removed from releases; nothing should resurrect it.
  assert.equal(classifyReleaseAsset('looptroop-1.2.3-bundle.zip'), null)
  assert.equal(classifyReleaseAsset('looptroop-1.2.3-linux-x64.tar.gz.sha256'), null)
  assert.equal(classifyReleaseAsset('release-manifest.json'), null)
  assert.equal(classifyReleaseAsset('INSTALL.SH'), null)
})

test('aggregates stable releases while excluding drafts and prereleases', () => {
  const result = aggregateGithubReleaseDownloads([
    release([
      asset('looptroop-1.0.0-bundle.tar.gz', 10),
      asset('looptroop-1.0.0-linux-x64.tar.gz', 2),
      asset('looptroop-1.0.0-linux-arm64.tar.gz', 3),
      asset('looptroop-1.0.0-darwin-arm64.tar.gz', 4),
      asset('looptroop-1.0.0-win-x64.zip', 5),
      asset('install.sh', 6),
      asset('install.ps1', 7),
      asset('looptroop-1.0.0.tgz', 1_000),
      asset('checksums.txt', 1_000),
    ]),
    release([asset('looptroop-1.1.0-bundle.tar.gz', 100)], { prerelease: true }),
    release([asset('looptroop-1.2.0-bundle.tar.gz', 100)], { draft: true }),
  ])

  assert.deepEqual(result, {
    bundle: 10,
    standalone: 14,
    npmTarball: 1_000,
    installerScripts: { posix: 6, powershell: 7, total: 13 },
  })
})

test('follows GitHub release pagination until a short page', async () => {
  const firstPage = Array.from({ length: GITHUB_PAGE_SIZE }, () => release([]))
  const urls = []
  const result = await fetchGithubReleaseDownloads(async (url) => {
    urls.push(url)
    if (url.endsWith('page=1')) return jsonResponse(firstPage)
    return jsonResponse([release([asset('looptroop-1.0.0-bundle.tar.gz', 9)])])
  })

  assert.equal(result.bundle, 9)
  assert.equal(urls.length, 2)
  assert.match(urls[0], /per_page=100&page=1$/)
  assert.match(urls[1], /per_page=100&page=2$/)
})

test('builds non-overlapping npm windows of at most 365 inclusive days', () => {
  assert.deepEqual(
    buildNpmDownloadWindows('2024-01-01T19:00:00.000Z', new Date('2026-01-01T07:00:00.000Z')),
    [
      { start: '2024-01-01', end: '2024-12-30' },
      { start: '2024-12-31', end: '2025-12-30' },
      { start: '2025-12-31', end: '2026-01-01' },
    ],
  )
})

test('deduplicated total excludes both installer script counters', () => {
  const result = buildProjectStats({
    stars: 119,
    npmRegistry: 100,
    dockerHub: 200,
    github: {
      bundle: 30,
      standalone: 40,
      npmTarball: 50,
      installerScripts: { posix: 9_000, powershell: 8_000, total: 999_999 },
    },
    updatedAt: new Date('2026-08-16T12:34:56.000Z'),
  })

  assert.equal(result.downloads.total, 420)
  assert.deepEqual(result.downloads.github.installerScripts, {
    posix: 9_000,
    powershell: 8_000,
    total: 17_000,
  })
})

test('collects the complete response schema from all public APIs', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.endsWith('/repos/looptroop-ai/LoopTroop')) {
      return jsonResponse({ stargazers_count: 12 })
    }
    if (url.includes('/releases?')) {
      return jsonResponse([release([
        asset('looptroop-0.5.0-bundle.tar.gz', 3),
        asset('looptroop-0.5.0-win-x64.zip', 4),
        asset('looptroop-0.5.0.tgz', 7),
        asset('install.sh', 5),
        asset('install.ps1', 6),
      ])])
    }
    if (url === 'https://registry.npmjs.org/looptroop') {
      return jsonResponse({ time: { created: '2026-08-01T00:00:00.000Z' } })
    }
    if (url.includes('api.npmjs.org/downloads/point')) {
      return jsonResponse({ downloads: 20 })
    }
    if (url.includes('hub.docker.com')) return jsonResponse({ pull_count: 30 })
    throw new Error(`Unexpected URL: ${url}`)
  }

  const result = await collectProjectStats({
    fetchImpl,
    now: new Date('2026-08-16T12:34:56.000Z'),
  })

  assert.deepEqual(result, {
    schemaVersion: 2,
    updatedAt: '2026-08-16T12:34:56.000Z',
    repository: { stars: 12 },
    downloads: {
      total: 64,
      npmRegistry: 20,
      dockerHub: 30,
      github: {
        bundle: 3,
        standalone: 4,
        npmTarball: 7,
        installerScripts: { posix: 5, powershell: 6, total: 11 },
      },
    },
  })
  assert.equal(calls.length, 5)
})

test('rejects malformed and unsafe upstream counters', async () => {
  assert.throws(
    () => aggregateGithubReleaseDownloads([
      release([asset('looptroop-1.0.0-bundle.tar.gz', -1)]),
    ]),
    /non-negative safe integer/,
  )

  await assert.rejects(
    collectProjectStats({
      fetchImpl: async (url) => {
        if (url.endsWith('/repos/looptroop-ai/LoopTroop')) {
          return jsonResponse({ stargazers_count: '12' })
        }
        return jsonResponse({})
      },
    }),
    /GitHub star count/,
  )
})

test('aborts an upstream request at its timeout', async () => {
  let signal
  await assert.rejects(
    fetchJson('https://example.invalid', {
      timeoutMs: 5,
      fetchImpl: async (_url, options) => {
        signal = options.signal
        await new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
        })
      },
    }),
  )
  assert.equal(signal.aborted, true)
})

test('handler returns a briefly cached 502 instead of partial statistics', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => jsonResponse({}, { ok: false, status: 503 })

  const response = createResponse()
  await handler({ method: 'GET' }, response)

  assert.equal(response.statusCode, 502)
  // Briefly cached, so an outage does not turn every page view into another
  // upstream fan-out against a rate limit that is already the likely cause.
  assert.equal(response.getHeader('cache-control'), UPSTREAM_ERROR_CACHE_CONTROL)
  assert.deepEqual(JSON.parse(response.body), {
    error: 'Project statistics are temporarily unavailable',
  })
})

test('a non-GET request is refused without touching an upstream', async () => {
  const response = createResponse()
  await handler({ method: 'POST' }, response)

  assert.equal(response.statusCode, 405)
  assert.equal(response.getHeader('allow'), 'GET')
  // Deterministic, so unlike an upstream failure there is nothing to re-check.
  assert.equal(response.getHeader('cache-control'), ERROR_CACHE_CONTROL)
})

test('successful responses carry the one-hour CDN cache policy', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async (url) => {
    if (url.endsWith('/repos/looptroop-ai/LoopTroop')) {
      return jsonResponse({ stargazers_count: 1 })
    }
    if (url.includes('/releases?')) return jsonResponse([])
    if (url === 'https://registry.npmjs.org/looptroop') {
      return jsonResponse({ time: { created: new Date().toISOString() } })
    }
    if (url.includes('api.npmjs.org/downloads/point')) return jsonResponse({ downloads: 2 })
    if (url.includes('hub.docker.com')) return jsonResponse({ pull_count: 3 })
    throw new Error(`Unexpected URL: ${url}`)
  }

  const response = createResponse()
  await handler({ method: 'GET' }, response)

  assert.equal(response.statusCode, 200)
  assert.equal(response.getHeader('cache-control'), SUCCESS_CACHE_CONTROL)
  assert.equal(JSON.parse(response.body).downloads.total, 5)
})
