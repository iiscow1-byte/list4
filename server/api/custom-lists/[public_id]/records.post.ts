import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { sendInboxMessage } from '~/server/utils/inbox'
import { notifyListWebhooks } from '~/server/utils/custom-list-webhooks'
import { assertClean } from '~/server/utils/profanity-guard'

/**
 * Submit a record to a custom list. Goes to the list owner's queue as
 * `pending`; owners (and site admins) submitting to their own list are
 * auto-approved, since there's nobody else to review it.
 *
 * Re-submitting for the same level replaces the previous attempt — the unique
 * (item_id, player_name) index makes that the only sensible behaviour, and it
 * matches how someone improving a 62% to 100% expects the list to work.
 */
export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const body = await readBody<{
    item_id?: number
    player_name?: string
    percent?: number
    hz?: number
    video?: string
    mobile?: boolean
    note?: string
  }>(event)

  const db = getDb()
  const list = db.prepare(
    `SELECT id, owner_account_id, is_public, accepts_records, require_record_video, title
       FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as {
    id: number; owner_account_id: number; is_public: number
    accepts_records: number; require_record_video: number; title: string
  } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  if (!list.is_public && list.owner_account_id !== account.id) {
    throw createError({ statusCode: 403, statusMessage: 'This list is private.' })
  }
  if (!list.accepts_records) {
    throw createError({ statusCode: 400, statusMessage: 'This list is not accepting records.' })
  }

  const itemId = Number(body?.item_id)
  const item = db.prepare(
    `SELECT id, name, percent_to_qualify FROM custom_list_items WHERE id = ? AND list_id = ?`,
  ).get(itemId, list.id) as { id: number; name: string; percent_to_qualify: number } | undefined
  if (!item) throw createError({ statusCode: 400, statusMessage: 'That level is not on this list.' })

  const percent = Math.round(Number(body?.percent))
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
    throw createError({ statusCode: 400, statusMessage: 'Percent must be between 1 and 100.' })
  }
  if (percent < item.percent_to_qualify) {
    throw createError({
      statusCode: 400,
      statusMessage: `${item.name} requires at least ${item.percent_to_qualify}%.`,
    })
  }

  // Proof is the default, but a list can turn it off — a community that already
  // trusts its members shouldn't have every submission bounced for a field it
  // doesn't care about. Enforced here as well as in the form: the form is a
  // convenience, this is the rule.
  const video = String(body?.video ?? '').trim().slice(0, 500)
  if (!video && list.require_record_video) {
    throw createError({ statusCode: 400, statusMessage: 'A video link is required.' })
  }

  // Default to the submitter's claimed player name so leaderboard entries line
  // up with the rest of the site's notion of who someone is.
  const playerName = String(body?.player_name ?? '').trim().slice(0, 100)
    || account.claimed_player || account.username

  assertClean(playerName, 'Player names')
  assertClean(String(body?.note ?? ''), 'Record notes')

  const hzRaw = Number(body?.hz)
  const hz = Number.isFinite(hzRaw) && hzRaw > 0 ? Math.round(hzRaw) : null
  const isOwner = list.owner_account_id === account.id
  const status = isOwner ? 'approved' : 'pending'

  db.prepare(
    `INSERT INTO custom_list_records
       (list_id, item_id, player_name, percent, hz, video, mobile, note, status,
        submitted_by, decided_by, decided_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(item_id, player_name) DO UPDATE SET
       percent = excluded.percent, hz = excluded.hz, video = excluded.video,
       mobile = excluded.mobile, note = excluded.note, status = excluded.status,
       submitted_by = excluded.submitted_by, submitted_at = datetime('now'),
       decided_by = excluded.decided_by, decided_at = excluded.decided_at,
       reject_reason = NULL`,
  ).run(
    list.id, item.id, playerName, percent, hz, video || null, body?.mobile ? 1 : 0,
    String(body?.note ?? '').trim().slice(0, 500) || null, status,
    account.id, isOwner ? account.id : null, isOwner ? new Date().toISOString() : null,
  )

  if (!isOwner) {
    sendInboxMessage(db, list.owner_account_id, {
      kind: 'custom_list_record',
      subject: `${account.username} submitted a record on "${list.title}"`,
      body: `${playerName} — ${item.name} at ${percent}%.`,
      sent_by: account.id,
      related_kind: 'custom_list',
      related_id: list.id,
    })
    notifyListWebhooks(db, list.id, 'records', {
      title: `New record on ${list.title}`,
      description: `**${playerName}** — ${item.name} at ${percent}%`,
    }).catch(() => {})
  }

  return { ok: true, status }
})
