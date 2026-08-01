import { getDb } from './index.ts'
import { recomputePoints } from '../utils/points.ts'
import { repairSandwichedTiers } from '../utils/tier-repair.ts'

const SHEET_BASE_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQqB-B4XtOCo-tsy5TCCFljoOClmAmrrE4oxowHVhrCcQW5r-_f6xSXOezekRsrR55_QBHhrsVlxXLH'

export const TABS = [
  { gid: '0',          label: 'Main (Extreme Demons)' },
  { gid: '1036115495', label: 'Tier 4 Demons' },
  { gid: '1989779679', label: 'Subtier 5 Harder' },
  { gid: '516171001',  label: 'Subtier 4 Harder' },
  { gid: '1985672631', label: 'Subtier 3 Hard' },
  { gid: '1875166663', label: 'Subtier 1 Easy' },
]
const LEADERBOARD_GID = '280339977'
const STATS_VIEWER_GID = '943829784'
const VOID_LIST_GID = '1630809094'
const PENDING_LIST_GID = '139895069'

// Sentinel pending_id for awaiting rows that originated from the sheet's
// Pending List tab. Lets re-imports prune stale sheet entries without
// touching real user-submitted approvals (which always have a positive
// pending_levels.id). pending_id has no FK, so -1 is safe.
const SHEET_PENDING_ID = -1

// ---------- HTML helpers ----------
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? m)
}
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).trim()
}

/**
 * Splits a `<tbody>...</tbody>` blob into individual `<tr>...</tr>` strings.
 * Done by streaming-style scan to avoid catastrophic regex backtracking on 18MB inputs.
 */
function splitRows(tbody: string): string[] {
  const rows: string[] = []
  let i = 0
  while (i < tbody.length) {
    const start = tbody.indexOf('<tr', i)
    if (start === -1) break
    const end = tbody.indexOf('</tr>', start)
    if (end === -1) break
    rows.push(tbody.slice(start, end + 5))
    i = end + 5
  }
  return rows
}

/**
 * Splits a `<tr>...` blob into its `<td>` cell HTML strings (in order).
 * The leading `<th>` (row number) is dropped.
 */
function splitCells(tr: string): string[] {
  const cells: string[] = []
  let i = 0
  while (i < tr.length) {
    const start = tr.indexOf('<td', i)
    if (start === -1) break
    const tagEnd = tr.indexOf('>', start)
    if (tagEnd === -1) break
    const close = tr.indexOf('</td>', tagEnd)
    if (close === -1) break
    cells.push(tr.slice(tagEnd + 1, close))
    i = close + 5
  }
  return cells
}

/**
 * Extract the real destination URL from a Google `https://www.google.com/url?q=...&sa=D...`
 * redirect, or return the URL unchanged if it isn't one.
 */
function unwrapGoogleRedirect(url: string): string {
  const m = url.match(/^https?:\/\/www\.google\.com\/url\?q=([^&]+)/)
  if (!m) return url
  try {
    return decodeURIComponent(m[1]!)
  } catch {
    return url
  }
}

/**
 * Returns the first `<a href="...">` URL inside a cell HTML string, unwrapped from
 * Google's redirect. Returns null if there is no link.
 */
export function extractLinkHref(cellHtml: string): string | null {
  const m = cellHtml.match(/<a[^>]*\shref="([^"]+)"/i)
  if (!m) return null
  return unwrapGoogleRedirect(decodeEntities(m[1]!))
}

// ---------- header detection ----------
/**
 * Each tab's first non-empty data row in `<tbody>` is the header row.
 * Returns a map of normalized header name -> column index.
 */
export function findHeaderColumns(rows: string[][]): { headerIdx: number; cols: Record<string, number> } | null {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    if (r.some((c) => c.toLowerCase() === 'level name' || c.toLowerCase() === 'player name')) {
      const cols: Record<string, number> = {}
      r.forEach((c, idx) => { if (c) cols[c.toLowerCase()] = idx })
      return { headerIdx: i, cols }
    }
  }
  return null
}

export async function fetchTabRows(gid: string): Promise<{ text: string[][]; html: string[][] }> {
  const url = `${SHEET_BASE_URL}/pubhtml/sheet?headers=false&gid=${gid}`
  const res = await fetch(url, { headers: { 'User-Agent': 'all-levels-list-importer/1.0' } })
  if (!res.ok) throw new Error(`fetch gid=${gid} failed: ${res.status}`)
  const html = await res.text()
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)
  if (!tbodyMatch) throw new Error(`gid=${gid}: no tbody found`)
  const trs = splitRows(tbodyMatch[1]!)
  const htmlRows = trs.map(splitCells)
  const textRows = htmlRows.map((cells) => cells.map(stripTags))
  return { text: textRows, html: htmlRows }
}

// ---------- numeric/text helpers ----------
export function num(s: string | undefined): number | null {
  if (!s) return null
  const cleaned = s.replace(/,/g, '').trim()
  if (cleaned === '' || cleaned === '-') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}
export function txt(s: string | undefined): string | null {
  const t = (s ?? '').trim()
  return t === '' ? null : t
}

// Parses tier strings from the sheet, including loose forms.
// "Tier 25" / "tier 25"   → { tier: "Tier 25",   frac: 0.5 }
// "Tier 25.5"             → { tier: "Tier 25",   frac: 0.5 }   decimal = position within tier
// "T25" / "tier25" / "25" → { tier: "Tier 25",   frac: 0.5 }   bare number / no space
// "Subtier 4" / "S4"      → { tier: "Subtier 4", frac: 0.5 }
// "Subtier 4.25"          → { tier: "Subtier 4", frac: 0.25 }
// Anything else           → null (caller leaves the cell as-is so we don't break)
export function parseTierLabel(raw: string | null): { tier: string; frac: number } | null {
  if (!raw) return null
  const t = raw.trim()
  if (!t) return null
  // Match Subtier first since "S5" would otherwise be eaten by the Tier regex
  // if we made it tolerate stray letters.
  const sub = t.match(/^(?:subtier|sub|s)\s*(\d{1,2})(?:\.(\d+))?$/i)
  if (sub) {
    const frac = sub[2] !== undefined ? Math.min(1, parseFloat(`0.${sub[2]}`)) : 0.5
    return { tier: `Subtier ${Number(sub[1])}`, frac }
  }
  const m = t.match(/^(?:t(?:ier)?)?\s*(\d{1,2})(?:\.(\d+))?$/i)
  if (m) {
    const frac = m[2] !== undefined ? Math.min(1, parseFloat(`0.${m[2]}`)) : 0.5
    return { tier: `Tier ${Number(m[1])}`, frac }
  }
  return null
}

