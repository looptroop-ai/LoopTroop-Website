const GITHUB_REPOSITORY_URL = 'https://api.github.com/repos/looptroop-ai/LoopTroop'
const GITHUB_RELEASES_URL = `${GITHUB_REPOSITORY_URL}/releases`
const NPM_PACKAGE_URL = 'https://registry.npmjs.org/looptroop'
const NPM_DOWNLOADS_URL = 'https://api.npmjs.org/downloads/point'
const DOCKER_HUB_URL = 'https://hub.docker.com/v2/repositories/looptroopai/looptroop/'

export const UPSTREAM_TIMEOUT_MS = 5_000
export const GITHUB_PAGE_SIZE = 100
export const SUCCESS_CACHE_CONTROL = 'public, s-maxage=3600, stale-while-revalidate=86400'
export const ERROR_CACHE_CONTROL = 'no-store'

const DAY_MS = 24 * 60 * 60 * 1_000
const MAX_NPM_WINDOW_DAYS = 365
const MAX_GITHUB_PAGES = 100
const VERSION = String.raw`\d+\.\d+\.\d+`
const BUNDLE_PATTERN = new RegExp(`^looptroop-${VERSION}-bundle\\.tar\\.gz$`)
const STANDALONE_PATTERN = new RegExp(
  `^looptroop-${VERSION}-(?:linux-x64|linux-arm64|darwin-arm64)\\.tar\\.gz$|^looptroop-${VERSION}-win-x64\\.zip$`,
)

function fail(message) {
  throw new TypeError(message)
}

