/**
 * Whether to show view counts anywhere on the site.
 *
 * A reading preference, like `useTierDecimal` beside it. The count is the one
 * number on a level that reflects readers rather than curators, which is
 * precisely why some people would rather not see it — a popularity figure next
 * to a difficulty ranking invites a comparison the list is not making.
 *
 * On by default: the number is public and useful, and a setting that starts
 * switched off is a feature nobody finds.
 *
 * ## Why this is persisted by hand
 *
 * `useState` alone is per-request server state and resets on every navigation
 * that reloads the app. The preference has to survive a reload or it isn't a
 * preference. It is read on mount rather than during setup because
 * `localStorage` does not exist on the server, and a value read there would
 * make the server's markup disagree with the browser's on hydration.
 */
const STORAGE_KEY = 'als:show-views'

export function useShowViews() {
  const enabled = useState<boolean>('show_views_enabled', () => true)

  // Guarded so a component tree with several callers doesn't attach several
  // watchers to the same piece of state.
  const wired = useState<boolean>('show_views_wired', () => false)

  onMounted(() => {
    if (wired.value) return
    wired.value = true
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw !== null) enabled.value = raw === '1'
    } catch { /* private mode — the default stands */ }
    watch(enabled, (v) => {
      try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0') } catch { /* ignore quota */ }
    })
  })

  return enabled
}
