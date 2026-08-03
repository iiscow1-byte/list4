import type { DatabaseSync } from 'node:sqlite'

/**
 * Records that come with a claimed account.
 *
 * Claiming an AREDL player is a statement that the player is you. The site
 * already knew everything that player had beaten — it mirrors AREDL's records
 * — and went on showing your ALL profile as empty anyway, because a record only
 * counts here if it is a row in `records` under your name. Approving a claim now
 * writes those rows.
 *
 * They are marked, not merged. `claim_source` says which claim produced a row
 * and `claim_account_id` says whose, so releasing the claim can take back
 * exactly what the claim gave and nothing else: records submitted here by hand
 * are untouched, and the mirror they were copied from is untouched too. That is
 * what "removed from your profile but they still exist" has to mean — the
 * AREDL record was never ours to delete.
 *
 * Levels the ALL doesn't carry are skipped, as are GD ids that resolve to more
 * than one row here (Solo/2P and Old/Unnerfed variants legitimately share one):
 * a record filed against the wrong variant is worse than a missing one.
 */

export type ClaimSource = 'aredl' | 'gdl' | 'pointercrate'

export const CLAIM_SOURCE_LABELS: Record<ClaimSource, string> = {
  aredl: 'AREDL',
  gdl: 'GDL',
  pointercrate: 'Pointercrate',
}

type SourceSpec = {
  /** Mirror table holding that site's records. */
  table: string
  /** Column identifying the player within that table. */
  playerCol: string
  /** Column holding the completion percentage, when the mirror tracks one. */
  percentCol: string | null
  /** Column holding the proof link. */
  videoCol: string
  /** Extra WHERE clauses — AREDL flags records whose video is hidden. */
  where: string[]
}

const SOURCES: Record<ClaimSource, SourceSpec> = {
  aredl: {
    table: 'aredl_records',
    playerCol: 'player_uuid',
    // AREDL only records completions; there is no partial-progress column.
    percentCol: null,
    videoCol: 'video_url',
    where: [],
  },
  gdl: {
    table: 'gdl_records',
    playerCol: 'player_gdl_id',
    percentCol: 'percent',
    videoCol: 'video_url',
    where: [],
  },
  pointercrate: {
    table: 'pointercrate_records',
    playerCol: 'player_pc_id',
    percentCol: 'progress',
    videoCol: 'video',
    where: [],
  },
}

export type AdoptResult = {
  source: ClaimSource
  /** Rows written to `records`. */
  added: number
  /** Mirror rows whose level this list doesn't carry, or can't tell apart. */
  skipped_no_level: number
  /** Mirror rows where a record already stood under this name. */
  skipped_existing: number
}

/** The name a claimed account's records file under: its site identity. */
export function accountPlayerName(
  db: DatabaseSync,
  accountId: number,
): string | null {
  const row = db.prepare(
    `SELECT username, claimed_player FROM accounts WHERE id = ?`,
  ).get(accountId) as { username: string; claimed_player: string | null } | undefined
  if (!row) return null
  return row.claimed_player ?? row.username
}

/**
 * Copy one claimed player's mirrored records onto their ALL profile.
 *
 * `playerKey` is whatever identifies them on that site — an AREDL uuid, a GDL
 * or Pointercrate numeric id. Safe to run twice: rows this claim already wrote
 * are recognised by their marks and counted as existing rather than duplicated.
 */
