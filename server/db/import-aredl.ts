/**
 * Aredl importer (api.aredl.net/v2). Mirrors Aredl's classic-demon list into:
 *   - aredl_players (separate from `players`; safe to re-run)
 *   - aredl_levels  (Aredl-only — i.e. levels not on the ALL list)
 *   - levels        (ALL-list rows: backfills aredl_position, aredl_tags,
 *                    edel_enjoyment, and fills empty creator/verifier/publisher)
 *   - aredl_records (skipping records that exact-match an existing ALL record
 *                    by player_name + gd_id)
 *
 * Only hits /api/aredl/ — /api/arepl/ (platformer) is intentionally avoided.
 * Idempotent: every insert uses ON CONFLICT so re-running is a no-op for
 * unchanged rows and an upsert for changed ones.
 */
import { getDb } from './index.ts'

const API_BASE = process.env.AREDL_API_BASE || 'https://api.aredl.net/v2/api/aredl'
const PAR = Number(process.env.AREDL_PARALLELISM || 8)

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
  user: { id: string; username: string; global_name: string; country: number | null; discord_id: string | null }
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
type AredlPerLevelRecord = {
  id: string
  submitted_by: { id: string; username: string; global_name: string; country: number | null; discord_id: string | null }
  mobile: boolean
  video_url: string
  hide_video: boolean
  achieved_at: string
}

export async function importAredl() {
  const t0 = Date.now()
  const db = getDb()
  const now = new Date().toISOString()

  console.log('[aredl] Fetching leaderboard…')
  const lb = await fetchAllPages<LbEntry>('/leaderboard', 200)
  console.log(`[aredl]   ${lb.length} players`)

  console.log('[aredl] Fetching level list…')
  const levels = await fetchJson<AredlLevelLite[]>('/levels?exclude_legacy=false')
  console.log(`[aredl]   ${levels.length} levels`)

  // ---- Persist players first so a later phase failure doesn't lose work ----
  console.log('[aredl] Writing players…')
  const insPlayer = db.prepare(`
    INSERT INTO aredl_players
      (uuid, username, global_name, country, discord_id, total_points, pack_points,
       extremes, rank, hardest_uuid, hardest_name, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(uuid) DO UPDATE SET
      username = excluded.username,
      global_name = excluded.global_name,
      country = excluded.country,
      discord_id = excluded.discord_id,
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

  console.log(`[aredl] Fetching per-level detail + creators + records (${levels.length} × 3)…`)
  const findExisting = db.prepare(`SELECT id, creator, verifier, publisher FROM levels WHERE gd_id = ?`)
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

  const isDupAll = db.prepare(`
    SELECT 1 FROM records r
      JOIN levels l ON l.id = r.level_id
     WHERE l.gd_id = ?
       AND r.player_name = ? COLLATE NOCASE
       AND r.percent = 100
     LIMIT 1
  `)
  const insRec = db.prepare(`
    INSERT INTO aredl_records
      (uuid, level_uuid, level_gd_id, player_uuid, player_name, mobile, video_url,
       hide_video, is_verification, achieved_at, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(uuid) DO UPDATE SET
      level_uuid = excluded.level_uuid, level_gd_id = excluded.level_gd_id,
      player_uuid = excluded.player_uuid, player_name = excluded.player_name,
      mobile = excluded.mobile, video_url = excluded.video_url, hide_video = excluded.hide_video,
      is_verification = excluded.is_verification, achieved_at = excluded.achieved_at,
      fetched_at = excluded.fetched_at
  `)

  // Process levels in batches: fetch detail + creators + per-level records
  // for each one, then commit. A failure mid-stream still keeps work done so
  // far. Per-level records is used because the global /records endpoint is
  // 403-locked behind auth (Cloudflare returns 403 even with browser UA).
  let merged = 0, aredlOnly = 0, recImported = 0, recDeduped = 0, recSkipped = 0
  const PERSIST_BATCH = 50
  for (let off = 0; off < levels.length; off += PERSIST_BATCH) {
    const slice = levels.slice(off, off + PERSIST_BATCH)
    const detailed = await pmap(slice, PAR, async (lvl) => {
      const [detail, creators, perLevelRecs] = await Promise.all([
        fetchJson<AredlLevelDetail>(`/levels/${lvl.id}`),
        fetchJson<AredlCreator[]>(`/levels/${lvl.id}/creators`),
        fetchJson<AredlPerLevelRecord[]>(`/levels/${lvl.id}/records`),
      ])
      return { lite: lvl, detail, creators, perLevelRecs }
    })

    db.exec('BEGIN')
    try {
      for (const item of detailed) {
        const lite = item.lite
        const detail = item.detail
        const creators = item.creators ?? []
        const verifications = detail.verifications ?? []
        const firstVer = verifications[0]
        const verifier = firstVer?.submitted_by?.global_name ?? null
        const verifierUuid = firstVer?.submitted_by?.id ?? null
        const verUrl = firstVer?.video_url ?? null
        const publisher = detail.publisher?.global_name ?? null
        const creatorsList = creators.map((c) => c.global_name).filter(Boolean)
        const creatorStr = creatorsList.join(' & ') || null
        const tagsJson = JSON.stringify(lite.tags ?? [])

        const existing = findExisting.get(lite.level_id) as { id: number } | undefined
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

        // Records for this level
        for (const r of item.perLevelRecs) {
          const playerName = r.submitted_by?.global_name || r.submitted_by?.username
          if (!playerName) { recSkipped++; continue }
          if (isDupAll.get(lite.level_id, playerName)) { recDeduped++; continue }
          const isVer = verifierUuid != null && r.submitted_by?.id === verifierUuid
          insRec.run(
            r.id,
            lite.id,
            lite.level_id,
            r.submitted_by.id,
            playerName,
            r.mobile ? 1 : 0,
            r.video_url ?? null,
            r.hide_video ? 1 : 0,
            isVer ? 1 : 0,
            r.achieved_at ?? null,
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
    console.log(`[aredl]   ${done}/${levels.length} levels processed (merged=${merged}, aredl-only=${aredlOnly}, recs=${recImported}, deduped=${recDeduped})`)
  }
  console.log(`[aredl] Levels: ${merged} merged into ALL, ${aredlOnly} Aredl-only`)
  console.log(`[aredl] Records: ${recImported} imported, ${recDeduped} deduped vs ALL, ${recSkipped} skipped`)

  console.log(`[aredl] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-aredl\.ts$/.test(process.argv[1])
if (isCli) {
  importAredl().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
