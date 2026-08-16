/**
 * Aredl importer (api.aredl.net/v2). Mirrors Aredl's classic-demon list into:
 *   - aredl_players (separate from `players`; safe to re-run)
 *   - aredl_levels  (Aredl-only — i.e. levels not on the ALL list)
 *   - levels        (ALL-list rows: backfills aredl_position, aredl_tags,
 *                    edel_enjoyment, and fills empty creator/verifier/publisher)
 *
 * Records are no longer fetched here — `aredl_records` is populated by the
 * Global Stats Viewer importer (server/db/import-gsv.ts). Only hits
 * /api/aredl/ — /api/arepl/ (platformer) is intentionally avoided.
 * Idempotent: every insert uses ON CONFLICT so re-running is a no-op for
 * unchanged rows and an upsert for changed ones.
 */
import { getDb } from './index.ts'
import type { ProgressReporter } from '../utils/imports-state.ts'

const API_BASE = process.env.AREDL_API_BASE || 'https://api.aredl.net/v2/api/aredl'
// AREDL's rate limiter starts returning 429s above ~4 concurrent requests.
const PAR = Number(process.env.AREDL_PARALLELISM || 4)

async function fetchJson<T>(path: string, retries = 6): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) {
        if (res.status >= 500 || res.status === 429) {
          if (attempt < retries - 1) {
            // On 429, honor Retry-After when present; otherwise back off
            // exponentially — AREDL's limiter needs multi-second pauses.
            const retryAfter = Number(res.headers.get('retry-after'))
            const wait = res.status === 429
              ? (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000 * (attempt + 1))
              : 500 * (attempt + 1)
            await new Promise((r) => setTimeout(r, wait))
            continue
          }
        }
        throw new Error(`HTTP ${res.status} ${url}`)
      }
      return (await res.json()) as T
    } catch (err) {
      if (attempt === retries - 1) throw err
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
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

type Paginated<T> = { data: T[]; pages: number; page: number; per_page: number }

async function fetchAllPages<T>(path: string, perPage = 200): Promise<T[]> {
  const sep = path.includes('?') ? '&' : '?'
  const first = await fetchJson<Paginated<T>>(`${path}${sep}page=1&per_page=${perPage}`)
  const out: T[] = [...first.data]
  if (first.pages > 1) {
    const pageNums: number[] = []
    for (let p = 2; p <= first.pages; p++) pageNums.push(p)
    const pages = await pmap(pageNums, PAR, async (p) => {
      const r = await fetchJson<Paginated<T>>(`${path}${sep}page=${p}&per_page=${perPage}`)
      return r.data
    })
    for (const p of pages) out.push(...p)
  }
  return out
}

type LbEntry = {
  rank: number
  user: {
    id: string; username: string; global_name: string
    country: number | null; discord_id: string | null
    /** Discord avatar *hash*, not a URL — see `utils/discord-avatar.ts`. */
    discord_avatar: string | null
  }
  country: number | null
  total_points: number
  pack_points: number
  extremes: number
  hardest: { id: string; name: string } | null
}
type AredlLevelLite = {
  id: string
  name: string
  position: number
  publisher_id: string
  points: number
  legacy: boolean
  level_id: number
  two_player: boolean
  tags: string[] | null
  description: string | null
  song: number | null
  edel_enjoyment: number | null
  is_edel_pending: boolean
  gddl_tier: number | null
  nlw_tier: string | null
}
type AredlLevelDetail = AredlLevelLite & {
  publisher: { id: string; username: string; global_name: string }
  verifications: Array<{
    id: string
    submitted_by: { id: string; username: string; global_name: string }
    video_url: string
    hide_video: boolean
    achieved_at: string
  }>
}
type AredlCreator = { id: string; username: string; global_name: string }

export async function importAredl(report?: ProgressReporter) {
  const t0 = Date.now()
  const db = getDb()
  const now = new Date().toISOString()

  report?.({ phase: 'Fetching the leaderboard', done: 0, total: null })
  console.log('[aredl] Fetching leaderboard…')
  const lb = await fetchAllPages<LbEntry>('/leaderboard', 200)
  console.log(`[aredl]   ${lb.length} players`)

  console.log('[aredl] Fetching level list…')
  const levels = await fetchJson<AredlLevelLite[]>('/levels?exclude_legacy=false')
  console.log(`[aredl]   ${levels.length} levels`)

  // ---- Persist players first so a later phase failure doesn't lose work ----
  report?.({ phase: 'Writing players', done: 0, total: lb.length })
  console.log('[aredl] Writing players…')
  const insPlayer = db.prepare(`
    INSERT INTO aredl_players
      (uuid, username, global_name, country, discord_id, discord_avatar, total_points, pack_points,
       extremes, rank, hardest_uuid, hardest_name, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(uuid) DO UPDATE SET
      username = excluded.username,
      global_name = excluded.global_name,
      country = excluded.country,
      discord_id = excluded.discord_id,
      discord_avatar = excluded.discord_avatar,
      total_points = excluded.total_points,
      pack_points = excluded.pack_points,
      extremes = excluded.extremes,
      rank = excluded.rank,
      hardest_uuid = excluded.hardest_uuid,
      hardest_name = excluded.hardest_name,
      fetched_at = excluded.fetched_at
  `)
  db.exec('BEGIN')
  try {
    for (const e of lb) {
      insPlayer.run(
        e.user.id,
        e.user.username,
        e.user.global_name,
        e.user.country ?? null,
        e.user.discord_id ?? null,
        e.user.discord_avatar ?? null,
        e.total_points ?? 0,
        e.pack_points ?? 0,
        e.extremes ?? 0,
        e.rank ?? null,
        e.hardest?.id ?? null,
        e.hardest?.name ?? null,
        now,
      )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  console.log(`[aredl] Fetching per-level detail + creators (${levels.length} × 2)…`)
  report?.({ phase: 'Fetching level detail', done: 0, total: levels.length })
  const findExisting = db.prepare(`SELECT id, creator, verifier, publisher FROM levels WHERE gd_id = ?`)
  const claimedGdId = db.prepare(`SELECT uuid FROM aredl_levels WHERE gd_id = ?`)
  const mergeExisting = db.prepare(`
    UPDATE levels
       SET aredl_position = ?,
           aredl_tags     = ?,
           edel_enjoyment = ?,
           creator        = CASE WHEN COALESCE(creator,'')   = '' THEN ? ELSE creator   END,
           verifier       = CASE WHEN COALESCE(verifier,'')  = '' THEN ? ELSE verifier  END,
           publisher      = CASE WHEN COALESCE(publisher,'') = '' THEN ? ELSE publisher END
     WHERE id = ?
  `)
  const insAredlLevel = db.prepare(`
    INSERT INTO aredl_levels
      (uuid, gd_id, position, name, points, legacy, two_player, tags, description, song,
       edel_enjoyment, is_edel_pending, gddl_tier, nlw_tier, publisher_uuid, publisher_name,
       verifier_name, verification_url, creators_json, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(uuid) DO UPDATE SET
      gd_id = excluded.gd_id, position = excluded.position, name = excluded.name,
      points = excluded.points, legacy = excluded.legacy, two_player = excluded.two_player,
      tags = excluded.tags, description = excluded.description, song = excluded.song,
      edel_enjoyment = excluded.edel_enjoyment, is_edel_pending = excluded.is_edel_pending,
      gddl_tier = excluded.gddl_tier, nlw_tier = excluded.nlw_tier,
      publisher_uuid = excluded.publisher_uuid, publisher_name = excluded.publisher_name,
      verifier_name = excluded.verifier_name, verification_url = excluded.verification_url,
      creators_json = excluded.creators_json, fetched_at = excluded.fetched_at
  `)

  // Process levels in batches: fetch detail + creators for each one, then
  // commit. A failure mid-stream still keeps work done so far.
  let merged = 0, aredlOnly = 0, skippedVariant = 0, failedBatches = 0
  const PERSIST_BATCH = 50
  for (let off = 0; off < levels.length; off += PERSIST_BATCH) {
    const slice = levels.slice(off, off + PERSIST_BATCH)
    /**
     * Two detail calls per level is ~3,000 requests for one run, so a single
     * failure anywhere used to reject the batch, escape the loop and abandon
     * every level after it — which is how the list ended up with placements for
     * the first 888 of 1,547 and no indication that the rest were missing.
     * A level that can't be fetched is skipped; the run continues.
     */
    let detailed: { lite: AredlLevelLite; detail: AredlLevelDetail; creators: AredlCreator[] }[]
    try {
      detailed = await pmap(slice, PAR, async (lvl) => {
        const [detail, creators] = await Promise.all([
          fetchJson<AredlLevelDetail>(`/levels/${lvl.id}`),
          fetchJson<AredlCreator[]>(`/levels/${lvl.id}/creators`),
        ])
        return { lite: lvl, detail, creators }
      })
    } catch (err) {
      failedBatches++
      console.warn(`[aredl]   warn: batch at ${off} failed (${(err as Error).message}) — skipping it`)
      continue
    }

    db.exec('BEGIN')
    try {
      for (const item of detailed) {
        const lite = item.lite
        const detail = item.detail
        const creators = item.creators ?? []
        const verifications = detail.verifications ?? []
        const firstVer = verifications[0]
        const verifier = firstVer?.submitted_by?.global_name ?? null
        const verUrl = firstVer?.video_url ?? null
        const publisher = detail.publisher?.global_name ?? null
        const creatorsList = creators.map((c) => c.global_name).filter(Boolean)
        const creatorStr = creatorsList.join(' & ') || null
        const tagsJson = JSON.stringify(lite.tags ?? [])

        const existing = findExisting.get(lite.level_id) as { id: number } | undefined
        // AREDL lists a level's 2-player and solo variants as separate entries
        // that share one GD level ID, but aredl_levels.gd_id is UNIQUE. Keep
        // whichever variant we saw first — the same first-wins rule the sheet
        // importer uses for position collisions.
        const claimed = claimedGdId.get(lite.level_id) as { uuid: string } | undefined
        if (existing) {
          mergeExisting.run(
            lite.position,
            tagsJson,
            lite.edel_enjoyment ?? null,
            creatorStr,
            verifier,
            publisher,
            existing.id,
          )
          merged++
        } else if (claimed && claimed.uuid !== lite.id) {
          skippedVariant++
        } else {
          insAredlLevel.run(
            lite.id,
            lite.level_id,
            lite.position,
            lite.name,
            lite.points ?? 0,
            lite.legacy ? 1 : 0,
            lite.two_player ? 1 : 0,
            tagsJson,
            detail.description ?? lite.description ?? null,
            lite.song ?? null,
            lite.edel_enjoyment ?? null,
            lite.is_edel_pending ? 1 : 0,
            lite.gddl_tier ?? null,
            lite.nlw_tier ?? null,
            detail.publisher?.id ?? null,
            publisher,
            verifier,
            verUrl,
            JSON.stringify(creatorsList),
            now,
          )
          aredlOnly++
        }
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }

    const done = Math.min(off + PERSIST_BATCH, levels.length)
    report?.({ done })
    console.log(`[aredl]   ${done}/${levels.length} levels processed (merged=${merged}, aredl-only=${aredlOnly})`)
  }
  console.log(`[aredl] Levels: ${merged} merged into ALL, ${aredlOnly} Aredl-only, ${skippedVariant} duplicate-gd_id variants skipped`)
  if (failedBatches) {
    console.warn(
      `[aredl] ${failedBatches} batch(es) could not be fetched. Placements for those levels are ` +
      `unchanged — run "Refresh placements" to fill them in from the list endpoint alone.`,
    )
  }

  console.log(`[aredl] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

/**
 * Refresh only where AREDL places each level.
 *
 * The full import fetches two detail endpoints per level to pick up creators,
 * verifiers and descriptions — roughly three thousand requests, and the reason
 * a run can die halfway and leave most of the list with no placement at all.
 * Every placement, though, is already in the single `/levels` response: one
 * request, every level, no detail needed.
 *
 * So this is the repair for exactly that failure, and the thing to run when the
 * only stale fact is the ordering. It touches `aredl_position` and nothing else
 * — a level's creator, verifier and description stay as the full import left
 * them, because this call has no opinion about them.
 */
export async function refreshAredlPlacements(report?: ProgressReporter) {
  const t0 = Date.now()
  const db = getDb()
  report?.({ phase: 'Fetching AREDL placements', done: 0, total: null })
  console.log('[aredl] Refreshing placements…')

  const levels = await fetchJson<AredlLevelLite[]>('/levels?exclude_legacy=false')
  console.log(`[aredl]   ${levels.length} level(s) from the API`)
  report?.({ phase: 'Writing placements', done: 0, total: levels.length })

  const findByGd = db.prepare(`SELECT id FROM levels WHERE gd_id = ?`)
  const setPos = db.prepare(`UPDATE levels SET aredl_position = ? WHERE id = ?`)
  const clearPos = db.prepare(
    `UPDATE levels SET aredl_position = NULL WHERE aredl_position IS NOT NULL AND gd_id NOT IN (SELECT value FROM json_each(?))`,
  )

  let matched = 0, unmatched = 0, variants = 0, done = 0
  db.exec('BEGIN')
  try {
    const seen: number[] = []
    // AREDL lists a level's Solo and 2-player entries separately under one GD
    // ID, and the ALL usually carries a single row for it. First wins, matching
    // the rule the sheet and full AREDL importers already use — otherwise the
    // row silently ends up with whichever variant happened to be read last.
    const claimed = new Set<number>()
    for (const lvl of levels) {
      const gd = Number(lvl.level_id)
      if (Number.isInteger(gd) && gd > 0) {
        seen.push(gd)
        if (claimed.has(gd)) { variants++ }
        else {
          const row = findByGd.get(gd) as { id: number } | undefined
          if (row) { setPos.run(lvl.position, row.id); matched++; claimed.add(gd) }
          else { unmatched++; claimed.add(gd) }
        }
      }
      if (++done % 200 === 0) report?.({ done })
    }
    // A level AREDL has dropped should stop claiming an AREDL placement, or the
    // list keeps showing a rank that no longer exists anywhere.
    const cleared = clearPos.run(JSON.stringify(seen))
    db.exec('COMMIT')
    console.log(
      `[aredl]   ${matched} placement(s) written, ${unmatched} AREDL level(s) not on the ALL, ` +
      `${variants} duplicate-gd_id variant(s) skipped, ${cleared.changes} stale placement(s) cleared`,
    )
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  report?.({ done: levels.length })
  console.log(`[aredl] Placements refreshed in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-aredl\.ts$/.test(process.argv[1])
if (isCli) {
  importAredl().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