export function adoptClaimedRecords(
  db: DatabaseSync,
  accountId: number,
  source: ClaimSource,
  playerKey: string | number,
): AdoptResult {
  const spec = SOURCES[source]
  const playerName = accountPlayerName(db, accountId)
  const result: AdoptResult = { source, added: 0, skipped_no_level: 0, skipped_existing: 0 }
  if (!playerName) return result

  const percent = spec.percentCol ? spec.percentCol : '100'
  const rows = db.prepare(
    `SELECT level_gd_id, ${spec.videoCol} AS video, ${percent} AS percent,
            is_verification
       FROM ${spec.table}
      WHERE ${spec.playerCol} = ?
        ${spec.where.length ? 'AND ' + spec.where.join(' AND ') : ''}`,
  ).all(playerKey) as {
    level_gd_id: number | null; video: string | null
    percent: number | null; is_verification: number
  }[]
  if (!rows.length) return result

  // One pass over the ALL's gd ids rather than a query per mirror row: a busy
  // player has hundreds of records and the list has tens of thousands of levels.
  const levelsByGd = new Map<number, number[]>()
  for (const l of db.prepare(
    `SELECT id, gd_id FROM levels WHERE gd_id IS NOT NULL`,
  ).all() as { id: number; gd_id: number }[]) {
    const bucket = levelsByGd.get(l.gd_id)
    if (bucket) bucket.push(l.id)
    else levelsByGd.set(l.gd_id, [l.id])
  }

  const already = new Set(
    (db.prepare(
      `SELECT level_id FROM records WHERE player_name = ? COLLATE NOCASE`,
    ).all(playerName) as { level_id: number }[]).map((r) => r.level_id),
  )

  const ins = db.prepare(
    `INSERT INTO records
       (level_id, player_name, percent, video, permanent, submitted_by,
        submitted_at, decided_at, decided_by, is_verification_claim,
        claim_source, claim_account_id)
     VALUES (?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'), ?, ?, ?, ?)`,
  )

  db.exec('BEGIN')
  try {
    for (const r of rows) {
      if (r.level_gd_id == null) { result.skipped_no_level++; continue }
      const candidates = levelsByGd.get(r.level_gd_id)
      if (!candidates || candidates.length !== 1) { result.skipped_no_level++; continue }
      const levelId = candidates[0]!
      if (already.has(levelId)) { result.skipped_existing++; continue }

      const pct = Math.max(1, Math.min(100, Math.round(Number(r.percent ?? 100)) || 100))
      ins.run(
        levelId, playerName, pct, r.video ?? null, accountId, accountId,
        r.is_verification ? 1 : 0, source, accountId,
      )
      already.add(levelId)
      result.added++
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return result
}

/**
 * Take back what a claim gave.
 *
 * Only rows this claim wrote — a record the person submitted here themselves
 * stays, because they submitted it. The mirror keeps its copy either way, so
 * re-claiming later restores the same set.
 */
export function releaseClaimedRecords(
  db: DatabaseSync,
  accountId: number,
  source: ClaimSource,
): number {
  const res = db.prepare(
    `DELETE FROM records WHERE claim_source = ? AND claim_account_id = ?`,
  ).run(source, accountId)
  return Number(res.changes)
}

/** How many records an account currently holds from each claim. */
export function claimedRecordCounts(
  db: DatabaseSync,
  accountId: number,
): Record<ClaimSource, number> {
  const out: Record<ClaimSource, number> = { aredl: 0, gdl: 0, pointercrate: 0 }
  for (const r of db.prepare(
    `SELECT claim_source AS source, COUNT(*) AS n
       FROM records WHERE claim_account_id = ? AND claim_source IS NOT NULL
      GROUP BY claim_source`,
  ).all(accountId) as { source: ClaimSource; n: number }[]) {
    if (r.source in out) out[r.source] = r.n
  }
  return out
}

/**
 * Follow a renamed identity.
 *
 * Records are found by name, so an account that later claims a leaderboard
 * player — or drops that claim — changes which name its profile reads under.
 * The rows a claim wrote belong to the account, not to the spelling, so they
 * move with it. Records the person submitted by hand keep the name they were
 * submitted under; those are statements about a player, not about an account.
 */
export function renameClaimedRecords(
  db: DatabaseSync,
  accountId: number,
  newName: string,
): number {
  const res = db.prepare(
    `UPDATE records SET player_name = ?
      WHERE claim_account_id = ? AND claim_source IS NOT NULL AND player_name != ?`,
  ).run(newName, accountId, newName)
  return Number(res.changes)
}

/** The claim keys an account currently holds, for the sources that have them. */
export function claimKeysFor(
  db: DatabaseSync,
  accountId: number,
): Partial<Record<ClaimSource, string | number>> {
  const row = db.prepare(
    `SELECT claimed_aredl_uuid, claimed_gdl_id, claimed_pointercrate_id
       FROM accounts WHERE id = ?`,
  ).get(accountId) as {
    claimed_aredl_uuid: string | null
    claimed_gdl_id: number | null
    claimed_pointercrate_id: number | null
  } | undefined
  if (!row) return {}
  const out: Partial<Record<ClaimSource, string | number>> = {}
  if (row.claimed_aredl_uuid) out.aredl = row.claimed_aredl_uuid
  if (row.claimed_gdl_id != null) out.gdl = row.claimed_gdl_id
  if (row.claimed_pointercrate_id != null) out.pointercrate = row.claimed_pointercrate_id
  return out
}
