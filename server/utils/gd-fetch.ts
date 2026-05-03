/**
 * Shared GD-info fetch pipeline used by both the on-demand level endpoint and
 * the background cache warmer.
 *
 * Strategy: try gdbrowser first (no rate limit, no UA blocking). If gdbrowser
 * is down OR returns its placeholder response (a sentinel level with exactly
 * 10,000,000 downloads), fall back to Boomlings.
 *
 * Boomlings is hit through node:http with no User-Agent — fetch silently
 * inserts `User-Agent: node` and Boomlings' Cloudflare layer 1020s any
 * UA-bearing request. The official GD client sends none. Must target the
 * `www.` subdomain — the apex hostname is also Cloudflare-blocked.
 *
 * Datacenter / Railway egress: Cloudflare 403s direct requests from datacenter
 * ranges no matter what UA you send. Set GD_PROXY_URL (and GD_PROXY_TOKEN to
 * match the proxy's secret) to route through the Cloudflare Worker in
 * worker/boomlings-proxy.js or the local-machine proxy in worker/local-proxy.js.
 */

import http from 'node:http'

const GD_SECRET = 'Wmfd2893gb7'
const BOOMLINGS_HOST = 'www.boomlings.com'
const BOOMLINGS_PATH = '/database/downloadGJLevel22.php'
const GD_PROXY_URL = process.env.GD_PROXY_URL?.replace(/\/+$/, '') ?? ''
const GD_PROXY_TOKEN = process.env.GD_PROXY_TOKEN ?? ''
const GDBROWSER_URL = (id: number) => `https://gdbrowser.com/api/level/${id}`
const GDBROWSER_PLACEHOLDER_DOWNLOADS = 10_000_000

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

