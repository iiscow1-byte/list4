/**
 * Restore the user's saved theme on app mount, before the first paint sees it.
 * Client-only: SSR renders with defaults, the plugin re-applies once mounted.
 */
export default defineNuxtPlugin(() => {
  const { loadFromStorage, applyToDom } = useTheme()
  loadFromStorage()
  applyToDom()
})
