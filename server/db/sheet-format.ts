import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Reading the published ALL sheet without depending on its exact layout.
 *
 * The curators rename tabs, rename and move columns, and add spacer columns
 * without notice, so nothing here trusts a fixed position or an exact header:
 * - level tabs are discovered from the sheet's own tab list,
 * - the header row is found by how many known titles it contains,
 * - each field accepts several titles, and the column it lands on is checked
 *   against what that field's data looks like (IDs are integers, tiers parse as
 *   tiers, the verification column has links).
 *
 * A field that can't be found is reported and left out; the importer never
 * blanks data because a column went missing.
 */

export const SHEET_BASE_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQqB-B4XtOCo-tsy5TCCFljoOClmAmrrE4oxowHVhrCcQW5r-_f6xSXOezekRsrR55_QBHhrsVlxXLH'

export type SheetTab = { gid: string; name: string }

/** The level tabs as of October 2026, used when the tab list can't be read. */
export const KNOWN_LEVEL_TABS: SheetTab[] = [
  { gid: '0', name: 'Top 10000' },
  { gid: '1036115495', name: 'Top 20000' },
  { gid: '1989779679', name: 'Top 30000' },
  { gid: '516171001', name: 'Top 40000' },
  { gid: '1985672631', name: 'Top 50000' },
  { gid: '1875166663', name: 'Top 60000' },
]

/** Tabs that are never level tabs, whatever they get renamed to. */
export const NON_LEVEL_GIDS = new Set([
  '1565294080', // rules, FAQ and landing
  '139895069', // pending list
  '1630809094', // voided list
  '1874969282', // pending list / helper points FAQ
  '1377816720', // helper leaderboard
  '1770988428', // co-op roulette
  '1504655270', // sources / lists
  '554663019', // staff team
  '1392626657', // skillsets
  '106774007', // archive
  '280339977', // old player leaderboard
  '943829784', // old stats viewer
])

const LEVEL_TAB_NAME = /^\s*(top|main|tier|subtier|levels?)\b/i
const NOT_LEVEL_TAB_NAME = /pending|void|faq|rules|staff|archive|roulette|leaderboard|helper|skillset|source|stats|landing/i

// ---------------------------------------------------------------- fetching

/**
 * `LIST_SHEET_FIXTURE_DIR` points the importer at saved copies of the sheet
 * (`index.html`, `gid-<gid>.html`) instead of Google. For testing changes to
 * the importer without hitting the network or waiting on 60 MB of HTML.
 */
function fixturePath(file: string): string | null {
  const dir = process.env.LIST_SHEET_FIXTURE_DIR
  if (!dir) return null
  const p = join(dir, file)
  return existsSync(p) ? p : null
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'all-levels-list-importer/2.0' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (e) {
      lastErr = e
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000))
    }
  }
  throw new Error(`${url.replace(SHEET_BASE_URL, 'sheet')} failed: ${(lastErr as Error)?.message ?? lastErr}`)
}

export async function fetchTabHtml(gid: string): Promise<string> {
  const fixture = fixturePath(`gid-${gid}.html`)
  if (fixture) return readFileSync(fixture, 'utf8')
  return fetchText(`${SHEET_BASE_URL}/pubhtml/sheet?headers=false&gid=${gid}`, 120_000)
}

/** Every tab the published sheet lists, in the sheet's order. */
export async function fetchSheetTabs(): Promise<SheetTab[]> {
  const fixture = fixturePath('index.html')
  const html = fixture ? readFileSync(fixture, 'utf8') : await fetchText(`${SHEET_BASE_URL}/pubhtml`, 30_000)
  const tabs: SheetTab[] = []
  const seen = new Set<string>()
  const re = /\{name:\s*"((?:[^"\\]|\\.)*)",\s*pageUrl:\s*"[^"]*",\s*gid:\s*"(\d+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const gid = m[2]!
    if (seen.has(gid)) continue
    seen.add(gid)
    tabs.push({ gid, name: decodeJsString(m[1]!) })
  }
  return tabs
}

function decodeJsString(s: string): string {
  return s
    .replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(.)/g, '$1')
}

/**
 * The tabs that hold the ranked list, in list order.
 *
 * A tab counts when it is one of the known level tabs or is named like one
 * ("Top 70000"), and isn't one of the known side tabs. Falls back to the known
 * list when the tab index can't be read, so a Google hiccup on the index page
 * doesn't stop the import.
 */
