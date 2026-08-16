const STATS_API_URL = '/api/project-stats'
const CACHE_KEY = 'looptroop.project-stats.v1'

export const CACHE_TTL_MS = 60 * 60 * 1000
export const STALE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0
}

/**
 * Treat the server payload as untrusted input. In particular, never turn a
 * missing source into zero: that would make an upstream outage look like a
 * sudden loss of every download the project has ever had.
 */
export function normalizeProjectStats(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 2) return null

  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : ''
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) return null

  const stars = value.repository?.stars
  const downloads = value.downloads
  const github = downloads?.github
  const scripts = github?.installerScripts
  const counts = [
    stars,
    downloads?.total,
    downloads?.npmRegistry,
    downloads?.dockerHub,
    github?.bundle,
    github?.standalone,
    github?.npmTarball,
    scripts?.posix,
    scripts?.powershell,
    scripts?.total,
  ]
  if (!counts.every(isCount)) return null

  const expectedTotal = downloads.npmRegistry
    + downloads.dockerHub
    + github.bundle
    + github.standalone
    + github.npmTarball
  if (downloads.total !== expectedTotal) return null
  if (scripts.total !== scripts.posix + scripts.powershell) return null

  return {
    schemaVersion: 2,
    updatedAt: new Date(updatedAt).toISOString(),
    repository: { stars },
    downloads: {
      total: downloads.total,
      npmRegistry: downloads.npmRegistry,
      dockerHub: downloads.dockerHub,
      github: {
        bundle: github.bundle,
        standalone: github.standalone,
        npmTarball: github.npmTarball,
        installerScripts: {
          posix: scripts.posix,
          powershell: scripts.powershell,
          total: scripts.total,
        },
      },
    },
  }
}

export function readProjectStatsCache(storage, now = Date.now()) {
  if (!storage) return null

  try {
    const cached = JSON.parse(storage.getItem(CACHE_KEY) ?? 'null')
    const stats = normalizeProjectStats(cached?.stats)
    const fetchedAt = Number(cached?.fetchedAt)
    if (!stats || !Number.isFinite(fetchedAt) || fetchedAt < 0 || fetchedAt > now) return null

    const age = now - fetchedAt
    if (age > STALE_CACHE_TTL_MS) return null
    return { stats, fresh: age < CACHE_TTL_MS }
  } catch {
    return null
  }
}

export function writeProjectStatsCache(storage, stats, now = Date.now()) {
  if (!storage) return
  try {
    storage.setItem(CACHE_KEY, JSON.stringify({ stats, fetchedAt: now }))
  } catch {
    // Storage can be unavailable in privacy modes; the live response still works.
  }
}

export async function fetchProjectStats(fetchImpl = fetch) {
  const response = await fetchImpl(STATS_API_URL, {
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Project statistics request failed with ${response.status}`)

  const stats = normalizeProjectStats(await response.json())
  if (!stats) throw new Error('Project statistics response had an invalid shape')
  return stats
}

export async function loadProjectStats({
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
} = {}) {
  const cached = readProjectStatsCache(storage, now)
  if (cached?.fresh) return { stats: cached.stats, stale: false }

  try {
    const stats = await fetchProjectStats(fetchImpl)
    writeProjectStatsCache(storage, stats, now)
    return { stats, stale: false }
  } catch {
    return cached ? { stats: cached.stats, stale: true } : null
  }
}

export function formatProjectCount(value, locales) {
  return new Intl.NumberFormat(locales, { maximumFractionDigits: 0 }).format(value)
}

export function renderProjectStats(documentRef, stats) {
  const downloads = `${formatProjectCount(stats.downloads.total)} downloads`
  for (const element of documentRef?.querySelectorAll?.('[data-project-downloads]') ?? []) {
    element.textContent = downloads
  }

  // Just the number: it sits before the icon and the label, so it carries no
  // separator of its own — the button's own gap spacing does that.
  const stars = formatProjectCount(stats.repository.stars)
  for (const element of documentRef?.querySelectorAll?.('[data-project-stars]') ?? []) {
    element.textContent = stars
    element.hidden = false
  }
}

export async function loadAndRenderProjectStats({
  documentRef = globalThis.document,
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
} = {}) {
  const result = await loadProjectStats({ storage, fetchImpl, now })
  if (result) renderProjectStats(documentRef, result.stats)
  return result
}

if (typeof document !== 'undefined'
    && document.querySelector?.('[data-project-downloads], [data-project-stars]')) {
  void loadAndRenderProjectStats()
}
