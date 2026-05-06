/**
 * Pointercrate importer (https://pointercrate.com/api/).
 *
 * Pulls into the same global mirror tables as the Aredl importer:
 *   - pointercrate_players  (separate from aredl_players; same human can have rows in both)
 *   - pointercrate_records  (deduped against records + aredl_records by player_name + gd_id at percent=100)
 *   - levels.pointercrate_position (only set for ranked demons, i.e. position ≤ extended_list_size)
 *
 * Pointercrate adds no new levels — every demon there is already on Aredl/ALL,
 * so we never insert level rows. We only enrich existing levels and store
 * records.
 *
 * Legacy records (demon position > extended_list_size) are pulled exactly
 * once per demon: pointercrate_legacy_imported tracks completion and re-runs
 * skip already-imported legacy demons. Ranked demons (Main + Extended) are
 * always re-fetched so new ranked records show up.
 *
 * Cloudflare blocks no-UA / datacenter requests; the importer sends a
 * browser User-Agent which is enough to pass through the standard challenge.
 */
import { getDb } from './index.ts'
import { spawn } from 'node:child_process'

const API_BASE = process.env.POINTERCRATE_API_BASE || 'https://pointercrate.com/api'
// Pointercrate's rate limit is tight — even 2 parallel + 200ms delay hits
// 429s frequently. Serialize entirely with a 600ms gap (~1.5 req/sec) which
// stays under the limit reliably. Re-runs are idempotent so missed demons
// retry on the next invocation.
const PAR = Number(process.env.POINTERCRATE_PARALLELISM || 1)
const REQ_DELAY_MS = Number(process.env.POINTERCRATE_REQ_DELAY_MS || 600)
const UA = process.env.POINTERCRATE_USER_AGENT
  || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

// Cloudflare TLS-fingerprints the request and blocks Node's fetch even with
// a browser UA. curl's TLS handshake passes through, so we shell out instead
// of using fetch. POINTERCRATE_PROXY_URL/_TOKEN can override this with a
// remote forwarder for environments that don't have curl available.
function curlOnce(url: string, extraArgs: string[] = []): Promise<{ status: number; body: string; headers: string }> {
  return new Promise((resolve, reject) => {
    const args = [
      '-sS',                                    // silent but show errors
      '-D', '-',                                // dump headers to stdout (followed by --- and body)
      '-A', UA,
      '-H', 'Accept: application/json',
      '-H', 'Accept-Language: en-US,en;q=0.9',
      '-H', 'Referer: https://pointercrate.com/',
      '--compressed',
      '-w', '\n__STATUS__%{http_code}\n',
      ...extraArgs,
      url,
    ]
    const proc = spawn('curl', args, { windowsHide: true })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('close', (code) => {
      if (code !== 0 && !out) return reject(new Error(`curl exit ${code}: ${err}`))
      // The body is everything between the headers blank line and the
      // __STATUS__ marker we appended via -w.
      const statusMatch = out.match(/\n__STATUS__(\d+)\s*$/)
      const status = statusMatch ? Number(statusMatch[1]) : 0
      const trimmed = statusMatch ? out.slice(0, statusMatch.index!) : out
      // Headers are separated from body by the first blank line. Multiple
      // header blocks can stack on redirects — we want the *last* one.
      const blocks = trimmed.split(/\r?\n\r?\n/)
      const body = blocks.pop() ?? ''
      const headers = blocks.join('\n\n')
      resolve({ status, body: body.trimEnd(), headers })
    })
    proc.on('error', reject)
  })
}

async function fetchJson<T>(path: string, retries = 6): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  for (let attempt = 0; attempt < retries; attempt++) {
    if (REQ_DELAY_MS > 0 && attempt === 0) {
      await new Promise((r) => setTimeout(r, REQ_DELAY_MS))
    }
    try {
      const { status, body } = await curlOnce(url)
      if (status >= 200 && status < 300) {
        return JSON.parse(body) as T
      }
      if ((status >= 500 || status === 429 || status === 403) && attempt < retries - 1) {
        // Exponential backoff: 2s, 4s, 8s, 16s, 32s.
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
        continue
      }
      throw new Error(`HTTP ${status} ${url}`)
    } catch (err) {
      if (attempt === retries - 1) throw err
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
    }
  }
  throw new Error('unreachable')
}

/**
 * Iterates a Pointercrate paginated endpoint by following the `rel=next`
 * Link header until none is returned. Returns headers + parsed body so we
 * can stream the next URL.
 */
