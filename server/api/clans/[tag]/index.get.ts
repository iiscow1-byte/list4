import { getDb } from '~/server/db'
import { getCurrentAccount } from '~/server/utils/auth'
import { clanCompletions, clanForAccount, clanMembers } from '~/server/utils/clans'

/**
 * One clan: who is in it, what they have beaten together, and where it stands.
 *
 * The completions list is the part worth having — a clan's page on other sites
 * is a roster and a number, and the question people actually ask is "what has
 * this group done".
 */
export default defineEventHandler((event) => {
  const tag = String(getRouterParam(event, 'tag') ?? '').trim()
  if (!tag) throw createError({ statusCode: 400, statusMessage: 'tag required' })

  const db = getDb()
  const clan = db.prepare(
    `SELECT c.*, o.username AS owner_username
       FROM clans c LEFT JOIN accounts o ON o.id = c.owner_account_id
      WHERE c.tag = ?`,
  ).get(tag) as any
  if (!clan) throw createError({ statusCode: 404, statusMessage: 'No such clan.' })

  const me = getCurrentAccount(event)
  const mine = me ? clanForAccount(db, me.id) ?? null : null
  const isOwner = !!me && me.id === clan.owner_account_id
  const members = clanMembers(db, clan.id)
  const completions = clanCompletions(db, clan.id)

  // Only the owner sees who has asked to join — it is a queue to act on, not
  // a fact about the clan.
  const requests = isOwner
    ? db.prepare(
        `SELECT j.account_id, a.username, j.message, j.created_at,
                (a.avatar_blob IS NOT NULL) AS has_avatar
           FROM clan_join_requests j JOIN accounts a ON a.id = j.account_id
          WHERE j.clan_id = ? ORDER BY j.created_at ASC`,
      ).all(clan.id).map((r: any) => ({ ...r, has_avatar: !!r.has_avatar }))
    : []

  // …and the same for invites the clan has sent but nobody has answered. The
  // owner needs to see these to avoid asking the same person twice, and to take
  // an invite back.
  const invites = isOwner
    ? db.prepare(
        `SELECT i.account_id, a.username, i.message, i.created_at,
                (a.avatar_blob IS NOT NULL) AS has_avatar,
                (SELECT 1 FROM clan_members m WHERE m.account_id = i.account_id) AS in_a_clan
           FROM clan_invites i JOIN accounts a ON a.id = i.account_id
          WHERE i.clan_id = ? ORDER BY i.created_at DESC`,
      ).all(clan.id).map((r: any) => ({
        ...r, has_avatar: !!r.has_avatar, in_a_clan: !!r.in_a_clan,
      }))
    : []

  const totals = {
    members: members.length,
    levels: completions.length,
    completions: members.reduce((n, m) => n + m.completions, 0),
    points: completions.reduce((n, c) => n + (c.points ?? 0), 0),
    challenges: completions.filter((c) => c.is_challenge).length,
  }

  // What the viewer was invited with, if anything — the message the owner sent
  // is the difference between an invite and a notification.
  const myInvite = me
    ? db.prepare(
        `SELECT i.message, i.created_at, inv.username AS invited_by_username
           FROM clan_invites i LEFT JOIN accounts inv ON inv.id = i.invited_by
          WHERE i.clan_id = ? AND i.account_id = ?`,
      ).get(clan.id, me.id) as
        { message: string | null; created_at: string; invited_by_username: string | null } | undefined
    : undefined

  return {
    clan: {
      id: clan.id, tag: clan.tag, name: clan.name, description: clan.description,
      color: clan.color, icon_url: clan.icon_url, banner_url: clan.banner_url,
      discord_url: clan.discord_url, invite_only: clan.invite_only,
      owner_username: clan.owner_username, created_at: clan.created_at,
      // Whether an *uploaded* picture exists, not the picture itself: the blob
      // is served by `image.get.ts` and would be megabytes of base64 in this
      // JSON otherwise. `utils/clan-images.ts` turns these two flags plus the
      // two URLs into one answer.
      has_icon: !!clan.icon_blob,
      has_banner: !!clan.banner_blob,
    },
    totals,
    members,
    completions,
    requests,
    invites,
    myInvite: myInvite ?? null,
    viewer: {
      signedIn: !!me,
      isOwner,
      isMember: !!mine && mine.id === clan.id,
      inAnotherClan: !!mine && mine.id !== clan.id,
      requested: !!me && !!db.prepare(
        `SELECT 1 FROM clan_join_requests WHERE clan_id = ? AND account_id = ?`,
      ).get(clan.id, me.id),
      invited: !!myInvite,
    },
  }
})
