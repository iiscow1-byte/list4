import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { listFollowedNames } from '~/server/utils/follows'
import { clanTagsForPlayers, type ClanBadge } from '~/server/utils/clans'

type Item = {
  kind: 'record' | 'verify' | 'level' | 'progress'
  at: string
  actor: string
  /** Site account behind the actor name, when there is one — for the avatar. */
  actor_username?: string | null
  actor_has_avatar?: boolean
  clan?: ClanBadge | null
  level_position: number | null
  level_name: string
  /** Drives the level art on feed rows. */
  level_gd_id?: number | null
  percent?: number | null
  start_percent?: number | null
  end_percent?: number | null
  video_url?: string | null
}

export default defineEventHandler((event) => {
  const me = requireAccount(event)
  const db = getDb()
  const names = listFollowedNames(db, me.id)
  if (names.length === 0) return { items: [] }

  const limit = Math.min(100, Math.max(1, Number(getQuery(event).limit) || 40))
  const placeholders = names.map(() => '?').join(',')

  // Records (completion submissions). Sheet records have a NULL submitted_at
  // default that resolves to the import time; that's still a coherent ordering
  // so we keep them in the feed.
  const records = db.prepare(
    `SELECT r.player_name AS actor, r.percent, r.submitted_at AS at,
            l.position AS level_position, l.name AS level_name, l.gd_id AS level_gd_id
       FROM records r
       JOIN levels l ON l.id = r.level_id
      WHERE r.permanent = 1
        AND r.player_name COLLATE NOCASE IN (${placeholders})
      ORDER BY r.submitted_at DESC
      LIMIT ?`,
  ).all(...names, limit) as any[]

  // Verifications: levels.verifier matches and verify_date is the timestamp
  // we surface. Falls back to never showing if verify_date is null.
  const verifies = db.prepare(
    `SELECT verifier AS actor, verify_date AS at,
            position AS level_position, name AS level_name, gd_id AS level_gd_id
       FROM levels
      WHERE verifier COLLATE NOCASE IN (${placeholders})
        AND verify_date IS NOT NULL
      ORDER BY verify_date DESC
      LIMIT ?`,
  ).all(...names, limit) as any[]

  // New levels submitted by a followed account. We treat the level's
  // `id` (auto-increment) order as proxy-time since `levels` has no
  // explicit submission timestamp.
  const created = db.prepare(
    `SELECT a.username AS actor, datetime('now') AS at,
            l.position AS level_position, l.name AS level_name, l.gd_id AS level_gd_id,
            l.id AS sort_id
       FROM levels l
       JOIN accounts a ON a.id = l.submitted_by
      WHERE (a.claimed_player IS NOT NULL AND a.claimed_player COLLATE NOCASE IN (${placeholders}))
         OR a.username COLLATE NOCASE IN (${placeholders})
      ORDER BY l.id DESC
      LIMIT ?`,
  ).all(...names, ...names, limit) as any[]

  // Progress posts. Joined to accounts to surface the canonical follow name.
  const progress = db.prepare(
    `SELECT COALESCE(a.claimed_player, a.username) AS actor, p.created_at AS at,
            p.level_position, p.level_name,
            p.start_percent, p.end_percent, p.video_url
       FROM progress_posts p
       JOIN accounts a ON a.id = p.account_id
      WHERE COALESCE(a.claimed_player, a.username) COLLATE NOCASE IN (${placeholders})
      ORDER BY p.created_at DESC
      LIMIT ?`,
  ).all(...names, limit) as any[]

  const items: Item[] = [
    ...records.map((r): Item => ({
      kind: 'record', at: r.at, actor: r.actor,
      level_position: r.level_position, level_name: r.level_name,
      level_gd_id: r.level_gd_id, percent: r.percent,
    })),
    ...verifies.map((v): Item => ({
      kind: 'verify', at: v.at, actor: v.actor,
      level_position: v.level_position, level_name: v.level_name,
      level_gd_id: v.level_gd_id,
    })),
    ...created.map((c): Item => ({
      kind: 'level', at: c.at, actor: c.actor,
      level_position: c.level_position, level_name: c.level_name,
      level_gd_id: c.level_gd_id,
    })),
    ...progress.map((p): Item => ({
      kind: 'progress', at: p.at, actor: p.actor,
      level_position: p.level_position, level_name: p.level_name,
      start_percent: p.start_percent, end_percent: p.end_percent,
      video_url: p.video_url,
    })),
  ]

  items.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
  const page = items.slice(0, limit)

  // Attach the site account behind each actor name in one pass, so the feed
  // can show avatars without a query per row. Actors are follow names, which
  // may be a claimed leaderboard name rather than a username.
  const actors = [...new Set(page.map((i) => i.actor).filter(Boolean))]
  if (actors.length) {
    const ph = actors.map(() => '?').join(',')
    const accounts = db.prepare(
      `SELECT username, claimed_player, (avatar_blob IS NOT NULL) AS has_avatar
         FROM accounts
        WHERE banned_at IS NULL
          AND (username COLLATE NOCASE IN (${ph}) OR claimed_player COLLATE NOCASE IN (${ph}))`,
    ).all(...actors, ...actors) as { username: string; claimed_player: string | null; has_avatar: number }[]

    const byName = new Map<string, { username: string; has_avatar: boolean }>()
    for (const a of accounts) {
      const entry = { username: a.username, has_avatar: !!a.has_avatar }
      byName.set(a.username.toLowerCase(), entry)
      if (a.claimed_player) byName.set(a.claimed_player.toLowerCase(), entry)
    }
    for (const i of page) {
      const hit = byName.get(i.actor.toLowerCase())
      i.actor_username = hit?.username ?? null
      i.actor_has_avatar = hit?.has_avatar ?? false
    }

    // And the clan tag, from the same page of names — the feed prints the
    // actor's name, so it prints the name the way the rest of the site does.
    const clans = clanTagsForPlayers(db, actors)
    if (clans.size) for (const i of page) i.clan = clans.get(i.actor.toLowerCase()) ?? null
  }

  return { items: page }
})
