import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HISTORY_SOURCES,
  MAX_HISTORY_BUCKETS,
  aggregateHistory,
  buildHistoryResponse,
  flattenProjectStats,
  resolveHistoryQuery,
  storeProjectStatsSnapshot,
} from '../api/_project-stats-history.js'
import { runSnapshotCron } from '../api/cron/project-stats.js'
import { runHistoryRequest } from '../api/project-stats-history.js'

const HOUR_MS = 60 * 60 * 1_000

function stats(overrides = {}) {
  const values = {
    total: 420,
    npmRegistry: 100,
    releaseTarball: 50,
    dockerHub: 200,
    releaseBundles: 30,
    standaloneArchives: 40,
    installerPosix: 9_000,
    installerPowershell: 8_000,
    ...overrides,
  }
  return {
    downloads: {
      total: values.total,
      npmRegistry: values.npmRegistry,
      dockerHub: values.dockerHub,
      github: {
        npmTarball: values.releaseTarball,
        bundle: values.releaseBundles,
        standalone: values.standaloneArchives,
        installerScripts: {
          posix: values.installerPosix,
          powershell: values.installerPowershell,
        },
      },
    },
  }
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

function record(periodStart, values) {
  return {
    periodStart,
    capturedAt: new Date(periodStart + 5 * 60_000).toISOString(),
    values,
  }
}

test('flattens every stable source while declaring installer fetches outside the total', () => {
  assert.deepEqual(flattenProjectStats(stats()), {
    total: 420,
    npmRegistry: 100,
    releaseTarball: 50,
    dockerHub: 200,
    releaseBundles: 30,
    standaloneArchives: 40,
    installerPosix: 9_000,
    installerPowershell: 8_000,
  })
  assert.deepEqual(
    HISTORY_SOURCES.filter(({ includedInTotal }) => !includedInTotal).map(({ key }) => key),
    ['installerPosix', 'installerPowershell'],
  )
})

test('validates ranges and buckets and refuses responses over 400 points', () => {
  const now = new Date('2026-08-27T12:05:00.000Z')
  assert.throws(() => resolveHistoryQuery({ range: 'yesterday', bucket: 'hour' }, { now }), /Unknown history range/)
  assert.throws(() => resolveHistoryQuery({ range: '24h', bucket: 'quarter' }, { now }), /Unknown history bucket/)
  assert.throws(
    () => resolveHistoryQuery({ range: '30d', bucket: 'hour' }, { now, trackingStartedAt: '2020-01-01T00:00:00.000Z' }),
    new RegExp(`${MAX_HISTORY_BUCKETS} buckets`),
  )
  assert.throws(
    () => resolveHistoryQuery({ range: '30d', bucket: 'hour' }, { now, trackingStartedAt: '2026-08-26T00:00:00.000Z' }),
    new RegExp(`${MAX_HISTORY_BUCKETS} buckets`),
  )
  assert.ok(resolveHistoryQuery(
    { range: '1y', bucket: 'day' },
    { now, trackingStartedAt: '2020-01-01T00:00:00.000Z' },
  ).bucketStarts.length <= MAX_HISTORY_BUCKETS)
})

test('the atomic snapshot script is hourly-idempotent and updates a daily rollup', async () => {
  const commands = []
  let inserted = 1
  const redis = {
    async command(command) {
      commands.push(command)
      const result = inserted
      inserted = 0
      return result
    },
  }
  const first = await storeProjectStatsSnapshot(redis, stats(), new Date('2026-08-27T12:05:00.000Z'))
  const duplicate = await storeProjectStatsSnapshot(redis, stats(), new Date('2026-08-27T12:35:00.000Z'))

  assert.equal(first.inserted, true)
  assert.equal(duplicate.inserted, false)
  assert.equal(first.hourStart, Date.parse('2026-08-27T12:00:00.000Z'))
  assert.equal(first.dayStart, Date.parse('2026-08-27T00:00:00.000Z'))
  assert.match(commands[0][1], /HSETNX/)
  assert.match(commands[0][1], /ZADD/)
  assert.match(commands[0][1], /HSET.*lastSuccessfulAt/s)
})

test('aggregation leaves gaps unknown and handles a confirmed reset without negative values', () => {
  const start = Date.parse('2026-08-27T08:00:00.000Z')
  const base = flattenProjectStats(stats())
  const records = [
    record(start, { ...base, total: 100 }),
    record(start + HOUR_MS, { ...base, total: 110 }),
    record(start + 2 * HOUR_MS, { ...base, total: 20 }),
    record(start + 3 * HOUR_MS, { ...base, total: 25 }),
    // 11:00 is missing; no delta may span the gap.
    record(start + 5 * HOUR_MS, { ...base, total: 30 }),
  ]
  const query = {
    bucket: 'hour',
    start: start + HOUR_MS,
    nowEpoch: start + 6 * HOUR_MS,
    bucketStarts: [1, 2, 3, 4, 5].map((offset) => start + offset * HOUR_MS),
  }
  const buckets = aggregateHistory(records, query)

  assert.equal(buckets[0].downloadsAdded.total, 10)
  assert.equal(buckets[1].downloadsAdded.total, null)
  assert.equal(buckets[2].downloadsAdded.total, 5)
  assert.equal(buckets[3].complete, false)
  assert.equal(buckets[4].downloadsAdded.total, null)
  for (const bucket of buckets) {
    assert.ok(bucket.downloadsAdded.total === null || bucket.downloadsAdded.total >= 0)
  }
})

test('history response exposes the agreed schema and marks old data stale', async () => {
  const snapshotAt = Date.parse('2026-08-27T08:00:00.000Z')
  const raw = JSON.stringify(record(snapshotAt, flattenProjectStats(stats())))
  const redis = {
    async pipeline() { return [new Date(snapshotAt).toISOString(), new Date(snapshotAt).toISOString()] },
    async command(command) {
      if (command[0] === 'ZRANGE') return [String(snapshotAt)]
      if (command[0] === 'HMGET') return [raw]
      throw new Error(`Unexpected command ${command[0]}`)
    },
  }
  const result = await buildHistoryResponse(
    redis,
    { range: '24h', bucket: 'hour' },
    new Date('2026-08-27T12:05:00.000Z'),
  )

  assert.deepEqual(Object.keys(result), [
    'schemaVersion', 'generatedAt', 'trackingStartedAt', 'range', 'bucket', 'stale', 'sources', 'buckets',
  ])
  assert.equal(result.schemaVersion, 1)
  assert.equal(result.stale, true)
  assert.deepEqual(Object.keys(result.buckets[0]), [
    'start', 'end', 'partial', 'complete', 'downloadsAdded', 'cumulative',
  ])
})

test('cron protects the route, reports missing configuration, and prevents concurrent work', async () => {
  const unauthorized = createResponse()
  await runSnapshotCron({
    request: { method: 'GET', headers: {} }, response: unauthorized, env: { CRON_SECRET: 'secret' },
  })
  assert.equal(unauthorized.statusCode, 401)

  const unconfigured = createResponse()
  await runSnapshotCron({
    request: { method: 'GET', headers: { authorization: 'Bearer secret' } },
    response: unconfigured,
    env: { CRON_SECRET: 'secret' },
  })
  assert.equal(unconfigured.statusCode, 503)

  const concurrent = createResponse()
  await runSnapshotCron({
    request: { method: 'GET', headers: { authorization: 'Bearer secret' } },
    response: concurrent,
    env: { CRON_SECRET: 'secret' },
    redis: { command: async () => null },
  })
  assert.equal(concurrent.statusCode, 409)
})

test('cron distinguishes upstream failures from Redis failures and always releases its lock', async () => {
  let releaseCalls = 0
  const redis = {
    async command(command) {
      if (command[0] === 'SET') return 'OK'
      if (command[0] === 'EVAL' && command[1].includes("redis.call('GET'")) {
        releaseCalls += 1
        return 1
      }
      throw new Error('Redis write failed')
    },
  }
  const upstream = createResponse()
  await runSnapshotCron({
    request: { method: 'GET', headers: { authorization: 'Bearer secret' } },
    response: upstream,
    env: { CRON_SECRET: 'secret' },
    redis,
    collect: async () => { throw new Error('upstream') },
  })
  assert.equal(upstream.statusCode, 502)
  assert.equal(releaseCalls, 1)

  const storage = createResponse()
  await runSnapshotCron({
    request: { method: 'GET', headers: { authorization: 'Bearer secret' } },
    response: storage,
    env: { CRON_SECRET: 'secret' },
    redis,
    collect: async () => stats(),
  })
  assert.equal(storage.statusCode, 503)
  assert.equal(releaseCalls, 2)
})

test('public endpoint rejects invalid and oversized queries without caching errors', async () => {
  const redis = { pipeline: async () => ['2020-01-01T00:00:00.000Z', '2026-08-27T12:00:00.000Z'] }
  const invalid = createResponse()
  await runHistoryRequest({
    request: { method: 'GET', query: { range: '24h', bucket: 'nope' } },
    response: invalid,
    redis,
  })
  assert.equal(invalid.statusCode, 400)
  assert.equal(invalid.getHeader('cache-control'), 'no-store')

  const oversized = createResponse()
  await runHistoryRequest({
    request: { method: 'GET', query: { range: '30d', bucket: 'hour' } },
    response: oversized,
    redis,
    now: new Date('2026-08-27T12:05:00.000Z'),
  })
  assert.equal(oversized.statusCode, 400)
})

test('public endpoint returns a valid empty-state basis before the first snapshot', async () => {
  const response = createResponse()
  await runHistoryRequest({
    request: { method: 'GET', query: { range: ['24h', '7d'], bucket: ['hour', 'day'] } },
    response,
    redis: { pipeline: async () => [null, null] },
    now: new Date('2026-08-27T12:05:00.000Z'),
  })
  const payload = JSON.parse(response.body)
  assert.equal(response.statusCode, 200)
  assert.equal(payload.trackingStartedAt, null)
  assert.equal(payload.range, '24h')
  assert.equal(payload.bucket, 'hour')
  assert.deepEqual(payload.sources, HISTORY_SOURCES)
  assert.deepEqual(payload.buckets, [])
})

test('stored-data errors are server failures, not client validation errors', async () => {
  const response = createResponse()
  await runHistoryRequest({
    request: { method: 'GET', query: { range: '24h', bucket: 'hour' } },
    response,
    redis: {
      pipeline: async () => ['2026-08-27T08:00:00.000Z', 'not-a-date'],
    },
  })
  assert.equal(response.statusCode, 503)
})