// ---------- import driver ----------
/**
 * Headers and data are sometimes off by one column in tabs that have extra
 * icon/spacer columns (notably the Main tab). For each named column, peek at
 * the next few data rows and shift right by 1 if the labelled column is empty
 * but the next column has content.
 */
export function refineColumns(textRows: string[][], cols: Record<string, number>, dataStart: number): Record<string, number> {
  const sample = textRows.slice(dataStart, dataStart + 8).filter((r) => r.length > 5)
  if (sample.length === 0) return cols
  const refined = { ...cols }
  for (const [name, idx] of Object.entries(cols)) {
    const hasHere = sample.some((r) => (r[idx] ?? '').trim() !== '')
    if (hasHere) continue
    const hasNext = sample.some((r) => (r[idx + 1] ?? '').trim() !== '')
    if (hasNext) refined[name] = idx + 1
  }
  return refined
}

/**
 * One-time cleanup for DBs populated before the (gd_id, name) dedupe was in
 * place. Earlier importLevels runs counted positions up from MAX(position)+1,
 * so every re-import created another full copy of every sheet level. Group by
 * (gd_id, lower(name)); per group, keep the permanent row if any, otherwise
 * the lowest id (oldest, most stable for FK references); re-point records,
 * opinions, and pending_levels to the survivor; delete the rest. Idempotent —
 * no-op once the DB is clean.
 *
 * Grouping is done in JS rather than via GROUP_CONCAT/window functions because
 * earlier SQL-based versions silently produced no diagnostic output when they
 * failed; this version always logs the group count and verifies afterward.
 */
