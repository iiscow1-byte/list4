import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { assertClean } from '~/server/utils/profanity-guard'
import { isValidClanTag } from '~/server/utils/clans'

/**
 * Edit a clan.
 *
 * Everything the create form asks for was, until now, answerable exactly once —
 * a typo in the description or a colour that turned out to clash was permanent,
 * and the only fix was to disband and start again, which loses the roster and
 * the standing.
 *
 * Owner only. A clan's identity is what its members joined; changing it is not
 * something a member should be able to do to everybody else.
 *
 * ## The tag
 *
 * Editable, but treated as a rename rather than as a field: it is in the URL,
 * it is what the tag badge prints beside every member's name everywhere on the
 * site, and it is unique. Uniqueness is enforced by the column's collation, so
 * "TSK" and "tsk" are the same tag and re-casing your own is allowed.
 */
export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const tag = String(getRouterParam(event, 'tag') ?? '').trim()
  const body = await readBody<Record<string, unknown>>(event) ?? {}

  const db = getDb()
  const clan = db.prepare(
    `SELECT id, tag, owner_account_id FROM clans WHERE tag = ?`,
  ).get(tag) as { id: number; tag: string; owner_account_id: number } | undefined
  if (!clan) throw createError({ statusCode: 404, statusMessage: 'No such clan.' })
  if (clan.owner_account_id !== me.id) {
    throw createError({ statusCode: 403, statusMessage: 'Only the clan owner can edit it.' })
  }

  const sets: string[] = []
  const params: (string | number | null)[] = []

  if ('name' in body) {
    const name = String(body.name ?? '').trim().slice(0, 60)
    if (!name) throw createError({ statusCode: 400, statusMessage: 'A clan needs a name.' })
    assertClean(name, 'Clan names')
    sets.push('name = ?')
    params.push(name)
  }

  if ('description' in body) {
    const description = String(body.description ?? '').trim().slice(0, 500) || null
    if (description) assertClean(description, 'Clan descriptions')
    sets.push('description = ?')
    params.push(description)
  }

  if ('color' in body) {
    // Only a hex literal ever reaches a style attribute — the same rule custom
    // lists and name badges are held to.
    const raw = String(body.color ?? '').trim()
    const color = /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : null
    if (raw && !color) throw createError({ statusCode: 400, statusMessage: 'Colour must be a hex code like #06b6d4.' })
    sets.push('color = ?')
    params.push(color)
  }

  for (const [key, label, max] of [
    ['icon_url', 'Icon', 500],
    ['banner_url', 'Banner', 500],
    ['discord_url', 'Discord', 300],
  ] as const) {
    if (!(key in body)) continue
    const v = String(body[key] ?? '').trim()
    if (v && !/^https?:\/\//i.test(v)) {
      throw createError({ statusCode: 400, statusMessage: `${label} links must start with http:// or https://` })
    }
    sets.push(`${key} = ?`)
    params.push(v.slice(0, max) || null)
  }

  if ('invite_only' in body) {
    sets.push('invite_only = ?')
    params.push(body.invite_only ? 1 : 0)
  }

  // The tag last, so a rejected rename doesn't leave the other edits applied.
  let newTag = clan.tag
  if ('tag' in body) {
    const wanted = String(body.tag ?? '').trim()
    if (!isValidClanTag(wanted)) {
      throw createError({ statusCode: 400, statusMessage: 'A tag is 2–6 letters or digits.' })
    }
    assertClean(wanted, 'Clan tags')
    if (wanted.toLowerCase() !== clan.tag.toLowerCase()) {
      const taken = db.prepare(`SELECT 1 FROM clans WHERE tag = ? AND id <> ?`).get(wanted, clan.id)
      if (taken) throw createError({ statusCode: 409, statusMessage: `[${wanted}] is taken.` })
    }
    sets.push('tag = ?')
    params.push(wanted)
    newTag = wanted
  }

  if (!sets.length) throw createError({ statusCode: 400, statusMessage: 'Nothing to update.' })

  db.prepare(`UPDATE clans SET ${sets.join(', ')} WHERE id = ?`).run(...params, clan.id)
  // The tag is in the URL, so the client needs to know where the clan now lives.
  return { ok: true, tag: newTag }
})
