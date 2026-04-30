/**
 * Look up a level on the official Geometry Dash servers.
 *
 * Strategy: try gdbrowser first (no rate limit, no UA blocking). If gdbrowser
 * is down OR returns its placeholder response (a sentinel level with exactly
 * 10,000,000 downloads), fall back to Boomlings via the configured proxy.
 *
 * Boomlings is hit through node:http with no User-Agent — fetch silently
 * inserts `User-Agent: node` and Boomlings 403s any UA-bearing request.
 * The official GD client sends none.
 */

import http from 'node:http'
import { getDb } from '~/server/db'

const GD_SECRET = 'Wmfd2893gb7'
const BOOMLINGS_HOST = 'www.boomlings.com'
const BOOMLINGS_PATH = '/database/downloadGJLevel22.php'
const GDBROWSER_URL = (id: number) => `https://gdbrowser.com/api/level/${id}`
const GDBROWSER_PLACEHOLDER_DOWNLOADS = 10_000_000
const CACHE_TTL_SECONDS = 3600

// Official soundtracks (level field 12 — only set for non-custom songs).
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

// Length code (field 15) -> label.
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

function parseGdMap(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  const first = s.split('#')[0] ?? s
  const parts = first.split(':')
  for (let i = 0; i + 1 < parts.length; i += 2) {
    out[parts[i]!] = parts[i + 1]!
  }
  return out
}

// GD password is XOR-encrypted with key 26364 then base64-encoded with a
// URL-safe alphabet. Returns the leading-1 prefix string the game uses.
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

function postDirect(body: string): Promise<string> {
  return new Promise((resolve, reject) => {
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
        timeout: 8000,
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
        res.on('end', () => resolve(data))
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('boomlings timeout')))
    req.end(body)
  })
}

async function postViaProxy(proxyUrl: string, token: string, body: string): Promise<string> {
  const url = proxyUrl.replace(/\/$/, '') + BOOMLINGS_PATH
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Proxy-Token': token,
    },
    body,
    signal: AbortSignal.timeout(8000),
  })
  if (!resp.ok) throw new Error(`boomlings HTTP ${resp.status}`)
  return await resp.text()
}

function postBoomlings(body: string): Promise<string> {
  const proxyUrl = process.env.GD_PROXY_URL
  const proxyToken = process.env.GD_PROXY_TOKEN
  if (proxyUrl && proxyToken) return postViaProxy(proxyUrl, proxyToken, body)
  return postDirect(body)
}

async function fetchFromGdBrowser(id: number): Promise<GdInfo> {
  const resp = await fetch(GDBROWSER_URL(id), {
    headers: { 'User-Agent': 'all-levels-list/1.0' },
    signal: AbortSignal.timeout(8000),
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
    description: typeof raw.description === 'string' ? raw.description : null,
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

/**
 * Try gdbrowser, then Boomlings. The 10M-downloads sentinel is gdbrowser's
 * placeholder response (returned when its own upstream call failed) — treat it
 * as a soft error so the Boomlings fallback runs. False positives on legitimate
 * 10M-download levels just cost one extra Boomlings call.
 *
 * `not_found` from gdbrowser is NOT treated as authoritative since their cache
 * can lag; only Boomlings' 404 is final.
 */
async function fetchFresh(id: number): Promise<GdInfo> {
  const errors: string[] = []
  try {
    const info = await fetchFromGdBrowser(id)
    if (info.downloads !== GDBROWSER_PLACEHOLDER_DOWNLOADS) return info
    errors.push('gdbrowser: placeholder response')
  } catch (e: any) {
    errors.push(`gdbrowser: ${e?.message ?? 'unknown'}`)
  }
  try {
    return await fetchFromBoomlings(id)
  } catch (e: any) {
    const msg = e?.message ?? 'unknown'
    if (msg === 'not_found') throw e
    const cause = e?.cause?.code ?? e?.cause?.message ?? e?.cause
    errors.push(`boomlings: ${cause ? `${msg} (${cause})` : msg}`)
    throw new Error(errors.join('; '))
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
    description: decodeBase64Url(m['3'] ?? ''),
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

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid level id' })
  }

  const db = getDb()
  const cached = db
    .prepare(
      `SELECT info_json, CAST(strftime('%s','now') - strftime('%s', fetched_at) AS INTEGER) AS age
       FROM gd_info_cache WHERE gd_id = ?`,
    )
    .get(id) as { info_json: string; age: number } | undefined

  if (cached && cached.age < CACHE_TTL_SECONDS) {
    setHeader(event, 'cache-control', 'public, max-age=300, s-maxage=300')
    return JSON.parse(cached.info_json) as GdInfo
  }

  let info: GdInfo
  try {
    info = await fetchFresh(id)
  } catch (e: any) {
    const msg = e?.message ?? 'unknown'
    if (msg === 'not_found') {
      throw createError({ statusCode: 404, statusMessage: 'Level not found on GD servers' })
    }
    // Both backends failed — serve stale cache if we have any, since stale data
    // is always better than a 502 for fields that change slowly.
    if (cached) {
      setHeader(event, 'cache-control', 'public, max-age=60')
      return JSON.parse(cached.info_json) as GdInfo
    }
    throw createError({
      statusCode: 502,
      statusMessage: `Geometry Dash servers unavailable (${msg})`,
    })
  }

  db.prepare(
    `INSERT INTO gd_info_cache (gd_id, info_json, fetched_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(gd_id) DO UPDATE SET info_json = excluded.info_json, fetched_at = excluded.fetched_at`,
  ).run(id, JSON.stringify(info))

  setHeader(event, 'cache-control', 'public, max-age=300, s-maxage=300')
  return info
})
