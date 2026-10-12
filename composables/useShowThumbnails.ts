/**
 * Whether level thumbnails are shown: behind the rows of every list of levels,
 * and across the top of a level's page. On by default.
 *
 * A cookie rather than localStorage, unlike the other reading preferences, so
 * the server draws the page the way the visitor chose. With localStorage the
 * server can't know, and every list would load one way and then flip.
 */
const COOKIE = 'als_thumbs'
const COOKIE_OPTS = {
  maxAge: 60 * 60 * 24 * 365 * 2,
  sameSite: 'lax' as const,
  path: '/',
  // Kept as the raw '0' / '1'. The default decoder would turn them into numbers.
  decode: (v: string) => v,
  encode: (v: string) => v,
}

export function useShowThumbnails() {
  const cookie = useCookie<string | null>(COOKIE, COOKIE_OPTS)
  const state = useState<boolean>('show_thumbnails', () => cookie.value !== '0')
  return computed({
    get: () => state.value,
    set: (v: boolean) => {
      state.value = v
      cookie.value = v ? '1' : '0'
    },
  })
}
