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

/** The editor roster, for display on the list page. */
export function loadEditors(db: DatabaseSync, listId: number) {
  return db.prepare(
    `SELECT a.id, a.username, e.created_at
       FROM custom_list_editors e
       JOIN accounts a ON a.id = e.account_id
      WHERE e.list_id = ?
      ORDER BY a.username COLLATE NOCASE ASC`,
  ).all(listId) as { id: number; username: string; created_at: string }[]
}
