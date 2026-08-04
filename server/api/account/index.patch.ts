import { getDb } from '~/server/db'
import { requireAccount, isAdminRole } from '~/server/utils/auth'
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

  /**
   * Staff decorations: a custom cover image, and an emoji plus a badge beside
   * the name.
   *
   * Gated on role rather than hidden in the UI, because hiding a control is not
   * a permission check — the request is what has to be refused. A demoted admin
   * keeps whatever they already set; taking it away is a moderation action, not
   * something a profile save should do silently.
   */
  const isStaff = isAdminRole(me.role)
  const cur = getDb().prepare(
    `SELECT banner_image_url, name_emoji, name_badge, name_badge_color FROM accounts WHERE id = ?`,
  ).get(me.id) as {
    banner_image_url: string | null; name_emoji: string | null
    name_badge: string | null; name_badge_color: string | null
  }

  let banner_image_url = cur.banner_image_url
  let name_emoji = cur.name_emoji
  let name_badge = cur.name_badge
  let name_badge_color = cur.name_badge_color

  if (isStaff) {
    if ('banner_image_url' in body) {
      const url = clamp(body.banner_image_url, 500)
      // Rendered as an <img src> on a public page.
      if (url && !/^https?:\/\//i.test(url)) {
        throw createError({ statusCode: 400, statusMessage: 'The background must be an http:// or https:// image link.' })
      }
      banner_image_url = url
    }
    if ('name_emoji' in body) {
      // Short by design: this sits inline with a username in list rows, and a
      // long string here pushes everything beside it off the row.
      const raw = clamp(body.name_emoji, 16)
      if (raw && [...raw].length > 3) {
        throw createError({ statusCode: 400, statusMessage: 'Up to three emoji.' })
      }
      name_emoji = raw
    }
    if ('name_badge' in body) {
      const raw = clamp(body.name_badge, 24)
      // It goes next to a name on public pages under the site's own styling,
      // so it is held to the same standard the username is.
      if (raw) assertClean(raw, 'Name badges')
      name_badge = raw
    }
    if ('name_badge_color' in body) {
      const hex = clamp(body.name_badge_color, 7)
      // Interpolated into a style attribute, so only a hex literal is stored.
      name_badge_color = hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : null
    }
  }

  const BANNERS = new Set(['hardest', 'favorite', 'level', 'none', 'custom'])
  let banner_choice = 'banner_choice' in body && BANNERS.has(String(body.banner_choice))
    ? String(body.banner_choice)
    : ((me as any).banner_choice ?? 'hardest')
  // Asking for a level banner without a level would render a plain header while
  // the setting claimed otherwise, so keep the two honest with each other.
  if (banner_choice === 'level' && banner_level_id == null) banner_choice = 'none'
  if (banner_choice === 'custom' && !banner_image_url) banner_choice = 'none'

  getDb().prepare(
    `UPDATE accounts SET bio = ?, country = ?, subdivision = ?, pronouns = ?, discord_handle = ?, youtube_url = ?,
     gd_username = ?, favorite_level_id = ?, favorite_level_note = ?, hardest_record_id = ?, banner_choice = ?,
     banner_level_id = ?, banner_image_url = ?, name_emoji = ?, name_badge = ?, name_badge_color = ?
     WHERE id = ?`,
  ).run(next.bio, next.country, next.subdivision, next.pronouns, next.discord_handle, next.youtube_url,
    next.gd_username, favorite_level_id, next.favorite_level_note, hardest_record_id, banner_choice, banner_level_id,
    banner_image_url, name_emoji, name_badge, name_badge_color, me.id)

  return {
    ok: true, ...next, favorite_level_id, hardest_record_id, banner_choice, banner_level_id,
    banner_image_url, name_emoji, name_badge, name_badge_color,
  }
})
