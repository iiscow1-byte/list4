const STORAGE_KEY = 'als-profanity-filter'

const WORDS = [
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'whore', 'slut',
]

const PATTERN = new RegExp(
  WORDS.map((w) => `\\b${w}s?\\b`).join('|'),
  'gi',
)

let _enabled: ReturnType<typeof useState<boolean>> | null = null

export function useProfanityFilter() {
  if (!_enabled) {
    const stored = import.meta.client ? localStorage.getItem(STORAGE_KEY) : null
    _enabled = useState<boolean>('profanity-filter', () => stored !== 'off')
  }
  const enabled = _enabled!

  function setEnabled(val: boolean) {
    enabled.value = val
    if (import.meta.client) localStorage.setItem(STORAGE_KEY, val ? 'on' : 'off')
  }

  function filter(text: string): string {
    if (!enabled.value) return text
    return text.replace(PATTERN, (m) => '*'.repeat(m.length))
  }

  return { enabled, setEnabled, filter }
}
