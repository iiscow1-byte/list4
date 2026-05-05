import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

function clamp(val: unknown, max: number): string | null {
  if (val === undefined || val === null) return null
  const s = String(val).slice(0, max).trim()
  return s === '' ? null : s
}

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const body = (await readBody(event)) ?? {}

  const next = {
    bio: 'bio' in body ? clamp(body.bio, 1000) : me.bio,
    country: 'country' in body ? clamp(body.country, 64) : me.country,
    subdivision: 'subdivision' in body ? clamp(body.subdivision, 64) : me.subdivision,
    pronouns: 'pronouns' in body ? clamp(body.pronouns, 64) : me.pronouns,
    discord_handle: 'discord_handle' in body ? clamp(body.discord_handle, 64) : me.discord_handle,
    youtube_url: 'youtube_url' in body ? clamp(body.youtube_url, 500) : me.youtube_url,
    favorite_level_note: 'favorite_level_note' in body ? clamp(body.favorite_level_note, 500) : me.favorite_level_note,
  }

  if (next.youtube_url) {
    const ytPattern = /^https?:\/\/(www\.)?youtube\.com\/((@|channel\/|c\/|user\/)[^/?&#\s]+)/i
    if (!ytPattern.test(next.youtube_url)) {
      throw createError({ statusCode: 400, statusMessage: 'YouTube URL must be a valid channel link (e.g. https://www.youtube.com/@handle)' })
    }
  }

  let favorite_level_id: number | null = me.favorite_level_id ?? null
  if ('favorite_level_id' in body) {
    const raw = body.favorite_level_id
    if (raw === null || raw === '' || raw === undefined) {
      favorite_level_id = null
    } else {
      const n = Number(raw)
      if (!Number.isFinite(n) || n <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid favorite_level_id' })
      const db = getDb()
      const exists = db.prepare(`SELECT id FROM levels WHERE id = ?`).get(n)
      if (!exists) throw createError({ statusCode: 404, statusMessage: 'Level not found' })
      favorite_level_id = n
    }
  }

  getDb().prepare(
    `UPDATE accounts SET bio = ?, country = ?, subdivision = ?, pronouns = ?, discord_handle = ?, youtube_url = ?,
     favorite_level_id = ?, favorite_level_note = ? WHERE id = ?`,
  ).run(next.bio, next.country, next.subdivision, next.pronouns, next.discord_handle, next.youtube_url,
    favorite_level_id, next.favorite_level_note, me.id)

  return { ok: true, ...next, favorite_level_id }
})
