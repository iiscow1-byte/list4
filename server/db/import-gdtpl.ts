/**
 * Generic importer for any list built on the TheShittyList/GDListTemplate
 * format (one `data/_list.json` of ordered slugs + one `data/<slug>.json` per
 * level). Mirrors per-list level rows into:
 *   - gdtpl_levels  (one row per (list_slug, level_slug); the source-of-truth
 *                    cache for what each list says about each level)
 *   - levels        (ALL-list rows: backfills empty creator / verifier /
 *                    publisher / verification_url for any matched gd_id)
 *   - pending_levels (one row per gdtpl level not yet on the ALL list, surfaced
 *                     in the admin "Imported levels" tab via from_gdtpl_id)
 *
 * Records are intentionally *not* fetched — per the user request, this importer
 * only seeds the level catalogue. Adding a new GDListTemplate-based list is a
 * one-call extension: see import-tsl.ts for the canonical example.
 *
 * Idempotent: every insert is an ON CONFLICT upsert. Re-running with no remote
 * changes is a no-op for unchanged rows.
 */
import { getDb } from './index.ts'
import { buildAnchors, estimateForSourcePosition } from '../utils/import-estimates.ts'
import type { ProgressReporter } from '../utils/imports-state.ts'

export type GdtplListConfig = {
  /** Short stable identifier — e.g. 'tsl'. Used as the gdtpl_levels.list_slug. */
  source: string
  /** Human label — e.g. 'The Shitty List Plus'. Surfaces in admin UI. */
  displayName: string
  /** Site root — e.g. 'https://tslplus.pages.dev'. /data/_list.json is appended. */
  baseUrl: string
  /** Default difficulty bucket for surfaced pending rows (e.g. 'Extreme Demon'). */
  defaultDifficulty?: string
  /** Concurrency for per-level fetches. Defaults to 8. */
  parallelism?: number
}

type GdtplLevelJson = {
  id?: number
  name?: string
  author?: string
  creators?: string[] | null
  verifier?: string
  verification?: string
  showcase?: string
  percentToQualify?: number | string
  password?: string | null
  records?: unknown
}

