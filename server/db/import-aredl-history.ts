/**
 * AREDL placement-history importer.
 *
 * For every ALL-list level that is also ranked on AREDL, fetches
 * `GET /levels/{gd_id}/history` from api.aredl.net/v2 and stores:
 *
 *   - aredl_position_history — the full raw trace (every event, including the
 *     passive ±1 shifts caused by other levels being placed/removed above).
 *     Powers the position-over-time graph on the level page.
 *
 *   - position_history (source='aredl') — only the level's own moves
 *     (Placed / MovedUp / MovedDown), so the changelog shows deliberate
 *     placements rather than thousands of knock-on shifts. AREDL positions
 *     are converted to their equivalent ALL placements (see below); the raw
 *     AREDL positions are kept in raw_from_position / raw_to_position.
 *
 * AREDL→ALL conversion: the current levels table gives us an anchor mapping
 * (aredl_position → ALL position) for every shared level. A historical AREDL
 * position converts by linear interpolation between the two nearest anchors
 * (exact match → that anchor's ALL position; beyond the ends → clamped).
 *
 * Idempotent: each level's imported rows are deleted and re-inserted, so
 * re-runs pick up new history without duplicating old entries.
 */
import { getDb } from './index.ts'

const API_BASE = process.env.AREDL_API_BASE || 'https://api.aredl.net/v2/api/aredl'
// AREDL's rate limiter starts returning 429s above ~4 concurrent requests.
const PAR = Number(process.env.AREDL_PARALLELISM || 4)

type HistoryEntry = {
  position: number | null
  position_diff: number | null
  event: 'Placed' | 'MovedUp' | 'MovedDown' | 'OtherPlaced' | 'OtherRemoved' | 'OtherMovedUp' | 'OtherMovedDown'
  legacy: boolean
  action_at: string
  cause: { id: string; name: string } | null
}

const SELF_EVENTS = new Set(['Placed', 'MovedUp', 'MovedDown'])

async function fetchJson<T>(path: string, retries = 6): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) {
        if ((res.status >= 500 || res.status === 429) && attempt < retries - 1) {
          const retryAfter = Number(res.headers.get('retry-after'))
          const wait = res.status === 429
            ? (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000 * (attempt + 1))
            : 750 * (attempt + 1)
          await new Promise((r) => setTimeout(r, wait))
          continue
        }
        throw new Error(`HTTP ${res.status} ${url}`)
      }
      return (await res.json()) as T
    } catch (err) {
      if (attempt === retries - 1) throw err
      await new Promise((r) => setTimeout(r, 750 * (attempt + 1)))
    }
  }
  throw new Error('unreachable')
}

async function pmap<T, R>(items: T[], parallel: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(parallel, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i]!, i)
    }
  })
  await Promise.all(workers)
  return out
}

/** ISO datetime → SQLite 'YYYY-MM-DD HH:MM:SS' (UTC), matching position_history. */
function toSqliteUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 19).replace('T', ' ')
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * Build an AREDL→ALL position converter from the current anchor mapping.
 * Anchors: every ALL level with a known aredl_position, sorted by it.
 */
export function buildAredlToAllConverter(
  anchors: Array<{ aredl_position: number; position: number }>,
): (aredlPos: number) => number | null {
  const sorted = [...anchors].sort((a, b) => a.aredl_position - b.aredl_position)
  if (sorted.length === 0) return () => null
  return (p: number) => {
    if (p <= sorted[0]!.aredl_position) return sorted[0]!.position
    const last = sorted[sorted.length - 1]!
    if (p >= last.aredl_position) return last.position
    // Binary search for the bracketing pair.
    let lo = 0, hi = sorted.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (sorted[mid]!.aredl_position <= p) lo = mid
      else hi = mid
    }
    const a = sorted[lo]!, b = sorted[hi]!
    if (a.aredl_position === p) return a.position
    const t = (p - a.aredl_position) / (b.aredl_position - a.aredl_position)
    return Math.round(a.position + t * (b.position - a.position))
  }
}

