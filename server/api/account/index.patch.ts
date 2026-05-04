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
  }

  getDb().prepare(
    `UPDATE accounts SET bio = ?, country = ?, subdivision = ?, pronouns = ?, discord_handle = ?, youtube_url = ? WHERE id = ?`,
  ).run(next.bio, next.country, next.subdivision, next.pronouns, next.discord_handle, next.youtube_url, me.id)

  return { ok: true, ...next }
})
