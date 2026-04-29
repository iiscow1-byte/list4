/**
 * Look up a level on the official Geometry Dash servers (Boomlings).
 *
 * gdbrowser.com used to proxy this for us but it's flagged experimental and
 * has been returning broken/default responses from some egress IPs (e.g.
 * Railway). We hit boomlings.com directly to get the authoritative data.
 *
 * The Boomlings response is `key:value:key:value:…#hash#hash`. We parse the
 * first section, ignore the hashes, and map the numeric keys we care about.
 */

const GD_SECRET = 'Wmfd2893gb7'
const GD_URL = 'http://www.boomlings.com/database/downloadGJLevel22.php'

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
    // The first character is a "1" prefix — drop it.
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

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid level id' })
  }

  let raw: string | null = null
  try {
    raw = await $fetch<string>(GD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // GD servers reject most User-Agents — mimic the game (empty UA).
        'User-Agent': '',
      },
      body: new URLSearchParams({
        secret: GD_SECRET,
        levelID: String(id),
      }).toString(),
      responseType: 'text',
      timeout: 8000,
    })
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Geometry Dash servers unavailable' })
  }

  const trimmed = (raw ?? '').trim()
  if (!trimmed || trimmed === '-1') {
    throw createError({ statusCode: 404, statusMessage: 'Level not found on GD servers' })
  }

  const m = parseGdMap(trimmed)

  const lengthCode = Number(m['15']) || 0
  const length = LENGTHS[lengthCode] ?? null

  const stars = Number(m['18']) || 0
  const featuredScore = Number(m['19']) || 0 // > 0 means Featured
  const epicNum = Number(m['42']) || 0       // 1 epic, 2 legendary, 3 mythic

  // GD rated tier — 0=Unrated, 1=Rated, 2=Featured, 3=Epic, 4=Legendary, 5=Mythic
  let score: 0 | 1 | 2 | 3 | 4 | 5 = 0
  if (epicNum === 3) score = 5
  else if (epicNum === 2) score = 4
  else if (epicNum === 1) score = 3
  else if (featuredScore > 0) score = 2
  else if (stars > 0) score = 1

  const customSong = Number(m['35']) || 0
  const officialSongId = Number(m['12']) || 0
  const songName = customSong
    ? `Custom song #${customSong}`
    : (OFFICIAL_SONGS[officialSongId] ?? null)

  const objectsRaw = Number(m['45']) || 0

  setHeader(event, 'cache-control', 'public, max-age=300, s-maxage=300')

  return {
    id: Number(m['1']) || id,
    name: m['2'] ?? null,
    // Author username isn't in the level response — would need a separate
    // getGJUsers20 call. The list already stores `creator` in our DB.
    author: null as string | null,
    description: decodeBase64Url(m['3'] ?? ''),
    downloads: Number(m['10']) || 0,
    likes: Number(m['14']) || 0,
    length,
    objects: objectsRaw,
    objectsApprox: false,
    coins: Number(m['37']) || 0,
    verifiedCoins: m['38'] === '1',
    score,
    song: {
      name: songName,
      id: customSong || officialSongId || null,
      custom: !!customSong,
    },
    password: decodePassword(m['27'] ?? ''),
  }
})
