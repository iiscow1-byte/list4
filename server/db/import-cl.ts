/**
 * Challenge List importer (https://challengelist.gd) — uses the Pointercrate
 * API format. Writes into gdtpl_levels (list_slug='cl') so the shared pending-
 * queue infrastructure (status counts, clear-pending, review tab) works
 * identically to every other demon-list import.
 *
 * Levels with ❌ in their name are removed/voided entries and are skipped.
 * New pending rows are pre-tagged as rated='Challenge' and difficulty=
 * 'Extreme Demon' since every level on the CL is a challenge by definition.
 *
 * challenge_list_position is also written onto matched main-list rows so the
 * "Rankings on other lists" panel can display the position.
 */
import { getDb } from './index.ts'
import { spawn } from 'node:child_process'

const API_BASE = process.env.CL_API_BASE || 'https://challengelist.gd/api'
const REQ_DELAY_MS = Number(process.env.CL_REQ_DELAY_MS || 400)
const UA = process.env.CL_USER_AGENT
  || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const LIST_SLUG = 'cl'
const DISPLAY_NAME = 'Challenge List'

function curlOnce(url: string): Promise<{ status: number; body: string; headers: string }> {
  return new Promise((resolve, reject) => {
    const origin = new URL(API_BASE).origin
    const args = [
      '-sS', '-D', '-',
      '-A', UA,
      '-H', 'Accept: application/json',
      '-H', 'Accept-Language: en-US,en;q=0.9',
      '-H', `Referer: ${origin}/`,
      '--compressed',
      '-w', '\n__STATUS__%{http_code}\n',
      url,
    ]
    const proc = spawn('curl', args, { windowsHide: true })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('close', (code) => {
      if (code !== 0 && !out) return reject(new Error(`curl exit ${code}: ${err}`))
      const statusMatch = out.match(/\n__STATUS__(\d+)\s*$/)
      const status = statusMatch ? Number(statusMatch[1]) : 0
      const trimmed = statusMatch ? out.slice(0, statusMatch.index!) : out
      const blocks = trimmed.split(/\r?\n\r?\n/)
      const body = blocks.pop() ?? ''
      const headers = blocks.join('\n\n')
      resolve({ status, body: body.trimEnd(), headers })
    })
    proc.on('error', reject)
  })
}

async function fetchJsonWithLink<T>(url: string): Promise<{ data: T; nextUrl: string | null }> {
  if (REQ_DELAY_MS > 0) await new Promise((r) => setTimeout(r, REQ_DELAY_MS))
  const { status, body, headers } = await curlOnce(url)
  if (status < 200 || status >= 300) throw new Error(`HTTP ${status} ${url}`)
  const data = JSON.parse(body) as T
  const linkLine = headers.split(/\r?\n/).find((l) => /^links?:/i.test(l)) ?? ''
  const m = linkLine.match(/<([^>]+)>;\s*rel=next/i)
  let nextUrl: string | null = null
  if (m) {
    const u = m[1]!
    const origin = new URL(API_BASE).origin
    nextUrl = u.startsWith('http') ? u : `${origin}${u}`
  }
  return { data, nextUrl }
}

async function fetchAllPages<T>(startPath: string): Promise<T[]> {
  const out: T[] = []
  const origin = new URL(API_BASE).origin
  let url: string | null = startPath.startsWith('http') ? startPath : `${API_BASE}${startPath}`
  while (url) {
    const { data, nextUrl } = await fetchJsonWithLink<T[]>(url)
    out.push(...data)
    url = nextUrl
  }
  return out
}

type ClDemon = {
  id: number
  position: number
  name: string
  level_id: number | null
  verifier: { id: number; name: string; banned: boolean } | null
  video: string | null
}

function tierToOrd(label: string | null): number | null {
  if (!label) return null
  const sub = label.match(/^Subtier (\d{1,2})$/)
  if (sub) return Number(sub[1])
  const t = label.match(/^Tier (\d{1,2})$/)
  if (t) return 5 + Number(t[1])
  return null
}
function ordToTier(ord: number): string {
  const r = Math.max(1, Math.round(ord))
  if (r <= 5) return `Subtier ${r}`
  return `Tier ${r - 5}`
}

