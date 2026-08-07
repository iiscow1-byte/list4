import { inflateRawSync } from 'node:zlib'

/**
 * Just enough of .xlsx to read a Google Sheet's hyperlinks.
 *
 * The ACS sheet keeps each level's verification video as a **link on the level
 * name**, not as a cell of its own. Every text export Google offers throws that
 * away: `gviz` CSV, TSV and the JSON endpoint all return the cell's *value*,
 * and `pubhtml` needs the document to be published. The workbook export is the
 * only form that carries it, and a workbook is a zip of XML.
 *
 * So: a zip reader and three regexes, rather than a dependency. What's here is
 * the narrow path an Excel-shaped file from Google actually takes — stored or
 * deflated entries, no encryption, no zip64 — and it refuses anything else
 * rather than guessing.
 */

/** Central-directory and local-header signatures. */
const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

/**
 * Every file in the archive, by name.
 *
 * Read through the central directory rather than by walking local headers:
 * a local header may declare sizes of zero and defer them to a data descriptor
 * after the payload, which cannot be parsed without already knowing where the
 * payload ends. The central directory always has the real numbers.
 */
export function unzip(buf: Buffer): Map<string, Buffer> {
  // The EOCD is at the end, after a comment of up to 64 KB.
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)')

  const count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || offset === 0xffffffff) {
    throw new Error('zip64 archives are not supported')
  }

  const out = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== SIG_CENTRAL) break
    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen)
    offset += 46 + nameLen + extraLen + commentLen

    if (buf.readUInt32LE(localOffset) !== SIG_LOCAL) continue
    // The local header's own name and extra lengths are the ones that describe
    // where its data starts — the extra field routinely differs between the two
    // copies of the record, and using the central one lands mid-payload.
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(start, start + compressedSize)

    if (method === 0) out.set(name, Buffer.from(raw))
    else if (method === 8) out.set(name, inflateRawSync(raw))
    // Anything else (encrypted, LZMA, …) is skipped: an entry we can't read is
    // better absent than present and wrong.
  }
  return out
}

const text = (entries: Map<string, Buffer>, name: string): string | null =>
  entries.get(name)?.toString('utf8') ?? null

/** `<t>` runs inside one `<si>`, joined — a shared string may be rich text. */
function siText(si: string): string {
  const parts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g)
  if (!parts) return ''
  return parts.map((p) => unescapeXml(p.replace(/^<t[^>]*>/, '').replace(/<\/t>$/, ''))).join('')
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    // Last, so an escaped ampersand can't re-trigger the rules above.
    .replace(/&amp;/g, '&')
}

/** The shared-string table, indexed as the cells refer to it. */
export function readSharedStrings(entries: Map<string, Buffer>): string[] {
  const xml = text(entries, 'xl/sharedStrings.xml')
  if (!xml) return []
  const out: string[] = []
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) out.push(siText(m[1]!))
  return out
}

/** Worksheet name → the path of its XML inside the archive. */
export function readSheetPaths(entries: Map<string, Buffer>): Map<string, string> {
  const wb = text(entries, 'xl/workbook.xml')
  const rels = text(entries, 'xl/_rels/workbook.xml.rels')
  const out = new Map<string, string>()
  if (!wb || !rels) return out

  const byId = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = m[0]
    const id = /Id="([^"]+)"/.exec(tag)?.[1]
    const target = /Target="([^"]+)"/.exec(tag)?.[1]
    if (id && target) byId.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'))
  }
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = m[0]
    const name = /name="([^"]*)"/.exec(tag)?.[1]
    const rid = /r:id="([^"]+)"/.exec(tag)?.[1]
    const target = rid ? byId.get(rid) : null
    if (name && target) out.set(unescapeXml(name), target)
  }
  return out
}

/** `C5` → `{ col: 2, row: 5 }`. Columns are 0-based, rows 1-based as written. */
export function parseRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!m) return null
  let col = 0
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col: col - 1, row: Number(m[2]) }
}

export type SheetCell = { col: number; row: number; text: string }

