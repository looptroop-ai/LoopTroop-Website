import { requireSafeCount } from './project-stats.js'

export const HISTORY_SCHEMA_VERSION = 1
export const HISTORY_SUCCESS_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=86400'
export const HISTORY_ERROR_CACHE_CONTROL = 'no-store'
export const MAX_HISTORY_BUCKETS = 400

const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * HOUR_MS
const STALE_AFTER_MS = 2 * HOUR_MS
const KEY_PREFIX = 'looptroop:project-stats:v1'
const KEYS = {
  hours: `${KEY_PREFIX}:hours`,
  hourly: `${KEY_PREFIX}:hourly`,
  days: `${KEY_PREFIX}:days`,
  daily: `${KEY_PREFIX}:daily`,
  meta: `${KEY_PREFIX}:meta`,
  lock: `${KEY_PREFIX}:cron-lock`,
}

export const HISTORY_SOURCES = Object.freeze([
  { key: 'total', label: 'Total downloads', includedInTotal: true },
  { key: 'npmRegistry', label: 'npm registry', includedInTotal: true },
  { key: 'releaseTarball', label: 'Release tarball', includedInTotal: true },
  { key: 'dockerHub', label: 'Docker Hub', includedInTotal: true },
  { key: 'releaseBundles', label: 'Release bundles', includedInTotal: true },
  { key: 'standaloneArchives', label: 'Standalone archives', includedInTotal: true },
  { key: 'installerPosix', label: 'POSIX installer fetches', includedInTotal: false },
  { key: 'installerPowershell', label: 'PowerShell installer fetches', includedInTotal: false },
])

const SOURCE_KEYS = HISTORY_SOURCES.map(({ key }) => key)
const VALID_RANGES = new Set(['24h', '7d', '30d', '1y', 'all'])
const VALID_BUCKETS = new Set(['hour', 'day', 'week', 'month', 'year'])

export class HistoryQueryError extends TypeError {}

function fail(message) {
  throw new TypeError(message)
}

function validDate(value, label) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) fail(`${label} must be a valid date`)
  return date
}

export function flattenProjectStats(stats) {
  if (!stats || typeof stats !== 'object' || !stats.downloads?.github?.installerScripts) {
    fail('Project statistics payload is invalid')
  }

  const github = stats.downloads.github
  const values = {
    total: stats.downloads.total,
    npmRegistry: stats.downloads.npmRegistry,
    releaseTarball: github.npmTarball,
    dockerHub: stats.downloads.dockerHub,
    releaseBundles: github.bundle,
    standaloneArchives: github.standalone,
    installerPosix: github.installerScripts.posix,
    installerPowershell: github.installerScripts.powershell,
  }
  for (const key of SOURCE_KEYS) requireSafeCount(values[key], `${key} history count`)
  return values
}

export function createRedisClient({ url, token, fetchImpl = globalThis.fetch } = {}) {
  if (!url || !token) fail('Upstash Redis is not configured')
  if (typeof fetchImpl !== 'function') fail('A fetch implementation is required')
  const endpoint = String(url).replace(/\/+$/, '')

  async function request(path, body) {
    const response = await fetchImpl(`${endpoint}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response?.ok) throw new Error(`Upstash request failed (${response?.status ?? 'unknown'})`)
    const payload = await response.json()
    if (payload?.error) throw new Error(`Upstash command failed: ${payload.error}`)
    return payload?.result
  }

  return {
    command(command) { return request('', command) },
    async pipeline(commands) {
      const response = await fetchImpl(`${endpoint}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands),
      })
      if (!response?.ok) throw new Error(`Upstash request failed (${response?.status ?? 'unknown'})`)
      const payload = await response.json()
      if (!Array.isArray(payload) || payload.some((item) => item?.error)) {
        throw new Error('Upstash pipeline failed')
      }
      return payload.map((item) => item.result)
    },
  }
}

export function createRedisClientFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  // The current Upstash Marketplace integration on Vercel provisions the
  // KV_REST_API_* names. Direct Upstash connections use the UPSTASH_* names.
  // Keep both pairs supported, but never mix a URL from one pair with a token
  // from the other.
  const credentials = [
    [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN],
    [env.KV_REST_API_URL, env.KV_REST_API_TOKEN],
  ].find(([url, token]) => url && token)
  return createRedisClient({
    url: credentials?.[0],
    token: credentials?.[1],
    fetchImpl,
  })
}

export async function acquireSnapshotLock(redis, token) {
  return (await redis.command(['SET', KEYS.lock, token, 'NX', 'EX', '300'])) === 'OK'
}

export async function releaseSnapshotLock(redis, token) {
  const script = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end"
  await redis.command(['EVAL', script, '1', KEYS.lock, token])
}

