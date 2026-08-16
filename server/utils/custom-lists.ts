import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { pointsForRank } from './custom-list-scoring'
import { firstProfanity } from '~/utils/profanity'

export const MAX_ITEMS = 250
export const MAX_LISTS_PER_USER = 50

export type CustomListItemInput = {
  /** Existing custom_list_items.id — set for rows already on the list. */
  id?: number | null
  level_id?: number | null
  name?: string | null
  gd_id?: number | null
  creator?: string | null
  difficulty?: string | null
  gddl_tier?: string | null
  verification_url?: string | null
  notes?: string | null
  verifier?: string | null
  percent_to_qualify?: number | null
  fps?: string | null
  game_version?: string | null
  /** The list's own call on whether this row is a challenge. */
  is_challenge?: boolean | number | null
  /** Nobody has verified this level yet — it cannot be cleared by anyone. */
  unverified?: boolean | number | null
}

/** Short, non-enumerable share token. */
export function newPublicId(): string {
  return randomBytes(8).toString('base64url')
}

/**
 * Find the ALL level a hand-entered custom-list row is really about, so the row
 * can follow the main list instead of drifting from it.
 *
 * Deliberately conservative: a wrong link silently replaces the row's name,
 * creator and video with another level's, which is worse than no link at all.
 * A `gd_id` is *not* unique in `levels` — Solo/2P and Old/Unnerfed variants
 * legitimately share one — so a match only counts when it resolves to exactly
 * one row, or when the name breaks the tie.
 *
 * @returns the `levels.id` to link to, or null to leave the row hand-entered.
 */
export function resolveAllLevel(
  db: DatabaseSync,
  opts: { gdId?: number | null; name?: string | null },
): number | null {
  const gdId = Number(opts.gdId)
  const name = (opts.name ?? '').trim()

  if (Number.isInteger(gdId) && gdId > 0) {
    const byGd = db.prepare(`SELECT id, name FROM levels WHERE gd_id = ?`)
      .all(gdId) as { id: number; name: string }[]
    if (byGd.length === 1) return byGd[0]!.id
    if (byGd.length > 1 && name) {
      // Several variants share this id — let the name pick one, but only if it
      // picks exactly one.
      const exact = byGd.filter((r) => r.name.toLowerCase() === name.toLowerCase())
      if (exact.length === 1) return exact[0]!.id
    }
    // An ambiguous id with no tie-breaker: better hand-entered than wrong.
    if (byGd.length > 1) return null
  }

  if (name) {
    const byName = db.prepare(
      `SELECT id FROM levels WHERE name = ? COLLATE NOCASE LIMIT 2`,
    ).all(name) as { id: number }[]
    if (byName.length === 1) return byName[0]!.id
  }

  return null
}

function clean(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  return s.slice(0, max)
}

/**
 * Reconcile a list's items against `items`, in array order. Items that name an
 * ALL level (`level_id`) get their display fields re-read from `levels` so a
 * saved list always shows current data; hand-entered items keep what the
 * client sent. Rows past MAX_ITEMS are dropped.
 *
 * Rows are matched to existing ones (by id, then by linked level, then by
 * name+gd_id) and *updated* rather than recreated. Records hang off
 * `custom_list_items.id` with ON DELETE CASCADE, so a delete-and-reinsert
 * would silently wipe every record on the list each time someone dragged a
 * row. Only items genuinely removed from the list are deleted.
 */