export async function importAredlHistory() {
  const t0 = Date.now()
  const db = getDb()

  const anchors = db.prepare(
    `SELECT aredl_position, position FROM levels
      WHERE aredl_position IS NOT NULL
      ORDER BY aredl_position ASC`,
  ).all() as Array<{ aredl_position: number; position: number }>
  const convert = buildAredlToAllConverter(anchors)
  console.log(`[aredl-history] ${anchors.length} anchor levels for AREDL→ALL conversion`)

  const targets = db.prepare(
    `SELECT id, gd_id, name FROM levels
      WHERE aredl_position IS NOT NULL AND gd_id IS NOT NULL
      ORDER BY aredl_position ASC`,
  ).all() as Array<{ id: number; gd_id: number; name: string }>
  console.log(`[aredl-history] fetching history for ${targets.length} levels…`)

  const delRaw = db.prepare(`DELETE FROM aredl_position_history WHERE level_id = ?`)
  const insRaw = db.prepare(`
    INSERT INTO aredl_position_history
      (level_id, gd_id, event, aredl_position, all_position, position_diff, legacy, cause_name, action_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `)
  const delSelf = db.prepare(`DELETE FROM position_history WHERE level_id = ? AND source = 'aredl'`)
  const insSelf = db.prepare(`
    INSERT INTO position_history
      (level_id, from_position, to_position, changed_by, changed_at, source, raw_from_position, raw_to_position)
    VALUES (?,?,?,NULL,?,'aredl',?,?)
  `)

  let done = 0, failed = 0, rawRows = 0, selfRows = 0
  const BATCH = 40
  for (let off = 0; off < targets.length; off += BATCH) {
    const slice = targets.slice(off, off + BATCH)
    const results = await pmap(slice, PAR, async (lvl) => {
      try {
        const hist = await fetchJson<HistoryEntry[]>(`/levels/${lvl.gd_id}/history`)
        return { lvl, hist }
      } catch (err: any) {
        failed++
        console.warn(`[aredl-history]   ${lvl.name} (${lvl.gd_id}) failed: ${err?.message ?? err}`)
        return { lvl, hist: null }
      }
    })

    db.exec('BEGIN')
    try {
      for (const { lvl, hist } of results) {
        if (!hist) continue
        // API returns newest-first; walk oldest-first so we can carry the
        // previous position forward for from→to pairs.
        const entries = [...hist].reverse()
        delRaw.run(lvl.id)
        delSelf.run(lvl.id)
        let prevAredl: number | null = null
        for (const e of entries) {
          const at = toSqliteUtc(e.action_at)
          const allPos = e.position != null ? convert(e.position) : null
          insRaw.run(
            lvl.id, lvl.gd_id, e.event,
            e.position ?? null, allPos, e.position_diff ?? null,
            e.legacy ? 1 : 0, e.cause?.name ?? null, at,
          )
          rawRows++
          if (SELF_EVENTS.has(e.event) && e.position != null && allPos != null) {
            // 'Placed' → from NULL (an add); moves → from the carried position.
            const fromAredl = e.event === 'Placed' ? null : prevAredl
            const fromAll = fromAredl != null ? convert(fromAredl) : null
            insSelf.run(lvl.id, fromAll, allPos, at, fromAredl, e.position)
            selfRows++
          }
          if (e.position != null) prevAredl = e.position
        }
        done++
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    console.log(`[aredl-history]   ${Math.min(off + BATCH, targets.length)}/${targets.length} (ok=${done}, failed=${failed})`)
  }

  console.log(`[aredl-history] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${rawRows} trace rows, ${selfRows} changelog rows, ${failed} fetch failures`)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-aredl-history\.ts$/.test(process.argv[1])
if (isCli) {
  importAredlHistory().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