export async function storeProjectStatsSnapshot(redis, stats, now = new Date()) {
  const capturedAt = validDate(now, 'Snapshot time')
  const hourStart = Math.floor(capturedAt.getTime() / HOUR_MS) * HOUR_MS
  const dayStart = Math.floor(capturedAt.getTime() / DAY_MS) * DAY_MS
  const record = JSON.stringify({
    periodStart: hourStart,
    capturedAt: capturedAt.toISOString(),
    values: flattenProjectStats(stats),
  })
  const dailyRecord = JSON.stringify({
    periodStart: dayStart,
    capturedAt: capturedAt.toISOString(),
    values: flattenProjectStats(stats),
  })
  const script = [
    "local inserted = redis.call('HSETNX', KEYS[1], ARGV[1], ARGV[2])",
    'if inserted == 1 then',
    "  redis.call('ZADD', KEYS[2], ARGV[1], ARGV[1])",
    "  redis.call('HSET', KEYS[3], ARGV[3], ARGV[4])",
    "  redis.call('ZADD', KEYS[4], ARGV[3], ARGV[3])",
    "  redis.call('HSETNX', KEYS[5], 'trackingStartedAt', ARGV[5])",
    "  redis.call('HSET', KEYS[5], 'lastSuccessfulAt', ARGV[5])",
    'end',
    'return inserted',
  ].join('\n')
  const inserted = await redis.command([
    'EVAL', script, '5', KEYS.hourly, KEYS.hours, KEYS.daily, KEYS.days, KEYS.meta,
    String(hourStart), record, String(dayStart), dailyRecord, capturedAt.toISOString(),
  ])
  return { inserted: Number(inserted) === 1, hourStart, dayStart }
}

function floorBucket(epoch, bucket) {
  const date = new Date(epoch)
  if (bucket === 'hour') return Math.floor(epoch / HOUR_MS) * HOUR_MS
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  if (bucket === 'day') return day
  if (bucket === 'week') return day - ((date.getUTCDay() + 6) % 7) * DAY_MS
  if (bucket === 'month') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
  return Date.UTC(date.getUTCFullYear(), 0, 1)
}

function nextBucket(epoch, bucket) {
  const date = new Date(epoch)
  if (bucket === 'hour') return epoch + HOUR_MS
  if (bucket === 'day') return epoch + DAY_MS
  if (bucket === 'week') return epoch + 7 * DAY_MS
  if (bucket === 'month') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
  return Date.UTC(date.getUTCFullYear() + 1, 0, 1)
}

function rangeStart(range, now, trackingStartedAt) {
  if (range === 'all') return trackingStartedAt
  const duration = { '24h': DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS, '1y': 365 * DAY_MS }[range]
  return now - duration
}

export function resolveHistoryQuery(query = {}, { now = new Date(), trackingStartedAt } = {}) {
  const range = Array.isArray(query.range) ? query.range[0] : query.range
  const bucket = Array.isArray(query.bucket) ? query.bucket[0] : query.bucket
  if (!VALID_RANGES.has(range)) throw new HistoryQueryError('Unknown history range')
  if (!VALID_BUCKETS.has(bucket)) throw new HistoryQueryError('Unknown history bucket')
  const nowEpoch = validDate(now, 'Current time').getTime()
  const trackingEpoch = trackingStartedAt ? validDate(trackingStartedAt, 'Tracking start time').getTime() : nowEpoch
  const requestedStart = rangeStart(range, nowEpoch, trackingEpoch)
  let requestedCount = 0
  for (let cursor = floorBucket(requestedStart, bucket); cursor <= nowEpoch; cursor = nextBucket(cursor, bucket)) {
    requestedCount += 1
    if (requestedCount > MAX_HISTORY_BUCKETS) {
      throw new HistoryQueryError(`History query exceeds ${MAX_HISTORY_BUCKETS} buckets`)
    }
  }
  const start = Math.max(requestedStart, trackingEpoch)
  const first = floorBucket(start, bucket)
  const buckets = []
  for (let cursor = first; cursor <= nowEpoch; cursor = nextBucket(cursor, bucket)) {
    buckets.push(cursor)
  }
  return { range, bucket, nowEpoch, start, bucketStarts: buckets }
}

function parseRecord(value) {
  let record
  try { record = JSON.parse(value) } catch { fail('Stored history snapshot is invalid') }
  if (!record || !Number.isSafeInteger(record.periodStart) || typeof record.capturedAt !== 'string') {
    fail('Stored history snapshot is invalid')
  }
  validDate(record.capturedAt, 'Stored snapshot time')
  for (const key of SOURCE_KEYS) requireSafeCount(record.values?.[key], `${key} stored history count`)
  return record
}