export function replaceItems(
  db: DatabaseSync,
  listId: number,
  items: CustomListItemInput[],
  actorId: number | null = null,
): number {
  const getLevel = db.prepare(
    `SELECT id, name, gd_id, creator, difficulty, gddl_tier, verification_url FROM levels WHERE id = ?`,
  )
  const ins = db.prepare(`
    INSERT INTO custom_list_items
      (list_id, sort_order, level_id, name, gd_id, creator, difficulty, gddl_tier,
       verification_url, notes, verifier, percent_to_qualify, fps, game_version, is_challenge,
       unverified)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `)
  const upd = db.prepare(`
    UPDATE custom_list_items
       SET sort_order = ?, level_id = ?, name = ?, gd_id = ?, creator = ?, difficulty = ?,
           gddl_tier = ?, verification_url = ?, notes = ?, verifier = ?,
           percent_to_qualify = ?, fps = ?, game_version = ?, is_challenge = ?,
           unverified = ?
     WHERE id = ? AND list_id = ?
  `)

  const existing = db.prepare(
    `SELECT id, level_id, name, gd_id, sort_order FROM custom_list_items WHERE list_id = ?`,
  ).all(listId) as
    { id: number; level_id: number | null; name: string; gd_id: number | null; sort_order: number }[]

  // Ranks before this save, so the changelog can describe the difference
  // rather than restating the whole list.
  const rankBefore = new Map(existing.map((e) => [e.id, e.sort_order]))

  const byId = new Map(existing.map((e) => [e.id, e]))
  const byLevel = new Map<number, number>()
  const byNameGd = new Map<string, number>()
  for (const e of existing) {
    if (e.level_id != null && !byLevel.has(e.level_id)) byLevel.set(e.level_id, e.id)
    const k = `${e.gd_id ?? ''}|${e.name.toLowerCase()}`
    if (!byNameGd.has(k)) byNameGd.set(k, e.id)
  }

  type PendingChange = {
    itemId: number | null
    name: string
    kind: 'add' | 'move' | 'remove'
    from: number | null
    to: number | null
  }
  const changes: PendingChange[] = []
  const keptIds = new Set<number>()
  let n = 0

  for (const raw of items.slice(0, MAX_ITEMS)) {
    const levelId = Number(raw?.level_id)
    let linked = Number.isInteger(levelId) && levelId > 0
      ? (getLevel.get(levelId) as any | undefined)
      : undefined

    /**
     * A linked level takes every display field from `levels` — including its
     * NULLs — so a saved list can never disagree with the ALL list about a
     * level it points at. Only hand-entered items use the client's values.
     * `notes` is always the user's; that's what it's for.
     */
    const fieldsFor = (lv: any | undefined) => lv
      ? {
          name: lv.name as string,
          gd_id: lv.gd_id as number | null,
          creator: lv.creator as string | null,
          difficulty: lv.difficulty as string | null,
          gddl_tier: lv.gddl_tier as string | null,
          verification_url: lv.verification_url as string | null,
        }
      : {
          name: clean(raw?.name),
          gd_id: Number.isInteger(Number(raw?.gd_id)) ? Number(raw?.gd_id) : null,
          creator: clean(raw?.creator),
          difficulty: clean(raw?.difficulty, 60),
          gddl_tier: clean(raw?.gddl_tier, 40),
          verification_url: clean(raw?.verification_url, 500),
        }

    let fields = fieldsFor(linked)
    if (!fields.name) continue // an item with no name at all is not renderable

    // A level's *name* is never checked — those are real level names, and one
    // of the lists this site mirrors is literally called "The Shitty List".
    // A note is the editor's own prose, and is.
    const note = clean(raw?.notes, 500)
    const badNote = firstProfanity(note)
    if (badNote) {
      throw createError({
        statusCode: 400,
        statusMessage: `The note on "${fields.name}" can't contain "${badNote}".`,
      })
    }

    const ptq = Number(raw?.percent_to_qualify)
    const listMeta = [
      clean(raw?.verifier, 200),
      Number.isFinite(ptq) ? Math.max(1, Math.min(100, Math.round(ptq))) : 100,
      clean(raw?.fps, 40),
      clean(raw?.game_version, 40),
      raw?.is_challenge ? 1 : 0,
      raw?.unverified ? 1 : 0,
    ] as const

    // Find the row this entry corresponds to, if any.
    const claimedId = Number(raw?.id)
    let matchId: number | undefined
    if (Number.isInteger(claimedId) && byId.has(claimedId) && !keptIds.has(claimedId)) {
      matchId = claimedId
    } else if (linked?.id != null && byLevel.has(linked.id) && !keptIds.has(byLevel.get(linked.id)!)) {
      matchId = byLevel.get(linked.id)
    } else {
      const k = `${fields.gd_id ?? ''}|${fields.name.toLowerCase()}`
      const candidate = byNameGd.get(k)
      if (candidate != null && !keptIds.has(candidate)) matchId = candidate
    }

    // A brand-new row the client didn't link — typed in by hand, or copied from
    // a mirror — still usually *is* a level on the ALL list. Adopt it when it
    // can be identified unambiguously, so it follows the main list for its
    // name, creator and video instead of going stale on its own.
    //
    // Only new rows: an existing row that someone deliberately unlinked would
    // otherwise be re-adopted by the very next save, making "unlink" impossible
    // to keep.
    if (!linked && matchId == null) {
      const guess = resolveAllLevel(db, { gdId: fields.gd_id, name: fields.name })
      if (guess != null) {
        linked = getLevel.get(guess) as any | undefined
        if (linked) fields = fieldsFor(linked)
      }
    }

    if (matchId != null) {
      upd.run(
        n, linked?.id ?? null, fields.name, fields.gd_id, fields.creator, fields.difficulty,
        fields.gddl_tier, fields.verification_url, note,
        ...listMeta, matchId, listId,
      )
      keptIds.add(matchId)
      const was = rankBefore.get(matchId)
      if (was != null && was !== n) {
        changes.push({ itemId: matchId, name: fields.name, kind: 'move', from: was + 1, to: n + 1 })
      }
    } else {
      const newId = Number(ins.run(
        listId, n, linked?.id ?? null, fields.name, fields.gd_id, fields.creator,
        fields.difficulty, fields.gddl_tier, fields.verification_url, note,
        ...listMeta,
      ).lastInsertRowid)
      changes.push({ itemId: newId, name: fields.name, kind: 'add', from: null, to: n + 1 })
    }
    n++
  }

  const del = db.prepare(`DELETE FROM custom_list_items WHERE id = ?`)
  for (const e of existing) {
    if (keptIds.has(e.id)) continue
    changes.push({ itemId: null, name: e.name, kind: 'remove', from: e.sort_order + 1, to: null })
    del.run(e.id)
  }

  recordListChanges(db, listId, changes, actorId)
  return n
}