async function fetchText(url: string, retries = 3): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json,text/plain,*/*' } })
      if (!res.ok) {
        if ((res.status >= 500 || res.status === 429) && attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
          continue
        }
        throw new Error(`HTTP ${res.status} ${url}`)
      }
      return await res.text()
    } catch (err) {
      if (attempt === retries - 1) throw err
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }
  throw new Error('unreachable')
}

async function fetchJson<T>(url: string, retries = 3): Promise<T> {
  return JSON.parse(await fetchText(url, retries)) as T
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

function pctNum(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

// Some lists (notably CCL) ship a level "id" as a space-separated pair of GD
// level IDs (the second is the alternate copy). Take the first numeric token —
// it's always the canonical level the list is ranking.
function firstId(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const m = String(v).match(/-?\d+/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

export async function importGdtpl(cfg: GdtplListConfig, report?: ProgressReporter): Promise<void> {
  const t0 = Date.now()
  const db = getDb()
  const now = new Date().toISOString()
  const tag = `[${cfg.source}]`
  const par = cfg.parallelism ?? 8
  const baseData = cfg.baseUrl.replace(/\/+$/, '') + '/data'

  report?.({ phase: `Fetching ${cfg.displayName}`, done: 0, total: null })
  console.log(`${tag} Fetching _list.json (${cfg.displayName})…`)
  const slugs = await fetchJson<string[]>(`${baseData}/_list.json`)
  console.log(`${tag}   ${slugs.length} slugs`)

  console.log(`${tag} Fetching per-level JSON…`)
  report?.({ phase: 'Fetching levels', done: 0, total: slugs.length })
  let fetchedCount = 0
  type FetchedLevel = { slug: string; position: number; data: GdtplLevelJson | null }
  const fetched = await pmap<string, FetchedLevel>(slugs, par, async (slug, i) => {
    // Reported inside the worker: `pmap` resolves out of order, so counting
    // completions is the only honest measure of "how far along is this".
    const tick = () => report?.({ done: ++fetchedCount })
    try {
      const data = await fetchJson<GdtplLevelJson>(`${baseData}/${encodeURIComponent(slug)}.json`)
      tick()
      return { slug, position: i + 1, data }
    } catch (err) {
      console.warn(`${tag}   warn: failed to fetch ${slug}.json: ${(err as Error).message}`)
      tick()
      return { slug, position: i + 1, data: null }
    }
  })
  const ok = fetched.filter((f): f is FetchedLevel & { data: GdtplLevelJson } => f.data != null)
  console.log(`${tag}   ${ok.length}/${slugs.length} fetched ok`)

  const upsertGdtpl = db.prepare(`
    INSERT INTO gdtpl_levels
      (list_slug, level_slug, position, gd_id, name, author, creators_json,
       verifier, verification_url, showcase_url, percent_to_qualify, password, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(list_slug, level_slug) DO UPDATE SET
      position           = excluded.position,
      gd_id              = excluded.gd_id,
      name               = excluded.name,
      author             = excluded.author,
      creators_json      = excluded.creators_json,
      verifier           = excluded.verifier,
      verification_url   = excluded.verification_url,
      showcase_url       = excluded.showcase_url,
      percent_to_qualify = excluded.percent_to_qualify,
      password           = excluded.password,
      fetched_at         = excluded.fetched_at
  `)

  // Backfill: every empty field on an existing levels row gets the gdtpl value.
  // Never overwrites a non-empty value — local edits win.
  const findExisting = db.prepare(
    `SELECT id, creator, verifier, publisher, verification_url FROM levels WHERE gd_id = ?`,
  )
  const mergeExisting = db.prepare(`
    UPDATE levels
       SET creator          = CASE WHEN COALESCE(creator,'')          = '' THEN ? ELSE creator          END,
           verifier         = CASE WHEN COALESCE(verifier,'')         = '' THEN ? ELSE verifier         END,
           publisher        = CASE WHEN COALESCE(publisher,'')        = '' THEN ? ELSE publisher        END,
           verification_url = CASE WHEN COALESCE(verification_url,'') = '' THEN ? ELSE verification_url END
     WHERE id = ?
  `)

  let upserted = 0, mergedExisting = 0
  report?.({ phase: 'Storing levels', done: 0, total: ok.length })
  db.exec('BEGIN')
  try {
    for (const f of ok) {
      const d = f.data
      const gdId = firstId(d.id)
      const creators = Array.isArray(d.creators)
        ? d.creators.filter((s): s is string => typeof s === 'string' && s.length > 0)
        : []
      const creatorStr = creators.length ? creators.join(' & ') : null
      const author = typeof d.author === 'string' && d.author.length > 0 ? d.author : null
      const verifier = typeof d.verifier === 'string' && d.verifier.length > 0 ? d.verifier : null
      const verUrl = typeof d.verification === 'string' && d.verification.length > 0 ? d.verification : null
      const showcase = typeof d.showcase === 'string' && d.showcase.length > 0 ? d.showcase : null
      const password = typeof d.password === 'string' && d.password.length > 0 ? d.password : null

      upsertGdtpl.run(
        cfg.source,
        f.slug,
        f.position,
        gdId,
        d.name ?? null,
        author,
        JSON.stringify(creators),
        verifier,
        verUrl,
        showcase,
        pctNum(d.percentToQualify),
        password,
        now,
      )
      upserted++

      if (gdId != null) {
        const existing = findExisting.get(gdId) as
          | { id: number; creator: string | null; verifier: string | null; publisher: string | null; verification_url: string | null }
          | undefined
        if (existing) {
          mergeExisting.run(creatorStr, verifier, author, verUrl, existing.id)
          mergedExisting++
        }
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  console.log(`${tag}   ${upserted} gdtpl_levels rows; ${mergedExisting} merged into existing levels`)

  // Surface levels not yet on the ALL list as pending_levels rows under
  // from_gdtpl_id so they appear in the admin "Imported levels" tab. Levels
  // already on the ALL list are skipped here (the merge above already happened).
  report?.({ phase: 'Matching against the ALL', done: 0, total: null })
  console.log(`${tag} Refreshing pending_levels for ${cfg.source}-only levels…`)
  const onlyHere = db.prepare(
    `SELECT g.id, g.gd_id, g.position, g.name, g.author, g.verifier, g.verification_url
       FROM gdtpl_levels g
       LEFT JOIN levels l ON l.gd_id = g.gd_id
      WHERE g.list_slug = ?
        AND l.id IS NULL
        AND g.promoted_to_position IS NULL`,
  ).all(cfg.source) as Array<{
    id: number; gd_id: number | null; position: number; name: string | null;
    author: string | null; verifier: string | null; verification_url: string | null
  }>

  // Prefetch all source-list levels that are *also* on the ALL list, sorted by
  // source-list position. The estimator binary-searches this array per pending
  // row instead of running join-against-52k-row SELECTs for every iteration —
  // node:sqlite is synchronous, and per-row queries inside one big transaction
  // starve the event loop (no HTTP request returns for the duration).
  const anchors = buildAnchors(
    (db.prepare(
      `SELECT g.position AS source_pos, l.position AS all_pos, l.gddl_tier AS tier
         FROM gdtpl_levels g
         JOIN levels l ON l.gd_id = g.gd_id
        WHERE g.list_slug = ?
        ORDER BY g.position ASC`,
    ).all(cfg.source) as { source_pos: number; all_pos: number; tier: string | null }[])
      .map((r) => ({ sourcePos: r.source_pos, allPos: r.all_pos, tier: r.tier })),
  )

  // Conflict-target must repeat the partial-index WHERE clause for SQLite to
  // match `idx_pending_levels_from_gdtpl` (a unique-when-not-null index).
  // On re-import we refresh the importer-computed estimates so adding a level
  // to the ALL list (which shifts neighbour midpoints) actually propagates to
  // existing pending rows. The DO UPDATE only touches rows still in 'pending'
  // status, and it leaves a manually-edited tier alone — once an admin sets
  // gddl_tier_estimated=0 (via save_metadata), the importer stops overwriting
  // their value.
  const insPending = db.prepare(
    `INSERT INTO pending_levels
       (gd_id, name, verification_url, verifier, difficulty, notes,
        placement_source, placement_estimate, gddl_tier, gddl_tier_estimated,
        status, submitted_at, from_gdtpl_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
     ON CONFLICT(from_gdtpl_id) WHERE from_gdtpl_id IS NOT NULL DO UPDATE SET
       placement_estimate = excluded.placement_estimate,
       gddl_tier = CASE
         WHEN pending_levels.gddl_tier_estimated = 1 OR pending_levels.gddl_tier IS NULL
           THEN excluded.gddl_tier
         ELSE pending_levels.gddl_tier
       END,
       gddl_tier_estimated = CASE
         WHEN pending_levels.gddl_tier_estimated = 1 OR pending_levels.gddl_tier IS NULL
           THEN excluded.gddl_tier_estimated
         ELSE pending_levels.gddl_tier_estimated
       END
     WHERE pending_levels.status = 'pending'`,
  )

  // Auto-reject imports whose verification URL already verifies a main-list
  // level — same video can't verify two different rankings, so it's almost
  // always a re-posting of an already-tracked level under another name.
  const existingVerUrls = new Set<string>(
    (db.prepare(`SELECT verification_url FROM levels WHERE verification_url IS NOT NULL AND verification_url <> ''`).all() as { verification_url: string }[])
      .map((r) => r.verification_url),
  )

  let importedReview = 0
  let skippedDupVer = 0
  const placementSource = cfg.displayName
  const difficulty = cfg.defaultDifficulty ?? 'Extreme Demon'

  // Batch the inserts so we yield to the event loop between batches. With one
  // big transaction the site freezes (node:sqlite holds the writer for the
  // whole loop and there are no awaits). 100 rows/batch keeps each blocking
  // window short enough that HTTP requests stay responsive.
  const BATCH_SIZE = 100
  report?.({ phase: 'Queuing new levels for review', done: 0, total: onlyHere.length })
  for (let i = 0; i < onlyHere.length; i += BATCH_SIZE) {
    const slice = onlyHere.slice(i, i + BATCH_SIZE)
    db.exec('BEGIN')
    try {
      for (const lv of slice) {
        if (lv.verification_url && existingVerUrls.has(lv.verification_url)) { skippedDupVer++; continue }

        const est = estimateForSourcePosition(anchors, lv.position)
        let placementEstimate = est.placement
        // Top-of-list extremes have ALL-positions close to their source-list
        // positions, so the estimate can coincidentally equal the source rank.
        // Drop the suggestion in that case — using the source-list position as a
        // placement on our list would be misleading.
        if (placementEstimate === lv.position) placementEstimate = null
        const estimatedTier = est.tier

        const notes = `Imported from ${cfg.displayName} · placement #${lv.position}`
        const result = insPending.run(
          lv.gd_id,
          lv.name,
          lv.verification_url,
          lv.verifier,
          difficulty,
          notes,
          placementSource,
          placementEstimate,
          estimatedTier,
          estimatedTier ? 1 : 0,
          now,
          lv.id,
        )
        if (result.changes > 0) importedReview++
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    report?.({ done: Math.min(i + BATCH_SIZE, onlyHere.length) })
    // Hand control back to the event loop so the running HTTP server can
    // serve requests between write batches.
    await new Promise<void>((r) => setImmediate(r))
  }
  console.log(`${tag}   ${importedReview} pending_levels rows written (insert or estimate refresh) (${onlyHere.length} ${cfg.source}-only total, ${skippedDupVer} dup verification URL)`)
  console.log(`${tag} Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}