/**
 * Every cell that holds text, as `{col,row,text}`.
 *
 * Values arrive three ways — an index into the shared table (`t="s"`), an
 * inline string (`t="inlineStr"`), or a literal — and a level name can be any
 * of them depending on how the row was typed.
 */
export function readSheetCells(sheetXml: string, shared: string[]): SheetCell[] {
  const out: SheetCell[] = []
  // The attribute run is lazy on purpose. Greedy, it eats the `/` of a
  // self-closing `<c r="D5" s="6"/>` — which then matches the `>` branch and
  // swallows every following cell up to the next `</c>`, quietly dropping the
  // one after each empty cell. On this sheet that was every level name.
  for (const m of sheetXml.matchAll(/<c\b([^>]*?)\s*(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1]!
    const body = m[2] ?? ''
    const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1]
    if (!ref) continue
    const at = parseRef(ref)
    if (!at) continue

    const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n'
    let value: string | null = null
    if (type === 'inlineStr') {
      const is = /<is>([\s\S]*?)<\/is>/.exec(body)?.[1]
      value = is ? siText(is) : null
    } else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      if (v == null) value = null
      else if (type === 's') value = shared[Number(v)] ?? null
      else value = unescapeXml(v)
    }
    if (value != null) out.push({ ...at, text: value })
  }
  return out
}

export type SheetLink = { col: number; row: number; url: string }

/**
 * The hyperlinks on a sheet, resolved to their URLs.
 *
 * `<hyperlink>` carries the cell and a relationship id; the URL itself lives in
 * the sheet's own rels file. Attribute order is not fixed — Google writes
 * `r:id` before `ref`, Excel the other way — so each is read out of the tag
 * rather than matched as a sequence.
 */
export function readSheetLinks(sheetXml: string, relsXml: string | null): SheetLink[] {
  if (!relsXml) return []
  const byId = new Map<string, string>()
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = m[0]
    const id = /Id="([^"]+)"/.exec(tag)?.[1]
    const target = /Target="([^"]+)"/.exec(tag)?.[1]
    if (id && target) byId.set(id, unescapeXml(target))
  }

  const out: SheetLink[] = []
  for (const m of sheetXml.matchAll(/<hyperlink\b[^>]*>/g)) {
    const tag = m[0]
    const ref = /ref="([^"]+)"/.exec(tag)?.[1]
    const rid = /r:id="([^"]+)"/.exec(tag)?.[1]
    if (!ref || !rid) continue
    const url = byId.get(rid)
    if (!url) continue
    // A merged or multi-cell ref ("C5:D5") anchors on its first cell.
    const at = parseRef(ref.split(':')[0]!)
    if (at) out.push({ ...at, url })
  }
  return out
}

/** The rels file that belongs to a worksheet path. */
export function relsPathFor(sheetPath: string): string {
  const i = sheetPath.lastIndexOf('/')
  return `${sheetPath.slice(0, i)}/_rels/${sheetPath.slice(i + 1)}.rels`
}

export type LinkedCell = { row: number; text: string; url: string }

/**
 * Text-plus-link for one column of one sheet.
 *
 * Both halves are returned because the caller matches them against a *different*
 * export of the same sheet: the CSV supplies the values, this supplies the
 * links, and the only safe way to join two exports is to check that the cell
 * each one is talking about says the same thing.
 */
export function linkedColumn(
  entries: Map<string, Buffer>,
  sheetName: string,
  column: number,
  shared: string[],
): LinkedCell[] {
  const path = readSheetPaths(entries).get(sheetName)
  if (!path) return []
  const xml = text(entries, path)
  if (!xml) return []

  const byRef = new Map<string, string>()
  for (const c of readSheetCells(xml, shared)) {
    if (c.col === column) byRef.set(`${c.row}`, c.text)
  }

  const out: LinkedCell[] = []
  for (const link of readSheetLinks(xml, text(entries, relsPathFor(path)))) {
    if (link.col !== column) continue
    out.push({ row: link.row, text: byRef.get(`${link.row}`) ?? '', url: link.url })
  }
  return out
}