/**
 * Append changelog rows for a save. Skipped entirely for a list's first save —
 * "every level was added" is the list being created, not a change worth
 * reading — and capped so one big reorder can't bury everything before it.
 */
const MAX_CHANGES_PER_SAVE = 60

function recordListChanges(
  db: DatabaseSync,
  listId: number,
  changes: {
    itemId: number | null
    name: string
    kind: 'add' | 'move' | 'remove'
    from: number | null
    to: number | null
  }[],
  actorId: number | null,
): void {
  if (!changes.length) return

  const alreadyLogged = (db.prepare(
    `SELECT COUNT(*) AS n FROM custom_list_changes WHERE list_id = ?`,
  ).get(listId) as { n: number }).n
  const everSaved = alreadyLogged > 0
    || (db.prepare(`SELECT COUNT(*) AS n FROM custom_list_records WHERE list_id = ?`)
          .get(listId) as { n: number }).n > 0
  // A brand-new list logs nothing; from its second save on, everything counts.
  if (!everSaved && changes.every((c) => c.kind === 'add')) return

  const ins = db.prepare(
    `INSERT INTO custom_list_changes
       (list_id, item_id, level_name, kind, from_rank, to_rank, changed_by)
     VALUES (?,?,?,?,?,?,?)`,
  )
  for (const c of changes.slice(0, MAX_CHANGES_PER_SAVE)) {
    ins.run(listId, c.itemId, c.name, c.kind, c.from, c.to, actorId)
  }
}

/**
 * A list plus its items, shaped for the client. Each item carries the points
 * its rank is worth and its approved records, so a custom list renders as a
 * complete list site rather than just an ordered set of names.
 */
