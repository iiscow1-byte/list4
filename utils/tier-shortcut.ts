/**
 * Parses a tier shortcut typed in a search box.
 * "[25]"  → "Tier 25"
 * "[S5]"  → "Subtier 5"   (case-insensitive S)
 * Returns null if the input isn't a tier shortcut.
 */
export function parseTierShortcut(q: string): string | null {
  const m = q.trim().match(/^\[([Ss]?)(\d{1,2})\]$/)
  if (!m) return null
  return m[1] ? `Subtier ${Number(m[2])}` : `Tier ${Number(m[2])}`
}
