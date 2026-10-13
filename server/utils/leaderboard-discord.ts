import type { DatabaseSync } from 'node:sqlite'
import { computeDerivedStats } from '~/server/utils/leaderboard'
import { buildLeaderboardEmbed, buildLevelStatusEmbed, postToDiscordWebhook, SITE_URL, withRoleMention, type Payload } from '~/server/utils/discord'
import { recordDelivery } from '~/server/utils/discord-deliveries'

type WebhookRow = { id: number; url: string; mention_role_id: string | null }

/**
 * A development server never announces anything unless asked to, for the same
 * reason it never sends the digest: it is usually running on a copy of the
 * production database, with the production webhooks in it.
 */
function eventsEnabled(): boolean {
  return !(import.meta.dev && process.env.LIST_DAILY_DISCORD !== '1')
}

function webhooksOfKind(db: DatabaseSync, kind: string): WebhookRow[] {
  if (!eventsEnabled()) return []
  return db.prepare(`SELECT id, url, mention_role_id FROM discord_webhooks WHERE active = 1 AND kind = ?`).all(kind) as WebhookRow[]
}

/**
 * Record that an announcement is going out. False when the same one already
 * went out in the last day — a level sent to awaiting, returned and sent again,
 * or a double click on Approve, is announced once.
 */
function claimEvent(db: DatabaseSync, kind: string, key: string): boolean {
  db.prepare(`DELETE FROM discord_event_log WHERE posted_at < datetime('now', '-1 day')`).run()
  const res = db.prepare(`INSERT OR IGNORE INTO discord_event_log (kind, event_key) VALUES (?, ?)`).run(kind, key)
  return Number(res.changes) === 1
}

async function broadcast(db: DatabaseSync, webhooks: WebhookRow[], payload: Payload, what: string): Promise<void> {
  const setStatus = db.prepare(`UPDATE discord_webhooks SET last_post_status = ? WHERE id = ?`)
  await Promise.allSettled(webhooks.map(async (wh) => {
    const res = await postToDiscordWebhook(wh.url, withRoleMention(payload, wh.mention_role_id))
    setStatus.run(res.ok ? 'ok' : res.status.slice(0, 300), wh.id)
    recordDelivery(db, wh.id, what, res)
  }))
}

/**
 * The player's account here, if they have one: the account that claimed this
 * player, or else one with the same username. Its picture heads the post.
 */
function playerAccount(db: DatabaseSync, playerName: string): { username: string; hasAvatar: boolean } | null {
  const rows = db.prepare(
    `SELECT username, claimed_player, (avatar_blob IS NOT NULL) AS has_avatar
       FROM accounts
      WHERE banned_at IS NULL
        AND (claimed_player = ? COLLATE NOCASE OR username = ? COLLATE NOCASE)`,
  ).all(playerName, playerName) as { username: string; claimed_player: string | null; has_avatar: number }[]
  const hit = rows.find((r) => r.claimed_player?.toLowerCase() === playerName.toLowerCase()) ?? rows[0]
  return hit ? { username: hit.username, hasAvatar: !!hit.has_avatar } : null
}

type RecordAnnouncement = {
  recordId: number
  playerName: string
  levelId: number
  videoUrl: string | null
  percent?: number | null
  isVerification?: boolean
}

/** The post for one approved record. Shared by the announcement and the admin preview. */
export function leaderboardPayload(db: DatabaseSync, opts: Omit<RecordAnnouncement, 'recordId'>): Payload {
  const level = db.prepare(`SELECT name, position, gd_id, points, gddl_tier FROM levels WHERE id = ?`).get(opts.levelId) as
    { name: string; position: number; gd_id: number | null; points: number | null; gddl_tier: string | null } | undefined
  const playerTotal = computeDerivedStats(db, opts.playerName)?.total_points ?? null
  const account = playerAccount(db, opts.playerName)

  return buildLeaderboardEmbed({
    playerName: opts.playerName,
    playerUsername: account?.username ?? null,
    playerAvatarUrl: account?.hasAvatar && SITE_URL ? `${SITE_URL}/api/users/${encodeURIComponent(account.username)}/avatar` : null,
    levelName: level?.name ?? 'Unknown level',
    levelPosition: level?.position ?? null,
    levelGdId: level?.gd_id ?? null,
    levelTier: level?.gddl_tier ?? null,
    levelPoints: level?.points ?? null,
    playerTotal,
    percent: opts.percent ?? null,
    videoUrl: opts.videoUrl,
    isVerification: opts.isVerification,
  })
}

