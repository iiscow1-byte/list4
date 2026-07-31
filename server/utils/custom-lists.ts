import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { pointsForRank } from './custom-list-scoring'

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
}

/** Short, non-enumerable share token. */
export function newPublicId(): string {
  return randomBytes(8).toString('base64url')
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
export function replaceItems(db: DatabaseSync, listId: number, items: CustomListItemInput[]): number {
  const getLevel = db.prepare(
    `SELECT id, name, gd_id, creator, difficulty, gddl_tier, verification_url FROM levels WHERE id = ?`,
  )
  const ins = db.prepare(`
    INSERT INTO custom_list_items
      (list_id, sort_order, level_id, name, gd_id, creator, difficulty, gddl_tier,
       verification_url, notes, verifier, percent_to_qualify, fps, game_version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `)
  const upd = db.prepare(`
    UPDATE custom_list_items
       SET sort_order = ?, level_id = ?, name = ?, gd_id = ?, creator = ?, difficulty = ?,
           gddl_tier = ?, verification_url = ?, notes = ?, verifier = ?,
           percent_to_qualify = ?, fps = ?, game_version = ?
     WHERE id = ? AND list_id = ?
  `)

  const existing = db.prepare(
    `SELECT id, level_id, name, gd_id FROM custom_list_items WHERE list_id = ?`,
  ).all(listId) as { id: number; level_id: number | null; name: string; gd_id: number | null }[]

  const byId = new Map(existing.map((e) => [e.id, e]))
  const byLevel = new Map<number, number>()
  const byNameGd = new Map<string, number>()
  for (const e of existing) {
    if (e.level_id != null && !byLevel.has(e.level_id)) byLevel.set(e.level_id, e.id)
    const k = `${e.gd_id ?? ''}|${e.name.toLowerCase()}`
    if (!byNameGd.has(k)) byNameGd.set(k, e.id)
  }

  const keptIds = new Set<number>()
  let n = 0

  for (const raw of items.slice(0, MAX_ITEMS)) {
    const levelId = Number(raw?.level_id)
    const linked = Number.isInteger(levelId) && levelId > 0
      ? (getLevel.get(levelId) as any | undefined)
      : undefined

    // A linked level takes every display field from `levels` — including its
    // NULLs — so a saved list can never disagree with the ALL list about a
    // level it points at. Only hand-entered items use the client's values.
    // `notes` is always the user's; that's what it's for.
    const fields = linked
      ? {
          name: linked.name as string,
          gd_id: linked.gd_id as number | null,
          creator: linked.creator as string | null,
          difficulty: linked.difficulty as string | null,
          gddl_tier: linked.gddl_tier as string | null,
          verification_url: linked.verification_url as string | null,
        }
      : {
          name: clean(raw?.name),
          gd_id: Number.isInteger(Number(raw?.gd_id)) ? Number(raw?.gd_id) : null,
          creator: clean(raw?.creator),
          difficulty: clean(raw?.difficulty, 60),
          gddl_tier: clean(raw?.gddl_tier, 40),
          verification_url: clean(raw?.verification_url, 500),
        }

    if (!fields.name) continue // an item with no name at all is not renderable

    const ptq = Number(raw?.percent_to_qualify)
    const listMeta = [
      clean(raw?.verifier, 200),
      Number.isFinite(ptq) ? Math.max(1, Math.min(100, Math.round(ptq))) : 100,
      clean(raw?.fps, 40),
      clean(raw?.game_version, 40),
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

    if (matchId != null) {
      upd.run(
        n, linked?.id ?? null, fields.name, fields.gd_id, fields.creator, fields.difficulty,
        fields.gddl_tier, fields.verification_url, clean(raw?.notes, 500),
        ...listMeta, matchId, listId,
      )
      keptIds.add(matchId)
    } else {
      ins.run(
        listId, n, linked?.id ?? null, fields.name, fields.gd_id, fields.creator,
        fields.difficulty, fields.gddl_tier, fields.verification_url, clean(raw?.notes, 500),
        ...listMeta,
      )
    }
    n++
  }

  const del = db.prepare(`DELETE FROM custom_list_items WHERE id = ?`)
  for (const e of existing) if (!keptIds.has(e.id)) del.run(e.id)

  return n
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
            a.username AS owner_username,
            src.public_id AS copied_from_public_id, src.title AS copied_from_title
       FROM custom_lists cl
       LEFT JOIN accounts a ON a.id = cl.owner_account_id
       LEFT JOIN custom_lists src ON src.id = cl.copied_from_id
      WHERE cl.id = ?`,
  ).get(listId) as any | undefined
  if (!list) return null

  // `position` is the linked level's *current* ALL placement, resolved at read
  // time so a saved list follows the level when it moves.
  const items = db.prepare(
    `SELECT i.id, i.sort_order, i.level_id, i.name, i.gd_id, i.creator, i.difficulty,
            i.gddl_tier, i.verification_url, i.notes, i.verifier, i.percent_to_qualify,
            i.fps, i.game_version, l.position, l.sheet_placement
       FROM custom_list_items i
       LEFT JOIN levels l ON l.id = i.level_id
      WHERE i.list_id = ?
      ORDER BY i.sort_order ASC, i.id ASC`,
  ).all(listId) as any[]

  const recordsByItem = db.prepare(
    `SELECT r.id, r.item_id, r.player_name, r.percent, r.hz, r.video, r.mobile,
            a.username AS account_username
       FROM custom_list_records r
       LEFT JOIN accounts a ON a.id = r.submitted_by
      WHERE r.list_id = ? AND r.status = 'approved'
      ORDER BY r.percent DESC, r.player_name COLLATE NOCASE ASC`,
  ).all(listId) as any[]

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
  const withExtras = items.map((i) => ({
    ...i,
    rank: i.sort_order + 1,
    points: pointsForRank(i.sort_order + 1, items.length, settings),
    records: byItem.get(i.id) ?? [],
  }))

  const packs = db.prepare(
    `SELECT p.id, p.name, p.color, p.sort_order
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

  return { ...list, items: withExtras, packs }
}
