import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { assertClean } from '~/server/utils/profanity-guard'
import { clanForAccount, isValidClanTag } from '~/server/utils/clans'

/**
 * Start a clan.
 *
 * One per account, on both sides: you cannot found a second while you are in
 * one, because the membership table keys on the account. Founding puts you in
 * it as the owner in the same transaction — a clan with nobody in it would be
 * an empty row on the leaderboard.
 */
export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const body = await readBody<{
    tag?: string; name?: string; description?: string
    color?: string; icon_url?: string; discord_url?: string; invite_only?: boolean
  }>(event) ?? {}

  const db = getDb()
  if (clanForAccount(db, me.id)) {
    throw createError({ statusCode: 400, statusMessage: 'You are already in a clan. Leave it first.' })
  }

  const tag = String(body.tag ?? '').trim()
  const name = String(body.name ?? '').trim().slice(0, 60)
  if (!isValidClanTag(tag)) {
    throw createError({ statusCode: 400, statusMessage: 'A tag is 2–6 letters or digits.' })
  }
  if (!name) throw createError({ statusCode: 400, statusMessage: 'A clan needs a name.' })
  assertClean(tag, 'Clan tags')
  assertClean(name, 'Clan names')

  const description = String(body.description ?? '').trim().slice(0, 500) || null
  if (description) assertClean(description, 'Clan descriptions')

  // Only a hex literal reaches a style attribute — the same rule custom lists
  // and name badges are held to.
  const rawColor = String(body.color ?? '').trim()
  const color = /^#[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor.toLowerCase() : null

  for (const [key, value] of [['icon_url', body.icon_url], ['discord_url', body.discord_url]] as const) {
    const v = String(value ?? '').trim()
    if (v && !/^https?:\/\//i.test(v)) {
      throw createError({ statusCode: 400, statusMessage: `${key === 'icon_url' ? 'Icon' : 'Discord'} links must start with http:// or https://` })
    }
  }

  // Case-insensitive by column collation, so "TSK" and "tsk" are one tag.
  const taken = db.prepare(`SELECT 1 FROM clans WHERE tag = ?`).get(tag)
  if (taken) throw createError({ statusCode: 409, statusMessage: `[${tag}] is taken.` })

  db.exec('BEGIN')
  try {
    const id = Number(db.prepare(
      `INSERT INTO clans (tag, name, description, color, icon_url, discord_url, invite_only, owner_account_id)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      tag, name, description, color,
      String(body.icon_url ?? '').trim().slice(0, 500) || null,
      String(body.discord_url ?? '').trim().slice(0, 300) || null,
      body.invite_only ? 1 : 0, me.id,
    ).lastInsertRowid)

    db.prepare(
      `INSERT INTO clan_members (account_id, clan_id, role) VALUES (?, ?, 'owner')`,
    ).run(me.id, id)
    db.exec('COMMIT')
    return { ok: true, id, tag }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
})