function cleanupDuplicateLevels(db: ReturnType<typeof getDb>): void {
  type Row = { id: number; gd_id: number | null; name: string; permanent: number }
  const rows = db.prepare(`SELECT id, gd_id, name, permanent FROM levels`).all() as Row[]

  const groups = new Map<string, { id: number; perm: boolean }[]>()
  for (const r of rows) {
    const key = `${r.gd_id ?? ''}|${r.name.toLowerCase()}`
    let g = groups.get(key)
    if (!g) { g = []; groups.set(key, g) }
    g.push({ id: r.id, perm: r.permanent === 1 })
  }

  const remap: { drop: number; keep: number }[] = []
  let dupGroups = 0
  for (const g of groups.values()) {
    if (g.length < 2) continue
    dupGroups++
    // Prefer permanent rows; among ties, lowest id wins.
    g.sort((a, b) => Number(b.perm) - Number(a.perm) || a.id - b.id)
    const keep = g[0]!.id
    for (let i = 1; i < g.length; i++) remap.push({ drop: g[i]!.id, keep })
  }

  console.log(`Dedupe scan: ${rows.length} rows, ${groups.size} unique (gd_id, name), ${dupGroups} duplicated, ${remap.length} rows to remove.`)
  if (remap.length === 0) return

  const updRecords  = db.prepare(`UPDATE records  SET level_id = ? WHERE level_id = ?`)
  const updOpinions = db.prepare(`UPDATE opinions SET level_id = ? WHERE list_kind = 'main' AND level_id = ?`)
  const updPending  = db.prepare(`UPDATE pending_levels SET comparison_level_id = ? WHERE comparison_level_id = ?`)
  const delLevel    = db.prepare(`DELETE FROM levels WHERE id = ?`)

  db.exec('BEGIN')
  try {
    for (const { drop, keep } of remap) {
      updRecords.run(keep, drop)
      updOpinions.run(keep, drop)
      updPending.run(keep, drop)
      delLevel.run(drop)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    console.error('Cleanup failed, rolled back:', e)
    throw e
  }

  // Sanity check — query the DB again and confirm zero duplicate groups remain.
  const remaining = db.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT 1 FROM levels GROUP BY COALESCE(gd_id, -1), LOWER(name) HAVING COUNT(*) > 1
    )
  `).get() as { n: number }
  console.log(`Removed ${remap.length} duplicate level rows. ${remaining.n} duplicate groups remain.`)
  if (remaining.n > 0) {
    console.warn(`WARNING: cleanup completed but ${remaining.n} duplicate groups still present — please report.`)
  }
}

const dupKey = (gd: number | null, n: string) => `${gd ?? ''}|${n.toLowerCase()}`

async function importLevels() {
  const db = getDb()

  cleanupDuplicateLevels(db)

  // `rated` is imported from the sheet only for the 'Challenge' value — every
  // other rating is sourced from the GD API at query time. `points` is skipped
  // entirely; values are derived from gddl_tier + position via recomputePoints().
  const insert = db.prepare(`
    INSERT INTO levels
      (position, name, gd_id, gddl_tier, difficulty, placement_source,
       main_skillset, verify_date, verification, verification_url, pov_placement,
       year_verified, category, source_tab, rated, sheet_placement)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'classic', ?, ?, ?)
  `)
  // Refreshed on every run for rows that already exist, so a curator
  // renumbering, renaming, or filling in the Level ID shows up without a wipe.
  const updSheetRow = db.prepare(
    `UPDATE levels SET sheet_placement = ?, name = ?, gd_id = COALESCE(?, gd_id) WHERE id = ?`,
  )
  // A level that has fallen off the sheet keeps its position but must not keep
  // advertising a stale placement — that's what put a "#5" between #19 and #20.
  const clearSheetPlacement = db.prepare(`UPDATE levels SET sheet_placement = NULL WHERE id = ?`)

  // Levels that have a permanent counterpart are owned by the website, not the
  // sheet — skip any incoming row matching one of these gd_ids.
  const permGdIds = new Set(
    (db.prepare(`SELECT gd_id FROM levels WHERE permanent = 1 AND gd_id IS NOT NULL`).all() as { gd_id: number }[])
      .map((r) => r.gd_id),
  )

  // Pre-load existing rows so we can decide insert vs. reuse-and-reposition.
  // Lowercased name matches the COLLATE NOCASE index on levels.name.
  //
  // Matching on (gd_id, name) alone is too strict: a curator renaming a level,
  // or filling in a Level ID that was previously blank, changes the key and the
  // old row survives as a second copy of the same level. Two fallback indexes
  // catch those, both restricted to values that are *unambiguous* so they can
  // never merge genuinely distinct entries — Solo/2P variants share a gd_id and
  // Old/Unnerfed re-releases share nothing but a similar name, so both stay
  // separate rows.
  const existingRows = db
    .prepare(`SELECT id, gd_id, name FROM levels WHERE permanent = 0 OR permanent IS NULL`)
    .all() as { id: number; gd_id: number | null; name: string }[]

  const existingByKey = new Map<string, number>()   // "gd_id|name" -> id
  const nameCounts = new Map<string, number>()
  const gdCounts = new Map<number, number>()
  for (const row of existingRows) {
    existingByKey.set(dupKey(row.gd_id, row.name), row.id)
    const n = row.name.toLowerCase()
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1)
    if (row.gd_id != null) gdCounts.set(row.gd_id, (gdCounts.get(row.gd_id) ?? 0) + 1)
  }
  const existingByName = new Map<string, number>()  // unique lowercase name -> id
  const existingByGd = new Map<number, number>()    // unique gd_id -> id
  for (const row of existingRows) {
    const n = row.name.toLowerCase()
    if (nameCounts.get(n) === 1) existingByName.set(n, row.id)
    if (row.gd_id != null && gdCounts.get(row.gd_id) === 1) existingByGd.set(row.gd_id, row.id)
  }

  /** Ids already claimed by a sheet row this run, so two rows can't share one. */
  const claimed = new Set<number>()

  /**
   * Resolve a sheet row to an existing level. Exact key first, then the
   * unambiguous fallbacks. `sheetGdCounts` guards the gd_id fallback: if the
   * sheet itself lists that id twice (a Solo/2P pair), matching on it would
   * collapse the pair into one row.
   */
  function findExistingLevel(
    gdId: number | null,
    name: string,
    sheetGdCounts: Map<number, number>,
  ): number | undefined {
    const exact = existingByKey.get(dupKey(gdId, name))
    if (exact !== undefined && !claimed.has(exact)) return exact

    const byName = existingByName.get(name.toLowerCase())
    if (byName !== undefined && !claimed.has(byName)) return byName

    if (gdId != null && (sheetGdCounts.get(gdId) ?? 0) === 1) {
      const byGd = existingByGd.get(gdId)
      if (byGd !== undefined && !claimed.has(byGd)) return byGd
    }
    return undefined
  }

  // Sheet placement numbers are not authoritative — the row order *within* each
  // tab is. Same level appearing on multiple tabs (e.g. main + tier-specific)
  // collapses to a single row; the first tab to claim it wins, matching the
  // TABS order (Main, then tiers). The placement column is still read, but only
  // as a "is this a real level row" signal (decoration / section-header rows
  // have no placement value).
  //
  // Newly-encountered rows are inserted with a temporary position above
  // MAX(position); applySheetOrder below renumbers everything to match the
  // sheet's current ordering.
  let tempPos = (db.prepare(`SELECT COALESCE(MAX(position), 0) AS m FROM levels`).get() as { m: number }).m

  // Ids inserted by this run, and whether the list existed beforehand. The
  // first seed of an empty database isn't news — writing 54,000 "added"
  // entries for it would bury every real change under the initial import.
  const newIds = new Set<number>()
  const hadLevelsBefore = tempPos > 0

  const sheetOrder: { key: string; gdId: number | null; name: string; rated: string | null }[] = []
  const seenKeys = new Set<string>()
  let total = 0
  let skipped = 0
  let permSkipped = 0

  // --- Phase 1: fetch every tab, then count how often each Level ID appears
  // across the whole sheet. The gd_id fallback in findExistingLevel is only
  // safe for ids the sheet lists once; a Solo/2P pair shares an id, and
  // matching on it would collapse the pair into a single row.
  type FetchedTab = {
    tab: (typeof TABS)[number]
    text: string[][]
    html: string[][]
    cols: Record<string, number>
    headerIdx: number
  }
  const fetched: FetchedTab[] = []
  const sheetGdCounts = new Map<number, number>()

  for (const tab of TABS) {
    process.stdout.write(`Fetching tab "${tab.label}" (gid=${tab.gid})... `)
    const { text, html } = await fetchTabRows(tab.gid)
    const found = findHeaderColumns(text)
    if (!found) { console.log('no header row, skipping'); continue }
    const c = refineColumns(text, found.cols, found.headerIdx + 1)
    // The "Placement on Verification" column in the published sheet has a
    // uniform "1" indicator cell at the labelled column; the actual placement
    // value lives one column to the right. refineColumns can't detect this
    // because it only shifts when the labelled cell is empty.
    if (c['placement on verification'] != null) {
      c['placement on verification'] = c['placement on verification'] + 1
    }
    console.log(`${text.length - found.headerIdx - 1} rows`)
    fetched.push({ tab, text, html, cols: c, headerIdx: found.headerIdx })

    for (let i = found.headerIdx + 1; i < text.length; i++) {
      const r = text[i]!
      if (!txt(r[c['level name']!]) || num(r[c['placement']!]) === null) continue
      const gd = num(r[c['level id']!])
      if (gd != null) sheetGdCounts.set(gd, (sheetGdCounts.get(gd) ?? 0) + 1)
    }
  }

  // --- Phase 2: reconcile the sheet against the database.
  for (const { tab, text, html, cols: c, headerIdx } of fetched) {
    const found = { headerIdx }
    const sourceCol = c['source'] ?? c['primary source']
    const verCol = c['verification link']
    let imported = 0

    db.exec('BEGIN')
    try {
      for (let i = found.headerIdx + 1; i < text.length; i++) {
        const r = text[i]!
        const rh = html[i]!
        const name = txt(r[c['level name']!])
        const placement = num(r[c['placement']!])
        // Filter, don't assign — placement === null means decoration row.
        if (!name || placement === null) { skipped++; continue }
        const gdId = num(r[c['level id']!])
        if (gdId !== null && permGdIds.has(gdId)) { permSkipped++; continue }
        const key = dupKey(gdId, name)
        // Already encountered earlier in the sheet — record nothing twice.
        // A Set lookup, not a scan: the old `sheetOrder.some(...)` was O(n²)
        // over 54k rows.
        if (seenKeys.has(key)) continue
        seenKeys.add(key)
        const ratedRaw = txt(r[c['rated']!])
        const sheetRated = ratedRaw?.toLowerCase() === 'challenge' ? 'Challenge' : null
        sheetOrder.push({ key, gdId, name, rated: sheetRated })

        const known = findExistingLevel(gdId, name, sheetGdCounts)
        if (known !== undefined) {
          claimed.add(known)
          // The row may have been found by a fallback because the sheet
          // renamed it or filled in its Level ID — write both back so the
          // next run matches on the exact key again.
          updSheetRow.run(placement, name, gdId, known)
          continue
        }

        tempPos++
        const verHref = verCol != null ? extractLinkHref(rh[verCol] ?? '') : null
        // Placement on verification is only trusted on the Main tab (gid=0);
        // tier-specific tabs have stale / off-by-one values for these.
        const povCol = c['placement on verification']
        const pov = tab.gid === '0' && povCol != null ? num(r[povCol]!) : null
        const result = insert.run(
          tempPos,
          name,
          gdId,
          txt(r[c['gddl tier']!]),
          txt(r[c['difficulty']!]),
          sourceCol != null ? txt(r[sourceCol]) : null,
          txt(r[c['main skillset']!]),
          txt(r[c['verify date']!]),
          verCol != null ? txt(r[verCol]) : null,
          verHref,
          pov,
          num(r[c['year verified']!]),
          tab.label,
          sheetRated,
          placement,
        )
        newIds.add(Number(result.lastInsertRowid))
        existingByKey.set(key, Number(result.lastInsertRowid))
        imported++
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    console.log(`${imported} new`)
    total += imported
  }

  // Levels on the site but not in the sheet: promoted submissions, hand-placed
  // additions, levels the curators removed. Their placement is the site's, not
  // the sheet's, so clear `sheet_placement` (the list must never show a number
  // the sheet doesn't back) and pin them where they are. Previously they were
  // swept to the bottom on every import, which is why a level added through
  // the site kept ending up at the end of the list.
  const unmatched = existingRows.filter((r) => !claimed.has(r.id) && !newIds.has(r.id))

  // Split the unmatched rows. One that originally came from a sheet tab and
  // was never touched through the site is a level the sheet has since renamed
  // or removed — the leftover copy is the duplicate that kept piling up at the
  // bottom of the list, so delete it. Anything a person put here (a site
  // submission, or a row carrying records) is kept and pinned in place.
  const detail = db.prepare(
    `SELECT id, source_tab, submitted_by, permanent,
            (SELECT COUNT(*) FROM records WHERE records.level_id = levels.id) AS record_count
       FROM levels WHERE id = ?`,
  )
  const prunable: typeof unmatched = []
  const strays: typeof unmatched = []
  for (const r of unmatched) {
    const d = detail.get(r.id) as
      { source_tab: string | null; submitted_by: number | null; permanent: number; record_count: number }
    const sheetBorn = !!d.source_tab && !d.submitted_by && !d.permanent && d.record_count === 0
    ;(sheetBorn ? prunable : strays).push(r)
  }

  if (prunable.length) {
    const del = db.prepare(`DELETE FROM levels WHERE id = ?`)
    db.exec('BEGIN')
    try {
      for (const r of prunable) del.run(r.id)
      db.exec('COMMIT')
    } catch (e) { db.exec('ROLLBACK'); throw e }
    console.log(`${prunable.length} sheet level(s) no longer in the sheet — removed:`)
    for (const r of prunable.slice(0, 20)) console.log(`  · ${r.name}${r.gd_id ? ` (${r.gd_id})` : ''}`)
    if (prunable.length > 20) console.log(`  … and ${prunable.length - 20} more`)
  }

  if (strays.length) {
    db.exec('BEGIN')
    try {
      for (const s of strays) clearSheetPlacement.run(s.id)
      db.exec('COMMIT')
    } catch (e) { db.exec('ROLLBACK'); throw e }
    console.log(`${strays.length} site-only level(s) — placement held, sheet number cleared:`)
    for (const s of strays.slice(0, 20)) console.log(`  · ${s.name}${s.gd_id ? ` (${s.gd_id})` : ''}`)
    if (strays.length > 20) console.log(`  … and ${strays.length - 20} more`)
  }

  const orphans = applySheetOrder(db, sheetOrder, {
    newIds,
    recordHistory: hadLevelsBefore,
    anchorIds: new Set(strays.map((s) => s.id)),
  })
  applyRatedFromSheet(db, sheetOrder)

  // A level whose tier disagrees with both neighbours (Tier 31, 30, 31) is a
  // sheet typo — correct it before points are derived from those tiers.
  const tierFixes = repairSandwichedTiers(db)
  for (const f of tierFixes) {
    console.log(`  tier fix: #${f.position} ${f.name}: ${f.from} → ${f.to}`)
  }

  // Points are derived from tier + position; recompute against the freshly
  // settled list ordering so every level (including imports just renumbered)
  // ends up with a current value.
  recomputePoints(db)

  // Detect natural ties (level has the same points as its position-neighbor
  // above) and pre-flag them as `same_as_above`. Pure import-time housekeeping —
  // future moves of the upper level will then keep the lower one in sync.
  const flagged = flagSameAsAbove(db)

  console.log(
    `\nImported ${total} new levels; renumbered all non-permanent rows by sheet order ` +
    `(${orphans} not in current sheet, kept at end). ${skipped} blank rows, ` +
    `${permSkipped} skipped — owned by permanent records. Points recomputed. ` +
    `${flagged} level(s) auto-flagged "same as above". ` +
    `${tierFixes.length} sandwiched tier(s) corrected.`,
  )
}

