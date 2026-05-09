/**
 * Global Stats Viewer importer (https://api.globalstatsviewer.com).
 *
 * GSV is a unified completion mirror — it tracks per-user demonlist
 * completions across the AREDL/PC/Pemonlist universe and exposes them via
 * /api/getuser/{id} and /api/getprofile/{id}. We enumerate every account
 * (claimed `user`s and unclaimed `profile`s) via /api/usersearch?includeAll=True,
 * pull each one's completions, and write them into `aredl_records` — the
 * same table that previously held the AREDL importer's records, so the level
 * page, AREDL profile views, and the leaderboard tag derivation keep
 * working unchanged.
 *
 * Records are uuid-namespaced as `gsv-${completion_id}` so a future re-run
 * upserts cleanly. Stale-while-revalidate: instead of a global wipe up
 * front, each successfully-fetched player has their existing rows replaced
 * atomically per batch. Old data stays visible for the rest of the run, and
 * a transient fetch failure for one player doesn't blank their records.
 */
import { getDb } from './index.ts'

const API_BASE = process.env.GSV_API_BASE || 'https://api.globalstatsviewer.com'
const PAR = Number(process.env.GSV_PARALLELISM || 8)
const UA = process.env.GSV_USER_AGENT
  || 'Mozilla/5.0 (compatible; all-levels-list-importer/1.0)'

async function fetchJson<T>(path: string, retries = 4): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
      })
      if (!res.ok) {
        if ((res.status >= 500 || res.status === 429) && attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, 750 * 2 ** attempt))
          continue
        }
        throw new Error(`HTTP ${res.status} ${url}`)
      }
      return (await res.json()) as T
    } catch (err) {
      if (attempt === retries - 1) throw err
      await new Promise((r) => setTimeout(r, 750 * 2 ** attempt))
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

type SearchEntry = { id: number; username: string; source: 'user' | 'profile' }
type SearchPage = { search_data: SearchEntry[]; total_pages: number }
type Completion = {
  internal_id?: string
  gd_id?: string
  level_name?: string
  position?: number
  aredl_uuid?: string | null
  completion_id?: number
  comp_data?: { video?: string | null } | null
}
type GetUserResp = {
  player_info: {
    id: number
    username: string
    aredl?: string | null
    pointercrate?: string | null
    geometry_dash?: string | null
  }
  demonlist: Completion[]
}

async function fetchAllAccounts(): Promise<SearchEntry[]> {
  const first = await fetchJson<SearchPage>('/api/usersearch?search=&page=1&includeAll=True')
  const out: SearchEntry[] = [...first.search_data]
  const totalPages = first.total_pages || 1
  if (totalPages > 1) {
    const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
    const results = await pmap(pages, PAR, async (p) => {
      const r = await fetchJson<SearchPage>(`/api/usersearch?search=&page=${p}&includeAll=True`)
      return r.search_data
    })
    for (const arr of results) out.push(...arr)
  }
  return out
}

export async function importGsv() {
  const t0 = Date.now()
  const db = getDb()
  const now = new Date().toISOString()

  console.log('[gsv] Enumerating accounts via usersearch…')
  const accounts = await fetchAllAccounts()
  const userCount = accounts.filter((a) => a.source === 'user').length
  const profileCount = accounts.length - userCount
  console.log(`[gsv]   ${accounts.length} accounts (${userCount} users, ${profileCount} profiles)`)

  const delPlayerRecords = db.prepare(`DELETE FROM aredl_records WHERE player_uuid = ?`)

  const insRec = db.prepare(`
    INSERT INTO aredl_records
      (uuid, level_uuid, level_gd_id, player_uuid, player_name, mobile, video_url,
       hide_video, is_verification, achieved_at, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(uuid) DO UPDATE SET
      level_uuid = excluded.level_uuid, level_gd_id = excluded.level_gd_id,
      player_uuid = excluded.player_uuid, player_name = excluded.player_name,
      video_url = excluded.video_url, fetched_at = excluded.fetched_at
  `)

  let recImported = 0, accountsDone = 0, accountsFailed = 0
  const PERSIST_BATCH = 100
  for (let off = 0; off < accounts.length; off += PERSIST_BATCH) {
    const slice = accounts.slice(off, off + PERSIST_BATCH)
    const fetched = await pmap(slice, PAR, async (a) => {
      const path = a.source === 'user' ? `/api/getuser/${a.id}` : `/api/getprofile/${a.id}`
      try {
        const r = await fetchJson<GetUserResp>(`${path}?type=classic`)
        return { account: a, resp: r }
      } catch (err) {
        return { account: a, resp: null, err: (err as Error).message }
      }
    })

    db.exec('BEGIN')
    try {
      for (const { account, resp, err } of fetched) {
        if (!resp) { accountsFailed++; if (err) console.warn(`[gsv]   ${account.source}/${account.id} failed: ${err}`); continue }
        const playerUuid = resp.player_info?.aredl
        // Only AREDL-mapped players have a stable level_uuid/player_uuid pair
        // we can fit into aredl_records' NOT NULL columns. Anonymous profiles
        // without an AREDL link are skipped.
        if (!playerUuid) { accountsDone++; continue }
        // Replace this player's old rows atomically inside the batch txn so
        // readers always see a coherent snapshot — either all old or all new.
        delPlayerRecords.run(playerUuid)
        const playerName = resp.player_info?.username ?? account.username
        for (const c of resp.demonlist ?? []) {
          if (!c.completion_id || !c.aredl_uuid) continue
          const gdId = c.gd_id != null ? Number(c.gd_id) : null
          insRec.run(
            `gsv-${c.completion_id}`,
            c.aredl_uuid,
            Number.isFinite(gdId) ? gdId : null,
            playerUuid,
            playerName,
            0,
            c.comp_data?.video ?? null,
            0,
            0,
            null,
            now,
          )
          recImported++
        }
        accountsDone++
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }

    const done = Math.min(off + PERSIST_BATCH, accounts.length)
    console.log(`[gsv]   ${done}/${accounts.length} accounts processed (recs=${recImported}, failed=${accountsFailed})`)
  }

  console.log(`[gsv] Records: ${recImported} imported across ${accountsDone} accounts (${accountsFailed} fetch failures)`)
  console.log(`[gsv] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-gsv\.ts$/.test(process.argv[1])
if (isCli) {
  importGsv().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
