import { getDb } from '~/server/db'

/**
 * Search Geometry Dash levels by name (or exact level ID) so users can submit
 * a level / record without having to look the ID up elsewhere.
 *
 * Backed by gdbrowser's search endpoint, which fronts RobTop's
 * `getGJLevels21.php` — the same source `server/utils/gd-fetch.ts` uses for
 * per-level info, and the one that doesn't rate-limit or block our UA.
 *
 * Every result is annotated with whether it's already on the ALL list (and at
 * what placement), so the UI can say "already ranked" instead of inviting a
 * duplicate submission.
 */
type GdbLevel = {
  name?: string
  id?: number | string
  author?: string
  accountID?: number
  description?: string
  difficulty?: string
  downloads?: number
  likes?: number
  length?: string
  stars?: number
  coins?: number
  verifiedCoins?: boolean
  featured?: boolean
  epic?: boolean
  legendary?: boolean
  mythic?: boolean
  songName?: string
  songAuthor?: string
  gameVersion?: string
  cp?: number
}

export type GdSearchResult = {
  gd_id: number
  name: string
  author: string | null
  description: string | null
  difficulty: string | null
  /** Highest rating tier the level holds, or 'Unrated'. */
  rating: string
  stars: number | null
  downloads: number | null
  likes: number | null
  length: string | null
  song: string | null
  /** Set when this level is already on the ALL list. */
  on_list: { position: number; sheet_placement: number | null; name: string } | null
}

function ratingOf(l: GdbLevel): string {
  if (l.mythic) return 'Mythic'
  if (l.legendary) return 'Legendary'
  if (l.epic) return 'Epic'
  if (l.featured) return 'Featured'
  if ((l.stars ?? 0) > 0) return 'Rated'
  return 'Unrated'
}

export default defineEventHandler(async (event) => {
  const q = String(getQuery(event).q ?? '').trim()
  if (!q) return { results: [] as GdSearchResult[] }
  if (q.length > 100) throw createError({ statusCode: 400, statusMessage: 'Query too long.' })

  const count = Math.max(1, Math.min(Number(getQuery(event).count) || 20, 40))

  let raw: GdbLevel[] = []
  try {
    const res = await $fetch<GdbLevel[] | GdbLevel>(
      `https://gdbrowser.com/api/search/${encodeURIComponent(q)}`,
      { query: { count, page: 0 }, timeout: 12_000 },
    )
    raw = Array.isArray(res) ? res : res ? [res] : []
  } catch (err: any) {
    // gdbrowser returns a bare "-1" body with a 404 for "no results", which
    // $fetch surfaces as an error — that's an empty result set, not a failure.
    const status = err?.response?.status ?? err?.statusCode
    if (status === 404) return { results: [] as GdSearchResult[] }
    throw createError({ statusCode: 502, statusMessage: 'Geometry Dash search is unavailable right now.' })
  }

  const db = getDb()
  const findOnList = db.prepare(
    `SELECT position, sheet_placement, name FROM levels WHERE gd_id = ? LIMIT 1`,
  )

  const results: GdSearchResult[] = []
  for (const l of raw) {
    const gdId = Number(l?.id)
    if (!Number.isInteger(gdId) || gdId <= 0) continue
    results.push({
      gd_id: gdId,
      name: String(l.name ?? '').slice(0, 200) || `Level ${gdId}`,
      author: l.author ? String(l.author) : null,
      description: l.description ? String(l.description).slice(0, 500) : null,
      difficulty: l.difficulty ? String(l.difficulty) : null,
      rating: ratingOf(l),
      stars: Number.isFinite(Number(l.stars)) ? Number(l.stars) : null,
      downloads: Number.isFinite(Number(l.downloads)) ? Number(l.downloads) : null,
      likes: Number.isFinite(Number(l.likes)) ? Number(l.likes) : null,
      length: l.length ? String(l.length) : null,
      song: l.songName ? `${l.songName}${l.songAuthor ? ` — ${l.songAuthor}` : ''}` : null,
      on_list: (findOnList.get(gdId) as GdSearchResult['on_list']) ?? null,
    })
  }

  return { results }
})
