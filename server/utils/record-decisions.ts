import type { DatabaseSync } from 'node:sqlite'
import { postLeaderboardUpdate } from '~/server/utils/leaderboard-discord'
import { logActivity } from '~/server/utils/activity-log'
import type { Account } from '~/server/utils/auth'

type Announcement = Parameters<typeof postLeaderboardUpdate>[1]

export type PendingRecordRow = {
  id: number
  level_id: number
  player_name: string
  is_verification_claim: number
}

/**
 * Approve one pending record: make it permanent, honour a verifier claim,
 * approve the rating sent with it, and announce it.
 *
 * One function for the single and the bulk approval. They were two copies, and
 * the bulk one never announced anything, so approving a submitter's ten
 * records at once posted none of them to Discord.
 */
export function approvePendingRecord(
  db: DatabaseSync,
  rec: PendingRecordRow,
  decider: Pick<Account, 'id' | 'username' | 'role'>,
  opts: { announce?: boolean; bulk?: boolean } = {},
): Announcement {
  const deciderId = decider.id
  db.prepare(
    `UPDATE records SET permanent = 1, decided_at = datetime('now'), decided_by = ? WHERE id = ?`,
  ).run(deciderId, rec.id)
  // Honour the verifier claim only if the level still has no verifier.
  if (rec.is_verification_claim) {
    db.prepare(
      `UPDATE levels SET verifier = ? WHERE id = ? AND (verifier IS NULL OR verifier = '')`,
    ).run(rec.player_name, rec.level_id)
  }
  // Approve any linked rating attached at submit time.
  db.prepare(
    `UPDATE opinions SET status = 'approved', decided_at = datetime('now'), decided_by = ?
      WHERE source_record_id = ? AND status = 'pending'`,
  ).run(deciderId, rec.id)

  const posted = db.prepare(`SELECT video, percent FROM records WHERE id = ?`).get(rec.id) as { video: string | null; percent: number | null } | undefined
  // The log's Records section promised "accepted, rejected and deleted" and
  // nothing ever wrote to it.
  const level = db.prepare(`SELECT name FROM levels WHERE id = ?`).get(rec.level_id) as { name: string } | undefined
  logActivity({
    kind: 'record.approve',
    area: 'records',
    actor: decider,
    subject: { kind: 'record', id: rec.id, label: `${rec.player_name} on ${level?.name ?? 'a level'}` },
    summary: `Approved ${rec.player_name}'s record on ${level?.name ?? 'a level'}${opts.bulk ? ' (approve all)' : ''}`,
    detail: { level_id: rec.level_id, percent: posted?.percent ?? null, verification: !!rec.is_verification_claim },
  }, db)
  const announcement: Announcement = {
    recordId: rec.id,
    playerName: rec.player_name,
    levelId: rec.level_id,
    videoUrl: posted?.video ?? null,
    percent: posted?.percent ?? null,
    isVerification: !!rec.is_verification_claim,
  }
  // Fire-and-forget leaderboard Discord notification.
  if (opts.announce !== false) postLeaderboardUpdate(db, announcement).catch(() => {})
  return announcement
}

/**
 * Announce a batch one post at a time, in the background. Sent all at once, a
 * submitter's twenty records ran straight into Discord's rate limit.
 */
export function announceInOrder(db: DatabaseSync, announcements: Announcement[]): void {
  void (async () => {
    for (const a of announcements) await postLeaderboardUpdate(db, a).catch(() => {})
  })()
}
