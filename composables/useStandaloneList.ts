/**
 * Reading a custom list as though it were its own site.
 *
 * A community that runs a list here wants a link they can put in a Discord
 * pin — one that opens *their* list, not the ALL with their list inside it.
 * Standalone mode is that link: `?standalone=1` drops the site header and
 * footer, promotes the list's own bar to being the page's header, and leaves a
 * single way back to the main list rather than a whole navigation of it.
 *
 * It lives in the URL rather than in a setting on the list, because it is a
 * property of how someone arrived, not of the list. The same list read from
 * the gallery is still an ordinary page inside this site, and a standalone
 * reader who wants the rest of the site is one click from it.
 *
 * The flag has to survive navigation *within* the list — clicking a level, or
 * the leaderboard tab — so every in-list link is built through `to()`, which
 * carries the query along. Links that leave the list deliberately don't.
 */
export function useStandaloneList() {
  const route = useRoute()

  /** Only ever true on a custom list's own pages. */
  const standalone = computed(
    () => route.query.standalone === '1' && route.path.startsWith('/lists/'),
  )

  /** Spread onto a `<NuxtLink :to>` object, or `undefined` for a plain path. */
  const linkQuery = computed(() => (standalone.value ? { standalone: '1' } : undefined))

  /**
   * An in-list destination that stays in standalone mode.
   *
   * Accepts a path that already carries a query — `…/submit?item=3` — because
   * several call sites build one, and a location object whose `path` contains a
   * `?` has it percent-encoded rather than parsed.
   */
  function to(path: string): string | { path: string; query: Record<string, string> } {
    if (!standalone.value) return path
    const [bare, search = ''] = path.split('?', 2)
    const query: Record<string, string> = { standalone: '1' }
    for (const [k, v] of new URLSearchParams(search)) query[k] = v
    return { path: bare!, query }
  }

  return { standalone, linkQuery, to }
}

/** The shareable form of a list URL, for the copy button in settings. */
export function standaloneUrl(origin: string, publicId: string): string {
  return `${origin.replace(/\/$/, '')}/lists/${publicId}?standalone=1`
}
