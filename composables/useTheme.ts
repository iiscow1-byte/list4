/**
 * Runtime theming. Re-themes the site by overriding the CSS variables that the
 * Tailwind config resolves to (see tailwind.config.js + assets/css/main.css).
 *
 * Stored in localStorage as { preset, overrides } so the choice persists.
 * `overrides` is layered on top of the active preset — picking a new preset
 * does NOT wipe per-color overrides; the user can clear them with Reset.
 */

const STORAGE_KEY = 'als-theme'

export type ThemeOverrideKey = 'accent' | 'bg' | 'surface' | 'border' | 'text'
export type ThemeOverrides = Partial<Record<ThemeOverrideKey, string>>

export type ThemeState = {
  preset: string
  overrides: ThemeOverrides
}

type Vars = Record<string, string>

export type Preset = {
  label: string
  swatch: { accent: string; bg: string; surface: string }
  vars: Vars
}

/** Each `--c-...` value is "R G B" so it composes with Tailwind <alpha-value>. */
export const PRESETS: Record<string, Preset> = {
  default: {
    label: 'Amber',
    swatch: { accent: '#f59e0b', bg: '#09090b', surface: '#18181b' },
    vars: {
      '--c-accent':     '245 158 11',
      '--c-accent-dim': '180 83 9',
      '--c-zinc-50':  '250 250 250',
      '--c-zinc-100': '244 244 245',
      '--c-zinc-200': '228 228 231',
      '--c-zinc-300': '212 212 216',
      '--c-zinc-400': '161 161 170',
      '--c-zinc-500': '113 113 122',
      '--c-zinc-600':  '82 82 91',
      '--c-zinc-700':  '63 63 70',
      '--c-zinc-800':  '39 39 42',
      '--c-zinc-900':  '24 24 27',
      '--c-zinc-950':   '9 9 11',
    },
  },
  emerald: {
    label: 'Emerald',
    swatch: { accent: '#10b981', bg: '#020617', surface: '#0f172a' },
    vars: {
      '--c-accent':     '16 185 129',
      '--c-accent-dim': '4 120 87',
      '--c-zinc-50':  '248 250 252',
      '--c-zinc-100': '241 245 249',
      '--c-zinc-200': '226 232 240',
      '--c-zinc-300': '203 213 225',
      '--c-zinc-400': '148 163 184',
      '--c-zinc-500': '100 116 139',
      '--c-zinc-600':  '71 85 105',
      '--c-zinc-700':  '51 65 85',
      '--c-zinc-800':  '30 41 59',
      '--c-zinc-900':  '15 23 42',
      '--c-zinc-950':   '2 6 23',
    },
  },
  rose: {
    label: 'Rose',
    swatch: { accent: '#f43f5e', bg: '#0c0a09', surface: '#1c1917' },
    vars: {
      '--c-accent':     '244 63 94',
      '--c-accent-dim': '190 18 60',
      '--c-zinc-50':  '250 250 249',
      '--c-zinc-100': '245 245 244',
      '--c-zinc-200': '231 229 228',
      '--c-zinc-300': '214 211 209',
      '--c-zinc-400': '168 162 158',
      '--c-zinc-500': '120 113 108',
      '--c-zinc-600':  '87 83 78',
      '--c-zinc-700':  '68 64 60',
      '--c-zinc-800':  '41 37 36',
      '--c-zinc-900':  '28 25 23',
      '--c-zinc-950':  '12 10 9',
    },
  },
  cyan: {
    label: 'Cyan',
    swatch: { accent: '#06b6d4', bg: '#0a0a0a', surface: '#171717' },
    vars: {
      '--c-accent':     '6 182 212',
      '--c-accent-dim': '14 116 144',
      '--c-zinc-50':  '250 250 250',
      '--c-zinc-100': '245 245 245',
      '--c-zinc-200': '229 229 229',
      '--c-zinc-300': '212 212 212',
      '--c-zinc-400': '163 163 163',
      '--c-zinc-500': '115 115 115',
      '--c-zinc-600':  '82 82 82',
      '--c-zinc-700':  '64 64 64',
      '--c-zinc-800':  '38 38 38',
      '--c-zinc-900':  '23 23 23',
      '--c-zinc-950':  '10 10 10',
    },
  },
}

/** Maps the high-level "advanced" controls onto the underlying CSS vars. */
const OVERRIDE_TARGETS: Record<ThemeOverrideKey, string[]> = {
  accent:  ['--c-accent'],
  bg:      ['--c-zinc-950'],
  surface: ['--c-zinc-900'],
  border:  ['--c-zinc-800'],
  text:    ['--c-zinc-100'],
}

export function hexToRgbTriplet(hex: string): string | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i)
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

export function rgbTripletToHex(triplet: string): string {
  const parts = triplet.trim().split(/\s+/).map((p) => Math.max(0, Math.min(255, Number(p) || 0)))
  const [r, g, b] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
}

function defaultState(): ThemeState {
  return { preset: 'default', overrides: {} }
}

export function useTheme() {
  const state = useState<ThemeState>('theme', defaultState)

  function applyToDom() {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const preset = PRESETS[state.value.preset] ?? PRESETS.default!
    for (const [k, v] of Object.entries(preset.vars)) {
      root.style.setProperty(k, v)
    }
    for (const [key, hex] of Object.entries(state.value.overrides)) {
      if (!hex) continue
      const triplet = hexToRgbTriplet(hex)
      if (!triplet) continue
      for (const target of OVERRIDE_TARGETS[key as ThemeOverrideKey]) {
        root.style.setProperty(target, triplet)
      }
    }
  }

  function loadFromStorage() {
    if (typeof localStorage === 'undefined') return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        state.value = {
          preset: typeof parsed.preset === 'string' && PRESETS[parsed.preset] ? parsed.preset : 'default',
          overrides: parsed.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {},
        }
      }
    } catch {
      // ignore corrupted storage
    }
  }

  function saveToStorage() {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.value))
    } catch {
      // ignore quota / private mode
    }
  }

  function setPreset(name: string) {
    if (!PRESETS[name]) return
    state.value = { ...state.value, preset: name }
    applyToDom()
    saveToStorage()
  }

  function setOverride(key: ThemeOverrideKey, hex: string | null) {
    const next = { ...state.value.overrides }
    if (hex == null) delete next[key]
    else next[key] = hex
    state.value = { ...state.value, overrides: next }
    applyToDom()
    saveToStorage()
  }

  function reset() {
    state.value = defaultState()
    applyToDom()
    saveToStorage()
  }

  /** Hex value currently in effect for an override slot — preset value or override. */
  function effectiveHex(key: ThemeOverrideKey): string {
    const o = state.value.overrides[key]
    if (o) return o
    const preset = PRESETS[state.value.preset] ?? PRESETS.default!
    const target = OVERRIDE_TARGETS[key][0]!
    return rgbTripletToHex(preset.vars[target] ?? '0 0 0')
  }

  return {
    state,
    PRESETS,
    applyToDom,
    loadFromStorage,
    setPreset,
    setOverride,
    reset,
    effectiveHex,
  }
}
