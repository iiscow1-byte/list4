/**
 * The lists an admin can spin a custom list out of.
 *
 * Kept in `utils/` rather than `server/utils/` because both sides need it: the
 * server validates `source` against it, and the admin picker renders from it.
 * The queries themselves live in `server/utils/list-sources.ts`.
 */
export type ListSource = {
  key: string
  label: string
  /** One-line description shown under the picker. */
  hint: string
  /** Only the ALL list carries the tier / rating data those filters need. */
  supportsFilters: boolean
}

/**
 * GDListTemplate-backed lists all live in `gdtpl_levels`, keyed by `list_slug`.
 * Adding a newly imported one is a line here.
 */
const GDTPL_LISTS: { slug: string; label: string; hint: string }[] = [
  { slug: 'ccl', label: 'CCL — Consistency Challenge List', hint: 'consistencychallenge.pages.dev' },
  { slug: 'tsl', label: 'TSL — The Shitty List', hint: 'GDListTemplate mirror' },
  { slug: 'edi', label: 'EDI — Extreme Demon Index', hint: 'GDListTemplate mirror' },
  { slug: 'ddl', label: 'DDL', hint: 'GDListTemplate mirror' },
  { slug: 'll',  label: 'LL',  hint: 'GDListTemplate mirror' },
  { slug: 'tcl', label: 'TCL — Tidal Challenge List', hint: 'GDListTemplate mirror' },
  { slug: 'sfl', label: 'SFL — Straight Fly List', hint: 'GDListTemplate mirror' },
  { slug: 'cl',  label: 'CL — Challenge List', hint: 'GDListTemplate mirror' },
]

export const LIST_SOURCES: ListSource[] = [
  { key: 'all', label: 'ALL — the main list', hint: 'Placements as shown on the sheet', supportsFilters: true },
  { key: 'aredl', label: 'AREDL — All Rated Extreme Demons', hint: 'aredl.net mirror', supportsFilters: false },
  { key: 'gdl', label: 'GDL — Demonlist', hint: 'gdladder mirror', supportsFilters: false },
  { key: 'mscl', label: 'MSCL — Super Challenge List', hint: 'mscl.dev mirror', supportsFilters: false },
  ...GDTPL_LISTS.map((g) => ({
    key: `gdtpl:${g.slug}`,
    label: g.label,
    hint: g.hint,
    supportsFilters: false,
  })),
]

export function findListSource(key: string): ListSource | undefined {
  return LIST_SOURCES.find((s) => s.key === key)
}

export function isKnownSource(key: string): boolean {
  return !!findListSource(key)
}

export function sourceLabel(key: string): string {
  return findListSource(key)?.label ?? key
}

/** Short form for a generated list title — "CCL" out of "CCL — Consistency…". */
export function sourceShortLabel(key: string): string {
  return sourceLabel(key).split(' — ')[0]!
}
