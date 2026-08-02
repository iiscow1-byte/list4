import { getDb } from './index.ts'
import type { ProgressReporter } from '../utils/imports-state.ts'

/**
 * MSCL — Mooncandy's Super Challenge List (https://mscl.dev).
 *
 * Runs a pointercrate-compatible API, so this mirrors `import-pointercrate.ts`
 * rather than inventing a new shape:
 *
 *   GET /api/v2/demons/listed/?limit=100&after=<id>   ranked entries
 *
 * Each entry carries `level_id` (the GD level ID), which is what lets an MSCL
 * placement attach to a level the ALL list already has. Entries whose level we
 * don't have are kept in `mscl_levels` so a curator can promote them later —
 * the same pattern the AREDL and GDL mirrors use.
 *
 * Records are not imported: MSCL requires raw footage for verification and its
 * point scale is its own, so mixing its records into ours would misrepresent
 * both. Only placements and level metadata come across.
 */
const API_BASE = process.env.MSCL_API_BASE || 'https://mscl.dev/api'

type MsclDemon = {
  id: number
  position: number
  name: string
  requirement: number | null
  video: string | null
  thumbnail: string | null
  level_id: number | null
  tier: number | null
  fps: string | null
  publisher?: { id: number; name: string } | null
  verifier?: { id: number; name: string } | null
}

async function fetchJson<T>(path: string, retries = 4): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) {
        if ((res.status >= 500 || res.status === 429) && attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
          continue
        }
        throw new Error(`HTTP ${res.status} ${url}`)
      }
      return await res.json() as T
    } catch (err) {
      if (attempt === retries - 1) throw err
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  throw new Error(`unreachable: ${url}`)
}

/**
 * Pointercrate paginates by `after=<last id>` rather than offset, so walking
 * the list means carrying the last id forward until a short page comes back.
 */
async function fetchAllDemons(): Promise<MsclDemon[]> {
  const out: MsclDemon[] = []
  let after = 0
  for (let guard = 0; guard < 100; guard++) {
    const page = await fetchJson<MsclDemon[]>(`/v2/demons/listed/?limit=100&after=${after}`)
    if (!page.length) break
    out.push(...page)
    const lastId = page[page.length - 1]!.id
    if (page.length < 100 || lastId === after) break
    after = lastId
  }
  return out
}

export async function importMscl(report?: ProgressReporter) {
  const t0 = Date.now()
  const db = getDb()
  const now = new Date().toISOString()

  console.log('[mscl] Fetching listed demons…')
  const demons = await fetchAllDemons()
  console.log(`[mscl]   ${demons.length} entries`)
  report?.({ phase: 'Writing levels', done: 0, total: demons.length })
  if (!demons.length) {
    console.warn('[mscl] nothing returned — leaving existing data alone')
    return
  }

  const findLevel = db.prepare(`SELECT id FROM levels WHERE gd_id = ?`)
  const updateLevel = db.prepare(`
    UPDATE levels
       SET mscl_position = ?,
           verifier  = CASE WHEN COALESCE(verifier,'')  = '' THEN ? ELSE verifier  END,
           publisher = CASE WHEN COALESCE(publisher,'') = '' THEN ? ELSE publisher END
     WHERE id = ?
  `)
  const insOwn = db.prepare(`
    INSERT INTO mscl_levels
      (mscl_id, gd_id, position, name, requirement, video, thumbnail, tier, fps,
       publisher_name, verifier_name, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(mscl_id) DO UPDATE SET
      gd_id = excluded.gd_id, position = excluded.position, name = excluded.name,
      requirement = excluded.requirement, video = excluded.video,
      thumbnail = excluded.thumbnail, tier = excluded.tier, fps = excluded.fps,
      publisher_name = excluded.publisher_name, verifier_name = excluded.verifier_name,
      fetched_at = excluded.fetched_at
  `)

  let merged = 0
  let msclOnly = 0

  db.exec('BEGIN')
  try {
    // Placements are re-derived every run, so a level dropped from MSCL stops
    // claiming a position instead of keeping a stale one.
    db.exec(`UPDATE levels SET mscl_position = NULL WHERE mscl_position IS NOT NULL`)

    for (const d of demons) {
      insOwn.run(
        d.id, d.level_id ?? null, d.position, d.name, d.requirement ?? null,
        d.video ?? null, d.thumbnail ?? null, d.tier ?? null, d.fps ?? null,
        d.publisher?.name ?? null, d.verifier?.name ?? null, now,
      )

      if (!d.level_id) { msclOnly++; continue }
      const existing = findLevel.get(d.level_id) as { id: number } | undefined
      if (!existing) { msclOnly++; continue }

      updateLevel.run(d.position, d.verifier?.name ?? '', d.publisher?.name ?? '', existing.id)
      merged++
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  console.log(
    `[mscl] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
    `${merged} merged into ALL, ${msclOnly} MSCL-only.`,
  )
}

// Matches the other importers. Comparing import.meta.url to argv[1] breaks on
// Windows, where the two disagree on how many slashes follow `file:`.
const isCli = typeof process !== 'undefined' && Array.isArray(process.argv)
  && process.argv[1] && /import-mscl\.ts$/.test(process.argv[1])
if (isCli) {
  importMscl().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
