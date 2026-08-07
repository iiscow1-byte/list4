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
 * Wrapping the column in pipes and stripping spaces makes one LIKE per source
 * match a whole part and only a whole part: `|ACS|` matches `ACS` and
 * `AREDL|ACS`, and never `ACSX`.
 */
export function challengeSourceSqlExpr(column = 'placement_source'): string {
  const haystack = `REPLACE(UPPER('|' || COALESCE(${column}, '') || '|'), ' ', '')`
  return `(${CHALLENGE_SOURCES.map((s) => `${haystack} LIKE '%|${s}|%'`).join(' OR ')})`
}