export type GdInfo = {
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

function postBoomlingsDirect(body: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'POST',
        host: BOOMLINGS_HOST,
        port: 80,
        path: BOOMLINGS_PATH,
        // Per boomlings.dev/endpoints/generic: User-Agent must be empty.
        // node:http doesn't auto-add it, but setting it explicitly is harmless
        // and matches the documented spec.
        headers: {
          'User-Agent': '',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': body.length,
        },
        timeout: timeoutMs,
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

async function postBoomlingsViaProxy(body: string, timeoutMs: number): Promise<string> {
  // Proxy expects the same path Boomlings uses; it forwards to www.boomlings.com.
  // Empty UA is preserved by the proxy on the upstream hop — cf. worker code.
  const resp = await fetch(`${GD_PROXY_URL}${BOOMLINGS_PATH}`, {
    method: 'POST',
    headers: {
      'User-Agent': '',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(GD_PROXY_TOKEN ? { 'X-Proxy-Token': GD_PROXY_TOKEN } : {}),
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!resp.ok) throw new Error(`boomlings HTTP ${resp.status}`)
  return resp.text()
}

async function postBoomlings(body: string, timeoutMs: number): Promise<string> {
  // When a proxy is configured, prefer it — but if it's unreachable (DNS
  // failure, connection refused, timeout), fall through to the direct call so
  // a stale GD_PROXY_URL doesn't fully break the integration. HTTP errors from
  // the proxy still bubble up: those mean the proxy reached upstream.
  if (GD_PROXY_URL) {
    try {
      return await postBoomlingsViaProxy(body, timeoutMs)
    } catch (e: any) {
      const msg = String(e?.message ?? '')
      const cause = String((e as any)?.cause?.code ?? (e as any)?.cause?.message ?? '')
      const isHttpStatus = /HTTP \d{3}/.test(msg)
      if (isHttpStatus) throw e
      console.warn(
        `[gd-fetch] proxy unreachable (${msg}${cause ? `: ${cause}` : ''}), falling back to direct boomlings call`,
      )
    }
  }
  return postBoomlingsDirect(body, timeoutMs)
}

async function fetchFromGdBrowser(id: number, timeoutMs: number): Promise<GdInfo> {
  const resp = await fetch(GDBROWSER_URL(id), {
    headers: { 'User-Agent': 'all-levels-list/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
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

async function fetchFromBoomlings(id: number, timeoutMs: number): Promise<GdInfo> {
  // gameVersion / binaryVersion track the live GD client. Per
  // https://boomlings.dev/endpoints/generic, the current values are 22 / 47.
  // Older values (e.g. 21 / 35) trip Cloudflare's bot heuristics.
  const body = new URLSearchParams({
    secret: GD_SECRET,
    levelID: String(id),
    gameVersion: '22',
    binaryVersion: '47',
    gdw: '0',
  }).toString()

  const raw = (await postBoomlings(body, timeoutMs)).trim()
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

export type FetchOutcome =
  | { kind: 'ok'; info: GdInfo; usedBoomlings: boolean; placeholder?: boolean }
  | { kind: 'not_found' }
  | { kind: 'error'; reason: string; rateLimited: boolean; usedBoomlings: boolean; httpStatus: number | null }

/** True iff `reason` looks like Cloudflare blocking us at the edge (HTTP 403). */
export function isBoomlingsBlocked(o: FetchOutcome): boolean {
  return o.kind === 'error' && o.usedBoomlings && o.httpStatus === 403
}

function statusFromMessage(msg: string): number | null {
  const m = msg.match(/HTTP (\d{3})/)
  return m ? Number(m[1]) : null
}

/**
 * Try gdbrowser, then Boomlings. The 10M-downloads sentinel is gdbrowser's
 * placeholder response — treat it as a soft error so the Boomlings fallback
 * runs. `not_found` from gdbrowser is NOT authoritative; only Boomlings' 404
 * is final.
 */
export async function fetchFresh(id: number, opts: { timeoutMs?: number } = {}): Promise<GdInfo> {
  const timeoutMs = opts.timeoutMs ?? 8000
  const errors: string[] = []
  try {
    const info = await fetchFromGdBrowser(id, timeoutMs)
    if (info.downloads !== GDBROWSER_PLACEHOLDER_DOWNLOADS) return info
    errors.push('gdbrowser: placeholder response')
  } catch (e: any) {
    errors.push(`gdbrowser: ${e?.message ?? 'unknown'}`)
  }
  try {
    return await fetchFromBoomlings(id, timeoutMs)
  } catch (e: any) {
    const msg = e?.message ?? 'unknown'
    if (msg === 'not_found') throw e
    const cause = e?.cause?.code ?? e?.cause?.message ?? e?.cause
    errors.push(`boomlings: ${cause ? `${msg} (${cause})` : msg}`)
    throw new Error(errors.join('; '))
  }
}

/**
 * Same as fetchFresh but classifies the result.
 *
 * `skipBoomlings` short-circuits the Boomlings fallback. Useful for the cache
 * warmer once it's seen a sustained 403 from Cloudflare — repeated 403s won't
 * recover within a single run, so it's better to keep going on gdbrowser data
 * (placeholder included) than to waste paced requests on a blocked endpoint.
 *
 * When `skipBoomlings` is set and gdbrowser returns its placeholder, the
 * outcome is `{ kind: 'ok', placeholder: true }` so callers can decide whether
 * caching the placeholder is acceptable for their workflow.
 */
export async function fetchOneClassified(
  id: number,
  opts: { timeoutMs?: number; skipBoomlings?: boolean } = {},
): Promise<FetchOutcome> {
  const timeoutMs = opts.timeoutMs ?? 10_000
  let gdbrowserPlaceholder: GdInfo | null = null
  try {
    const info = await fetchFromGdBrowser(id, timeoutMs)
    if (info.downloads !== GDBROWSER_PLACEHOLDER_DOWNLOADS) {
      return { kind: 'ok', info, usedBoomlings: false }
    }
    gdbrowserPlaceholder = info
  } catch (e: any) {
    const msg = String(e?.message ?? 'unknown')
    if (msg === 'not_found') return { kind: 'not_found' }
  }

  if (opts.skipBoomlings) {
    if (gdbrowserPlaceholder) {
      return { kind: 'ok', info: gdbrowserPlaceholder, usedBoomlings: false, placeholder: true }
    }
    return { kind: 'error', reason: 'gdbrowser failed; boomlings skipped', rateLimited: false, usedBoomlings: false, httpStatus: null }
  }

  try {
    const info = await fetchFromBoomlings(id, timeoutMs)
    return { kind: 'ok', info, usedBoomlings: true }
  } catch (e: any) {
    const msg = String(e?.message ?? 'unknown')
    if (msg === 'not_found') return { kind: 'not_found' }
    const httpStatus = statusFromMessage(msg)
    const rateLimited = /HTTP (4\d\d|5\d\d)|timeout|EAI|ECONN|ENOTFOUND|socket/i.test(msg)
    return { kind: 'error', reason: msg, rateLimited, usedBoomlings: true, httpStatus }
  }
}