/**
 * Flag `same_as_above = 1` on any level whose `points` exactly match the level
 * immediately above it (position − 1). Only writes when the flag is currently
 * 0 — never clears a flag set elsewhere, and is otherwise a no-op on rerun.
 * Returns the number of rows updated this call.
 *
 * Position-adjacency is required so a gap (e.g. a missing position from a
 * past delete) doesn't cause us to bridge unrelated rows.
 */
function flagSameAsAbove(db: ReturnType<typeof getDb>): number {
  const rows = db
    .prepare(
      `SELECT id, position, points, same_as_above
         FROM levels
        ORDER BY position ASC`,
    )
    .all() as { id: number; position: number; points: number | null; same_as_above: number }[]
  if (rows.length < 2) return 0

  const upd = db.prepare(`UPDATE levels SET same_as_above = 1 WHERE id = ?`)
  let prev: (typeof rows)[number] | null = null
  let flagged = 0

  db.exec('BEGIN')
  try {
    for (const r of rows) {
      if (
        prev &&
        prev.position === r.position - 1 &&
        prev.points != null &&
        r.points != null &&
        Math.abs(prev.points - r.points) < 1e-6 &&
        !r.same_as_above
      ) {
        upd.run(r.id)
        flagged++
      }
      prev = r
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return flagged
}

/**
 * Sync the 'rated' field for non-permanent levels based on the sheet data.
 * Only the 'Challenge' value is imported from the sheet; all other ratings
 * come from the GD API at query time and are never overwritten here.
 * - If sheet says 'Challenge' and DB doesn't → set to 'Challenge'.
 * - If sheet doesn't say 'Challenge' and DB has 'Challenge' → clear to NULL
 *   (so it no longer suppresses the GD API rating).
 * - Other rated values (Featured, Epic, etc.) set by admins are left alone.
 */
function applyRatedFromSheet(
  db: ReturnType<typeof getDb>,
  sheetOrder: { key: string; gdId: number | null; name: string; rated: string | null }[],
): void {
  const challengeKeys = new Set(
    sheetOrder.filter((s) => s.rated === 'Challenge').map((s) => s.key),
  )

  const rows = db
    .prepare(`SELECT id, gd_id, name, rated FROM levels WHERE permanent = 0 OR permanent IS NULL`)
    .all() as { id: number; gd_id: number | null; name: string; rated: string | null }[]

  const update = db.prepare(`UPDATE levels SET rated = ? WHERE id = ?`)
  let changed = 0

  db.exec('BEGIN')
  try {
    for (const row of rows) {
      const key = dupKey(row.gd_id, row.name)
      const sheetSaysChallenge = challengeKeys.has(key)
      if (sheetSaysChallenge && row.rated !== 'Challenge') {
        update.run('Challenge', row.id)
        changed++
      } else if (!sheetSaysChallenge && row.rated === 'Challenge') {
        update.run(null, row.id)
        changed++
      }
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  if (changed > 0) console.log(`Challenge rated: ${changed} level(s) updated.`)
}

/**
 * Two-phase reposition. Sheet entries get sequential positions starting at 1,
 * skipping over positions held by permanent levels (which are website-owned and
 * never move). DB rows that don't match a sheet entry are appended after the
 * sheet entries in their previous-position order. Everything happens inside a
 * single transaction; the negative-position parking step lets us swap rows
 * without tripping the position UNIQUE constraint mid-way.
 *
 * Returns the count of non-permanent rows that weren't matched against the
 * sheet (orphans).
 */
function applySheetOrder(
  db: ReturnType<typeof getDb>,
  sheetOrder: { key: string; gdId: number | null; name: string }[],
  opts: { newIds?: Set<number>; recordHistory?: boolean; anchorIds?: Set<number> } = {},
): number {
  const sheetRank = new Map<string, number>()
  sheetOrder.forEach((s, i) => sheetRank.set(s.key, i))

  const anchorIds = opts.anchorIds ?? new Set<number>()
  const allNonPerm = (db
    .prepare(`SELECT id, gd_id, name, position FROM levels WHERE permanent = 0 OR permanent IS NULL`)
    .all() as { id: number; gd_id: number | null; name: string; position: number }[])
    // Anchored rows keep the position they already hold; only sheet-backed
    // levels are renumbered, and they flow around the anchors.
    .filter((r) => !anchorIds.has(r.id))

  // Positions before the renumber, so real movements can be told apart from
  // the passive shifting every level does when rows are inserted above it.
  const oldPositions = new Map<number, number>(allNonPerm.map((r) => [r.id, r.position]))

  const ranked = allNonPerm.map((r) => ({
    id: r.id,
    rank: sheetRank.get(dupKey(r.gd_id, r.name)) ?? Number.POSITIVE_INFINITY,
    fallbackPos: r.position,
  }))
  ranked.sort((a, b) => a.rank - b.rank || a.fallbackPos - b.fallbackPos)

  const anchoredPositions = new Set(
    (db.prepare(
      `SELECT id, position FROM levels WHERE permanent = 1`,
    ).all() as { id: number; position: number }[]).map((r) => r.position),
  )
  for (const row of db
    .prepare(`SELECT id, position FROM levels`)
    .all() as { id: number; position: number }[]) {
    if (anchorIds.has(row.id)) anchoredPositions.add(row.position)
  }
  const targets: number[] = []
  let p = 1
  while (targets.length < ranked.length) {
    if (!anchoredPositions.has(p)) targets.push(p)
    p++
  }

  const setPos = db.prepare(`UPDATE levels SET position = ? WHERE id = ?`)
  db.exec('BEGIN')
  try {
    // Park every non-permanent row at a unique negative position so the final
    // assignment can't collide with a value still held by another row in this
    // batch. Permanent positions are positive, so negatives are conflict-free.
    for (let i = 0; i < ranked.length; i++) setPos.run(-(i + 1), ranked[i]!.id)
    for (let i = 0; i < ranked.length; i++) setPos.run(targets[i]!, ranked[i]!.id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  if (opts.recordHistory) {
    recordSheetMovements(db, {
      oldPositions,
      newPositions: new Map(ranked.map((r, i) => [r.id, targets[i]!])),
      newIds: opts.newIds ?? new Set(),
    })
  }

  return ranked.filter((r) => !Number.isFinite(r.rank)).length
}

/**
 * Write changelog entries for a sheet refresh.
 *
 * Every level's absolute position moves whenever rows are inserted above it,
 * so absolute position is useless as a "did this move?" signal — a single new
 * level at the top would otherwise generate 54,000 changelog entries. What
 * matters is a level's rank *among the levels that were already on the list*:
 * insertions and removals leave that untouched, so a change to it means the
 * curators genuinely re-ranked the level against its peers.
 *
 * Newly imported levels get an "added" entry (from_position NULL), which is
 * what the changelog renders as "Added".
 */
function recordSheetMovements(
  db: ReturnType<typeof getDb>,
  args: {
    oldPositions: Map<number, number>
    newPositions: Map<number, number>
    newIds: Set<number>
  },
): void {
  const { oldPositions, newPositions, newIds } = args

  // Survivors: on the list before this run and still on it now.
  const survivors = [...newPositions.keys()].filter((id) => !newIds.has(id) && oldPositions.has(id))

  const oldRank = new Map<number, number>()
  survivors
    .slice()
    .sort((a, b) => oldPositions.get(a)! - oldPositions.get(b)!)
    .forEach((id, i) => oldRank.set(id, i))

  const newRank = new Map<number, number>()
  survivors
    .slice()
    .sort((a, b) => newPositions.get(a)! - newPositions.get(b)!)
    .forEach((id, i) => newRank.set(id, i))

  const ins = db.prepare(
    `INSERT INTO position_history (level_id, from_position, to_position, changed_by, source)
     VALUES (?, ?, ?, NULL, 'all')`,
  )

  let moves = 0
  let adds = 0
  db.exec('BEGIN')
  try {
    for (const id of survivors) {
      if (oldRank.get(id) === newRank.get(id)) continue
      ins.run(id, oldPositions.get(id)!, newPositions.get(id)!)
      moves++
    }
    for (const id of newIds) {
      const pos = newPositions.get(id)
      if (pos == null) continue
      ins.run(id, null, pos)
      adds++
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  console.log(`Changelog: ${adds} level(s) added, ${moves} genuinely re-ranked.`)
}

async function importLeaderboard() {
  const db = getDb()
  process.stdout.write(`Fetching leaderboard (gid=${LEADERBOARD_GID})... `)
  const { text } = await fetchTabRows(LEADERBOARD_GID)
  const found = findHeaderColumns(text)
  if (!found) { console.log('no header row, skipping'); return }
  const c = found.cols

  db.exec('DELETE FROM players')
  const insert = db.prepare(`
    INSERT INTO players (name, total_points, skill_points, hardest, tier)
    VALUES (?, ?, ?, ?, ?)
  `)

  let imported = 0
  db.exec('BEGIN')
  try {
    for (let i = found.headerIdx + 1; i < text.length; i++) {
      const r = text[i]!
      const name = txt(r[c['player name']!])
      if (!name) continue
      const tot = num(r[c['total points']!]) ?? 0
      const skl = num(r[c['skill points']!]) ?? 0
      if (tot === 0 && skl === 0) continue
      insert.run(name, tot, skl, txt(r[c['hardest']!]), txt(r[c['tier']!]))
      imported++
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  console.log(`${imported} players`)
}

/**
 * Stats Viewer tab — wide spreadsheet, one 5-column block per player:
 *   col 5N+1: separator
 *   col 5N+2: Level Name
 *   col 5N+3: Points
 *   col 5N+4: ALL Place  (the global level position; the level_id isn't shown)
 *   col 5N+5: GDDL Tier
 *
 * The player names sit in an early row at col 5N+2 (same column as Level Name).
 * We look levels up by `position = ALL Place` since the tab doesn't expose gd_id.
 */
type CellPos = { col: number; text: string }

function parseRowWithCols(rowHtml: string): CellPos[] {
  const cells: CellPos[] = []
  let col = 0
  const re = /<t([dh])([^>]*)>([\s\S]*?)<\/t\1>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(rowHtml)) !== null) {
    const attrs = m[2]!
    const content = m[3]!
    const csMatch = attrs.match(/colspan="(\d+)"/)
    const cs = csMatch ? Number(csMatch[1]) : 1
    cells.push({ col, text: stripTags(content) })
    col += cs
  }
  return cells
}

async function importStatsViewer() {
  const db = getDb()
  process.stdout.write(`Fetching stats viewer (gid=${STATS_VIEWER_GID})... `)

  const url = `${SHEET_BASE_URL}/pubhtml/sheet?headers=false&gid=${STATS_VIEWER_GID}`
  const res = await fetch(url, { headers: { 'User-Agent': 'all-levels-list-importer/1.0' } })
  if (!res.ok) throw new Error(`fetch stats viewer failed: ${res.status}`)
  const html = await res.text()
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)
  if (!tbodyMatch) { console.log('no tbody, skipping'); return }
  const trs = splitRows(tbodyMatch[1]!)
  const rows = trs.map(parseRowWithCols)

  // Find player-name row: the one containing 'Total Points' labels.
  let playerRowIdx = -1
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    if (rows[i]!.some((c) => c.text === 'Total Points')) { playerRowIdx = i; break }
  }
  if (playerRowIdx < 0) { console.log('no player row, skipping'); return }

  // Find level-header row: the one containing 'ALL Place'.
  let headerRowIdx = -1
  for (let i = playerRowIdx + 1; i < Math.min(12, rows.length); i++) {
    if (rows[i]!.some((c) => c.text.toLowerCase() === 'all place')) { headerRowIdx = i; break }
  }
  if (headerRowIdx < 0) { console.log('no header row, skipping'); return }

  // Build block index → player name. Player names are at col 5N+2 (block-local pos 1).
  const players = new Map<number, string>()
  for (const c of rows[playerRowIdx]!) {
    if (c.col < 1 || !c.text) continue
    const block = Math.floor((c.col - 1) / 5)
    const pos = (c.col - 1) % 5
    if (pos !== 1) continue
    if (c.text === 'Total Points' || c.text === 'Skill Points') continue
    players.set(block, c.text)
  }

  // Sheet records are auto-accepted (permanent = 1). They never went through the
  // submission queue, and not every legacy entry has a video link of consistent
  // shape, so we don't store one here either.
  const insert = db.prepare(
    `INSERT INTO records (level_id, player_id, player_name, video, permanent, submitted_by)
     VALUES (?, ?, ?, NULL, 1, NULL)`,
  )
  // Resolve by name first — that's the most stable key the stats viewer exposes.
  // Position lookup is the fallback: admin moves/deletes can shift DB positions
  // out of sync with the sheet's "ALL Place", and matching by position would
  // then bind records to the wrong level. The resulting level_id is the
  // levels.id PK (stable for the lifetime of the row), so once stored, records
  // stay correctly attached even if the level later moves.
  const findLevelByName = db.prepare(
    `SELECT id FROM levels WHERE name = ? COLLATE NOCASE ORDER BY position ASC LIMIT 1`,
  )
  const findLevelByPosition = db.prepare(`SELECT id FROM levels WHERE position = ?`)
  const findPlayer = db.prepare(`SELECT id FROM players WHERE name = ? COLLATE NOCASE`)

  let imported = 0
  let missingLevels = 0
  let dupes = 0

  // De-dup cases where the sheet lists the same player + level twice.
  const seen = new Set<string>()

  db.exec('BEGIN')
  try {
    // Wipe all sheet-source records and re-import. User submissions
    // (submitted_by IS NOT NULL) are preserved regardless of permanent state.
    db.exec(`DELETE FROM records WHERE submitted_by IS NULL`)

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i]!
      // Group cells by block index → { name, place }
      const blocks = new Map<number, { name?: string; place?: string }>()
      for (const c of row) {
        if (c.col < 1) continue
        const block = Math.floor((c.col - 1) / 5)
        const pos = (c.col - 1) % 5
        if (pos !== 1 && pos !== 3) continue
        let entry = blocks.get(block)
        if (!entry) { entry = {}; blocks.set(block, entry) }
        if (pos === 1) entry.name = c.text
        else entry.place = c.text
      }

      for (const [block, fields] of blocks) {
        const player = players.get(block)
        if (!player || !fields.name) continue
        const place = num(fields.place ?? '')

        const levelName = (fields.name ?? '').trim()
        const lvl = (levelName ? findLevelByName.get(levelName) as { id: number } | undefined : undefined)
                 ?? (place !== null && place > 0
                       ? findLevelByPosition.get(place) as { id: number } | undefined
                       : undefined)
        if (!lvl) { missingLevels++; continue }

        const dedupeKey = `${lvl.id}:${player.toLowerCase()}`
        if (seen.has(dedupeKey)) { dupes++; continue }
        seen.add(dedupeKey)

        const p = findPlayer.get(player) as { id: number } | undefined
        insert.run(lvl.id, p?.id ?? null, player)
        imported++
      }
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  console.log(`${imported} records (${dupes} duplicates, ${missingLevels} skipped — no matching position)`)
}

export async function importVoidList() {
  const db = getDb()
  process.stdout.write(`Fetching void list (gid=${VOID_LIST_GID})... `)
  const { text, html } = await fetchTabRows(VOID_LIST_GID)
  const found = findHeaderColumns(text)
  if (!found) { console.log('no header row, skipping'); return }
  const c = found.cols
  const verCol = c['verification link']

  // Wipe and re-import — void list churns frequently as levels move into the main list.
  db.exec(`DELETE FROM void_levels`)
  const insert = db.prepare(`
    INSERT OR IGNORE INTO void_levels
      (position, name, gd_id, verify_date, days, demon_ranking,
       placement_source, verification, verification_url, added_on)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let pos = 0
  let imported = 0
  db.exec('BEGIN')
  try {
    for (let i = found.headerIdx + 1; i < text.length; i++) {
      const r = text[i]!
      const rh = html[i]!
      const name = txt(r[c['level name']!])
      if (!name) continue
      const gdId = num(r[c['level id']!])
      const verifyDate = txt(r[c['verify date']!])
      const days = num(r[c['days']!])
      const demonRank = txt(r[c['demon ranking']!])
      const source = txt(r[c['source']!] ?? r[c['primary source']!])
      // Skip section header / blank rows — they have a name but no actual level data.
      if (!gdId && !verifyDate && days == null && !demonRank && !source) continue
      pos++
      const verHref = verCol != null ? extractLinkHref(rh[verCol] ?? '') : null
      // Prefer an explicit date from the sheet; fall back to computing one from
      // the `days` count so the display auto-updates every day rather than
      // staying frozen at the import snapshot.
      const explicitAddedOn = txt(r[c['added to pending on']!])
      const addedOn = explicitAddedOn || (days != null ? (() => {
        const d = new Date()
        d.setUTCDate(d.getUTCDate() - Math.max(0, days))
        return d.toISOString().slice(0, 10)
      })() : null)
      insert.run(
        pos, name, gdId, verifyDate, days, demonRank, source,
        verCol != null ? txt(r[verCol]) : null, verHref,
        addedOn,
      )
      imported++
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  console.log(`${imported} levels`)
}

export async function importPendingList() {
  const db = getDb()
  process.stdout.write(`Fetching pending list (gid=${PENDING_LIST_GID})... `)
  const { text, html } = await fetchTabRows(PENDING_LIST_GID)
  const found = findHeaderColumns(text)
  if (!found) { console.log('no header row, skipping'); return }
  const c = refineColumns(text, found.cols, found.headerIdx + 1)
  const verCol = c['verification link']
  // The pending tab calls the source column "Source" historically, but other
  // tabs use "Primary Source" — accept either so the import survives a header
  // tweak on the sheet.
  const sourceCol = c['source'] ?? c['primary source']

  // Dedupe across pending_levels (any source) and awaiting_levels so we don't
  // duplicate a level the user has already submitted or that's already in the
  // post-pending awaiting queue.
  const existingKeys = new Set<string>([
    ...(db.prepare(`SELECT gd_id, name FROM pending_levels WHERE status = 'pending'`).all() as { gd_id: number | null; name: string }[])
      .map((r) => dupKey(r.gd_id, r.name)),
    ...(db.prepare(`SELECT gd_id, name FROM awaiting_levels`).all() as { gd_id: number | null; name: string }[])
      .map((r) => dupKey(r.gd_id, r.name)),
  ])

  // Sheet-originated rows from earlier imports — used to prune stale entries
  // (levels that have since been removed from the sheet's pending tab).
  const existingSheetRows = db
    .prepare(`SELECT id, gd_id, name FROM pending_levels WHERE from_sheet_pending = 1 AND status = 'pending'`)
    .all() as { id: number; gd_id: number | null; name: string }[]

  // Skip levels already on the main list — overlapping would create a
  // confusing duplicate where the same gd_id appears in two queues.
  const mainGdIds = new Set<number>(
    (db.prepare(`SELECT gd_id FROM levels WHERE gd_id IS NOT NULL`).all() as { gd_id: number }[])
      .map((r) => r.gd_id),
  )
  // Auto-reject rows whose verification URL is already in use by an existing
  // main-list level — the same video can't verify two different rankings, so
  // these are almost always re-postings of an already-tracked level under a
  // different name or source.
  const existingVerUrls = new Set<string>(
    (db.prepare(`SELECT verification_url FROM levels WHERE verification_url IS NOT NULL AND verification_url <> ''`).all() as { verification_url: string }[])
      .map((r) => r.verification_url),
  )

  const insert = db.prepare(`
    INSERT INTO pending_levels
      (gd_id, name, verify_date, gddl_tier, difficulty,
       verification, verification_url, placement_source,
       placement_estimate, status, submitted_at, from_sheet_pending)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1)
  `)

  // Per-tier sorted positions for the placement-estimate fallback. Built
  // lazily as we encounter each tier, so we only pay the query cost for tiers
  // actually present in the sheet's pending tab.
  const tierPositions = new Map<string, number[]>()
  function positionForTier(tier: string, frac: number): number | null {
    let positions = tierPositions.get(tier)
    if (!positions) {
      positions = (db
        .prepare(`SELECT position FROM levels WHERE gddl_tier = ? ORDER BY position ASC`)
        .all(tier) as { position: number }[]).map((r) => r.position)
      tierPositions.set(tier, positions)
    }
    if (positions.length === 0) return null
    const idx = Math.min(positions.length - 1, Math.floor(frac * positions.length))
    return positions[idx]!
  }

  const seenInThisRun = new Set<string>()
  let imported = 0, skippedExisting = 0, skippedMain = 0, skippedBlank = 0, skippedDupVer = 0

  db.exec('BEGIN')
  try {
    // Sweep legacy sheet-pending rows out of awaiting_levels — they now go
    // through the admin "Imported levels" review queue (pending_levels).
    const legacyAwaiting = db.prepare(`DELETE FROM awaiting_levels WHERE pending_id = ?`).run(SHEET_PENDING_ID)
    for (let i = found.headerIdx + 1; i < text.length; i++) {
      const r = text[i]!
      const rh = html[i]!
      const name = txt(r[c['level name']!])
      const gdId = num(r[c['level id']!])
      const verifyDate = txt(r[c['verify date']!])
      const rawTier = txt(r[c['gddl tier']!])
      const giRange = txt(r[c['general idea / range']!])
      // Section headers / decoration: a name with no other identifying data.
      if (!name) { skippedBlank++; continue }
      if (!gdId && !verifyDate && !rawTier && !giRange) { skippedBlank++; continue }
      if (gdId !== null && mainGdIds.has(gdId)) { skippedMain++; continue }

      const key = dupKey(gdId, name)
      if (seenInThisRun.has(key)) continue
      seenInThisRun.add(key)
      if (existingKeys.has(key)) { skippedExisting++; continue }

      const verHref = verCol != null ? extractLinkHref(rh[verCol] ?? '') : null
      // Auto-reject when the verification video already verifies a main-list
      // entry — the curator pulled the level into pending under a different
      // source, but it's already tracked.
      if (verHref && existingVerUrls.has(verHref)) { skippedDupVer++; continue }

      // Normalize the tier string. Sheet rows can be "Tier 25", "Tier 25.5",
      // "25", "S4", etc. — we store the integer-tier form so the rest of the
      // app's tier filters/joins work, while the decimal informs the
      // placement-within-tier fallback below. Anything we can't parse is
      // stored verbatim so we don't lose information.
      const parsedTier = parseTierLabel(rawTier)
      const tier = parsedTier?.tier ?? rawTier

      // "General Idea / Range" looks like "~#2400" — extract the integer for
      // the placement estimate. If absent, fall back to a position derived
      // from the GDDL tier (decimal = position within tier) so the reviewer
      // gets a sensible default instead of an empty placement field.
      const placementMatch = giRange?.match(/(\d[\d,]*)/)
      const placementEstimate = placementMatch
        ? num(placementMatch[1]!)
        : (parsedTier ? positionForTier(parsedTier.tier, parsedTier.frac) : null)

      const addedOn = txt(r[c['added to pending on']!]) ?? new Date().toISOString().slice(0, 10)

      insert.run(
        gdId,
        name,
        verifyDate,
        tier,
        // Demon Ranking ("Extreme Demon", "Hard Demon", …) is GD's difficulty
        // category — fits the existing `difficulty` text column.
        txt(r[c['demon ranking']!]),
        verCol != null ? txt(r[verCol]) : null,
        verHref,
        sourceCol != null ? txt(r[sourceCol]) : null,
        placementEstimate,
        addedOn,
      )
      imported++
    }

    // Prune sheet rows from prior imports that are no longer on the sheet.
    const del = db.prepare(`DELETE FROM pending_levels WHERE id = ?`)
    let removed = 0
    for (const row of existingSheetRows) {
      if (!seenInThisRun.has(dupKey(row.gd_id, row.name))) { del.run(row.id); removed++ }
    }

    db.exec('COMMIT')
    console.log(
      `${imported} new (${skippedExisting} already pending/awaiting, ${skippedMain} on main list, ` +
      `${skippedDupVer} dup verification URL, ${skippedBlank} blank rows, ${removed} removed, ` +
      `${legacyAwaiting.changes} legacy awaiting rows swept)`,
    )
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export async function runImport() {
  const t0 = Date.now()
  await importLevels()
  await importLeaderboard()
  await importStatsViewer()
  await importVoidList()
  await importPendingList()
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s.`)
}

// Run as a CLI when invoked directly via `node server/db/import.ts`
const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import\.ts$/.test(process.argv[1])
if (isCli) {
  runImport().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
