import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { isGdUsername } from '~/utils/gd-links'
import { assertClean } from '~/server/utils/profanity-guard'

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
    gd_username: 'gd_username' in body ? clamp(body.gd_username, 20) : (me as any).gd_username,
    favorite_level_note: 'favorite_level_note' in body ? clamp(body.favorite_level_note, 500) : me.favorite_level_note,
  }

  if (next.youtube_url) {
    const ytPattern = /^https?:\/\/(www\.)?youtube\.com\/((@|channel\/|c\/|user\/)[^/?&#\s]+)/i
    if (!ytPattern.test(next.youtube_url)) {
      throw createError({ statusCode: 400, statusMessage: 'YouTube URL must be a valid channel link (e.g. https://www.youtube.com/@handle)' })
    }
  }

  if (next.gd_username) {
    // Validated against what was *sent*, not against the clamped copy. Clamping
    // to 20 characters turns a 34-character paste into a perfectly valid
    // 20-character name, and storing that would put a username on the profile
    // that nobody typed and that belongs to somebody else.
    const raw = 'gd_username' in body ? String(body.gd_username ?? '').trim() : next.gd_username
    // Checked rather than accepted as free text: the value is turned into a
    // gdbrowser link, and anything that isn't a username produces a dead one.
    if (!isGdUsername(raw)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'That isn\'t a Geometry Dash username — letters, numbers, spaces, dots, dashes and underscores, up to 20 characters.',
      })
    }
    // It sits on a public profile under the account's own name, so it's held to
    // the same standard the username is.
    assertClean(next.gd_username, 'Geometry Dash usernames')
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

  // The showcased completion has to be one of the caller's own approved
  // records — otherwise anyone could pin someone else's #1 to their profile.
  let hardest_record_id: number | null = (me as any).hardest_record_id ?? null
  if ('hardest_record_id' in body) {
    const raw = body.hardest_record_id
    if (raw === null || raw === '' || raw === undefined) {
      hardest_record_id = null
    } else {
      const n = Number(raw)
      if (!Number.isFinite(n) || n <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid hardest_record_id' })
      const mine = getDb().prepare(
        `SELECT id FROM records WHERE id = ? AND permanent = 1 AND player_name = ? COLLATE NOCASE`,
      ).get(n, me.claimed_player ?? me.username)
      if (!mine) throw createError({ statusCode: 404, statusMessage: 'That completion is not on your profile.' })
      hardest_record_id = n
    }
  }

  // Any level may back the header — unlike the two picks above it claims
  // nothing about the account, so it only has to exist.
  let banner_level_id: number | null = (me as any).banner_level_id ?? null
  if ('banner_level_id' in body) {
    const raw = body.banner_level_id
    if (raw === null || raw === '' || raw === undefined) {
      banner_level_id = null
    } else {
      const n = Number(raw)
      if (!Number.isFinite(n) || n <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid banner_level_id' })
      const exists = getDb().prepare(`SELECT id FROM levels WHERE id = ?`).get(n)
      if (!exists) throw createError({ statusCode: 404, statusMessage: 'Level not found' })
      banner_level_id = n
    }
  }

  const BANNERS = new Set(['hardest', 'favorite', 'level', 'none'])
  let banner_choice = 'banner_choice' in body && BANNERS.has(String(body.banner_choice))
    ? String(body.banner_choice)
    : ((me as any).banner_choice ?? 'hardest')
  // Asking for a level banner without a level would render a plain header while
  // the setting claimed otherwise, so keep the two honest with each other.
  if (banner_choice === 'level' && banner_level_id == null) banner_choice = 'none'

  getDb().prepare(
    `UPDATE accounts SET bio = ?, country = ?, subdivision = ?, pronouns = ?, discord_handle = ?, youtube_url = ?,
     gd_username = ?, favorite_level_id = ?, favorite_level_note = ?, hardest_record_id = ?, banner_choice = ?,
     banner_level_id = ? WHERE id = ?`,
  ).run(next.bio, next.country, next.subdivision, next.pronouns, next.discord_handle, next.youtube_url,
    next.gd_username, favorite_level_id, next.favorite_level_note, hardest_record_id, banner_choice, banner_level_id, me.id)

  return { ok: true, ...next, favorite_level_id, hardest_record_id, banner_choice, banner_level_id }
})
