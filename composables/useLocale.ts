import { LOCALE_CODES, matchLocale, translate, type LocaleCode } from '~/utils/i18n'

/**
 * The reader's language.
 *
 * Kept in a cookie rather than `localStorage` so the server renders the page in
 * the right language the first time. With `localStorage` the markup would leave
 * the server in English and be swapped out on hydration, which is a visible
 * flash on every navigation and, for a reader who does not read English, a page
 * that is briefly unusable rather than briefly wrong.
 *
 * On a first visit with no cookie the browser's own `Accept-Language` decides.
 * That is a guess, so it is never written back — the cookie is only ever set by
 * somebody choosing a language, which keeps "I picked this" and "we guessed
 * this" distinguishable, and stops a guess from outliving a change of browser
 * settings.
 */
export function useLocale() {
  const cookie = useCookie<string | undefined>('all:lang', {
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    path: '/',
  })

  const guessed = useState<LocaleCode>('locale:guess', () => {
    // `useRequestHeaders` is server-only; on the client the cookie or the
    // already-hydrated state answers instead.
    const header = import.meta.server
      ? useRequestHeaders(['accept-language'])['accept-language']
      : undefined
    return matchLocale(header) ?? 'en'
  })

  const locale = computed<LocaleCode>(() => {
    const c = cookie.value
    return c && LOCALE_CODES.has(c) ? (c as LocaleCode) : guessed.value
  })

  function setLocale(code: LocaleCode) {
    cookie.value = code
  }

  /**
   * Translate one string, keyed by its English text — see `utils/i18n.ts`.
   *
   * Anything with no translation renders as the English it was written in,
   * which is the right failure: a half-translated site is readable, and a site
   * full of `nav.build.label` is not.
   */
  const t = (text: string): string => translate(locale.value, text)

  return { locale, setLocale, t }
}
