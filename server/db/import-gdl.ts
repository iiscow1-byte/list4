/**
 * GDL importer (Global Demonlist, https://api.demonlist.org). Mirrors GDL's
 * classic-demon list into:
 *   - gdl_players (separate from `players` / `aredl_players` / `pointercrate_players`)
 *   - gdl_levels  (GDL-only — i.e. levels not on the ALL list)
 *   - levels      (ALL-list rows: backfills gdl_position, fills empty creator/verifier
 *                  if absent locally)
 *   - gdl_records (per-level fetch via /level/classic/record/list)
 *
 * Idempotent: every insert uses ON CONFLICT so re-running is a no-op for
 * unchanged rows and an upsert for changed ones.
 *
 * Pagination model: the GDL API returns bare `{message, data: { levels|users|records }}`
 * — no page count, no Link header. We page by `limit`/`offset` until the
 * returned array is short of `limit`.
 */
import { getDb } from './index.ts'
import { buildAnchors, estimateForSourcePosition } from '../utils/import-estimates.ts'

const API_BASE = process.env.GDL_API_BASE || 'https://api.demonlist.org'
const PAR = Number(process.env.GDL_PARALLELISM || 8)

async function fetchJson<T>(path: string, retries = 3): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) {
        if (res.status >= 500 || res.status === 429) {
          if (attempt < retries - 1) {
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
            continue
          }
        }
        throw new Error(`HTTP ${res.status} ${url}`)
      }
      return (await res.json()) as T
    } catch (err) {
      if (attempt === retries - 1) throw err
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
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

type ApiResp<T> = { message: string; data: T }

type GdlListItem = {
  id: number
  ingame_id: number
  placement: number
  name: string
  points: number | string
  list_percent: number
  length: number
  holder: string
  verifier: { user_id: number; username: string }
  verification_url: string
  date_created: string
}
type GdlLevelDetail = GdlListItem & {
  objects: number
  description: string | null
  creator: string
  song_url: string | null
  game_version: number
  verification: { user_id: number; username: string; video_url: string }
  copy_info: { is_copyable: boolean; password: string | null }
}
type GdlLeaderboardItem = {
  id: number
  username: string
  placement: number
  points: number | string
  country: string
  badge: string
}
type GdlUserGet = {
  username: string
  placement: number
  points: number | string
  country: string
  badge: string
  is_banned: boolean
  levels: {
    hardest: { id: number; name: string; placement: number } | null
    main: Array<{ id: number; name: string; placement: number }>
    extended: Array<{ id: number; name: string; placement: number }>
    advanced: Array<{ id: number; name: string; placement: number }>
    unbounded: Array<{ id: number; name: string; placement: number }>
    progress: Array<{ id: number; name: string; placement: number; percent: number }>
    verified: Array<{ id: number; name: string; placement: number }>
  }
}
type GdlRecord = {
  id: number
  percent: number
  video_url: string
  user: { id: number; username: string; country: string }
}

// GDL caps `limit` at 50 on /leaderboard/user/list and /level/classic/record/list.
// /level/classic/list has no documented cap but 50 works fine. Keeping a single
// page size for all endpoints avoids accidental 400s.
const PAGE = 50

async function fetchAllLevels(listType: 'main' | 'extended' | 'advanced' | 'unbounded'): Promise<GdlListItem[]> {
  const out: GdlListItem[] = []
  let offset = 0
  while (true) {
    const r = await fetchJson<ApiResp<{ levels: GdlListItem[] }>>(
      `/level/classic/list?list_type=${listType}&limit=${PAGE}&offset=${offset}`,
    )
    out.push(...r.data.levels)
    if (r.data.levels.length < PAGE) break
    offset += PAGE
  }
  return out
}

async function fetchAllPlayers(): Promise<GdlLeaderboardItem[]> {
  const out: GdlLeaderboardItem[] = []
  let offset = 0
  while (true) {
    const r = await fetchJson<ApiResp<{ users: GdlLeaderboardItem[] }>>(
      `/leaderboard/user/list?limit=${PAGE}&offset=${offset}`,
    )
    out.push(...r.data.users)
    if (r.data.users.length < PAGE) break
    offset += PAGE
  }
  return out
}

async function fetchLevelRecords(levelId: number): Promise<GdlRecord[]> {
  const out: GdlRecord[] = []
  let offset = 0
  while (true) {
    const r = await fetchJson<ApiResp<{ records: GdlRecord[]; total_count: number }>>(
      `/level/classic/record/list?level_id=${levelId}&limit=${PAGE}&offset=${offset}`,
    )
    out.push(...r.data.records)
    if (r.data.records.length < PAGE) break
    offset += PAGE
  }
  return out
}

const numFromStr = (v: number | string | null | undefined): number | null => {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export async function importGdl() {
  const t0 = Date.now()
  const db = getDb()
  const now = new Date().toISOString()

  console.log('[gdl] Fetching leaderboard…')
  const players = await fetchAllPlayers()
  console.log(`[gdl]   ${players.length} players`)

  console.log('[gdl] Fetching level lists…')
  const [main, extended, advanced, unbounded] = await Promise.all([
    fetchAllLevels('main'),
    fetchAllLevels('extended'),
    fetchAllLevels('advanced'),
    fetchAllLevels('unbounded'),
  ])
  // Tag each with its source list_type. A single level only appears in one
  // list_type (main vs extended vs advanced vs unbounded), so a flat merge is fine.
  const levelsByType: Array<[GdlListItem[], string]> = [
    [main, 'main'], [extended, 'extended'], [advanced, 'advanced'], [unbounded, 'unbounded'],
  ]
  const levels: Array<GdlListItem & { list_type: string }> = []
  for (const [arr, t] of levelsByType) for (const l of arr) levels.push({ ...l, list_type: t })
  console.log(`[gdl]   ${levels.length} levels (main=${main.length} ext=${extended.length} adv=${advanced.length} unb=${unbounded.length})`)

  // ---- Players first so a later phase failure doesn't lose work ----
  // Hardest-level lookup needs a per-player /user/get fetch — skipped here for
  // load reasons. The lazy player-profile API fills it in on first view.
  console.log('[gdl] Writing players…')
  const insPlayer = db.prepare(`
    INSERT INTO gdl_players
      (gdl_id, username, country, badge, is_banned, placement, points,
       hardest_gdl_id, hardest_name, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(gdl_id) DO UPDATE SET
      username = excluded.username,
      country = excluded.country,
      badge = excluded.badge,
      placement = excluded.placement,
      points = excluded.points,
      fetched_at = excluded.fetched_at
  `)
  db.exec('BEGIN')
  try {
    for (const p of players) {
      insPlayer.run(
        p.id,
        p.username,
        p.country ?? null,
        p.badge ?? null,
        0,
        p.placement ?? null,
        numFromStr(p.points) ?? 0,
        null,
        null,
        now,
      )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  // ---- Levels + per-level records ----
  // Records are pulled per-level (the API has no global records endpoint).
  // Level detail (creator string, verification user/url) is also a per-level
  // fetch. Both run together in pmap-batches under PAR concurrency.
  console.log(`[gdl] Fetching per-level detail + records (${levels.length} × 2)…`)
  const findExisting = db.prepare(`SELECT id, creator, verifier, publisher FROM levels WHERE gd_id = ?`)
  const mergeExisting = db.prepare(`
    UPDATE levels
       SET gdl_position = ?,
           creator   = CASE WHEN COALESCE(creator,'')   = '' THEN ? ELSE creator   END,
           verifier  = CASE WHEN COALESCE(verifier,'')  = '' THEN ? ELSE verifier  END
     WHERE id = ?
  `)
  const insGdlLevel = db.prepare(`
    INSERT INTO gdl_levels
      (gdl_id, gd_id, placement, name, points, list_percent, length, list_type,
       holder_name, verifier_gdl_id, verifier_name, verification_url, creator,
       date_created, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(gdl_id) DO UPDATE SET
      gd_id = excluded.gd_id, placement = excluded.placement, name = excluded.name,
      points = excluded.points, list_percent = excluded.list_percent, length = excluded.length,
      list_type = excluded.list_type, holder_name = excluded.holder_name,
      verifier_gdl_id = excluded.verifier_gdl_id, verifier_name = excluded.verifier_name,
      verification_url = excluded.verification_url, creator = excluded.creator,
      date_created = excluded.date_created, fetched_at = excluded.fetched_at
  `)
  const insRec = db.prepare(`
    INSERT INTO gdl_records
      (gdl_id, level_gdl_id, level_gd_id, player_gdl_id, player_name,
       percent, video_url, is_verification, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(gdl_id) DO UPDATE SET
      level_gdl_id = excluded.level_gdl_id, level_gd_id = excluded.level_gd_id,
      player_gdl_id = excluded.player_gdl_id, player_name = excluded.player_name,
      percent = excluded.percent, video_url = excluded.video_url,
      is_verification = excluded.is_verification, fetched_at = excluded.fetched_at
  `)

  let merged = 0, gdlOnly = 0, recImported = 0
  const PERSIST_BATCH = 50
  for (let off = 0; off < levels.length; off += PERSIST_BATCH) {
    const slice = levels.slice(off, off + PERSIST_BATCH)
    const detailed = await pmap(slice, PAR, async (lvl) => {
      const [detail, recs] = await Promise.all([
        fetchJson<ApiResp<GdlLevelDetail>>(`/level/classic/get?id=${lvl.id}`).then((r) => r.data).catch(() => null),
        fetchLevelRecords(lvl.id).catch(() => [] as GdlRecord[]),
      ])
      return { lite: lvl, detail, recs }
    })

    db.exec('BEGIN')
    try {
      for (const item of detailed) {
        const lite = item.lite
        const detail = item.detail
        const verifierUid = detail?.verification?.user_id ?? lite.verifier?.user_id ?? null
        const verifierName = detail?.verification?.username ?? lite.verifier?.username ?? null
        const verUrl = detail?.verification?.video_url ?? lite.verification_url ?? null
        const creator = detail?.creator ?? null

        const existing = findExisting.get(lite.ingame_id) as { id: number } | undefined
        if (existing) {
          mergeExisting.run(lite.placement, creator, verifierName, existing.id)
          merged++
        } else {
          insGdlLevel.run(
            lite.id,
            lite.ingame_id,
            lite.placement,
            lite.name,
            numFromStr(lite.points),
            lite.list_percent ?? null,
            lite.length ?? null,
            lite.list_type,
            lite.holder ?? null,
            verifierUid,
            verifierName,
            verUrl,
            creator,
            lite.date_created ?? null,
            now,
          )
          gdlOnly++
        }

        for (const r of item.recs) {
          insRec.run(
            r.id,
            lite.id,
            lite.ingame_id,
            r.user.id,
            r.user.username,
            r.percent ?? 100,
            r.video_url ?? null,
            verifierUid != null && r.user.id === verifierUid ? 1 : 0,
            now,
          )
          recImported++
        }
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }

    const done = Math.min(off + PERSIST_BATCH, levels.length)
    console.log(`[gdl]   ${done}/${levels.length} levels processed (merged=${merged}, gdl-only=${gdlOnly}, recs=${recImported})`)
  }
  console.log(`[gdl] Levels: ${merged} merged into ALL, ${gdlOnly} GDL-only`)
  console.log(`[gdl] Records: ${recImported} imported`)

  // Surface gdl-only levels in the admin "Imported levels" tab as pending_levels
  // rows, autofilled from the API. We run this AFTER the merge loop above so
  // levels.gdl_position is populated everywhere — that's what the placement
  // midpoint search reads. Idempotent via the unique idx on from_gdl_id.
  console.log('[gdl] Refreshing pending_levels for GDL-only levels…')
  const gdlOnlyForReview = db.prepare(
    `SELECT gl.gdl_id, gl.gd_id, gl.placement, gl.name, gl.list_type,
            gl.creator, gl.verifier_name, gl.verification_url
       FROM gdl_levels gl
       LEFT JOIN levels l ON l.gd_id = gl.gd_id
      WHERE l.id IS NULL
        AND gl.promoted_to_position IS NULL`,
  ).all() as Array<{
    gdl_id: number; gd_id: number; placement: number; name: string;
    list_type: string | null; creator: string | null;
    verifier_name: string | null; verification_url: string | null
  }>

  // Every level the ALL and GDL share, in GDL order — the anchors an estimate
  // for a GDL-only level is read from.
  const anchors = buildAnchors(
    (db.prepare(
      `SELECT gdl_position AS source_pos, position AS all_pos, gddl_tier AS tier
         FROM levels
        WHERE gdl_position IS NOT NULL
        ORDER BY gdl_position ASC`,
    ).all() as { source_pos: number; all_pos: number; tier: string | null }[])
      .map((r) => ({ sourcePos: r.source_pos, allPos: r.all_pos, tier: r.tier })),
  )
  const insPending = db.prepare(
    `INSERT INTO pending_levels
       (gd_id, name, verification_url, verifier, difficulty, notes,
        placement_source, placement_estimate, status, submitted_at, from_gdl_id)
     VALUES (?, ?, ?, ?, 'Extreme Demon', ?, 'GDL Import', ?, 'pending', ?, ?)
     ON CONFLICT(from_gdl_id) DO NOTHING`,
  )

  // Auto-reject imports whose verification URL already verifies a main-list
  // level — same video can't verify two different rankings, so it's almost
  // always a re-posting of an already-tracked level.
  const existingVerUrls = new Set<string>(
    (db.prepare(`SELECT verification_url FROM levels WHERE verification_url IS NOT NULL AND verification_url <> ''`).all() as { verification_url: string }[])
      .map((r) => r.verification_url),
  )

  let importedReview = 0
  let skippedDupVer = 0
  db.exec('BEGIN')
  try {
    for (const lv of gdlOnlyForReview) {
      if (lv.verification_url && existingVerUrls.has(lv.verification_url)) { skippedDupVer++; continue }

      const placementEstimate = estimateForSourcePosition(anchors, lv.placement).placement

      const notes = `Imported from GDL · placement #${lv.placement} on ${lv.list_type ?? 'classic'} list`
      const result = insPending.run(
        lv.gd_id,
        lv.name,
        lv.verification_url,
        lv.verifier_name,
        notes,
        placementEstimate,
        now,
        lv.gdl_id,
      )
      if (result.changes > 0) importedReview++
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  console.log(`[gdl]   ${importedReview} new pending_levels rows for admin review (${gdlOnlyForReview.length} GDL-only total, ${skippedDupVer} dup verification URL)`)

  // Backfill hardest_name on gdl_players from each player's recorded set.
  // Cheaper than per-player /user/get fetches — the records table already
  // tells us which level each player has 100%'d, and we know each level's
  // placement from gdl_levels (or levels.gdl_position).
  console.log('[gdl] Backfilling hardest level for each player…')
  db.exec(`
    WITH player_best AS (
      SELECT r.player_gdl_id,
             COALESCE(gl.placement, l.gdl_position) AS placement,
             COALESCE(gl.gdl_id, NULL)              AS hardest_gdl_id,
             COALESCE(gl.name, l.name)              AS name
        FROM gdl_records r
        LEFT JOIN gdl_levels gl ON gl.gdl_id = r.level_gdl_id
        LEFT JOIN levels     l  ON l.gd_id   = r.level_gd_id
       WHERE r.percent = 100
    ),
    ranked AS (
      SELECT player_gdl_id, hardest_gdl_id, name, placement,
             ROW_NUMBER() OVER (PARTITION BY player_gdl_id ORDER BY placement ASC) AS rn
        FROM player_best
       WHERE placement IS NOT NULL
    )
    UPDATE gdl_players
       SET hardest_gdl_id = (SELECT hardest_gdl_id FROM ranked WHERE ranked.player_gdl_id = gdl_players.gdl_id AND rn = 1),
           hardest_name   = (SELECT name           FROM ranked WHERE ranked.player_gdl_id = gdl_players.gdl_id AND rn = 1)
  `)

  console.log(`[gdl] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-gdl\.ts$/.test(process.argv[1])
if (isCli) {
  importGdl().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