export async function discoverLevelTabs(log: (msg: string) => void = console.log): Promise<SheetTab[]> {
  let tabs: SheetTab[]
  try {
    tabs = await fetchSheetTabs()
  } catch (e) {
    log(`[sheet] couldn't read the tab list (${(e as Error).message}); using the known level tabs`)
    return KNOWN_LEVEL_TABS
  }
  if (!tabs.length) {
    log('[sheet] the tab list came back empty; using the known level tabs')
    return KNOWN_LEVEL_TABS
  }
  const known = new Set(KNOWN_LEVEL_TABS.map((t) => t.gid))
  const level = tabs.filter((t) => {
    if (NON_LEVEL_GIDS.has(t.gid)) return false
    if (known.has(t.gid)) return true
    return LEVEL_TAB_NAME.test(t.name) && !NOT_LEVEL_TAB_NAME.test(t.name)
  })
  const missing = KNOWN_LEVEL_TABS.filter((k) => !tabs.some((t) => t.gid === k.gid))
  if (missing.length) {
    log(`[sheet] known level tab(s) no longer published: ${missing.map((t) => `${t.name} (gid ${t.gid})`).join(', ')}`)
  }
  const extra = level.filter((t) => !known.has(t.gid))
  if (extra.length) log(`[sheet] new level tab(s) found: ${extra.map((t) => `${t.name} (gid ${t.gid})`).join(', ')}`)
  return level.length ? level : KNOWN_LEVEL_TABS
}

// ---------------------------------------------------------------- HTML table

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? m)
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

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

/** `<td>` contents in order, expanded by `colspan` so columns line up across rows. */
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
    const attrs = tr.slice(start, tagEnd)
    const span = Number(attrs.match(/colspan="(\d+)"/)?.[1] ?? 1)
    cells.push(tr.slice(tagEnd + 1, close))
    for (let k = 1; k < span && k < 50; k++) cells.push('')
    i = close + 5
  }
  return cells
}

export type SheetTable = { text: string[][]; html: string[][] }

export function parseTable(page: string): SheetTable | null {
  const tbody = page.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)
  if (!tbody) return null
  const html = splitRows(tbody[1]!).map(splitCells)
  return { html, text: html.map((cells) => cells.map(stripTags)) }
}

function unwrapGoogleRedirect(url: string): string {
  const m = url.match(/^https?:\/\/www\.google\.com\/url\?q=([^&]+)/)
  if (!m) return url
  try {
    return decodeURIComponent(m[1]!)
  } catch {
    return url
  }
}

/** The first link in a cell, unwrapped from Google's redirect. */
export function extractLinkHref(cellHtml: string): string | null {
  const m = cellHtml.match(/<a[^>]*\shref="([^"]+)"/i)
  if (!m) return null
  return unwrapGoogleRedirect(decodeEntities(m[1]!))
}

// ---------------------------------------------------------------- values

