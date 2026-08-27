const HISTORY_API_URL = '/api/project-stats-history'

export const HISTORY_RANGES = Object.freeze([
  { value: '24h', label: 'Last 24 hours', durationMs: 24 * 60 * 60 * 1000, defaultBucket: 'hour' },
  { value: '7d', label: 'Last 7 days', durationMs: 7 * 24 * 60 * 60 * 1000, defaultBucket: 'hour' },
  { value: '30d', label: 'Last 30 days', durationMs: 30 * 24 * 60 * 60 * 1000, defaultBucket: 'day' },
  { value: '1y', label: 'Last year', durationMs: 366 * 24 * 60 * 60 * 1000, defaultBucket: 'day' },
  { value: 'all', label: 'All time', durationMs: null, defaultBucket: 'month' },
])

export const HISTORY_BUCKETS = Object.freeze([
  { value: 'hour', label: 'Hour', approximateMs: 60 * 60 * 1000 },
  { value: 'day', label: 'Day', approximateMs: 24 * 60 * 60 * 1000 },
  { value: 'week', label: 'Week', approximateMs: 7 * 24 * 60 * 60 * 1000 },
  { value: 'month', label: 'Month', approximateMs: 30 * 24 * 60 * 60 * 1000 },
  { value: 'year', label: 'Year', approximateMs: 365 * 24 * 60 * 60 * 1000 },
])

export const HISTORY_SOURCE_KEYS = Object.freeze([
  'total',
  'npmRegistry',
  'releaseTarball',
  'dockerHub',
  'releaseBundles',
  'standaloneArchives',
  'installerPosix',
  'installerPowershell',
])

export const MAX_HISTORY_POINTS = 400

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isValidTimestamp(value) {
  return typeof value === 'string' && value !== '' && Number.isFinite(Date.parse(value))
}

function normalizeValues(value) {
  if (!isRecord(value)) return null
  const result = {}
  for (const key of HISTORY_SOURCE_KEYS) {
    const count = value[key]
    if (count !== null && (!Number.isSafeInteger(count) || count < 0)) return null
    result[key] = count
  }
  return result
}

export function normalizeProjectStatsHistory(value) {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  if (!isValidTimestamp(value.generatedAt)
    || (value.trackingStartedAt !== null && !isValidTimestamp(value.trackingStartedAt))) return null
  if (!HISTORY_RANGES.some(({ value: range }) => range === value.range)) return null
  if (!HISTORY_BUCKETS.some(({ value: bucket }) => bucket === value.bucket)) return null
  if (typeof value.stale !== 'boolean' || !Array.isArray(value.sources) || !Array.isArray(value.buckets)) return null
  if (value.buckets.length > MAX_HISTORY_POINTS) return null
  if (value.trackingStartedAt === null && value.buckets.length > 0) return null

  const seenSources = new Set()
  const sources = []
  for (const source of value.sources) {
    if (!isRecord(source)
      || !HISTORY_SOURCE_KEYS.includes(source.key)
      || seenSources.has(source.key)
      || typeof source.label !== 'string'
      || source.label.trim() === ''
      || typeof source.includedInTotal !== 'boolean') return null
    seenSources.add(source.key)
    sources.push({
      key: source.key,
      label: source.label,
      includedInTotal: source.includedInTotal,
    })
  }
  if (seenSources.size !== HISTORY_SOURCE_KEYS.length) return null

  let previousStart = -Infinity
  const buckets = []
  for (const item of value.buckets) {
    if (!isRecord(item)
      || !isValidTimestamp(item.start)
      || !isValidTimestamp(item.end)
      || typeof item.partial !== 'boolean'
      || typeof item.complete !== 'boolean') return null
    const startMs = Date.parse(item.start)
    const endMs = Date.parse(item.end)
    if (startMs >= endMs || startMs <= previousStart) return null
    const downloadsAdded = normalizeValues(item.downloadsAdded)
    const cumulative = normalizeValues(item.cumulative)
    if (!downloadsAdded || !cumulative) return null
    previousStart = startMs
    buckets.push({
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      partial: item.partial,
      complete: item.complete,
      downloadsAdded,
      cumulative,
    })
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date(value.generatedAt).toISOString(),
    trackingStartedAt: value.trackingStartedAt === null ? null : new Date(value.trackingStartedAt).toISOString(),
    range: value.range,
    bucket: value.bucket,
    stale: value.stale,
    sources,
    buckets,
  }
}

