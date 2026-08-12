/**
 * The chip shape used by the two rows under a profile's name.
 *
 * There are two of them and they sit side by side: where somebody is from,
 * their pronouns and when they joined on the left; the places to find them on
 * the right. They were different objects — one was a row of bordered chips, the
 * other a run of grey text separated by gaps — so the same header had two
 * different ideas of what a small fact looks like, three inches apart.
 *
 * One shape now, one place. `sm` is for a dense header, `md` beside a name.
 */
export const PROFILE_CHIP_BASE =
  'inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-950/70 '
  + 'text-zinc-400 transition-colors max-w-full min-w-0'

export const PROFILE_CHIP_SIZE = {
  sm: 'gap-1 px-1.5 py-0.5 text-[10px]',
  md: 'gap-1.5 px-2 py-1 text-[11px]',
} as const
export type ProfileChipSize = keyof typeof PROFILE_CHIP_SIZE

export const PROFILE_CHIP_ICON = { sm: 'w-3 h-3', md: 'w-3.5 h-3.5' } as const

export function profileChipClass(size: ProfileChipSize = 'md'): string {
  return `${PROFILE_CHIP_BASE} ${PROFILE_CHIP_SIZE[size]}`
}

/**
 * `2026-03-04 11:22:33` → `March 2026`, and the full date for the tooltip.
 *
 * SQLite writes `YYYY-MM-DD HH:MM:SS` with no zone marker, and `Date.parse` of
 * that is implementation-defined — Safari returns NaN. Every reader of
 * `created_at` on this site therefore has to patch it into an ISO instant
 * first, and this is that, once.
 */
export function joinedOn(at: string | null | undefined): { month: string; full: string } | null {
  if (!at) return null
  const iso = at.includes('T') ? at : `${at.replace(' ', 'T')}Z`
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const d = new Date(t)
  return {
    month: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    full: d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
  }
}
