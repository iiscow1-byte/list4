import { getDb } from '~/server/db'
import { requireAdmin } from '~/server/utils/auth'
import { queuedDigest } from '~/server/utils/daily-discord'
import { withRoleMention } from '~/server/utils/discord'
import { samplePayload } from '~/server/utils/leaderboard-discord'

/** "Oct 12, 06:54 UTC" from SQLite's UTC timestamp. */
function utcLabel(ts: string): string {
  const d = new Date(`${ts.replace(' ', 'T')}Z`)
  return `${d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })} UTC`
}

/**
 * What a webhook would post, without posting it.
 *
 * For a digest: exactly what "Post now" would send, from the webhook's own
 * cursor to this moment. For record and level-status webhooks, which post one
 * event at a time: the newest real event, built the way it would be announced.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad id.' })
  }
  const db = getDb()
  const wh = db.prepare(`SELECT kind, mention_role_id FROM discord_webhooks WHERE id = ?`).get(id) as
    { kind: string; mention_role_id: string | null } | undefined
  if (!wh) throw createError({ statusCode: 404, statusMessage: 'Webhook not found.' })

  if (wh.kind === 'changes' || wh.kind === 'challenge_changes') {
    const q = queuedDigest(db, id)!
    return {
      kind: wh.kind,
      basis: q.window
        ? `Everything that changed since ${utcLabel(q.window.after)}, which this channel hasn’t been sent yet.`
        : 'Nothing since the last post.',
      changes: q.changes,
      payloads: q.payloads,
    }
  }

  if (wh.kind === 'leaderboard' || wh.kind === 'level_status') {
    const s = samplePayload(db, wh.kind)
    return {
      kind: wh.kind,
      basis: s?.basis ?? 'Nothing to build a sample from yet.',
      changes: null,
      payloads: s ? [withRoleMention(s.payload, wh.mention_role_id)] : [],
    }
  }

  return { kind: wh.kind, basis: 'This webhook’s kind isn’t one this version posts.', changes: null, payloads: [] }
})