/** A record was approved. Fire-and-forget. */
export async function postLeaderboardUpdate(db: DatabaseSync, opts: RecordAnnouncement): Promise<void> {
  const webhooks = webhooksOfKind(db, 'leaderboard')
  if (!webhooks.length || !claimEvent(db, 'leaderboard', `record:${opts.recordId}`)) return
  const level = db.prepare(`SELECT name FROM levels WHERE id = ?`).get(opts.levelId) as { name: string } | undefined
  await broadcast(db, webhooks, leaderboardPayload(db, opts), `Record: ${opts.playerName} on ${level?.name ?? 'a level'}`)
}

/** A level was sent to Awaiting Placement or the void list. Fire-and-forget. */
export async function postLevelStatusUpdate(
  db: DatabaseSync,
  opts: {
    destination: 'awaiting' | 'void'
    levelName: string
    gdId?: number | null
    gddlTier: string | null
    difficulty: string | null
    submitter: string | null
    verificationUrl: string | null
    awaitingId?: number | null
    voidPosition?: number | null
  },
): Promise<void> {
  const webhooks = webhooksOfKind(db, 'level_status')
  const key = `${opts.destination}:${opts.gdId ?? opts.levelName.toLowerCase()}`
  if (!webhooks.length || !claimEvent(db, 'level_status', key)) return
  await broadcast(db, webhooks, buildLevelStatusEmbed(opts), `${opts.destination === 'awaiting' ? 'Awaiting' : 'Void'}: ${opts.levelName}`)
}

/**
 * What a records or level-status webhook posts, built from the newest real
 * event when there is one, for the admin preview. Null when there is nothing to
 * build it from.
 */
export function samplePayload(db: DatabaseSync, kind: 'leaderboard' | 'level_status'): { payload: Payload; basis: string } | null {
  if (kind === 'leaderboard') {
    const r = db.prepare(
      `SELECT r.id, r.player_name, r.level_id, r.video, r.percent, r.is_verification_claim, l.name AS level_name
         FROM records r JOIN levels l ON l.id = r.level_id
        WHERE r.permanent = 1
        ORDER BY COALESCE(r.decided_at, r.submitted_at) DESC, r.id DESC
        LIMIT 1`,
    ).get() as { id: number; player_name: string; level_id: number; video: string | null; percent: number; is_verification_claim: number; level_name: string } | undefined
    if (!r) return null
    return {
      basis: `The newest approved record: ${r.player_name} on ${r.level_name}.`,
      payload: leaderboardPayload(db, {
        playerName: r.player_name, levelId: r.level_id, videoUrl: r.video,
        percent: r.percent, isVerification: !!r.is_verification_claim,
      }),
    }
  }
  const a = db.prepare(
    `SELECT id, gd_id, name, gddl_tier, difficulty, submitter, verification_url
       FROM awaiting_levels ORDER BY approved_at DESC, id DESC LIMIT 1`,
  ).get() as { id: number; gd_id: number | null; name: string; gddl_tier: string | null; difficulty: string | null; submitter: string | null; verification_url: string | null } | undefined
  if (!a) return null
  return {
    basis: `The newest level awaiting placement: ${a.name}.`,
    payload: buildLevelStatusEmbed({
      destination: 'awaiting', levelName: a.name, gdId: a.gd_id, gddlTier: a.gddl_tier,
      difficulty: a.difficulty, submitter: a.submitter, verificationUrl: a.verification_url, awaitingId: a.id,
    }),
  }
}