async function fetchJsonWithLink<T>(url: string): Promise<{ data: T; nextUrl: string | null }> {
  const { status, body, headers } = await curlOnce(url)
  if (status < 200 || status >= 300) throw new Error(`HTTP ${status} ${url}`)
  const data = JSON.parse(body) as T
  // Pointercrate sets a single `links` (or `Link`) header with comma-separated entries.
  const linkLine = headers.split(/\r?\n/).find((l) => /^links?:/i.test(l)) ?? ''
  const m = linkLine.match(/<([^>]+)>;\s*rel=next/i)
  let nextUrl: string | null = null
  if (m) {
    const u = m[1]!
    nextUrl = u.startsWith('http') ? u : `https://pointercrate.com${u}`
  }
  return { data, nextUrl }
}

async function fetchAllPages<T>(startPath: string): Promise<T[]> {
  const out: T[] = []
  let url: string | null = startPath.startsWith('http') ? startPath : `${API_BASE}${startPath}`
  while (url) {
    const { data, nextUrl } = await fetchJsonWithLink<T[]>(url)
    out.push(...data)
    url = nextUrl
  }
  return out
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

type PcDemon = {
  id: number
  position: number
  name: string
  level_id: number | null
  publisher: { id: number; name: string; banned: boolean }
  verifier: { id: number; name: string; banned: boolean }
}
type PcCreator = { id: number; name: string; banned: boolean }
type PcRecord = {
  id: number
  progress: number
  video: string | null
  status: string
  player: { id: number; name: string; banned: boolean }
}
type PcDemonDetail = {
  id: number
  position: number
  name: string
  level_id: number | null
  publisher: { id: number; name: string; banned: boolean }
  verifier: { id: number; name: string; banned: boolean }
  creators: PcCreator[]
  records: PcRecord[]
}
type PcRankedPlayer = {
  id: number
  name: string
  banned: boolean
  score: number
  rank: number | null
  nationality: { country_code: string; nation: string; subdivision: string | null } | null
}

export async function importPointercrate() {
  const t0 = Date.now()
  const db = getDb()
  const now = new Date().toISOString()

  console.log('[pc] Fetching list cutoffs…')
  const cutoffs = await fetchJson<{ list_size: number; extended_list_size: number }>('/v1/list_information/')
  console.log(`[pc]   Main 1-${cutoffs.list_size}, Extended ${cutoffs.list_size + 1}-${cutoffs.extended_list_size}, Legacy ${cutoffs.extended_list_size + 1}+`)

  console.log('[pc] Fetching all demons (id → gd_id map)…')
  const allDemons = await fetchAllPages<PcDemon>('/v2/demons/?limit=100')
  console.log(`[pc]   ${allDemons.length} demons`)

  // Backfill levels.pointercrate_position + creator/verifier/publisher (only-if-empty)
  // for ranked demons (1..extended_list_size). Legacy demons skip the level
  // backfill (we don't track legacy positions per the design call).
  console.log('[pc] Updating level metadata for ranked demons…')
  const findLevel = db.prepare(`SELECT id, creator, verifier, publisher FROM levels WHERE gd_id = ?`)
  const updateLevel = db.prepare(`
    UPDATE levels
       SET pointercrate_position = ?,
           creator   = CASE WHEN COALESCE(creator,'')   = '' THEN ? ELSE creator   END,
           verifier  = CASE WHEN COALESCE(verifier,'')  = '' THEN ? ELSE verifier  END,
           publisher = CASE WHEN COALESCE(publisher,'') = '' THEN ? ELSE publisher END
     WHERE id = ?
  `)
  let levelsTouched = 0
  db.exec('BEGIN')
  try {
    for (const d of allDemons) {
      if (d.position > cutoffs.extended_list_size) continue
      if (!d.level_id) continue
      const existing = findLevel.get(d.level_id) as { id: number } | undefined
      if (!existing) continue
      // Pointercrate names sometimes carry a `[CLAN] Name` prefix; strip the
      // bracketed prefix before backfilling so a clean name lands.
      const cleanName = (s: string) => s.replace(/^\s*\[[^\]]+\]\s*/, '').trim()
      updateLevel.run(
        d.position,
        cleanName(d.publisher?.name ?? ''),
        cleanName(d.verifier?.name ?? ''),
        cleanName(d.publisher?.name ?? ''),
        existing.id,
      )
      levelsTouched++
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  console.log(`[pc]   ${levelsTouched} ALL-list rows updated with pointercrate_position`)

  // ---- Players ----
  console.log('[pc] Fetching ranked players…')
  const players = await fetchAllPages<PcRankedPlayer>('/v1/players/ranking/?limit=100')
  console.log(`[pc]   ${players.length} ranked players`)

  const insPlayer = db.prepare(`
    INSERT INTO pointercrate_players
      (pc_id, name, banned, nationality, subdivision, rank, score, fetched_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(pc_id) DO UPDATE SET
      name = excluded.name, banned = excluded.banned,
      nationality = excluded.nationality, subdivision = excluded.subdivision,
      rank = excluded.rank, score = excluded.score, fetched_at = excluded.fetched_at
  `)
  db.exec('BEGIN')
  try {
    for (const p of players) {
      insPlayer.run(
        p.id,
        p.name,
        p.banned ? 1 : 0,
        p.nationality?.country_code ?? null,
        p.nationality?.subdivision ?? null,
        p.rank ?? null,
        p.score ?? 0,
        now,
      )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  // ---- Records ----
  // Strategy: per-demon detail fetch (returns records inline, fewer requests
  // than paginating /v1/records/ for ~127k records). For ranked demons fetch
  // every run; for legacy demons fetch only if not already in
  // pointercrate_legacy_imported.
  const isLegacyDone = db.prepare(`SELECT 1 FROM pointercrate_legacy_imported WHERE pc_demon_id = ?`)
  const markLegacyDone = db.prepare(`INSERT OR REPLACE INTO pointercrate_legacy_imported (pc_demon_id) VALUES (?)`)

  // Pull every approved record into pointercrate_records — dedup against
  // ALL/AREDL is no longer done at import time. Cross-source dedup happens
  // at query time on the All Lists leaderboard and the level records list,
  // which lets each source keep its full record history.
  const insRec = db.prepare(`
    INSERT INTO pointercrate_records
      (pc_id, demon_pc_id, demon_position, demon_name, level_gd_id,
       player_pc_id, player_name, progress, video, is_legacy, is_verification, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(pc_id) DO UPDATE SET
      demon_pc_id = excluded.demon_pc_id, demon_position = excluded.demon_position,
      demon_name = excluded.demon_name, level_gd_id = excluded.level_gd_id,
      player_pc_id = excluded.player_pc_id, player_name = excluded.player_name,
      progress = excluded.progress, video = excluded.video,
      is_legacy = excluded.is_legacy, is_verification = excluded.is_verification,
      fetched_at = excluded.fetched_at
  `)

  // Build the list of demons to process: every ranked demon + every legacy
  // demon that hasn't been imported yet.
  const toProcess: { demon: PcDemon; isLegacy: boolean; skip: boolean }[] = []
  let legacySkipped = 0
  for (const d of allDemons) {
    const isLegacy = d.position > cutoffs.extended_list_size
    if (isLegacy) {
      const done = isLegacyDone.get(d.id)
      if (done) { legacySkipped++; continue }
    }
    toProcess.push({ demon: d, isLegacy, skip: false })
  }
  console.log(`[pc] Processing ${toProcess.length} demons (${legacySkipped} legacy already imported, skipping)…`)

  let recImported = 0, recSkipped = 0, processed = 0
  const PERSIST_BATCH = 25
  for (let off = 0; off < toProcess.length; off += PERSIST_BATCH) {
    const slice = toProcess.slice(off, off + PERSIST_BATCH)
    const detailed = await pmap(slice, PAR, async (item) => {
      try {
        const detail = await fetchJson<{ data: PcDemonDetail }>(`/v2/demons/${item.demon.id}/`)
        return { item, detail: detail.data }
      } catch (err) {
        console.warn(`[pc]   demon ${item.demon.id} fetch failed:`, (err as Error).message)
        return { item, detail: null }
      }
    })

    db.exec('BEGIN')
    try {
      for (const { item, detail } of detailed) {
        if (!detail) continue
        const verifierId = detail.verifier?.id ?? null
        const gdId = detail.level_id
        for (const r of detail.records) {
          if (r.status !== 'approved') { recSkipped++; continue }
          insRec.run(
            r.id,
            detail.id,
            detail.position,
            detail.name,
            gdId,
            r.player.id,
            r.player.name,
            r.progress ?? 100,
            r.video,
            item.isLegacy ? 1 : 0,
            verifierId != null && r.player.id === verifierId ? 1 : 0,
            now,
          )
          recImported++
        }
        if (item.isLegacy) markLegacyDone.run(detail.id)
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }

    processed += slice.length
    if (processed % 100 < PERSIST_BATCH) {
      console.log(`[pc]   ${processed}/${toProcess.length} demons processed (recs=${recImported})`)
    }
  }

  console.log(`[pc] Records: ${recImported} imported, ${recSkipped} skipped (non-approved)`)
  console.log(`[pc] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-pointercrate\.ts$/.test(process.argv[1])
if (isCli) {
  importPointercrate().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
