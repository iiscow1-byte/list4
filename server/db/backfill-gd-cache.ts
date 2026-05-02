/**
 * Warm gd_info_cache for every levels.gd_id that has no cache row yet.
 *
 * Mirrors the fetch pipeline in server/api/gd/level/[id].get.ts: gdbrowser
 * first (no rate limit, no UA blocking), then Boomlings as fallback. Most
 * requests therefore never hit Boomlings, which is the rate-sensitive path.
 *
 * Resumable — re-running picks up wherever the cache left off.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings server/db/backfill-gd-cache.ts
 */

import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const DB_PATH = process.env.LIST_DB_PATH || resolve(process.cwd(), 'data', 'list.db')

const GD_SECRET = 'Wmfd2893gb7'
const BOOMLINGS_HOST = 'www.boomlings.com'
const BOOMLINGS_PATH = '/database/downloadGJLevel22.php'
const GDBROWSER_URL = (id: number) => `https://gdbrowser.com/api/level/${id}`
const GDBROWSER_PLACEHOLDER_DOWNLOADS = 10_000_000

// Rate-limit knobs. gdbrowser is unmetered but uses Cloudflare; Boomlings is
// the constraint when the fallback fires. Pacing is per-request regardless of
// which backend served, so the effective Boomlings rate is much lower than
// `1 / BASE_DELAY_MS` (only fallback hits land there).
const BASE_DELAY_MS = 1100              // baseline gap between requests
const BOOMLINGS_EXTRA_DELAY_MS = 1500   // additional pause after a Boomlings hit
const BACKOFF_INITIAL_MS = 5_000        // first backoff after a transient error
const BACKOFF_MAX_MS = 5 * 60_000       // cap on exponential backoff
const CONSECUTIVE_ERROR_HARD_STOP = 25  // bail if the API is clearly blocking us
const PROGRESS_EVERY = 25               // log a progress line this often

const OFFICIAL_SONGS: Record<number, string> = {
  0:  'Stereo Madness — ForeverBound',
  1:  'Back On Track — DJVI',
  2:  'Polargeist — Step',
  3:  'Dry Out — DJVI',
  4:  'Base After Base — DJVI',
  5:  "Can't Let Go — DJVI",
  6:  'Jumper — Waterflame',
  7:  'Time Machine — Waterflame',
  8:  'Cycles — DJVI',
  9:  'xStep — DJVI',
  10: 'Clutterfunk — Waterflame',
  11: 'Theory of Everything — DJ-Nate',
  12: 'Electroman Adventures — Waterflame',
  13: 'Clubstep — DJ-Nate',
  14: 'Electrodynamix — DJ-Nate',
  15: 'Hexagon Force — Waterflame',
  16: 'Blast Processing — Waterflame',
  17: 'Theory of Everything 2 — DJ-Nate',
  18: 'Geometrical Dominator — Waterflame',
  19: 'Deadlocked — F-777',
  20: 'Fingerdash — MDK',
  21: 'Dash — MDK',
}

const LENGTHS = ['Tiny', 'Short', 'Medium', 'Long', 'XL', 'Plat'] as const

type GdInfo = {
  id: number
  name: string | null
  author: string | null
  description: string | null
  downloads: number
  likes: number
  length: string | null
  objects: number
  objectsApprox: boolean
  coins: number
  verifiedCoins: boolean
  score: 0 | 1 | 2 | 3 | 4 | 5
  song: { name: string | null; id: number | null; custom: boolean }
  password: string | null
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function parseGdMap(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  const first = s.split('#')[0] ?? s
  const parts = first.split(':')
  for (let i = 0; i + 1 < parts.length; i += 2) {
    out[parts[i]!] = parts[i + 1]!
  }
  return out
}

function decodePassword(raw: string): string | null {
  if (!raw || raw === '0') return null
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
    const xored = atob(b64)
    const key = '26364'
    let out = ''
    for (let i = 0; i < xored.length; i++) {
      out += String.fromCharCode(xored.charCodeAt(i) ^ key.charCodeAt(i % key.length))
    }
    return out.startsWith('1') ? (out.slice(1) || null) : out
  } catch {
    return null
  }
}

function cleanDescription(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^\(?\s*no description provided\s*\)?$/i.test(trimmed)) return null
  return raw
}

function decodeBase64Url(raw: string): string | null {
  if (!raw) return null
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return null
  }
}

function postBoomlings(body: string): Promise<string> {
  return new Promise((resolveP, reject) => {
    const req = http.request(
      {
        method: 'POST',
        host: BOOMLINGS_HOST,
        port: 80,
        path: BOOMLINGS_PATH,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': body.length,
        },
        timeout: 10_000,
      },
      (res: any) => {
        const status = res.statusCode ?? 0
        if (status !== 200) {
          res.resume()
          reject(new Error(`boomlings HTTP ${status}`))
          return
        }
        res.setEncoding('utf8')
        let data = ''
        res.on('data', (c: string) => { data += c })
        res.on('end', () => resolveP(data))
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('boomlings timeout')))
    req.end(body)
  })
}