export function requireSafeCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer`)
  }
  return value
}

export function addCounts(...values) {
  const total = values.reduce((sum, value) => sum + requireSafeCount(value, 'Download count'), 0)
  return requireSafeCount(total, 'Download count total')
}

export async function fetchJson(
  url,
  { fetchImpl = globalThis.fetch, headers = {}, timeoutMs = UPSTREAM_TIMEOUT_MS } = {},
) {
  if (typeof fetchImpl !== 'function') fail('A fetch implementation is required')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      headers,
      signal: controller.signal,
    })
    if (!response || response.ok !== true) {
      const status = Number.isInteger(response?.status) ? ` (${response.status})` : ''
      throw new Error(`Upstream request failed${status}`)
    }

    try {
      return await response.json()
    } catch {
      throw new Error('Upstream returned invalid JSON')
    }
  } finally {
    clearTimeout(timeout)
  }
}

function githubHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'LoopTroop-Website',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

export function classifyReleaseAsset(name) {
  if (name === 'install.sh') return 'installer-posix'
  if (name === 'install.ps1') return 'installer-powershell'
  if (typeof name !== 'string') return null
  if (BUNDLE_PATTERN.test(name)) return 'bundle'
  if (STANDALONE_PATTERN.test(name)) return 'standalone'
  return null
}

export function aggregateGithubReleaseDownloads(releases) {
  if (!Array.isArray(releases)) fail('GitHub releases must be an array')

  const counts = {
    bundle: 0,
    standalone: 0,
    installerScripts: { posix: 0, powershell: 0, total: 0 },
  }

  for (const release of releases) {
    if (
      !release
      || typeof release !== 'object'
      || typeof release.draft !== 'boolean'
      || typeof release.prerelease !== 'boolean'
      || !Array.isArray(release.assets)
    ) {
      fail('GitHub returned an invalid release')
    }
    if (release.draft || release.prerelease) continue

    for (const asset of release.assets) {
      if (!asset || typeof asset !== 'object' || typeof asset.name !== 'string') {
        fail('GitHub returned an invalid release asset')
      }

      const category = classifyReleaseAsset(asset.name)
      if (!category) continue
      const downloads = requireSafeCount(asset.download_count, `Download count for ${asset.name}`)

      if (category === 'bundle') counts.bundle = addCounts(counts.bundle, downloads)
      if (category === 'standalone') counts.standalone = addCounts(counts.standalone, downloads)
      if (category === 'installer-posix') {
        counts.installerScripts.posix = addCounts(counts.installerScripts.posix, downloads)
      }
      if (category === 'installer-powershell') {
        counts.installerScripts.powershell = addCounts(counts.installerScripts.powershell, downloads)
      }
    }
  }

  counts.installerScripts.total = addCounts(
    counts.installerScripts.posix,
    counts.installerScripts.powershell,
  )
  return counts
}

export async function fetchGithubStars(fetchImpl = globalThis.fetch) {
  const payload = await fetchJson(GITHUB_REPOSITORY_URL, {
    fetchImpl,
    headers: githubHeaders(),
  })
  if (!payload || typeof payload !== 'object') fail('GitHub returned an invalid repository')
  return requireSafeCount(payload.stargazers_count, 'GitHub star count')
}

export async function fetchGithubReleaseDownloads(fetchImpl = globalThis.fetch) {
  const releases = []

  for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
    const payload = await fetchJson(
      `${GITHUB_RELEASES_URL}?per_page=${GITHUB_PAGE_SIZE}&page=${page}`,
      { fetchImpl, headers: githubHeaders() },
    )
    if (!Array.isArray(payload)) fail('GitHub releases response must be an array')
    releases.push(...payload)
    if (payload.length < GITHUB_PAGE_SIZE) return aggregateGithubReleaseDownloads(releases)
  }

  throw new Error('GitHub release pagination exceeded the safety limit')
}

function utcDay(value, label) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) fail(`${label} must be a valid date`)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function formatUtcDay(epoch) {
  return new Date(epoch).toISOString().slice(0, 10)
}

export function buildNpmDownloadWindows(createdAt, through = new Date()) {
  let start = utcDay(createdAt, 'npm package creation time')
  const lastDay = utcDay(through, 'Download window end')
  if (start > lastDay) fail('npm package creation time cannot be in the future')

  const windows = []
  while (start <= lastDay) {
    const end = Math.min(start + (MAX_NPM_WINDOW_DAYS - 1) * DAY_MS, lastDay)
    windows.push({ start: formatUtcDay(start), end: formatUtcDay(end) })
    start = end + DAY_MS
  }
  return windows
}

export async function fetchNpmDownloads(fetchImpl = globalThis.fetch, through = new Date()) {
  const metadata = await fetchJson(NPM_PACKAGE_URL, { fetchImpl })
  const createdAt = metadata?.time?.created
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) {
    fail('npm returned an invalid package creation time')
  }

  const windows = buildNpmDownloadWindows(createdAt, through)
  const payloads = await Promise.all(windows.map(({ start, end }) => (
    fetchJson(`${NPM_DOWNLOADS_URL}/${start}:${end}/looptroop`, { fetchImpl })
  )))

  return payloads.reduce((total, payload) => {
    if (!payload || typeof payload !== 'object') fail('npm returned an invalid download response')
    return addCounts(total, requireSafeCount(payload.downloads, 'npm download count'))
  }, 0)
}

export async function fetchDockerHubPulls(fetchImpl = globalThis.fetch) {
  const payload = await fetchJson(DOCKER_HUB_URL, { fetchImpl })
  if (!payload || typeof payload !== 'object') fail('Docker Hub returned an invalid repository')
  return requireSafeCount(payload.pull_count, 'Docker Hub pull count')
}

export function normalizeGithubDownloadCounts(github) {
  if (!github || typeof github !== 'object' || !github.installerScripts || typeof github.installerScripts !== 'object') {
    fail('GitHub download counts are invalid')
  }

  const bundle = requireSafeCount(github.bundle, 'GitHub bundle download count')
  const standalone = requireSafeCount(github.standalone, 'GitHub standalone download count')
  const posix = requireSafeCount(github.installerScripts.posix, 'POSIX installer download count')
  const powershell = requireSafeCount(
    github.installerScripts.powershell,
    'PowerShell installer download count',
  )

  return {
    bundle,
    standalone,
    installerScripts: { posix, powershell, total: addCounts(posix, powershell) },
  }
}

export function buildProjectStats({ stars, npmRegistry, dockerHub, github, updatedAt }) {
  const safeStars = requireSafeCount(stars, 'GitHub star count')
  const safeNpm = requireSafeCount(npmRegistry, 'npm download count')
  const safeDocker = requireSafeCount(dockerHub, 'Docker Hub pull count')
  const safeGithub = normalizeGithubDownloadCounts(github)
  const timestamp = updatedAt instanceof Date ? updatedAt : new Date(updatedAt)
  if (!Number.isFinite(timestamp.getTime())) fail('Statistics update time must be a valid date')

  return {
    schemaVersion: 1,
    updatedAt: timestamp.toISOString(),
    repository: { stars: safeStars },
    downloads: {
      total: addCounts(safeNpm, safeDocker, safeGithub.bundle, safeGithub.standalone),
      npmRegistry: safeNpm,
      dockerHub: safeDocker,
      github: safeGithub,
    },
  }
}

export async function collectProjectStats({ fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const timestamp = now instanceof Date ? new Date(now.getTime()) : new Date(now)
  if (!Number.isFinite(timestamp.getTime())) fail('Statistics update time must be a valid date')

  const [stars, github, npmRegistry, dockerHub] = await Promise.all([
    fetchGithubStars(fetchImpl),
    fetchGithubReleaseDownloads(fetchImpl),
    fetchNpmDownloads(fetchImpl, timestamp),
    fetchDockerHubPulls(fetchImpl),
  ])

  return buildProjectStats({ stars, npmRegistry, dockerHub, github, updatedAt: timestamp })
}

function sendJson(response, status, payload, cacheControl) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', cacheControl)
  response.end(JSON.stringify(payload))
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    sendJson(response, 405, { error: 'Method not allowed' }, ERROR_CACHE_CONTROL)
    return
  }

  try {
    const stats = await collectProjectStats()
    sendJson(response, 200, stats, SUCCESS_CACHE_CONTROL)
  } catch {
    sendJson(
      response,
      502,
      { error: 'Project statistics are temporarily unavailable' },
      ERROR_CACHE_CONTROL,
    )
  }
}