/** A number from a cell: tolerates `#12`, `1,234`, `~400`, `12.` and spaces. */
export function num(s: string | undefined | null): number | null {
  if (s == null) return null
  const cleaned = String(s).replace(/[#~≈,\s ]/g, '').replace(/\.$/, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '—') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** A positive whole number, or null. */
export function int(s: string | undefined | null): number | null {
  const n = num(s)
  return n != null && Number.isInteger(n) && n > 0 ? n : null
}

export function txt(s: string | undefined | null): string | null {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t === '' || t === '-' || t === '—' ? null : t
}

/**
 * Tier labels in any of the forms the sheets use.
 *   "Tier 25", "tier25", "T25", "25", "Tier 25.5"  → Tier 25 (decimal kept as `frac`)
 *   "Subtier 4", "S4", "Sub 4.25"                   → Subtier 4
 */
export function parseTierLabel(raw: string | null | undefined): { tier: string; frac: number } | null {
  if (!raw) return null
  const t = raw.trim()
  if (!t) return null
  const sub = t.match(/^(?:sub\s*-?\s*tier|subtier|sub|s)\s*(\d{1,2})(?:\.(\d+))?$/i)
  if (sub) {
    const n = Number(sub[1])
    if (n > 5) return null
    const frac = sub[2] !== undefined ? Math.min(1, parseFloat(`0.${sub[2]}`)) : 0.5
    return { tier: `Subtier ${n}`, frac }
  }
  const m = t.match(/^(?:t(?:ier)?)?\s*(\d{1,2})(?:\.(\d+))?$/i)
  if (m) {
    const n = Number(m[1])
    if (n < 1 || n > 45) return null
    const frac = m[2] !== undefined ? Math.min(1, parseFloat(`0.${m[2]}`)) : 0.5
    return { tier: `Tier ${n}`, frac }
  }
  return null
}

export function normTier(raw: string | null | undefined): string | null {
  return parseTierLabel(raw)?.tier ?? null
}

/** `2026-10-05` from the date formats the sheet has used; anything else as typed. */
export function normDate(raw: string | null | undefined): string | null {
  const t = txt(raw)
  if (!t) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const ymd = t.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/)
  if (ymd) return `${ymd[1]}-${ymd[2]!.padStart(2, '0')}-${ymd[3]!.padStart(2, '0')}`
  return t
}

// ---------------------------------------------------------------- columns

/** Lowercase, `&` → `and`, and nothing but letters, digits and `#`. */
export function normHeader(s: string): string {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9#]+/g, '')
}

export type FieldSpec = {
  key: string
  /** Normalised titles that mean this field outright. */
  titles: string[]
  /** Normalised substrings that also mean it, tried after `titles`. */
  contains?: string[]
  /** Normalised titles that look similar but are something else. */
  not?: RegExp
  /** Whether a data cell looks like this field. */
  shape?: (text: string, html: string) => boolean
  /** Where the value lives when the header is over a spacer: try these offsets too. */
  drift?: number[]
}

const isInt = (t: string) => int(t) != null
const isGdId = (t: string) => { const n = int(t); return n != null && n < 2_000_000_000 }
const isTier = (t: string) => parseTierLabel(t) != null
const hasLink = (_t: string, h: string) => /<a[^>]*\shref=/i.test(h)
const isText = (t: string) => t.trim() !== '' && !/^[\d.,%#\s-]+$/.test(t)

export const LEVEL_FIELDS: FieldSpec[] = [
  { key: 'placement', titles: ['#', 'placement', 'rank', 'pos', 'position', 'no', 'number', 'place', 'allplacement'],
    contains: ['placement', 'rank'], not: /peak|verif|pov|previous|old|change/, shape: isInt, drift: [1, -1] },
  { key: 'name', titles: ['levelname', 'level', 'name', 'levels', 'title'], contains: ['levelname'], not: /id$|creator|verifier/, shape: isText },
  { key: 'gd_id', titles: ['levelid', 'id', 'gdid', 'ingameid', 'gdlevelid'], contains: ['levelid'], shape: isGdId, drift: [1, -1] },
  { key: 'gddl_tier', titles: ['gddltier', 'tier', 'gddl'], contains: ['tier'], not: /sub|community|estimate/, shape: isTier, drift: [1, -1] },
  { key: 'rated', titles: ['rated', 'rating', 'ratedstatus'], drift: [1, -1] },
  { key: 'verify_date', titles: ['verifydate', 'verificationdate', 'dateverified', 'verified', 'date'], contains: ['verifydate', 'verificationdate'], not: /pending|added/, drift: [1, -1] },
  { key: 'difficulty', titles: ['difficulty', 'demondifficulty', 'demonranking', 'demondiff', 'face'], contains: ['difficulty'], not: /approx|tier|community/, shape: isText, drift: [1, -1] },
  { key: 'source', titles: ['primarysource', 'source', 'placementsource', 'sources', 'list'], contains: ['source'], shape: isText, drift: [1, -1] },
  { key: 'main_skillset', titles: ['mainskillset', 'skillset', 'skillsets', 'skill'], contains: ['skillset'], shape: isText, drift: [1, -1] },
  { key: 'verification', titles: ['verificationlink', 'verification', 'verificationvideo', 'video', 'link'], contains: ['verificationlink', 'video'], not: /date|placement|pov/, shape: hasLink, drift: [1, 2, -1] },
  { key: 'pov', titles: ['placementonverification', 'placementatverification', 'pov'], contains: ['onverification'], shape: isInt },
  { key: 'year_verified', titles: ['yearverified', 'year'], shape: (t) => /^(19|20)\d\d$/.test(t.trim()) },
]

export type ResolvedColumns = {
  headerIdx: number
  cols: Record<string, number | undefined>
  /** One line per field, for the import log. */
  report: string[]
}

function titleMatches(spec: FieldSpec, header: string): 'exact' | 'contains' | null {
  if (!header) return null
  if (spec.not?.test(header) && !spec.titles.includes(header)) return null
  if (spec.titles.includes(header)) return 'exact'
  if (spec.contains?.some((c) => header.includes(c))) return 'contains'
  return null
}

/**
 * The header row: the one among the first 40 that names the most known fields,
 * which must include the level's name. Null when no row qualifies.
 */
export function findHeaderRow(rows: string[][], fields: FieldSpec[] = LEVEL_FIELDS): number | null {
  let best: { idx: number; score: number } | null = null
  const nameSpec = fields.find((f) => f.key === 'name')
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const norm = rows[i]!.map(normHeader)
    if (nameSpec && !norm.some((h) => titleMatches(nameSpec, h))) continue
    let score = 0
    for (const spec of fields) if (norm.some((h) => titleMatches(spec, h) === 'exact')) score++
    if (score >= 2 && (!best || score > best.score)) best = { idx: i, score }
  }
  return best?.idx ?? null
}

/**
 * Map each field to a column, checking each choice against the data under it.
 *
 * Merged cells and spacer columns put a header one or two columns away from
 * its data, so a field with `drift` also tries its neighbours and takes
 * whichever column's values look most like the field — but never a column
 * another field's header owns.
 */
export function resolveColumns(table: SheetTable, headerIdx: number, fields: FieldSpec[] = LEVEL_FIELDS): ResolvedColumns {
  const header = table.text[headerIdx]!.map(normHeader)
  const sample: number[] = []
  for (let i = headerIdx + 1; i < table.text.length && sample.length < 400; i++) {
    if (table.text[i]!.some((c) => c !== '')) sample.push(i)
  }

  // Header matches first, so drift can't wander onto a labelled column.
  const byTitle = new Map<string, number>()
  const owned = new Set<number>()
  for (const pass of ['exact', 'contains'] as const) {
    for (const spec of fields) {
      if (byTitle.has(spec.key)) continue
      const idx = header.findIndex((h, i) => !owned.has(i) && titleMatches(spec, h) === pass)
      if (idx !== -1) { byTitle.set(spec.key, idx); owned.add(idx) }
    }
  }

  const score = (spec: FieldSpec, col: number): number => {
    if (!sample.length) return 0
    let hits = 0
    for (const r of sample) {
      const t = table.text[r]![col] ?? ''
      const h = table.html[r]![col] ?? ''
      if (spec.shape ? (t !== '' || h !== '') && spec.shape(t, h) : t !== '') hits++
    }
    return hits / sample.length
  }

  const cols: Record<string, number | undefined> = {}
  const report: string[] = []
  for (const spec of fields) {
    const at = byTitle.get(spec.key)
    if (at == null) {
      cols[spec.key] = undefined
      report.push(`${spec.key}: not found`)
      continue
    }
    let bestCol = at
    let bestScore = score(spec, at)
    for (const d of spec.drift ?? []) {
      const c = at + d
      if (c < 0 || owned.has(c)) continue
      const s = score(spec, c)
      if (s > bestScore + 0.05) { bestCol = c; bestScore = s }
    }
    cols[spec.key] = bestCol
    const label = table.text[headerIdx]![at] || '?'
    report.push(`${spec.key}: "${label}" → col ${bestCol}${bestCol !== at ? ` (header at ${at})` : ''}, ${(bestScore * 100).toFixed(0)}% filled`)
  }

  // No placement title at all: look for a column that counts up.
  if (cols.placement == null) {
    const found = findCountingColumn(table, sample, new Set(Object.values(cols).filter((c): c is number => c != null)))
    if (found != null) {
      cols.placement = found
      report.push(`placement: found by its values in col ${found}`)
    }
  }
  return { headerIdx, cols, report }
}

/** A column whose values are mostly whole numbers that mostly go up by one. */
function findCountingColumn(table: SheetTable, sample: number[], taken: Set<number>): number | null {
  const width = Math.max(...sample.map((r) => table.text[r]!.length), 0)
  let best: { col: number; score: number } | null = null
  for (let c = 0; c < width; c++) {
    if (taken.has(c)) continue
    const vals = sample.map((r) => int(table.text[r]![c])).filter((n): n is number => n != null)
    if (vals.length < sample.length * 0.6) continue
    let steps = 0
    for (let i = 1; i < vals.length; i++) if (vals[i]! - vals[i - 1]! === 1) steps++
    const s = steps / Math.max(1, vals.length - 1)
    if (s > 0.8 && (!best || s > best.score)) best = { col: c, score: s }
  }
  return best?.col ?? null
}

/** Read one field from a row, or null when the column wasn't found. */
export function cell(table: SheetTable, cols: Record<string, number | undefined>, row: number, key: string): string | null {
  const c = cols[key]
  if (c == null) return null
  return txt(table.text[row]?.[c])
}

export function cellHtml(table: SheetTable, cols: Record<string, number | undefined>, row: number, key: string): string {
  const c = cols[key]
  if (c == null) return ''
  return table.html[row]?.[c] ?? ''
}
