import { randomUUID } from 'node:crypto'
import { collectProjectStats } from '../project-stats.js'
import {
  HISTORY_ERROR_CACHE_CONTROL,
  acquireSnapshotLock,
  createRedisClientFromEnv,
  releaseSnapshotLock,
  sendHistoryJson,
  storeProjectStatsSnapshot,
} from '../_project-stats-history.js'

export function isAuthorizedCron(request, secret) {
  if (!secret) return false
  const authorization = request?.headers?.authorization ?? request?.headers?.Authorization
  return authorization === `Bearer ${secret}`
}

export async function runSnapshotCron({
  request,
  response,
  env = process.env,
  now = new Date(),
  redis,
  collect = collectProjectStats,
  token = randomUUID(),
} = {}) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    sendHistoryJson(response, 405, { error: 'Method not allowed' })
    return
  }
  if (!isAuthorizedCron(request, env.CRON_SECRET)) {
    sendHistoryJson(response, 401, { error: 'Unauthorized' })
    return
  }

  let store
  try {
    store = redis ?? createRedisClientFromEnv(env)
  } catch {
    sendHistoryJson(response, 503, { error: 'History storage is not configured' })
    return
  }

  let locked = false
  try {
    locked = await acquireSnapshotLock(store, token)
    if (!locked) {
      sendHistoryJson(response, 409, { error: 'A statistics snapshot is already running' })
      return
    }
  } catch {
    sendHistoryJson(response, 503, { error: 'History storage is temporarily unavailable' })
    return
  }

  try {
    let stats
    try {
      stats = await collect({ now })
    } catch {
      sendHistoryJson(response, 502, { error: 'Project statistics are temporarily unavailable' })
      return
    }
    const result = await storeProjectStatsSnapshot(store, stats, now)
    sendHistoryJson(response, 200, {
      stored: result.inserted,
      hour: new Date(result.hourStart).toISOString(),
    }, HISTORY_ERROR_CACHE_CONTROL)
  } catch {
    sendHistoryJson(response, 503, { error: 'History storage is temporarily unavailable' })
  } finally {
    try { await releaseSnapshotLock(store, token) } catch { /* The lock expires after five minutes. */ }
  }
}

export default async function handler(request, response) {
  await runSnapshotCron({ request, response })
}
