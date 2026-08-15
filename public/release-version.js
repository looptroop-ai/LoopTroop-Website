const RELEASE_API_URL = 'https://api.github.com/repos/looptroop-ai/LoopTroop/releases/latest'
const CACHE_KEY = 'looptroop.latest-release'

/**
 * How long a cached version is served without asking GitHub again.
 *
 * This was six hours, which meant the badge kept naming the previous release
 * for most of a day after one shipped — the cache was fresh, so nothing
 * refetched, and the page looked like the release had not happened. Fifteen
 * minutes still spares GitHub's unauthenticated rate limit (60/hour per IP,
 * shared by everyone behind the same NAT) while making a release visible in
 * minutes rather than hours.
 */
export const CACHE_TTL_MS = 15 * 60 * 1000

export function normalizeReleaseTag(value) {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/)
  return match?.[1] ?? null
}

export function readReleaseCache(storage, now = Date.now()) {
  if (!storage) return null

  try {
    const parsed = JSON.parse(storage.getItem(CACHE_KEY) ?? 'null')
    const version = normalizeReleaseTag(parsed?.version)
    const fetchedAt = Number(parsed?.fetchedAt)
    if (!version || !Number.isFinite(fetchedAt) || fetchedAt < 0) return null
    return { version, fresh: now - fetchedAt < CACHE_TTL_MS }
  } catch {
    return null
  }
}

export function writeReleaseCache(storage, version, now = Date.now()) {
  if (!storage) return
  try {
    storage.setItem(CACHE_KEY, JSON.stringify({ version, fetchedAt: now }))
  } catch {
    // Storage can be unavailable in privacy modes; the live value still works.
  }
}

export async function fetchLatestReleaseVersion(fetchImpl = fetch) {
  const response = await fetchImpl(RELEASE_API_URL, {
    credentials: 'omit',
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) throw new Error(`GitHub release request failed with ${response.status}`)
  const payload = await response.json()
  const version = normalizeReleaseTag(payload?.tag_name)
  if (!version) throw new Error('GitHub returned an invalid release tag')
  return version
}

export function renderReleaseVersion(documentRef, version) {
  for (const element of documentRef?.querySelectorAll?.('[data-release-version]') ?? []) {
    element.textContent = ` · v${version}`
    element.hidden = false
  }
}

export async function loadReleaseVersion({
  documentRef = globalThis.document,
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
} = {}) {
  const cached = readReleaseCache(storage, now)
  if (cached) renderReleaseVersion(documentRef, cached.version)
  if (cached?.fresh) return cached.version

  try {
    const version = await fetchLatestReleaseVersion(fetchImpl)
    writeReleaseCache(storage, version, now)
    renderReleaseVersion(documentRef, version)
    return version
  } catch {
    return cached?.version ?? null
  }
}

if (typeof document !== 'undefined') {
  void loadReleaseVersion()
}
