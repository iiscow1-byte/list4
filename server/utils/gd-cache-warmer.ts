/**
 * Background warmer for gd_info_cache. Fires when an admin triggers
 * /api/admin/gd-cache/start, walks every level whose gd_id has no cache row,
 * and fetches via the shared pipeline in ~/server/utils/gd-fetch.
 *
 * Walk order is `levels.position ASC` so the front of the list (the highest-
 * profile entries) gets cached first.
 *
 * A 60-second heartbeat logs the most recently loaded level so progress is
 * visible in the server logs without spamming per-fetch lines.
 */

import { getDb } from '~/server/db'
import { fetchOneClassified } from '~/server/utils/gd-fetch'

// Pacing knobs. gdbrowser is unmetered but uses Cloudflare; Boomlings is the
// hard rate limit when the fallback fires.
const BASE_DELAY_MS = 1100
const BOOMLINGS_EXTRA_DELAY_MS = 1500
const BACKOFF_INITIAL_MS = 5_000
const BACKOFF_MAX_MS = 5 * 60_000
const CONSECUTIVE_ERROR_HARD_STOP = 25
const HEARTBEAT_MS = 60_000

type WarmerStatus = {
  running: boolean
  startedAt: string | null
  stoppedAt: string | null
  totalQueued: number
  processed: number
  ok: number
  notFound: number
  errors: number
  lastLevel: { gd_id: number; name: string | null; position: number; at: string } | null
  lastError: string | null
}

let state: WarmerStatus = {
  running: false,
  startedAt: null,
  stoppedAt: null,
  totalQueued: 0,
  processed: 0,
  ok: 0,
  notFound: 0,
  errors: 0,
  lastLevel: null,
  lastError: null,
}

let stopRequested = false
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function emitHeartbeat() {
  const last = state.lastLevel
  if (!last) {
    console.log(
      `[gd-warmer] heartbeat — processed=${state.processed}/${state.totalQueued} ok=${state.ok} notFound=${state.notFound} err=${state.errors} (no level loaded yet)`,
    )
    return
  }
  console.log(
    `[gd-warmer] heartbeat — processed=${state.processed}/${state.totalQueued} ok=${state.ok} notFound=${state.notFound} err=${state.errors} ` +
    `last=#${last.position} "${last.name ?? '(no name)'}" gd_id=${last.gd_id} at=${last.at}`,
  )
}

export function getWarmerStatus(): WarmerStatus {
  return { ...state, lastLevel: state.lastLevel ? { ...state.lastLevel } : null }
}

export function stopWarmer(): boolean {
  if (!state.running) return false
  stopRequested = true
  return true
}

export function startWarmer(): { started: boolean; status: WarmerStatus } {
  if (state.running) return { started: false, status: getWarmerStatus() }

  // Reset state for a fresh run.
  state = {
    running: true,
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    totalQueued: 0,
    processed: 0,
    ok: 0,
    notFound: 0,
    errors: 0,
    lastLevel: null,
    lastError: null,
  }
  stopRequested = false

  heartbeatTimer = setInterval(emitHeartbeat, HEARTBEAT_MS)
  // Don't keep the Node event loop alive just for the heartbeat.
  if (typeof heartbeatTimer === 'object' && heartbeatTimer && 'unref' in heartbeatTimer) {
    (heartbeatTimer as { unref: () => void }).unref()
  }

  void runLoop().catch((e) => {
    state.lastError = String(e?.message ?? e)
    console.error('[gd-warmer] fatal:', e)
  }).finally(() => {
    state.running = false
    state.stoppedAt = new Date().toISOString()
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
    console.log(
      `[gd-warmer] done. processed=${state.processed} ok=${state.ok} notFound=${state.notFound} err=${state.errors}`,
    )
  })

  return { started: true, status: getWarmerStatus() }
}

async function runLoop() {
  const db = getDb()

  // Top-of-list-down: order by position ASC. Snapshot the queue at start so
  // late inserts don't extend the run; admins can re-trigger to pick those up.
  const rows = db.prepare(
    `SELECT l.id AS level_id, l.position AS position, l.name AS name, l.gd_id AS gd_id
       FROM levels l
      WHERE l.gd_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM gd_info_cache c WHERE c.gd_id = l.gd_id)
      ORDER BY l.position ASC`,
  ).all() as { level_id: number; position: number; name: string | null; gd_id: number }[]

  state.totalQueued = rows.length
  console.log(`[gd-warmer] starting — ${rows.length} levels queued (top-down by position)`)
  if (rows.length === 0) return

  const insert = db.prepare(
    `INSERT INTO gd_info_cache (gd_id, info_json, fetched_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(gd_id) DO UPDATE SET info_json = excluded.info_json, fetched_at = excluded.fetched_at`,
  )

  let consecutiveErrors = 0
  let backoffMs = BACKOFF_INITIAL_MS

  for (const row of rows) {
    if (stopRequested) {
      console.log('[gd-warmer] stop requested — exiting cleanly')
      break
    }

    const result = await fetchOneClassified(row.gd_id)
    state.processed++

    if (result.kind === 'ok') {
      insert.run(row.gd_id, JSON.stringify(result.info))
      state.ok++
      state.lastLevel = {
        gd_id: row.gd_id,
        name: row.name,
        position: row.position,
        at: new Date().toISOString(),
      }
      consecutiveErrors = 0
      backoffMs = BACKOFF_INITIAL_MS
    } else if (result.kind === 'not_found') {
      state.notFound++
      // Still update lastLevel so the heartbeat reflects forward progress.
      state.lastLevel = {
        gd_id: row.gd_id,
        name: row.name,
        position: row.position,
        at: new Date().toISOString(),
      }
      consecutiveErrors = 0
      backoffMs = BACKOFF_INITIAL_MS
    } else {
      state.errors++
      state.lastError = result.reason
      if (result.rateLimited) {
        consecutiveErrors++
        if (consecutiveErrors >= CONSECUTIVE_ERROR_HARD_STOP) {
          console.error(
            `[gd-warmer] ${consecutiveErrors} consecutive rate-limited errors — aborting. Trigger /api/admin/gd-cache/start again later to resume.`,
          )
          break
        }
        const wait = Math.min(backoffMs, BACKOFF_MAX_MS)
        console.warn(
          `[gd-warmer] gd_id=${row.gd_id} ${result.usedBoomlings ? 'boomlings' : 'gdbrowser'} error "${result.reason}" — backing off ${wait}ms (consecutive=${consecutiveErrors})`,
        )
        await sleep(wait)
        backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS)
      } else {
        console.warn(`[gd-warmer] gd_id=${row.gd_id} skipped: ${result.reason}`)
      }
    }

    // Pace the next request. Boomlings hits get extra spacing because that's
    // the backend that actually rate-limits.
    let pause = BASE_DELAY_MS
    if (result.kind === 'ok' && result.usedBoomlings) pause += BOOMLINGS_EXTRA_DELAY_MS
    if (result.kind === 'error' && result.usedBoomlings) pause += BOOMLINGS_EXTRA_DELAY_MS
    await sleep(pause)
  }
}
