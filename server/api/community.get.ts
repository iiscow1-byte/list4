import { getDb } from '~/server/db'

/**
 * Everything the community hub shows that isn't personalised: newly ranked
 * levels, the latest approved records, freshly published lists, and the
 * players who have been most active lately. The personalised half of the page
 * comes from /api/feed/followed.
 */
export default defineEventHandler(() => {
  const db = getDb()

  // Levels added to *this* list. Imported AREDL "Placed" events also carry a
  // null from_position, so without the source guard the newly-ranked panel
  // filled up with placements that happened on another site years ago.
  const newLevels = db.prepare(
    `SELECT l.position, l.sheet_placement, l.name, l.gd_id, l.gddl_tier, h.changed_at
       FROM position_history h
       JOIN levels l ON l.id = h.level_id
      WHERE h.from_position IS NULL AND h.source <> 'aredl'
      ORDER BY h.changed_at DESC, h.id DESC
      LIMIT 10`,
  ).all()

  const recentRecords = db.prepare(
    `SELECT r.player_name, r.percent, r.video, r.submitted_at,
            l.position, l.sheet_placement, l.name AS level_name, l.gd_id, l.gddl_tier,
            (SELECT username FROM accounts a
              WHERE a.banned_at IS NULL
                AND (a.claimed_player = r.player_name COLLATE NOCASE
                     OR a.username = r.player_name COLLATE NOCASE)
              LIMIT 1) AS player_username
       FROM records r
       JOIN levels l ON l.id = r.level_id
      WHERE r.permanent = 1 AND r.submitted_by IS NOT NULL
      ORDER BY r.decided_at DESC, r.submitted_at DESC
      LIMIT 10`,
  ).all()

  const newLists = db.prepare(
    `SELECT cl.public_id, cl.title, cl.likes, cl.updated_at, cl.icon_url, cl.accent_color,
            a.username AS owner_username,
            (SELECT COUNT(*) FROM custom_list_items i WHERE i.list_id = cl.id) AS item_count
       FROM custom_lists cl
       LEFT JOIN accounts a ON a.id = cl.owner_account_id
      WHERE cl.is_public = 1
      ORDER BY cl.updated_at DESC
      LIMIT 8`,
  ).all()

  const newMembers = db.prepare(
    `SELECT username, created_at, claimed_player,
            (avatar_blob IS NOT NULL) AS has_avatar
       FROM accounts
      WHERE banned_at IS NULL
      ORDER BY created_at DESC
      LIMIT 12`,
  ).all()

  const totals = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM levels)                        AS levels,
       (SELECT COUNT(*) FROM accounts WHERE banned_at IS NULL) AS members,
       (SELECT COUNT(*) FROM custom_lists WHERE is_public = 1) AS public_lists,
       (SELECT COUNT(*) FROM records WHERE permanent = 1)   AS records`,
  ).get()

  return { newLevels, recentRecords, newLists, newMembers, totals }
})
