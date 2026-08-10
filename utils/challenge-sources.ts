// Sources that flag a level as a Challenge regardless of any rated value.
// Match against placement_source case-insensitively — sheet entries are
// usually uppercase but admins editing through the UI may type whatever.
export const CHALLENGE_SOURCES = [
  '1SCL', 'CCPL', 'GDSRSH', 'TCL', 'SFCL', 'TSCL', '2PCL', 'CCL', 'WSCL', 'MSCL',
  // The project's own challenge sheet — see `server/db/import-acs.ts`.
  'ACS',
] as const

const CHALLENGE_SOURCE_SET = new Set<string>(CHALLENGE_SOURCES)

/**
 * A level can be tagged with several sources, stored pipe-separated — the
 * level editor writes `AREDL|ACS`. So the test is per part, not on the whole
 * string: matching the column outright meant one challenge list among several
 * sources counted for nothing, and the level quietly stayed off the challenge
 * ranking. Nothing on the sheet is multi-source today, which is the only reason
 * that has never been visible.
 */
export function splitSources(source: string | null | undefined): string[] {
  if (!source) return []
  return source.split('|').map((s) => s.trim()).filter(Boolean)
}

export function isChallengeSource(source: string | null | undefined): boolean {
  return splitSources(source).some((s) => CHALLENGE_SOURCE_SET.has(s.toUpperCase()))
}

/**
 * SQL fragment matching `placement_source` against the challenge source list.
 *
 * Two tests, cheapest first, and the order is the whole point.
 *
 * A single-source value — which is every row on the sheet today — is settled by
 * the `IN`, one comparison against a small constant set. Only a value that
 * actually contains a pipe falls through to the eleven `LIKE`s that match a
 * whole part and only a whole part (`|ACS|` matches `ACS` and `AREDL|ACS`, and
 * never `ACSX`).
 *
 * Measured on the real 54,000-row list: the LIKE chain alone costs 126 ms per
 * evaluation and this costs 10.6 ms, against 9.8 ms for the plain `IN` it
 * replaced. That expression runs twice per list request — once to count and
 * once to fetch — and again inside the effective-rating CASE, so making it
 * unconditional turned every filtered search on the site into a slow one.
 */
export function challengeSourceSqlExpr(column = 'placement_source'): string {
  const col = `COALESCE(${column}, '')`
  // TRIM, because a hand-typed source can arrive as " ACS ". The pipe form
  // below strips spaces anywhere in the value, and the two tests have to agree
  // about what counts — a row matching one and not the other is exactly the
  // kind of difference nobody notices until a level is on the wrong list.
  const single = `UPPER(TRIM(${col})) IN (${CHALLENGE_SOURCES.map((s) => `'${s}'`).join(', ')})`
  const haystack = `REPLACE(UPPER('|' || ${col} || '|'), ' ', '')`
  const anyPart = CHALLENGE_SOURCES.map((s) => `${haystack} LIKE '%|${s}|%'`).join(' OR ')
  return `(${single} OR (${col} LIKE '%|%' AND (${anyPart})))`
}