export async function importCl(): Promise<void> {
  const t0 = Date.now()
  const db = getDb()
  const now = new Date().toISOString()

  console.log('[cl] Fetching demons from Challenge List API…')
  const rawDemons = await fetchAllPages<ClDemon>('/v1/demons/?limit=100')
  const demons = rawDemons.filter((d) => !d.name.includes('❌'))
  console.log(`[cl]   ${demons.length} demons (${rawDemons.length - demons.length} ❌ skipped)`)

  // --- 1. Upsert into gdtpl_levels + refresh challenge_list_position ---
  const upsertGdtpl = db.prepare(`
    INSERT INTO gdtpl_levels
      (list_slug, level_slug, position, gd_id, name, author, creators_json,
       verifier, verification_url, showcase_url, percent_to_qualify, password, fetched_at)
    VALUES (?, ?, ?, ?, ?, NULL, '[]', ?, ?, NULL, NULL, NULL, ?)
    ON CONFLICT(list_slug, level_slug) DO UPDATE SET
      position         = excluded.position,
      gd_id            = excluded.gd_id,
      name             = excluded.name,
      verifier         = excluded.verifier,
      verification_url = excluded.verification_url,
      fetched_at       = excluded.fetched_at
  `)
  const updateChallengePos = db.prepare(`UPDATE levels SET challenge_list_position = ? WHERE gd_id = ?`)

  db.exec('BEGIN')
  try {
    // Reset so removed levels don't keep a stale position.
    db.prepare(`UPDATE levels SET challenge_list_position = NULL WHERE challenge_list_position IS NOT NULL`).run()
    for (const d of demons) {
      upsertGdtpl.run(
        LIST_SLUG, String(d.id), d.position, d.level_id,
        d.name, d.verifier?.name ?? null, d.video ?? null, now,
      )
      updateChallengePos.run(d.position, d.level_id)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  console.log(`[cl]   gdtpl_levels upserted, challenge_list_position refreshed`)

  // --- 2. Backfill verifier / verification_url on matched main-list rows ---
  const mergeExisting = db.prepare(`
    UPDATE levels
       SET verifier         = CASE WHEN COALESCE(verifier,'')         = '' THEN ? ELSE verifier         END,
           verification_url = CASE WHEN COALESCE(verification_url,'') = '' THEN ? ELSE verification_url END
     WHERE gd_id = ?
  `)
  db.exec('BEGIN')
  try {
    for (const d of demons) {
      mergeExisting.run(d.verifier?.name ?? null, d.video ?? null, d.level_id)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  // --- 3. Surface CL-only levels as pending_levels for admin review ---
  const onlyHere = db.prepare(`
    SELECT g.id, g.gd_id, g.position, g.name, g.verifier, g.verification_url
      FROM gdtpl_levels g
      LEFT JOIN levels l ON l.gd_id = g.gd_id
     WHERE g.list_slug = ?
       AND l.id IS NULL
       AND g.promoted_to_position IS NULL
  `).all(LIST_SLUG) as Array<{
    id: number; gd_id: number | null; position: number; name: string | null
    verifier: string | null; verification_url: string | null
  }>
  console.log(`[cl]   ${onlyHere.length} CL-only levels for pending queue`)

  // Shared levels (on CL and ALL list) — used for placement/tier estimation.
  type Neighbour = { sourcePos: number; allPos: number; tier: string | null }
  const sharedAll: Neighbour[] = (db.prepare(`
    SELECT g.position AS source_pos, l.position AS all_pos, l.gddl_tier AS tier
      FROM gdtpl_levels g
      JOIN levels l ON l.gd_id = g.gd_id
     WHERE g.list_slug = ?
     ORDER BY g.position ASC
  `).all(LIST_SLUG) as { source_pos: number; all_pos: number; tier: string | null }[])
    .map((r) => ({ sourcePos: r.source_pos, allPos: r.all_pos, tier: r.tier }))
  const sharedTiered = sharedAll.filter((n) => n.tier != null && n.tier.trim() !== '')

  function gtIdx(arr: Neighbour[], pos: number): number {
    let lo = 0, hi = arr.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (arr[mid]!.sourcePos <= pos) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  function neighboursAt(arr: Neighbour[], pos: number) {
    const i = gtIdx(arr, pos)
    return { above: i > 0 ? arr[i - 1]! : null, below: i < arr.length ? arr[i]! : null }
  }

  const insPending = db.prepare(`
    INSERT INTO pending_levels
      (gd_id, name, verification_url, verifier, difficulty, notes, rated,
       placement_source, placement_estimate, gddl_tier, gddl_tier_estimated,
       status, submitted_at, from_gdtpl_id)
    VALUES (?, ?, ?, ?, 'Extreme Demon', ?, 'Challenge', ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(from_gdtpl_id) WHERE from_gdtpl_id IS NOT NULL DO UPDATE SET
      placement_estimate    = excluded.placement_estimate,
      gddl_tier             = CASE
        WHEN pending_levels.gddl_tier_estimated = 1 OR pending_levels.gddl_tier IS NULL
          THEN excluded.gddl_tier ELSE pending_levels.gddl_tier END,
      gddl_tier_estimated   = CASE
        WHEN pending_levels.gddl_tier_estimated = 1 OR pending_levels.gddl_tier IS NULL
          THEN excluded.gddl_tier_estimated ELSE pending_levels.gddl_tier_estimated END
    WHERE pending_levels.status = 'pending'
  `)

  const existingVerUrls = new Set<string>(
    (db.prepare(`SELECT verification_url FROM levels WHERE verification_url IS NOT NULL AND verification_url <> ''`)
      .all() as { verification_url: string }[]).map((r) => r.verification_url),
  )

  let imported = 0
  let skippedDupVer = 0
  const BATCH_SIZE = 100
  for (let i = 0; i < onlyHere.length; i += BATCH_SIZE) {
    const slice = onlyHere.slice(i, i + BATCH_SIZE)
    db.exec('BEGIN')
    try {
      for (const lv of slice) {
        if (lv.verification_url && existingVerUrls.has(lv.verification_url)) { skippedDupVer++; continue }

        const { above, below } = neighboursAt(sharedAll, lv.position)
        let est: number | null = null
        if (above && below) {
          // Linear interpolation against the CL position — a flat midpoint
          // collapses every level in a sparse bracket to the same suggestion.
          const span = below.sourcePos - above.sourcePos
          const frac = span > 0 ? (lv.position - above.sourcePos) / span : 0.5
          est = Math.round(above.allPos + frac * (below.allPos - above.allPos))
        } else if (above) est = above.allPos + 1
        else if (below) est = Math.max(1, below.allPos - 1)
        if (est === lv.position) est = null

        const { above: tA, below: tB } = neighboursAt(sharedTiered, lv.position)
        const aOrd = tierToOrd(tA?.tier ?? null)
        const bOrd = tierToOrd(tB?.tier ?? null)
        let tier: string | null = null
        if (aOrd != null && bOrd != null) {
          const span = tB!.sourcePos - tA!.sourcePos
          const frac = span > 0 ? (lv.position - tA!.sourcePos) / span : 0.5
          tier = ordToTier(aOrd + frac * (bOrd - aOrd))
        } else if (aOrd != null) tier = ordToTier(aOrd)
        else if (bOrd != null) tier = ordToTier(bOrd)

        const res = insPending.run(
          lv.gd_id, lv.name, lv.verification_url, lv.verifier,
          `Imported from ${DISPLAY_NAME} · placement #${lv.position}`,
          DISPLAY_NAME, est, tier, tier ? 1 : 0, now, lv.id,
        )
        if (res.changes > 0) imported++
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    await new Promise<void>((r) => setImmediate(r))
  }
  console.log(`[cl]   ${imported} pending rows written (${skippedDupVer} dup-ver skipped)`)
  console.log(`[cl] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-cl\.ts$/.test(process.argv[1])
if (isCli) {
  importCl().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