export function estimateHistoryPoints(range, bucket, trackingStartedAt, now = Date.now()) {
  const rangeOption = HISTORY_RANGES.find(({ value }) => value === range)
  const bucketOption = HISTORY_BUCKETS.find(({ value }) => value === bucket)
  if (!rangeOption || !bucketOption) return Infinity

  let durationMs = rangeOption.durationMs
  if (range === 'all') {
    const startMs = Date.parse(trackingStartedAt ?? '')
    if (!Number.isFinite(startMs)) return bucket === 'month' || bucket === 'year' ? 1 : Infinity
    durationMs = Math.max(0, now - startMs)
  }
  return Math.max(1, Math.ceil(durationMs / bucketOption.approximateMs) + 1)
}

export function isHistoryBucketAllowed(range, bucket, trackingStartedAt, now = Date.now()) {
  return estimateHistoryPoints(range, bucket, trackingStartedAt, now) <= MAX_HISTORY_POINTS
}

export function chooseHistoryBucket(range, currentBucket, trackingStartedAt, now = Date.now()) {
  if (isHistoryBucketAllowed(range, currentBucket, trackingStartedAt, now)) return currentBucket
  const preferred = HISTORY_RANGES.find(({ value }) => value === range)?.defaultBucket ?? 'month'
  if (isHistoryBucketAllowed(range, preferred, trackingStartedAt, now)) return preferred
  return HISTORY_BUCKETS.find(({ value }) => isHistoryBucketAllowed(range, value, trackingStartedAt, now))?.value ?? 'year'
}

export function updateHistorySourceSelection(current, key, checked) {
  const selection = current.filter((source) => HISTORY_SOURCE_KEYS.includes(source))
  if (!HISTORY_SOURCE_KEYS.includes(key)) return selection
  if (checked) return selection.includes(key) ? selection : [...selection, key]
  if (selection.length === 1 && selection[0] === key) return selection
  return selection.filter((source) => source !== key)
}

export function getHistorySeries(history, sourceKey, metric) {
  if (!HISTORY_SOURCE_KEYS.includes(sourceKey)
    || (metric !== 'downloadsAdded' && metric !== 'cumulative')
    || !Array.isArray(history?.buckets)) return []
  return history.buckets.map((item) => item?.[metric]?.[sourceKey] ?? null)
}

export async function fetchProjectStatsHistory({
  range,
  bucket,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!HISTORY_RANGES.some(({ value }) => value === range)
    || !HISTORY_BUCKETS.some(({ value }) => value === bucket)) {
    throw new TypeError('Unknown download-history range or bucket')
  }

  const query = new URLSearchParams({ range, bucket })
  const response = await fetchImpl(`${HISTORY_API_URL}?${query}`, {
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Download history request failed with ${response.status}`)

  const history = normalizeProjectStatsHistory(await response.json())
  if (!history) throw new Error('Download history response had an invalid shape')
  return history
}

export function formatHistoryBucketLabel(start, end, bucket, locales) {
  const startDate = new Date(start)
  const endDate = new Date(end)
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return ''

  const options = bucket === 'hour'
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }
    : bucket === 'year'
      ? { year: 'numeric', timeZone: 'UTC' }
      : { year: 'numeric', month: bucket === 'month' ? 'long' : 'short', day: bucket === 'month' ? undefined : 'numeric', timeZone: 'UTC' }
  const formatter = new Intl.DateTimeFormat(locales, options)
  if (bucket === 'hour' || bucket === 'month' || bucket === 'year') return formatter.format(startDate)
  const inclusiveEnd = new Date(Math.max(startDate.getTime(), endDate.getTime() - 1))
  return startDate.getTime() === inclusiveEnd.getTime()
    ? formatter.format(startDate)
    : `${formatter.format(startDate)} to ${formatter.format(inclusiveEnd)}`
}

export function formatHistoryCount(value, locales, compact = false) {
  return new Intl.NumberFormat(locales, compact
    ? { notation: 'compact', maximumFractionDigits: 1 }
    : { maximumFractionDigits: 0 }).format(value)
}
