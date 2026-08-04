// Sources that flag a level as a Challenge regardless of any rated value.
// Match against placement_source case-insensitively — sheet entries are
// usually uppercase but admins editing through the UI may type whatever.
export const CHALLENGE_SOURCES = [
  '1SCL', 'CCPL', 'GDSRSH', 'TCL', 'SFCL', 'TSCL', '2PCL', 'CCL', 'WSCL', 'MSCL',
  // The project's own challenge sheet — see `server/db/import-acs.ts`.
  'ACS',
] as const

const CHALLENGE_SOURCE_SET = new Set<string>(CHALLENGE_SOURCES)

export function isChallengeSource(source: string | null | undefined): boolean {
  if (!source) return false
  return CHALLENGE_SOURCE_SET.has(source.trim().toUpperCase())
}

/** SQL fragment matching `placement_source` against the challenge source list. */
export function challengeSourceSqlExpr(column = 'placement_source'): string {
  const list = CHALLENGE_SOURCES.map((s) => `'${s}'`).join(', ')
  return `UPPER(COALESCE(${column}, '')) IN (${list})`
}
