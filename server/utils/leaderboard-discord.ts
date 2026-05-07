import type { DatabaseSync } from 'node:sqlite'
import { computeDerivedStats } from '~/server/utils/leaderboard'
import { buildLeaderboardEmbed, buildLevelStatusEmbed, postToDiscordWebhook } from '~/server/utils/discord'

type WebhookRow = { id: number; url: string }

function webhooksOfKind(db: DatabaseSync, kind: string): WebhookRow[] {
  return db.prepare(
    `SELECT id, url FROM discord_webhooks WHERE active = 1 AND kind = ?`,
  ).all(kind) as WebhookRow[]
}

async function broadcast(webhooks: WebhookRow[], payload: object): Promise<void> {
  await Promise.allSettled(
    webhooks.map((wh) => postToDiscordWebhook(wh.url, payload).catch(() => {})),
  )
}

/**
 * Post a leaderboard-update embed when a record is approved. Safe to call
 * fire-and-forget (errors are swallowed — Discord posts are best-effort).
 */
export async function postLeaderboardUpdate(
  db: DatabaseSync,
  opts: {
    playerName: string
    levelId: number
    videoUrl: string | null
    isVerification?: boolean
  },
): Promise<void> {
  const webhooks = webhooksOfKind(db, 'leaderboard')
  if (!webhooks.length) return

  const level = db.prepare(
    `SELECT name, position, points FROM levels WHERE id = ?`,
  ).get(opts.levelId) as { name: string; position: number; points: number | null } | undefined

  // Compute total from the live records table so the just-approved record is
  // already included (it was set permanent=1 before this call).
  const derived = computeDerivedStats(db, opts.playerName)
  const playerTotal = derived?.total_points ?? null

  const payload = buildLeaderboardEmbed({
    playerName: opts.playerName,
    levelName: level?.name ?? 'Unknown level',
    levelPosition: level?.position ?? null,
    levelPoints: level?.points ?? null,
    playerTotal,
    videoUrl: opts.videoUrl,
    isVerification: opts.isVerification,
  })

  await broadcast(webhooks, payload)
}

/**
 * Post a level-status embed when a level is sent to Awaiting Placement or
 * the Void list. Safe to call fire-and-forget.
 */
export async function postLevelStatusUpdate(
  db: DatabaseSync,
  opts: {
    destination: 'awaiting' | 'void'
    levelName: string
    gddlTier: string | null
    difficulty: string | null
    submitter: string | null
    verificationUrl: string | null
    awaitingId?: number | null
    voidPosition?: number | null
  },
): Promise<void> {
  const webhooks = webhooksOfKind(db, 'level_status')
  if (!webhooks.length) return

  const payload = buildLevelStatusEmbed(opts)
  await broadcast(webhooks, payload)
}
