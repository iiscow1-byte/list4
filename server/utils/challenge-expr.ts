import { challengeSourceSqlExpr } from '~/utils/challenge-sources'

/**
 * "Is this level a challenge?", as one SQL expression.
 *
 * A level counts as a challenge when any of four things is true:
 *
 *  1. an admin said so, with `force_challenge`,
 *  2. its `placement_source` is one of the challenge lists (see
 *     `utils/challenge-sources.ts`),
 *  3. it is explicitly pinned with `rated = 'Challenge'`, or
 *  4. Geometry Dash itself describes it as one: unrated, zero score, Tiny or
 *     Short, and tiered on this list at Tier 1 or above.
 *
 * …and `not_challenge` is not set. Those two columns are the editorial override
 * in each direction, and they beat the three inferences: a rule with no way to
 * be told it is wrong leaves a level stuck on a list it doesn't belong on, and
 * an unusual challenge the rules miss stuck off one it does. `not_challenge`
 * wins a contradiction, which the write path never creates anyway.
 *
 * Built rather than written out because it appeared in five places across three
 * files, each with its own table aliases, and every rule change had to be made
 * five times identically. They had already drifted once.
 *
 * @param level table alias for `levels`, or '' when the query has none
 * @param cache table alias for the joined `gd_info_cache` row
 */
export function isChallengeSql(level = '', cache = 'c'): string {
  const l = level ? `${level}.` : ''
  return `
  COALESCE(
    (
      COALESCE(${l}force_challenge, 0) = 1
      OR ${challengeSourceSqlExpr(`${l}placement_source`)}
      OR ${l}rated = 'Challenge'
      OR ((${l}rated IS NULL OR ${l}rated = '')
          AND json_extract(${cache}.info_json, '$.score') = 0
          AND json_extract(${cache}.info_json, '$.length') IN ('Tiny', 'Short')
          AND ${l}gddl_tier LIKE 'Tier %')
    ) AND COALESCE(${l}not_challenge, 0) = 0,
    0
  )
`.trim()
}
