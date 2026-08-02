import { maskProfanity } from '~/utils/profanity'

/**
 * The reading preference: mask profanity in text other people wrote.
 *
 * Distinct from the submission guard in `server/utils/profanity-guard.ts`,
 * which refuses text outright. That one covers names and titles nobody can opt
 * out of seeing; this one is a personal setting over message bodies. Both read
 * the same word list, so they can't disagree about what a word is — this used
 * to keep its own copy of fourteen words while nothing checked submissions at
 * all.
 */
const STORAGE_KEY = 'als-profanity-filter'

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
    return maskProfanity(text)
  }

  return { enabled, setEnabled, filter }
}
