import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export const MAX_ITEMS = 250
export const MAX_LISTS_PER_USER = 50

export type CustomListItemInput = {
  level_id?: number | null
  name?: string | null
  gd_id?: number | null
  creator?: string | null
  difficulty?: string | null
  gddl_tier?: string | null
  verification_url?: string | null
  notes?: string | null
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
 * Replace a list's items with `items`, in array order. Items that name an ALL
 * level (`level_id`) get their display fields re-read from `levels` so a
 * saved list always shows current data; hand-entered items keep what the
 * client sent. Rows past MAX_ITEMS are dropped.
 */
export function replaceItems(db: DatabaseSync, listId: number, items: CustomListItemInput[]): number {
  const getLevel = db.prepare(
    `SELECT id, name, gd_id, creator, difficulty, gddl_tier, verification_url FROM levels WHERE id = ?`,
  )
  const ins = db.prepare(`
    INSERT INTO custom_list_items
      (list_id, sort_order, level_id, name, gd_id, creator, difficulty, gddl_tier, verification_url, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `)
  db.prepare(`DELETE FROM custom_list_items WHERE list_id = ?`).run(listId)

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

    ins.run(
      listId,
      n,
      linked?.id ?? null,
      fields.name,
      fields.gd_id,
      fields.creator,
      fields.difficulty,
      fields.gddl_tier,
      fields.verification_url,
      clean(raw?.notes, 500),
    )
    n++
  }
  return n
}

/** A list plus its items, shaped for the client. */
export function loadList(db: DatabaseSync, listId: number) {
  const list = db.prepare(
    `SELECT cl.id, cl.public_id, cl.title, cl.description, cl.created_at, cl.updated_at,
            cl.owner_account_id, cl.is_public, cl.likes, cl.copied_from_id,
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
            i.gddl_tier, i.verification_url, i.notes, l.position, l.sheet_placement
       FROM custom_list_items i
       LEFT JOIN levels l ON l.id = i.level_id
      WHERE i.list_id = ?
      ORDER BY i.sort_order ASC, i.id ASC`,
  ).all(listId)

  return { ...list, items }
}
