import type { DatabaseSync } from 'node:sqlite'
import { isAdminRole } from './auth'

/**
 * Who may do what to a custom list.
 *
 *  - **owner**   — everything, including deleting the list and managing editors
 *  - **editor**  — edit the list's levels/settings and moderate its records
 *  - **admin**   — site staff, same reach as an editor for moderation purposes
 *
 * Kept in one place so every endpoint agrees; scattering `owner_account_id ===
 * account.id` checks is how a collaborator ends up able to accept records but
 * not reorder the list they're accepting them for.
 */
export type ListActor = { id: number; role?: string | null } | null | undefined

export type ListRow = { id: number; owner_account_id: number }

export function isListOwner(list: ListRow, actor: ListActor): boolean {
  return !!actor && actor.id === list.owner_account_id
}

export function isListEditor(db: DatabaseSync, listId: number, actor: ListActor): boolean {
  if (!actor) return false
  return !!db.prepare(
    `SELECT 1 FROM custom_list_editors WHERE list_id = ? AND account_id = ?`,
  ).get(listId, actor.id)
}

/** Can change the list's levels, settings, packs, and moderate its records. */
export function canEditList(db: DatabaseSync, list: ListRow, actor: ListActor): boolean {
  if (!actor) return false
  if (isListOwner(list, actor)) return true
  if (isAdminRole(actor.role ?? '')) return true
  return isListEditor(db, list.id, actor)
}

/** Owner-only actions: deleting the list, adding/removing editors. */
export function canAdministerList(list: ListRow, actor: ListActor): boolean {
  if (!actor) return false
  return isListOwner(list, actor) || isAdminRole(actor.role ?? '')
}

export type ListStaff = {
  id: number
  username: string
  /** `owner` for the account that made the list, `editor` for everyone added. */
  role: 'owner' | 'editor'
  has_avatar: boolean
  created_at: string | null
}

/**
 * Everyone who runs the list, owner first — the roster other list sites print
 * as "List Editors".
 *
 * The owner is included even though they aren't in `custom_list_editors`: a
 * staff list that omits the person who runs the list is not a staff list, and
 * every caller was otherwise going to reassemble it from two fields.
 */
export function loadEditors(db: DatabaseSync, listId: number): ListStaff[] {
  const owner = db.prepare(
    `SELECT a.id, a.username, (a.avatar_blob IS NOT NULL) AS has_avatar, cl.created_at
       FROM custom_lists cl
       JOIN accounts a ON a.id = cl.owner_account_id
      WHERE cl.id = ?`,
  ).get(listId) as { id: number; username: string; has_avatar: number; created_at: string } | undefined

  const editors = db.prepare(
    `SELECT a.id, a.username, (a.avatar_blob IS NOT NULL) AS has_avatar, e.created_at
       FROM custom_list_editors e
       JOIN accounts a ON a.id = e.account_id
      WHERE e.list_id = ?
      ORDER BY a.username COLLATE NOCASE ASC`,
  ).all(listId) as { id: number; username: string; has_avatar: number; created_at: string }[]

  const out: ListStaff[] = []
  if (owner) {
    out.push({
      id: owner.id, username: owner.username, role: 'owner',
      has_avatar: !!owner.has_avatar, created_at: owner.created_at,
    })
  }
  for (const e of editors) {
    // An owner who is also listed as an editor appears once, as the owner.
    if (owner && e.id === owner.id) continue
    out.push({
      id: e.id, username: e.username, role: 'editor',
      has_avatar: !!e.has_avatar, created_at: e.created_at,
    })
  }
  return out
}
