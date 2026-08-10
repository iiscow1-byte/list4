/**
 * One shape and one palette for every badge on the site.
 *
 * A badge here means a small chip that says something *about* the thing beside
 * it — a role, a source, a state. There were dozens written out by hand, and
 * they had drifted into four text sizes, five paddings, and two different
 * opinions about whether a chip has a border. Put next to each other in a
 * leaderboard row or a records list, the mismatch reads as sloppiness rather
 * than as meaning, which is the opposite of what a badge is for.
 *
 * Geometry is `BADGE_BASE` plus a size; colour is a tone. Nothing else. A new
 * badge picks a tone from this list or it doesn't get a colour — which is the
 * point, because the moment one call site invents `bg-teal-600/20` the set
 * stops being a vocabulary and goes back to being decoration.
 *
 * The one exception is a colour somebody chose themselves — a clan's colour, a
 * staff-set name badge — which arrives as a hex literal and goes through
 * `hexBadgeStyle`, filling the same three roles a tone does.
 */

export type BadgeTone =
  /** The default: says something without claiming importance. */
  | 'neutral'
  /** Quieter still — for a fact that is only worth noticing if you look. */
  | 'quiet'
  /** The site's accent. On a custom-list page this follows the list's colour. */
  | 'accent'
  | 'amber'
  | 'violet'
  | 'cyan'
  | 'emerald'
  | 'sky'
  | 'rose'
  | 'pink'

/**
 * Colour only — the border *width* comes from `BADGE_BASE`, so a tone supplies
 * `border-x/40` and never the bare `border`. Splitting it that way is what
 * stops a tone from being able to change a badge's shape.
 */
export const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: 'bg-zinc-900 text-zinc-300 border-zinc-700/80',
  quiet: 'bg-zinc-900/60 text-zinc-500 border-zinc-800',
  accent: 'bg-accent/10 text-accent border-accent/40',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  violet: 'bg-violet-500/15 text-violet-300 border-violet-500/40',
  cyan: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
  emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  sky: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  rose: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  pink: 'bg-pink-500/15 text-pink-300 border-pink-500/40',
}

/**
 * Two sizes, because there are two places a badge goes: beside a heading, or
 * inside a dense row. Anything between them is somebody eyeballing it.
 */
export const BADGE_SIZE = {
  sm: 'text-[9px] px-1.5 py-0.5 gap-1',
  md: 'text-[10px] px-2 py-1 gap-1',
} as const
export type BadgeSize = keyof typeof BADGE_SIZE

export const BADGE_BASE =
  'shrink-0 inline-flex items-center rounded border font-medium uppercase '
  + 'tracking-widest leading-none whitespace-nowrap'

export function badgeClass(tone: BadgeTone = 'neutral', size: BadgeSize = 'md'): string {
  return `${BADGE_BASE} ${BADGE_TONE[tone]} ${BADGE_SIZE[size]}`
}

/**
 * A user-chosen colour filling the same three roles a tone does.
 *
 * Re-validated here even though every write path already refuses anything that
 * isn't a hex literal: this value lands in a `style` attribute, so it gets a
 * second gate rather than one. Anything else returns undefined and the caller
 * falls back to a tone, which is why a bad colour degrades to a plain badge
 * instead of to an unstyled one.
 */
export function hexBadgeStyle(
  hex: string | null | undefined,
): { backgroundColor: string; borderColor: string; color: string } | undefined {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return undefined
  return { backgroundColor: `${hex}22`, borderColor: `${hex}66`, color: hex }
}
