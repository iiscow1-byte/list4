/**
 * Parses a tier shortcut typed in a search box.
 * "[25]"    → { tier: "Tier 25",   frac: 0.5  }  midpoint of Tier 25
 * "[25.75]" → { tier: "Tier 25",   frac: 0.75 }  75% through Tier 25
 * "[S5]"    → { tier: "Subtier 5", frac: 0.5  }
 * Returns null if the input isn't a tier shortcut.
 */
export type TierShortcut = { tier: string; frac: number }

export function parseTierShortcut(q: string): TierShortcut | null {
  const m = q.trim().match(/^\[([Ss]?)(\d{1,2})(?:\.(\d+))?\]$/)
  if (!m) return null
  const tier = m[1] ? `Subtier ${Number(m[2])}` : `Tier ${Number(m[2])}`
  const frac = m[3] !== undefined ? Math.min(1, parseFloat(`0.${m[3]}`)) : 0.5
  return { tier, frac }
}
