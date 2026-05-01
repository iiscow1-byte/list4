import type { Ref, WritableComputedRef } from 'vue'

export type LevelMatch = { position: number; name: string }

const PAGE_SIZE = 20

/**
 * Shared autocomplete behavior for the level picker used in record submission:
 * debounced search, paginated infinite scroll, and an exact-name-match pin
 * floated to the top of the result list.
 *
 * The caller owns the search text + currently-selected level; this composable
 * only manages the dropdown state (matches, loading, open/closed).
 */
export function useLevelPicker(
  search: WritableComputedRef<string> | Ref<string>,
  selected: Ref<LevelMatch | null> | { value: LevelMatch | null },
  setSelected: (s: LevelMatch | null) => void,
) {
  const matches = ref<LevelMatch[]>([])
  const open = ref(false)
  const loading = ref(false)
  const page = ref(1)
  const total = ref(0)
  const lastQuery = ref('')
  const scrollEl = ref<HTMLElement | null>(null)
  const setScrollEl = (el: HTMLElement | Element | null) => {
    scrollEl.value = (el as HTMLElement | null) ?? null
  }
  let blurTimer: ReturnType<typeof setTimeout> | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null
  let reqId = 0

  const exact = computed(() => {
    const q = lastQuery.value.trim().toLowerCase()
    if (!q) return null
    return matches.value.find((m) => m.name.toLowerCase() === q) ?? null
  })

  function isExactMatch(l: LevelMatch): boolean {
    return exact.value?.position === l.position
  }

  function reorderForExact(items: LevelMatch[]): LevelMatch[] {
    const q = lastQuery.value.trim().toLowerCase()
    if (!q) return items
    const exactIdx = items.findIndex((m) => m.name.toLowerCase() === q)
    if (exactIdx <= 0) return items
    const copy = items.slice()
    const [hit] = copy.splice(exactIdx, 1)
    copy.unshift(hit!)
    return copy
  }

  async function loadPage(p: number) {
    const q = lastQuery.value
    if (!q.trim()) return
    loading.value = true
    const myReq = ++reqId
    try {
      const res = await $fetch<{ items: LevelMatch[]; total: number }>('/api/levels', {
        query: { search: q.trim(), pageSize: PAGE_SIZE, page: p },
      })
      if (myReq !== reqId || lastQuery.value !== q) return
      total.value = res.total
      page.value = p
      const merged = p === 1 ? res.items : [...matches.value, ...res.items]
      // De-dup in case a row appears across pages (it shouldn't with stable
      // ordering, but cheap insurance).
      const seen = new Set<number>()
      const dedup = merged.filter((m) => (seen.has(m.position) ? false : (seen.add(m.position), true)))
      matches.value = reorderForExact(dedup)
      open.value = matches.value.length > 0
    } catch {
      if (myReq !== reqId) return
      matches.value = []
      open.value = false
    } finally {
      if (myReq === reqId) loading.value = false
    }
  }

  watch(search, (v) => {
    if (selected.value && v !== `#${selected.value.position} ${selected.value.name}`) {
      setSelected(null)
    }
    if (selected.value) {
      matches.value = []
      open.value = false
      return
    }
    if (debounce) clearTimeout(debounce)
    if (!v.trim()) {
      matches.value = []
      open.value = false
      lastQuery.value = ''
      return
    }
    debounce = setTimeout(() => {
      lastQuery.value = v
      page.value = 1
      total.value = 0
      loadPage(1)
    }, 200)
  })

  function pick(l: LevelMatch) {
    setSelected(l)
    if ('value' in (search as any)) (search as any).value = `#${l.position} ${l.name}`
    matches.value = []
    open.value = false
  }

  function onScroll() {
    const el = scrollEl.value
    if (!el || loading.value) return
    if (matches.value.length >= total.value) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      loadPage(page.value + 1)
    }
  }

  function openIfHasMatches() {
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = null }
    if (matches.value.length) open.value = true
  }
  function scheduleClose() {
    if (blurTimer) clearTimeout(blurTimer)
    blurTimer = setTimeout(() => { open.value = false }, 150)
  }

  return {
    matches, open, loading, scrollEl,
    setScrollEl, isExactMatch, pick, onScroll,
    openIfHasMatches, scheduleClose,
  }
}
