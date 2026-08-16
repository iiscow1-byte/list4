/**
 * The GDSR tier ladder.
 *
 * Taken from the GDSR sheets, which sort levels into named difficulty tiers
 * rather than ranking them — Bronze through Legend, each asking for a number of
 * clears rather than all of them ("Bronze Challenges (Clear Any 9)"). A new
 * GDSR list starts with this ladder so it looks like the thing it is imitating
 * before the author has typed anything; every field stays editable.
 *
 * `requireCount` is the sheet's "Clear Any N". Null means the tier asks for all
 * of its levels.
 */
export type GdsrTierPreset = {
  name: string
  color: string
  requireCount: number | null
}

export const GDSR_TIER_PRESETS: GdsrTierPreset[] = [
  { name: 'Bronze',   color: '#cd7f32', requireCount: 9 },
  { name: 'Silver',   color: '#c0c0c0', requireCount: 13 },
  { name: 'Gold',     color: '#ffd700', requireCount: 7 },
  { name: 'Emerald',  color: '#50c878', requireCount: 5 },
  { name: 'Ruby',     color: '#e0115f', requireCount: 4 },
  { name: 'Diamond',  color: '#b9f2ff', requireCount: 3 },
  { name: 'Amethyst', color: '#9966cc', requireCount: 2 },
  { name: 'Legend',   color: '#ff8c00', requireCount: 1 },
]

/**
 * A readable requirement for a tier.
 *
 *   0 levels          -> "No levels yet"
 *   1 level, required -> "Clear 1"          ("Clear all 1" is not English)
 *   all required      -> "Clear all 6"
 *   some required     -> "Clear any 4 of 9"
 */
export function gdsrRequirementLabel(requireCount: number | null, levelCount: number): string {
  if (levelCount === 0) return 'No levels yet'
  // Null, or a number at least as large as the tier, both mean "all of them".
  if (requireCount == null || requireCount >= levelCount) {
    return levelCount === 1 ? 'Clear 1' : `Clear all ${levelCount}`
  }
  return `Clear any ${requireCount} of ${levelCount}`
}
