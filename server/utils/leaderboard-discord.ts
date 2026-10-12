import type { DatabaseSync } from 'node:sqlite'
import { computeDerivedStats } from '~/server/utils/leaderboard'
import { buildLeaderboardEmbed, buildLevelStatusEmbed, postToDiscordWebhook, SITE_URL } from '~/server/utils/discord'

type WebhookRow = { id: number; url: string }

function webhooksOfKind(db: DatabaseSync, kind: string): WebhookRow[] {
  return db.prepare(`SELECT id, url FROM discord_webhooks WHERE active = 1 AND kind = ?`).all(kind) as WebhookRow[]
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

async function broadcast(db: DatabaseSync, webhooks: WebhookRow[], payload: object): Promise<void> {
  const setStatus = db.prepare(`UPDATE discord_webhooks SET last_post_status = ? WHERE id = ?`)
  await Promise.allSettled(webhooks.map(async (wh) => {
    const res = await postToDiscordWebhook(wh.url, payload)
    setStatus.run(res.ok ? 'ok' : res.status.slice(0, 300), wh.id)
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

/** A record was approved. Fire-and-forget. */
export async function postLeaderboardUpdate(
  db: DatabaseSync,
  opts: { recordId: number; playerName: string; levelId: number; videoUrl: string | null; percent?: number | null; isVerification?: boolean },
): Promise<void> {
  const webhooks = webhooksOfKind(db, 'leaderboard')
  if (!webhooks.length || !claimEvent(db, 'leaderboard', `record:${opts.recordId}`)) return

  const level = db.prepare(`SELECT name, position, gd_id, points, gddl_tier FROM levels WHERE id = ?`).get(opts.levelId) as
    { name: string; position: number; gd_id: number | null; points: number | null; gddl_tier: string | null } | undefined
  const playerTotal = computeDerivedStats(db, opts.playerName)?.total_points ?? null
  const account = playerAccount(db, opts.playerName)

  await broadcast(db, webhooks, buildLeaderboardEmbed({
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
  }))
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
  await broadcast(db, webhooks, buildLevelStatusEmbed(opts))
}