async function readRecords(redis, bucket, start, now) {
  const hourly = bucket === 'hour'
  const indexKey = hourly ? KEYS.hours : KEYS.days
  const valueKey = hourly ? KEYS.hourly : KEYS.daily
  const step = hourly ? HOUR_MS : DAY_MS
  const members = await redis.command(['ZRANGE', indexKey, String(start - step), String(now), 'BYSCORE'])
  if (!Array.isArray(members) || members.length === 0) return []
  const values = await redis.command(['HMGET', valueKey, ...members.map(String)])
  if (!Array.isArray(values)) throw new Error('Upstash returned invalid history records')
  return values.filter((value) => value !== null).map(parseRecord).sort((a, b) => a.periodStart - b.periodStart)
}

function emptyValues(value = null) {
  return Object.fromEntries(SOURCE_KEYS.map((key) => [key, value]))
}

function transitionValues(previousPrevious, previous, current, expectedStep) {
  if (!previous || current.periodStart - previous.periodStart !== expectedStep) return null
  const result = {}
  for (const key of SOURCE_KEYS) {
    const before = previous.values[key]
    const after = current.values[key]
    if (after >= before) {
      result[key] = after - before
      continue
    }
    // The first lower observation is never turned into a negative download.
    // The following observation decides whether that lower value was a reset
    // or a transient upstream anomaly; either way, the uncertain interval is
    // left null rather than reconstructed.
    result[key] = null
  }

  if (previousPrevious && previous.periodStart - previousPrevious.periodStart === expectedStep) {
    for (const key of SOURCE_KEYS) {
      const oldBaseline = previousPrevious.values[key]
      const candidate = previous.values[key]
      const currentValue = current.values[key]
      if (candidate >= oldBaseline || currentValue < candidate) continue
      result[key] = currentValue < oldBaseline
        ? currentValue - candidate
        : currentValue - oldBaseline
    }
  }
  return result
}

export function aggregateHistory(records, query) {
  const sourceStep = query.bucket === 'hour' ? HOUR_MS : DAY_MS
  const output = query.bucketStarts.map((start) => ({
    start,
    end: nextBucket(start, query.bucket),
    entries: [],
  }))
  const byStart = new Map(output.map((item) => [item.start, item]))

  for (let index = 0; index < records.length; index += 1) {
    const current = records[index]
    const target = byStart.get(floorBucket(current.periodStart, query.bucket))
    if (!target) continue
    target.entries.push({
      record: current,
      transition: transitionValues(records[index - 2], records[index - 1], current, sourceStep),
    })
  }

  return output.map((item) => {
    const sourceStart = query.bucket === 'hour'
      ? floorBucket(query.start, 'hour')
      : floorBucket(query.start, 'day')
    const entries = item.entries.filter(({ record }) => record.periodStart >= sourceStart)
    const latest = entries.at(-1)?.record
    const partial = item.start <= query.nowEpoch && item.end > query.nowEpoch
    const expectedStart = Math.max(item.start, sourceStart)
    const expectedSourcePeriods = Math.max(1, Math.ceil((Math.min(item.end, query.nowEpoch + 1) - expectedStart) / sourceStep))
    const validTransitions = entries.map(({ transition }) => transition).filter(Boolean)
    const hasCoverage = entries.length >= expectedSourcePeriods
      && validTransitions.length >= expectedSourcePeriods
    const complete = !partial && hasCoverage
    const downloadsAdded = emptyValues()
    if (hasCoverage) {
      for (const key of SOURCE_KEYS) {
        downloadsAdded[key] = validTransitions.every((values) => values[key] !== null)
          ? validTransitions.reduce((sum, values) => sum + values[key], 0)
          : null
      }
    }
    return {
      start: new Date(item.start).toISOString(),
      end: new Date(item.end).toISOString(),
      partial,
      complete,
      downloadsAdded,
      cumulative: latest ? { ...latest.values } : emptyValues(),
    }
  })
}

export async function buildHistoryResponse(redis, query, now = new Date()) {
  const [trackingStartedAt, lastSuccessfulAt] = await redis.pipeline([
    ['HGET', KEYS.meta, 'trackingStartedAt'],
    ['HGET', KEYS.meta, 'lastSuccessfulAt'],
  ])
  if (!trackingStartedAt || !lastSuccessfulAt) return null
  validDate(trackingStartedAt, 'Tracking start time')
  validDate(lastSuccessfulAt, 'Last successful snapshot time')
  const resolved = resolveHistoryQuery(query, { now, trackingStartedAt })
  const records = await readRecords(redis, resolved.bucket, resolved.start, resolved.nowEpoch)
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    generatedAt: validDate(now, 'Current time').toISOString(),
    trackingStartedAt,
    range: resolved.range,
    bucket: resolved.bucket,
    stale: resolved.nowEpoch - Date.parse(lastSuccessfulAt) > STALE_AFTER_MS,
    sources: HISTORY_SOURCES.map((source) => ({ ...source })),
    buckets: aggregateHistory(records, resolved),
  }
}

export function sendHistoryJson(response, status, payload, cacheControl = HISTORY_ERROR_CACHE_CONTROL) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', cacheControl)
  response.end(JSON.stringify(payload))
}
