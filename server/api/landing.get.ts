const SHEET_BASE_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQqB-B4XtOCo-tsy5TCCFljoOClmAmrrE4oxowHVhrCcQW5r-_f6xSXOezekRsrR55_QBHhrsVlxXLH'
const LANDING_GID = '1565294080'

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (_m, e) => ENTITIES[(e as string).toLowerCase()] ?? _m)
}
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}
function unwrapGoogleRedirect(url: string): string {
  const m = url.match(/^https?:\/\/www\.google\.com\/url\?q=([^&]+)/)
  if (!m) return url
  try { return decodeURIComponent(m[1]!) } catch { return url }
}
function extractLinkHref(cellHtml: string): string | null {
  const m = cellHtml.match(/<a[^>]*\shref="([^"]+)"/i)
  if (!m) return null
  return unwrapGoogleRedirect(decodeEntities(m[1]!))
}
function splitRows(tbody: string): string[] {
  const rows: string[] = []
  let i = 0
  while (i < tbody.length) {
    const s = tbody.indexOf('<tr', i); if (s === -1) break
    const e = tbody.indexOf('</tr>', s); if (e === -1) break
    rows.push(tbody.slice(s, e + 5))
    i = e + 5
  }
  return rows
}
function splitCells(tr: string): string[] {
  const cells: string[] = []
  let i = 0
  while (i < tr.length) {
    const s = tr.indexOf('<td', i); if (s === -1) break
    const tagEnd = tr.indexOf('>', s); if (tagEnd === -1) break
    const close = tr.indexOf('</td>', tagEnd); if (close === -1) break
    cells.push(tr.slice(tagEnd + 1, close))
    i = close + 5
  }
  return cells
}

type LandingPayload = {
  intro: string[]
  faq: string[]
  statsViewerFaq: string[]
  lists: { name: string; href: string | null }[]
}

let _cache: { at: number; data: LandingPayload } | null = null
const TTL_MS = 60 * 60 * 1000

async function fetchLanding(): Promise<LandingPayload> {
  const url = `${SHEET_BASE_URL}/pubhtml/sheet?headers=false&gid=${LANDING_GID}`
  const res = await fetch(url, { headers: { 'User-Agent': 'all-levels-list/1.0' } })
  if (!res.ok) throw createError({ statusCode: 502, statusMessage: 'Sheet fetch failed' })
  const html = await res.text()
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)
  if (!tbodyMatch) throw createError({ statusCode: 502, statusMessage: 'No tbody in landing sheet' })
  const trs = splitRows(tbodyMatch[1]!)
  const rows = trs.map(splitCells)
  const text = rows.map((cells) => cells.map(stripTags))

  // Build rich rows with primary text + link extracted from any cell.
  const richRows = rows.map((cells, i) => ({
    text: text[i]!,
    links: cells.map((c) => extractLinkHref(c)),
  }))

  // Section boundaries by header text.
  const indexOfHeader = (label: string) =>
    richRows.findIndex((r) => r.text.some((t) => t.toLowerCase() === label.toLowerCase()))

  const iFaq = indexOfHeader('FAQ')
  const iStatsFaq = indexOfHeader('Stats Viewer FAQ')
  const iAddStats = indexOfHeader('Additional Stats')
  const iLists = indexOfHeader('All Demonlists Used')

  const collectParas = (from: number, to: number): string[] => {
    const out: string[] = []
    for (let i = from; i < to && i < richRows.length; i++) {
      const r = richRows[i]!
      const primary = r.text.find((t) => t) ?? ''
      if (!primary) continue
      // Inline an attached link, if any (some cells store the link separately in column 3).
      const link = r.links.find((l, idx) => l && r.text[idx] && r.text[idx]!.startsWith('http'))
      out.push(link ? `${primary} ${link}` : primary)
    }
    return out
  }

  const intro = collectParas(1, iFaq)
  const faq = collectParas(iFaq + 1, iStatsFaq)
  const statsViewerFaq = collectParas(iStatsFaq + 1, iAddStats)

  // Lists section: each row has a friendly name in one column (often col 1) and
  // a link in a later column (often col 3). The name column sometimes carries a
  // stale/wrong href, so we prefer links from cells AFTER the name column.
  const lists: { name: string; href: string | null }[] = []
  for (let i = iLists + 1; i < richRows.length; i++) {
    const r = richRows[i]!
    let nameIdx = -1
    let name = ''
    for (let k = 0; k < r.text.length; k++) {
      const t = r.text[k]!
      if (t && !/^https?:\/\//i.test(t)) { name = t; nameIdx = k; break }
    }
    if (!name) {
      for (let k = 0; k < r.text.length; k++) if (r.text[k]) { name = r.text[k]!; nameIdx = k; break }
    }
    if (!name) continue
    let href: string | null = null
    for (let k = nameIdx + 1; k < r.links.length; k++) {
      if (r.links[k]) { href = r.links[k]; break }
    }
    if (!href) href = r.links.find((l) => l) ?? null
    lists.push({ name, href })
  }

  return { intro, faq, statsViewerFaq, lists }
}

export default defineEventHandler(async (event) => {
  if (_cache && Date.now() - _cache.at < TTL_MS) {
    setHeader(event, 'cache-control', 'public, max-age=300')
    return _cache.data
  }
  const data = await fetchLanding()
  _cache = { at: Date.now(), data }
  setHeader(event, 'cache-control', 'public, max-age=300')
  return data
})
