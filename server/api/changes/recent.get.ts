import { getDb } from '~/server/db'
import { groupByDay, loadChanges } from '~/server/utils/changes'

/**
 * Recent main-list changes grouped by UTC day, newest first, for the changelog
 * and the builder page. Limit caps the row count *before* grouping so a chatty
 * day doesn't crowd out older ones.
 *
 * Rows leave out what neither page reads: placements equal positions, and the
 * changelog asks for up to 2,000 rows, so every field is paid for 2,000 times.
 */
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const days = Math.max(1, Math.min(Number(q.days) || 14, 3650))
  const limit = Math.max(1, Math.min(Number(q.limit) || 300, 2000))

  // `days` ago at 00:00 UTC.
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ')

  const db = getDb()
  const changes = loadChanges(db, { since, limit }).map((c) => ({
    kind: c.kind,
    level_id: c.level_id,
    level_position: c.level_position,
    level_name: c.level_name,
    level_gddl_tier: c.level_gddl_tier,
    level_gd_id: c.level_gd_id,
    level_rated: c.level_rated,
    challenge_rank: c.challenge_rank,
    from_challenge_rank: c.from_challenge_rank,
    from_position: c.from_position,
    to_position: c.to_position,
    changed_at: c.changed_at,
  }))
  return { days: groupByDay(changes) }
})
