/**
 * How a level's records are grouped and ordered.
 *
 * Out of the component because the rule is the interesting part and a rule
 * living inside a `<template>`'s sibling script is a rule nothing can check.
 * The panel that draws them is `components/LevelRecords.vue`.
 */

export type RecordSource = 'site' | 'aredl' | 'pointercrate'

export type RecordLike = {
  player: string
  percent: number
  source?: 'all' | 'aredl' | 'pointercrate' | null
}

/**
 * Which list a record came from.
 *
 * A missing source means the site's own — the ALL list's records predate the
 * column and the endpoint labels them `'all'`, so both spellings land here.
 */
export function recordSource(r: RecordLike): RecordSource {
  if (r.source === 'aredl') return 'aredl'
  if (r.source === 'pointercrate') return 'pointercrate'
  return 'site'
}

/**
 * Tie-break order between sources: the same priority the endpoint dedups by.
 *
 * The ALL row carries the most editorial metadata — the hz and the video the
 * submitter chose — so it wins; AREDL beats Pointercrate for the same reason.
 */
const SOURCE_RANK: Record<RecordSource, number> = { site: 0, aredl: 1, pointercrate: 2 }

/**
 * Records, hardest-won first.
 *
 * The panel used to render the three source arrays back to back, each sorted
 * within itself, so a 60% attempt from the sheet sat above a verified 100% from
 * AREDL. What a record *is* decides the order now, and where it was imported
 * from only breaks ties.
 *
 * Returns a new array — the caller's props are not ours to sort in place, and
 * sorting a prop array is the kind of mutation Vue will happily let you do and
 * then re-render around.
 */
export function sortRecords<T extends RecordLike>(records: readonly T[]): T[] {
  return [...records].sort((a, b) =>
    (b.percent ?? 0) - (a.percent ?? 0)
    || SOURCE_RANK[recordSource(a)] - SOURCE_RANK[recordSource(b)]
    || a.player.localeCompare(b.player, undefined, { sensitivity: 'base' }),
  )
}

/** The chip on a row, as one description rather than three near-copies. */
export function recordSourceBadge(
  r: RecordLike & { is_verification?: number | null; is_legacy?: number | null },
): { label: string; title: string } {
  const source = recordSource(r)
  if (source === 'aredl') {
    return {
      label: 'AREDL',
      title: r.is_verification ? 'Verified on AREDL' : 'Imported from AREDL',
    }
  }
  if (source === 'pointercrate') {
    return {
      label: r.is_legacy ? 'PC Legacy' : 'PC',
      title: r.is_legacy
        ? 'From Pointercrate Legacy'
        : (r.is_verification ? 'Verifier on Pointercrate' : 'Imported from Pointercrate'),
    }
  }
  return { label: 'ALL', title: 'Record accepted on the All Levels List' }
}
