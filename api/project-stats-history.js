import {
  HISTORY_ERROR_CACHE_CONTROL,
  HistoryQueryError,
  HISTORY_SOURCES,
  HISTORY_SUCCESS_CACHE_CONTROL,
  buildHistoryResponse,
  createRedisClientFromEnv,
  sendHistoryJson,
} from './_project-stats-history.js'

export async function runHistoryRequest({
  request,
  response,
  env = process.env,
  now = new Date(),
  redis,
} = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD')
    sendHistoryJson(response, 405, { error: 'Method not allowed' })
    return
  }

  let store
  try {
    store = redis ?? createRedisClientFromEnv(env)
  } catch {
    sendHistoryJson(response, 503, { error: 'Download history is not configured' })
    return
  }

  try {
    // Validate even before the first snapshot exists, so deterministic client
    // mistakes never masquerade as an empty history response.
    const requestedRange = Array.isArray(request.query?.range) ? request.query.range[0] : request.query?.range
    const requestedBucket = Array.isArray(request.query?.bucket) ? request.query.bucket[0] : request.query?.bucket
    if (!['24h', '7d', '30d', '1y', 'all'].includes(requestedRange)) {
      throw new HistoryQueryError('Unknown history range')
    }
    if (!['hour', 'day', 'week', 'month', 'year'].includes(requestedBucket)) {
      throw new HistoryQueryError('Unknown history bucket')
    }
    const history = await buildHistoryResponse(store, request.query ?? {}, now)
    if (!history) {
      sendHistoryJson(response, 200, {
        schemaVersion: 1,
        generatedAt: new Date(now).toISOString(),
        trackingStartedAt: null,
        range: requestedRange,
        bucket: requestedBucket,
        stale: false,
        sources: HISTORY_SOURCES.map((source) => ({ ...source })),
        buckets: [],
      }, HISTORY_SUCCESS_CACHE_CONTROL)
      return
    }
    sendHistoryJson(response, 200, history, HISTORY_SUCCESS_CACHE_CONTROL)
  } catch (error) {
    if (error instanceof HistoryQueryError) {
      sendHistoryJson(response, 400, { error: error.message }, HISTORY_ERROR_CACHE_CONTROL)
      return
    }
    sendHistoryJson(
      response,
      503,
      { error: 'Download history is temporarily unavailable' },
      HISTORY_ERROR_CACHE_CONTROL,
    )
  }
}

export default async function handler(request, response) {
  await runHistoryRequest({ request, response })
}
