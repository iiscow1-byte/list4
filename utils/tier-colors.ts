/**
 * GDDL tier → background color map, lifted from the source sheet's CSS.
 * Each tier always uses the same color in the sheet; if that ever changes we
 * regenerate this file by re-parsing the `<style>` block of any tab's HTML.
 *
 * The sheet's own ramp ends at Tier 40, a near-black violet. Tiers 41–45 are
 * this site's, and continue somewhere the sheet's ramp cannot: it has already
 * run out of darkness, so five more shades of black would be five tiers nobody
 * could tell apart. They bottom out once more and then climb back through deep
 * blue, which keeps consecutive tiers distinguishable and reads as what it is —
 * a band past the end of the original scale.
 */
export const TIER_COLORS: Record<string, string> = {
  // Subtiers (Easy → Harder), light → dark purple
  'Subtier 0': '#9d8dbf',
  'Subtier 1': '#917ebc',
  'Subtier 2': '#866dbe',
  'Subtier 3': '#7b5dc1',
  'Subtier 4': '#704cc3',
  'Subtier 5': '#653bc5',

  // Demon tiers, light pink → red → near-black purple
  'Tier 1':  '#dddfee',
  'Tier 2':  '#d5d3e9',
  'Tier 3':  '#d3cbe7',
  'Tier 4':  '#d3c3e4',
  'Tier 5':  '#d4bbe2',
  'Tier 6':  '#d5b0de',
  'Tier 7':  '#dba7dc',
  'Tier 8':  '#db9fd1',
  'Tier 9':  '#d991c1',
  'Tier 10': '#da86b0',
  'Tier 11': '#db7698',
  'Tier 12': '#dc6a7d',
  'Tier 13': '#dd5a5a',
  'Tier 14': '#dc514c',
  'Tier 15': '#da493e',
  'Tier 16': '#da4534',
  'Tier 17': '#d93e26',
  'Tier 18': '#cd3f23',
  'Tier 19': '#c03a1b',
  'Tier 20': '#b23415',
  'Tier 21': '#a23010',
  'Tier 22': '#9b2b0c',
  'Tier 23': '#932b0b',
  'Tier 24': '#892608',
  'Tier 25': '#832607',
  'Tier 26': '#752105',
  'Tier 27': '#6c1e04',
  'Tier 28': '#601a02',
  'Tier 29': '#5a1802',
  'Tier 30': '#511700',
  'Tier 31': '#4f0a01',
  'Tier 32': '#4a0207',
  'Tier 33': '#470313',
  'Tier 34': '#42041e',
  'Tier 35': '#400427',
  'Tier 36': '#3d0630',
  'Tier 37': '#380635',
  'Tier 38': '#300636',
  'Tier 39': '#250630',
  'Tier 40': '#120118',

  // Past the sheet's scale — see the note above.
  'Tier 41': '#0a0620',
  'Tier 42': '#0a0a30',
  'Tier 43': '#0b1040',
  'Tier 44': '#0c1650',
  'Tier 45': '#0d1c62',
}

/** Lookup with graceful fallback to a neutral zinc color. */
export function tierColor(tier: string | null | undefined): string {
  if (!tier) return '#27272a' // zinc-800
  return TIER_COLORS[tier.trim()] ?? '#27272a'
}

/**
 * Pick black or white for text on top of `bg`, based on perceived luminance.
 * Uses the WCAG-style relative luminance threshold.
 */
export function textOn(bg: string): string {
  const m = bg.match(/^#([0-9a-fA-F]{6})$/)
  if (!m) return '#fafafa'
  const n = parseInt(m[1]!, 16)
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff
  // Relative luminance: 0.299 R + 0.587 G + 0.114 B (BT.601)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '#0a0a0a' : '#fafafa'
}
