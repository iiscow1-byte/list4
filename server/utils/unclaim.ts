import type { DatabaseSync } from 'node:sqlite'
import {
  releaseClaimedRecords, renameClaimedRecords,
  type ClaimSource,
} from './claim-records'

/**
 * Letting go of a claimed account.
 *
 * A claim binds three things: a column on the account, a back-reference on the
 * mirrored player, and the records the claim copied onto the ALL profile.
 * Releasing has to undo all three or the next claim of that player is refused
 * by a row nobody can see. Shared between the user's own "unclaim" and the
 * admin one, because those differ only in who is allowed to ask.
 *
 * The mirrored records themselves are never touched. AREDL's copy of your
 * completion is AREDL's; unclaiming says "don't show these as mine", not
 * "delete these".
 */

/** Every kind of claim, including the ALL leaderboard name (no mirror table). */
export type ClaimKind = ClaimSource | 'player'

export const CLAIM_KINDS: ClaimKind[] = ['player', 'aredl', 'gdl', 'pointercrate']

export function isClaimKind(v: unknown): v is ClaimKind {
  return typeof v === 'string' && (CLAIM_KINDS as string[]).includes(v)
}

export const CLAIM_KIND_LABELS: Record<ClaimKind, string> = {
  player: 'the ALL leaderboard player',
  aredl: 'the AREDL player',
  gdl: 'the GDL player',
  pointercrate: 'the Pointercrate player',
}

export type UnclaimResult = {
  kind: ClaimKind
  /** False when the account had no such claim to begin with. */
  released: boolean
  /** What was let go of, for the confirmation message. */
  name: string | null
  /** Records removed from the profile. They still exist on the source list. */
  records_removed: number
}

const MIRROR: Record<ClaimSource, { accountCol: string; table: string; keyCol: string; nameCol: string }> = {
  aredl: {
    accountCol: 'claimed_aredl_uuid', table: 'aredl_players',
    keyCol: 'uuid', nameCol: 'global_name',
  },
  gdl: {
    accountCol: 'claimed_gdl_id', table: 'gdl_players',
    keyCol: 'gdl_id', nameCol: 'username',
  },
  pointercrate: {
    accountCol: 'claimed_pointercrate_id', table: 'pointercrate_players',
    keyCol: 'pc_id', nameCol: 'name',
  },
}

export function unclaim(db: DatabaseSync, accountId: number, kind: ClaimKind): UnclaimResult {
  if (kind === 'player') {
    const acc = db.prepare(
      `SELECT username, claimed_player FROM accounts WHERE id = ?`,
    ).get(accountId) as { username: string; claimed_player: string | null } | undefined
    if (!acc?.claimed_player) {
      return { kind, released: false, name: null, records_removed: 0 }
    }
    db.exec('BEGIN')
    try {
      db.prepare(`UPDATE accounts SET claimed_player = NULL WHERE id = ?`).run(accountId)
      // The profile reads under the username again, so the records other claims
      // put here follow it back. Hand-submitted records keep the name they were
      // submitted under — those describe a player, not this account.
      renameClaimedRecords(db, accountId, acc.username)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    return { kind, released: true, name: acc.claimed_player, records_removed: 0 }
  }

  const m = MIRROR[kind]
  const acc = db.prepare(
    `SELECT ${m.accountCol} AS key FROM accounts WHERE id = ?`,
  ).get(accountId) as { key: string | number | null } | undefined
  if (!acc || acc.key == null) {
    return { kind, released: false, name: null, records_removed: 0 }
  }

  const name = (db.prepare(
    `SELECT ${m.nameCol} AS name FROM ${m.table} WHERE ${m.keyCol} = ?`,
  ).get(acc.key) as { name: string } | undefined)?.name ?? null

  let removed = 0
  db.exec('BEGIN')
  try {
    db.prepare(`UPDATE accounts SET ${m.accountCol} = NULL WHERE id = ?`).run(accountId)
    db.prepare(
      `UPDATE ${m.table} SET claimed_account_id = NULL WHERE ${m.keyCol} = ? AND claimed_account_id = ?`,
    ).run(acc.key, accountId)
    removed = releaseClaimedRecords(db, accountId, kind)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return { kind, released: true, name, records_removed: removed }
}