async function fetchFromGdBrowser(id: number): Promise<GdInfo> {
  const resp = await fetch(GDBROWSER_URL(id), {
    headers: { 'User-Agent': 'all-levels-list/1.0 (cache-warmer)' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!resp.ok) throw new Error(`gdbrowser HTTP ${resp.status}`)
  const raw: any = await resp.json().catch(() => null)
  if (!raw || raw === -1 || typeof raw !== 'object') throw new Error('not_found')

  const customSong = Number(raw.customSong) || 0
  const song = customSong
    ? [raw.songName, raw.songAuthor].filter(Boolean).join(' — ') || null
    : (raw.officialSong || null)

  const passwordRaw = String(raw.password ?? '')
  const password = passwordRaw && passwordRaw !== '0' ? passwordRaw : null

  const stars = Number(raw.stars) || 0
  const featured = !!raw.featured
  const epicNum = Number(raw.epic) || 0
  const isEpic = epicNum >= 1 || raw.epic === true
  const isLegendary = !!raw.legendary || epicNum === 2
  const isMythic = !!raw.mythic || epicNum === 3
  let score: 0 | 1 | 2 | 3 | 4 | 5 = 0
  if (isMythic) score = 5
  else if (isLegendary) score = 4
  else if (isEpic) score = 3
  else if (featured) score = 2
  else if (stars > 0) score = 1

  return {
    id: Number(raw.id) || id,
    name: raw.name ?? null,
    author: raw.author ?? null,
    description: cleanDescription(raw.description),
    downloads: Number(raw.downloads) || 0,
    likes: Number(raw.likes) || 0,
    length: raw.length ?? null,
    objects: Number(raw.objects) || 0,
    objectsApprox: !!raw.large,
    coins: Number(raw.coins) || 0,
    verifiedCoins: !!raw.verifiedCoins,
    score,
    song: { name: song, id: customSong || null, custom: !!customSong },
    password,
  }
}

async function fetchFromBoomlings(id: number): Promise<GdInfo> {
  const body = new URLSearchParams({
    secret: GD_SECRET,
    levelID: String(id),
    gameVersion: '21',
    binaryVersion: '35',
    gdw: '0',
  }).toString()

  const raw = (await postBoomlings(body)).trim()
  if (!raw || raw === '-1') throw new Error('not_found')

  const m = parseGdMap(raw)

  const lengthCode = Number(m['15']) || 0
  const stars = Number(m['18']) || 0
  const featuredScore = Number(m['19']) || 0
  const epicNum = Number(m['42']) || 0

  let score: 0 | 1 | 2 | 3 | 4 | 5 = 0
  if (epicNum === 3) score = 5
  else if (epicNum === 2) score = 4
  else if (epicNum === 1) score = 3
  else if (featuredScore > 0) score = 2
  else if (stars > 0) score = 1

  const customSong = Number(m['35']) || 0
  const officialSongId = Number(m['12']) || 0

  return {
    id: Number(m['1']) || id,
    name: m['2'] ?? null,
    author: null,
    description: cleanDescription(decodeBase64Url(m['3'] ?? '')),
    downloads: Number(m['10']) || 0,
    likes: Number(m['14']) || 0,
    length: LENGTHS[lengthCode] ?? null,
    objects: Number(m['45']) || 0,
    objectsApprox: false,
    coins: Number(m['37']) || 0,
    verifiedCoins: m['38'] === '1',
    score,
    song: {
      name: customSong ? `Custom song #${customSong}` : (OFFICIAL_SONGS[officialSongId] ?? null),
      id: customSong || officialSongId || null,
      custom: !!customSong,
    },
    password: decodePassword(m['27'] ?? ''),
  }
}

type FetchOutcome =
  | { kind: 'ok'; info: GdInfo; usedBoomlings: boolean }
  | { kind: 'not_found' }
  | { kind: 'error'; reason: string; rateLimited: boolean; usedBoomlings: boolean }

async function fetchOne(id: number): Promise<FetchOutcome> {
  let usedBoomlings = false
  try {
    const info = await fetchFromGdBrowser(id)
    if (info.downloads !== GDBROWSER_PLACEHOLDER_DOWNLOADS) {
      return { kind: 'ok', info, usedBoomlings: false }
    }
    // gdbrowser placeholder => fall through to Boomlings
  } catch (e: any) {
    const msg = String(e?.message ?? 'unknown')
    if (msg === 'not_found') return { kind: 'not_found' }
    // gdbrowser failure isn't authoritative; try Boomlings.
  }

  usedBoomlings = true
  try {
    const info = await fetchFromBoomlings(id)
    return { kind: 'ok', info, usedBoomlings: true }
  } catch (e: any) {
    const msg = String(e?.message ?? 'unknown')
    if (msg === 'not_found') return { kind: 'not_found' }
    // Treat 4xx/5xx + Cloudflare blocks as rate-limit signals so the loop
    // backs off rather than burning through the queue.
    const rateLimited = /HTTP (4\d\d|5\d\d)|timeout|EAI|ECONN|ENOTFOUND|socket/i.test(msg)
    return { kind: 'error', reason: msg, rateLimited, usedBoomlings }
  }
}

async function main() {
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec(`
    CREATE TABLE IF NOT EXISTS gd_info_cache (
      gd_id      INTEGER PRIMARY KEY,
      info_json  TEXT    NOT NULL,
      fetched_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  const rows = db.prepare(
    `SELECT DISTINCT l.gd_id AS gd_id
       FROM levels l
      WHERE l.gd_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM gd_info_cache c WHERE c.gd_id = l.gd_id)
      ORDER BY l.gd_id`,
  ).all() as { gd_id: number }[]

  const ids = rows.map((r) => r.gd_id).filter((n) => Number.isFinite(n) && n > 0)
  console.log(`[backfill] ${ids.length} levels to fetch`)
  if (ids.length === 0) {
    db.close()
    return
  }

  const insert = db.prepare(
    `INSERT INTO gd_info_cache (gd_id, info_json, fetched_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(gd_id) DO UPDATE SET info_json = excluded.info_json, fetched_at = excluded.fetched_at`,
  )

  let stopRequested = false
  const onSig = () => { stopRequested = true }
  process.on('SIGINT', onSig)
  process.on('SIGTERM', onSig)

  let okCount = 0
  let notFoundCount = 0
  let errCount = 0
  let consecutiveErrors = 0
  let backoffMs = BACKOFF_INITIAL_MS
  const startedAt = Date.now()

  for (let i = 0; i < ids.length; i++) {
    if (stopRequested) {
      console.log('[backfill] stop requested, exiting cleanly')
      break
    }

    const id = ids[i]!
    const result = await fetchOne(id)

    if (result.kind === 'ok') {
      insert.run(id, JSON.stringify(result.info))
      okCount++
      consecutiveErrors = 0
      backoffMs = BACKOFF_INITIAL_MS
    } else if (result.kind === 'not_found') {
      notFoundCount++
      consecutiveErrors = 0
      backoffMs = BACKOFF_INITIAL_MS
    } else {
      errCount++
      if (result.rateLimited) {
        consecutiveErrors++
        if (consecutiveErrors >= CONSECUTIVE_ERROR_HARD_STOP) {
          console.error(
            `[backfill] ${consecutiveErrors} consecutive rate-limited errors — aborting. Re-run later to resume.`,
          )
          break
        }
        const wait = Math.min(backoffMs, BACKOFF_MAX_MS)
        console.warn(
          `[backfill] id=${id} ${result.usedBoomlings ? 'boomlings' : 'gdbrowser'} error "${result.reason}" — backing off ${wait}ms (consecutive=${consecutiveErrors})`,
        )
        await sleep(wait)
        backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS)
      } else {
        // Non-rate-limit transient: log but don't trip the backoff.
        console.warn(`[backfill] id=${id} skipped: ${result.reason}`)
      }
    }

    if ((i + 1) % PROGRESS_EVERY === 0 || i === ids.length - 1) {
      const elapsed = (Date.now() - startedAt) / 1000
      const rate = (i + 1) / Math.max(elapsed, 1)
      const remaining = ids.length - (i + 1)
      const etaMin = remaining / Math.max(rate, 0.001) / 60
      console.log(
        `[backfill] ${i + 1}/${ids.length} ok=${okCount} notFound=${notFoundCount} err=${errCount} ` +
        `rate=${rate.toFixed(2)}/s eta=${etaMin.toFixed(1)}min`,
      )
    }

    // Pace requests. Boomlings hits get extra spacing because that's the
    // backend that actually rate-limits.
    let pause = BASE_DELAY_MS
    if (result.kind === 'ok' && result.usedBoomlings) pause += BOOMLINGS_EXTRA_DELAY_MS
    if (result.kind === 'error' && result.usedBoomlings) pause += BOOMLINGS_EXTRA_DELAY_MS
    await sleep(pause)
  }

  db.close()
  console.log(
    `[backfill] done. ok=${okCount} notFound=${notFoundCount} err=${errCount} ` +
    `elapsed=${((Date.now() - startedAt) / 60_000).toFixed(1)}min`,
  )
}

main().catch((e) => {
  console.error('[backfill] fatal:', e)
  process.exit(1)
})
