import { getDb } from '~/server/db'

/**
 * Serve a clan's uploaded icon or banner.
 *
 * Public, because a clan's picture appears wherever its tag does. 404s rather
 * than serving a placeholder when there is nothing uploaded, so the client can
 * fall back to the `icon_url` / `banner_url` link or to the tag's initials —
 * a placeholder image here would make "no picture" indistinguishable from
 * "picture that failed to load".
 */
export default defineEventHandler((event) => {
  const tag = String(getRouterParam(event, 'tag') ?? '').trim()
  const kind = String(getQuery(event).kind ?? 'icon')
  if (kind !== 'icon' && kind !== 'banner') {
    throw createError({ statusCode: 400, statusMessage: 'kind must be "icon" or "banner".' })
  }

  const row = getDb().prepare(
    `SELECT ${kind}_blob AS blob, ${kind}_type AS type FROM clans WHERE tag = ?`,
  ).get(tag) as { blob: Uint8Array | null; type: string | null } | undefined

  if (!row?.blob) throw createError({ statusCode: 404, statusMessage: 'No image.' })

  setHeader(event, 'Content-Type', row.type || 'image/png')
  // Short and revalidating: the owner can replace this at any moment, and a
  // long cache would leave the old picture in place for everybody who had
  // already seen it. The `v=` query the client appends handles the rest.
  setHeader(event, 'Cache-Control', 'public, max-age=300, must-revalidate')
  return row.blob
})