export function loadList(db: DatabaseSync, listId: number) {
  const list = db.prepare(
    `SELECT cl.id, cl.public_id, cl.title, cl.description, cl.created_at, cl.updated_at,
            cl.owner_account_id, cl.is_public, cl.likes, cl.copied_from_id,
            cl.accepts_records, cl.max_points, cl.min_points, cl.scored_count,
            cl.icon_url, cl.accent_color, cl.banner_url, cl.follow_all_order,
            cl.accepts_submissions, cl.require_record_video, cl.mark_off_all,
            cl.show_banner, cl.show_thumbnails, cl.show_points, cl.show_records,
            cl.compact_rows, cl.show_editors,
            cl.show_tier, cl.show_difficulty, cl.show_level_links, cl.name_display,
            cl.discord_url, cl.youtube_url, cl.kind,
            a.username AS owner_username,
            src.public_id AS copied_from_public_id, src.title AS copied_from_title
       FROM custom_lists cl
       LEFT JOIN accounts a ON a.id = cl.owner_account_id
       LEFT JOIN custom_lists src ON src.id = cl.copied_from_id
      WHERE cl.id = ?`,
  ).get(listId) as any | undefined
  if (!list) return null

  /**
   * `position` is the linked level's *current* ALL placement, resolved at read
   * time so a saved list follows the level when it moves.
   *
   * The `ov_` columns are this list's own answers, and win where they're set.
   * They're returned alongside the effective value rather than instead of the
   * mirrored one, so the editor can show both — "the ALL says X, this list says
   * Y" — and clearing an override is a visible act rather than guesswork.
   */
  const items = db.prepare(
    `SELECT i.id, i.sort_order, i.level_id, i.gd_id, i.notes, i.verifier,
            i.percent_to_qualify, i.fps, i.game_version, i.is_challenge, i.unverified,
            COALESCE(i.ov_name, i.name)                         AS name,
            COALESCE(i.ov_creator, i.creator)                   AS creator,
            COALESCE(i.ov_difficulty, i.difficulty)             AS difficulty,
            COALESCE(i.ov_gddl_tier, i.gddl_tier)               AS gddl_tier,
            COALESCE(i.ov_verification_url, i.verification_url) AS verification_url,
            i.name AS all_name, i.creator AS all_creator, i.difficulty AS all_difficulty,
            i.gddl_tier AS all_gddl_tier, i.verification_url AS all_verification_url,
            i.ov_name, i.ov_creator, i.ov_difficulty, i.ov_gddl_tier, i.ov_verification_url,
            l.position, l.sheet_placement
       FROM custom_list_items i
       LEFT JOIN levels l ON l.id = i.level_id
      WHERE i.list_id = ?
      ORDER BY i.sort_order ASC, i.id ASC`,
  ).all(listId) as any[]

  /**
   * "Follow the ALL's order": rank by each level's current ALL placement rather
   * than by the stored order. Done here rather than by rewriting `sort_order`
   * so the list keeps tracking the ALL as it changes, and so turning the option
   * off restores the hand-made order untouched.
   *
   * Levels the ALL doesn't have can't be placed by it, so they keep their
   * relative order and sit at the bottom — the alternative is inventing a
   * position for them, which would be a guess presented as fact.
   */
  if (list.follow_all_order) {
    items.sort((a, b) => {
      const ap = a.position ?? null
      const bp = b.position ?? null
      if (ap == null && bp == null) return a.sort_order - b.sort_order
      if (ap == null) return 1
      if (bp == null) return -1
      return ap - bp
    })
  }

  // The clan joins through the submitting account: a custom list's records are
  // submitted by a site account, so that account's clan is the one to print.
  const recordsByItem = db.prepare(
    `SELECT r.id, r.item_id, r.player_name, r.percent, r.hz, r.video, r.mobile,
            a.username AS account_username,
            cl.tag AS clan_tag, cl.name AS clan_name, cl.color AS clan_color
       FROM custom_list_records r
       LEFT JOIN accounts a ON a.id = r.submitted_by
       LEFT JOIN clan_members cm ON cm.account_id = a.id
       LEFT JOIN clans        cl ON cl.id = cm.clan_id
      WHERE r.list_id = ? AND r.status = 'approved'
      ORDER BY r.percent DESC, r.player_name COLLATE NOCASE ASC`,
  ).all(listId).map((r: any) => ({
    ...r,
    clan: r.clan_tag ? { tag: r.clan_tag, name: r.clan_name, color: r.clan_color } : null,
  })) as any[]

  const byItem = new Map<number, any[]>()
  for (const r of recordsByItem) {
    let bucket = byItem.get(r.item_id)
    if (!bucket) { bucket = []; byItem.set(r.item_id, bucket) }
    bucket.push(r)
  }

  const settings = {
    max_points: list.max_points,
    min_points: list.min_points,
    scored_count: list.scored_count,
  }
  // Rank comes from the array's own order, not from `sort_order` — under
  // "follow the ALL's order" those disagree, and rank is what everything else
  // (points, the leaderboard, the /lists/:id/:rank URLs) is built on.
  const withExtras = items.map((i, idx) => ({
    ...i,
    rank: idx + 1,
    points: pointsForRank(idx + 1, items.length, settings),
    records: byItem.get(i.id) ?? [],
  }))

  /**
   * The list's own tiers, if it defines any.
   *
   * Each owns every rank from `from_rank` until the next one starts, so the
   * bands follow the list as levels are added and removed rather than needing
   * to be redrawn. Returned ordered, which is what lets the client walk them
   * once instead of searching per row.
   */
  const tiers = db.prepare(
    `SELECT id, name, color, from_rank
       FROM custom_list_tiers WHERE list_id = ?
      ORDER BY from_rank ASC, id ASC`,
  ).all(listId) as { id: number; name: string; color: string | null; from_rank: number }[]

  const packs = db.prepare(
    `SELECT p.id, p.name, p.color, p.sort_order, p.require_count
       FROM custom_list_packs p
      WHERE p.list_id = ?
      ORDER BY p.sort_order ASC, p.id ASC`,
  ).all(listId) as any[]
  const packItems = db.prepare(
    `SELECT pi.pack_id, pi.item_id FROM custom_list_pack_items pi
       JOIN custom_list_packs p ON p.id = pi.pack_id
      WHERE p.list_id = ?`,
  ).all(listId) as { pack_id: number; item_id: number }[]
  for (const p of packs) {
    p.item_ids = packItems.filter((pi) => pi.pack_id === p.id).map((pi) => pi.item_id)
  }

  return { ...list, items: withExtras, packs, tiers }
}
