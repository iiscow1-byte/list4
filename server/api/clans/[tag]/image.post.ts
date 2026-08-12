import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

/**
 * Upload a clan's icon or banner.
 *
 * Stored as a blob on the clan row, the same way an account's avatar is, rather
 * than as a link to somewhere else. A clan's picture is part of the clan; a URL
 * to an image host is a picture that disappears when somebody else's account
 * lapses, and that has happened to enough of the `icon_url` links already on
 * file to be worth designing away.
 *
 * `icon_url` / `banner_url` still work and are still editable — a clan already
 * pointing at an image keeps working — but an upload wins over one. See
 * `clanImageUrl` in `utils/clan-images.ts` for the single place that decides.
 *
 * The two differ only in size, because they are used at different sizes: an
 * icon is a 56px square and a banner is a full-bleed strip behind the header.
 */
const LIMITS = {
  icon: 1 * 1024 * 1024,
  banner: 3 * 1024 * 1024,
} as const
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const tag = String(getRouterParam(event, 'tag') ?? '').trim()

  const db = getDb()
  const clan = db.prepare(`SELECT id, owner_account_id FROM clans WHERE tag = ?`)
    .get(tag) as { id: number; owner_account_id: number } | undefined
  if (!clan) throw createError({ statusCode: 404, statusMessage: 'No such clan.' })
  if (clan.owner_account_id !== me.id) {
    throw createError({ statusCode: 403, statusMessage: 'Only the clan owner can change its pictures.' })
  }

  const parts = await readMultipartFormData(event)
  const kindPart = parts?.find((p) => p.name === 'kind')
  const kind = kindPart?.data ? String(kindPart.data) : 'icon'
  if (kind !== 'icon' && kind !== 'banner') {
    throw createError({ statusCode: 400, statusMessage: 'kind must be "icon" or "banner".' })
  }

  const file = parts?.find((p) => p.name === 'image' && p.data && p.data.length > 0)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'No file uploaded.' })

  const type = file.type ?? 'application/octet-stream'
  if (!ALLOWED_TYPES.has(type)) {
    throw createError({ statusCode: 400, statusMessage: 'Must be a PNG, JPEG, GIF or WebP image.' })
  }
  const limit = LIMITS[kind]
  if (file.data.length > limit) {
    throw createError({
      statusCode: 413,
      statusMessage: `${kind === 'icon' ? 'Icon' : 'Banner'} must be ${limit / 1024 / 1024} MB or smaller.`,
    })
  }

  db.prepare(`UPDATE clans SET ${kind}_blob = ?, ${kind}_type = ? WHERE id = ?`)
    .run(file.data, type, clan.id)
  return { ok: true, kind }
})
