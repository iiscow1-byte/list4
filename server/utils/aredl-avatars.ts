import type { DatabaseSync } from 'node:sqlite'
import { discordAvatarUrl } from '~/utils/discord-avatar'

/**
 * A Discord avatar for each of these player names, via AREDL.
 *
 * Only ever a *fallback*. A name belonging to an account on this site shows the
 * avatar that account uploaded — chosen and cropped here, for here — and the
 * callers apply that first. This fills in the rest of the leaderboard, which is
 * mostly people who have never signed up and whose rows were a grey circle with
 * one letter in it.
 *
 * Matched on both of AREDL's names because they are different things and either
 * can be the name a record is filed under: `global_name` is the display name a
 * player sets, `username` is their Discord handle. A player who has set neither
 * unusually has them equal, and the map keys collapse.
 *
 * Chunked at 400 placeholders for the same reason `clanTagsForPlayers` is:
 * SQLite's host-parameter ceiling is 999 and the leaderboard hands this up to
 * 2,000 names at a time. Keyed lowercase, because `COLLATE NOCASE` is a SQLite
 * property and a JavaScript `Map` has never heard of it.
 */
export function aredlAvatarsForPlayers(
  db: DatabaseSync,
  names: string[],
): Map<string, string> {
  const out = new Map<string, string>()
  const unique = [...new Set(names.filter(Boolean).map((n) => n.toLowerCase()))]
  if (!unique.length) return out

  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400)
    const ph = chunk.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT global_name, username, discord_id, discord_avatar
        FROM aredl_players
       WHERE discord_id IS NOT NULL
         AND discord_avatar IS NOT NULL
         AND (global_name COLLATE NOCASE IN (${ph})
              OR username COLLATE NOCASE IN (${ph}))
    `).all(...chunk, ...chunk) as {
      global_name: string; username: string
      discord_id: string | null; discord_avatar: string | null
    }[]

    for (const r of rows) {
      const url = discordAvatarUrl(r.discord_id, r.discord_avatar, 64)
      if (!url) continue
      // `global_name` is the display name, so it is the likelier match and is
      // written second — it wins a collision with somebody else's handle.
      if (r.username) out.set(r.username.toLowerCase(), url)
      if (r.global_name) out.set(r.global_name.toLowerCase(), url)
    }
  }
  return out
}
