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
 *
 * Text sits at the 200 step rather than 300. At 9–10px on a near-black card the
 * 300s measure around 4.4:1 against the chip's own tinted background, which is
 * under AA for text this small; the 200s clear it with room to spare, and the
 * badge still reads as coloured rather than as white.
 */
export const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: 'bg-zinc-800/70 text-zinc-200 border-zinc-700/70',
  quiet: 'bg-zinc-900/70 text-zinc-400 border-zinc-800',
  accent: 'bg-accent/10 text-accent border-accent/40',
  amber: 'bg-amber-500/15 text-amber-200 border-amber-500/40',
  violet: 'bg-violet-500/15 text-violet-200 border-violet-500/40',
  cyan: 'bg-cyan-500/15 text-cyan-200 border-cyan-500/40',
  emerald: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
  sky: 'bg-sky-500/15 text-sky-200 border-sky-500/40',
  rose: 'bg-rose-500/15 text-rose-200 border-rose-500/40',
  pink: 'bg-pink-500/15 text-pink-200 border-pink-500/40',
}

/**
 * Two sizes, because there are two places a badge goes: beside a heading, or
 * inside a dense row. Anything between them is somebody eyeballing it.
 *
 * The right padding is larger than the left, and deliberately so. `letter-spacing`
 * is applied *after* every glyph including the last, so uppercase tracked text
 * in a symmetric box carries a phantom 0.1em on its right and sits visibly left
 * of centre. Adding the same 0.1em back as padding is what makes a badge look
 * centred rather than nearly centred — the sort of thing nobody can name but
 * everybody sees when a row of them lines up.
 */
export const BADGE_SIZE = {
  sm: 'text-[9px] pl-1.5 pr-[calc(0.375rem_+_0.1em)] py-[3px] gap-1',
  md: 'text-[10px] pl-2 pr-[calc(0.5rem_+_0.1em)] py-1 gap-1.5',
} as const
export type BadgeSize = keyof typeof BADGE_SIZE

export const BADGE_BASE =
  'shrink-0 inline-flex items-center rounded-[5px] border font-semibold uppercase '
  + 'tracking-widest leading-none whitespace-nowrap align-middle'

/** The dot before a label, when a badge asks for one. */
export const BADGE_DOT = {
  sm: 'w-1 h-1 rounded-full bg-current shrink-0 opacity-90',
  md: 'w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-90',
} as const

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
