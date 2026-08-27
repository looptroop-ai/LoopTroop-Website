import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chooseHistoryBucket,
  estimateHistoryPoints,
  fetchProjectStatsHistory,
  formatHistoryBucketLabel,
  getHistorySeries,
  isHistoryBucketAllowed,
  normalizeProjectStatsHistory,
  updateHistorySourceSelection,
} from '../public/project-stats-history.js'

const sources = [
  ['total', 'Total downloads', true],
  ['npmRegistry', 'npm registry', true],
  ['releaseTarball', 'Release tarball', true],
  ['dockerHub', 'Docker Hub', true],
  ['releaseBundles', 'Release bundles', true],
  ['standaloneArchives', 'Standalone archives', true],
  ['installerPosix', 'POSIX installer fetches', false],
  ['installerPowershell', 'PowerShell installer fetches', false],
].map(([key, label, includedInTotal]) => ({ key, label, includedInTotal }))

const values = Object.fromEntries(sources.map(({ key }, index) => [key, 100 + index]))
const payload = {
  schemaVersion: 1,
  generatedAt: '2026-08-27T12:06:00Z',
  trackingStartedAt: '2026-08-20T12:05:00Z',
  range: '7d',
  bucket: 'hour',
  stale: false,
  sources,
  buckets: [{
    start: '2026-08-27T11:00:00Z',
    end: '2026-08-27T12:00:00Z',
    partial: false,
    complete: true,
    downloadsAdded: values,
    cumulative: values,
  }],
}

test('normalizes a complete history payload', () => {
  const result = normalizeProjectStatsHistory(payload)
  assert.equal(result?.generatedAt, '2026-08-27T12:06:00.000Z')
  assert.deepEqual(result?.sources, sources)
  assert.equal(result?.buckets[0].complete, true)
})

test('rejects missing sources, invalid values, unordered buckets, and oversized responses', () => {
  assert.equal(normalizeProjectStatsHistory({ ...payload, sources: sources.slice(1) }), null)
  assert.equal(normalizeProjectStatsHistory({
    ...payload,
    buckets: [{ ...payload.buckets[0], downloadsAdded: { ...values, total: -1 } }],
  }), null)
  assert.equal(normalizeProjectStatsHistory({
    ...payload,
    buckets: [payload.buckets[0], payload.buckets[0]],
  }), null)
  assert.equal(normalizeProjectStatsHistory({
    ...payload,
    buckets: Array.from({ length: 401 }, (_, index) => ({
      ...payload.buckets[0],
      start: new Date(index * 3_600_000).toISOString(),
      end: new Date((index + 1) * 3_600_000).toISOString(),
    })),
  }), null)
})

test('allows null values so gaps are never displayed as zero', () => {
  const result = normalizeProjectStatsHistory({
    ...payload,
    buckets: [{
      ...payload.buckets[0],
      complete: false,
      downloadsAdded: { ...values, total: null },
    }],
  })
  assert.equal(result?.buckets[0].downloadsAdded.total, null)
  assert.equal(result?.buckets[0].complete, false)
})

test('accepts a waiting state before the first snapshot', () => {
  const result = normalizeProjectStatsHistory({
    ...payload,
    trackingStartedAt: null,
    buckets: [],
  })
  assert.equal(result?.trackingStartedAt, null)
  assert.deepEqual(result?.buckets, [])
  assert.equal(normalizeProjectStatsHistory({ ...payload, trackingStartedAt: null }), null)
})

test('fetches the selected range and bucket without credentials', async () => {
  let request
  const result = await fetchProjectStatsHistory({
    range: '7d',
    bucket: 'hour',
    fetchImpl: async (url, options) => {
      request = { url, options }
      return { ok: true, json: async () => payload }
    },
  })
  assert.equal(request.url, '/api/project-stats-history?range=7d&bucket=hour')
  assert.deepEqual(request.options, { credentials: 'omit', headers: { Accept: 'application/json' } })
  assert.equal(result.range, '7d')
})

test('rejects unknown controls, HTTP failures, and invalid responses', async () => {
  await assert.rejects(fetchProjectStatsHistory({ range: 'nope', bucket: 'day' }), TypeError)
  await assert.rejects(fetchProjectStatsHistory({
    range: '30d',
    bucket: 'day',
    fetchImpl: async () => ({ ok: false, status: 503 }),
  }), /503/)
  await assert.rejects(fetchProjectStatsHistory({
    range: '30d',
    bucket: 'day',
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  }), /invalid shape/)
})

test('limits chart combinations to 400 points and selects a readable replacement', () => {
  const now = Date.parse('2026-08-27T12:00:00Z')
  assert.equal(estimateHistoryPoints('7d', 'hour', null, now), 169)
  assert.equal(isHistoryBucketAllowed('30d', 'hour', null, now), false)
  assert.equal(chooseHistoryBucket('30d', 'hour', null, now), 'day')
  assert.equal(chooseHistoryBucket('24h', 'hour', null, now), 'hour')
  assert.equal(chooseHistoryBucket('all', 'hour', '2026-01-01T00:00:00Z', now), 'month')
})

test('formats chart and table ranges in UTC', () => {
  assert.match(formatHistoryBucketLabel('2026-08-27T11:00:00Z', '2026-08-27T12:00:00Z', 'hour', 'en-US'), /UTC/)
  assert.equal(formatHistoryBucketLabel('2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', 'month', 'en-US'), 'August 2026')
})

test('source controls retain one selection and support multiple series', () => {
  assert.deepEqual(updateHistorySourceSelection(['total'], 'total', false), ['total'])
  assert.deepEqual(updateHistorySourceSelection(['total'], 'npmRegistry', true), ['total', 'npmRegistry'])
  assert.deepEqual(updateHistorySourceSelection(['total', 'npmRegistry'], 'total', false), ['npmRegistry'])
})

test('chart series retain missing values for either metric', () => {
  const history = normalizeProjectStatsHistory({
    ...payload,
    buckets: [{ ...payload.buckets[0], downloadsAdded: { ...values, total: null } }],
  })
  assert.deepEqual(getHistorySeries(history, 'total', 'downloadsAdded'), [null])
  assert.deepEqual(getHistorySeries(history, 'total', 'cumulative'), [100])
})
