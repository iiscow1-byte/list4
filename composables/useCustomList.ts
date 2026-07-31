/**
 * Loads a custom list once per route and shares it across the list's pages,
 * so switching between List / Leaderboard / Queue doesn't refetch the whole
 * thing each time. Keyed by public id so two lists never share a cache entry.
 */
export function useCustomList(publicId: MaybeRefOrGetter<string>) {
  const id = computed(() => toValue(publicId))

  const { data, error, refresh, pending } = useFetch<{
    list: any
    can_edit: boolean
    can_manage: boolean
    editors: { id: number; username: string }[]
    liked_by_me: boolean
  }>(() => `/api/custom-lists/${id.value}`, { key: () => `custom-list-${id.value}` })

  const list = computed(() => data.value?.list ?? null)
  const canEdit = computed(() => !!data.value?.can_edit)
  const canManage = computed(() => !!data.value?.can_manage)
  const editors = computed(() => data.value?.editors ?? [])
  const base = computed(() => `/lists/${id.value}`)

  // The owner's pending-record count drives the Queue tab badge, so it's
  // fetched alongside the list rather than only on the queue page.
  const pendingCount = useState<number>(`cl-pending-${id.value}`, () => 0)
  const suggestionCount = useState<number>(`cl-suggest-${id.value}`, () => 0)
  async function refreshPending() {
    if (!canEdit.value) { pendingCount.value = 0; suggestionCount.value = 0; return }
    // Both badges come from the same permission check, so fetch them together
    // and let one failing not blank the other.
    const [records, suggestions] = await Promise.allSettled([
      $fetch<{ pending_count: number }>(`/api/custom-lists/${id.value}/records`, { query: { status: 'pending' } }),
      $fetch<{ pending_count: number }>(`/api/custom-lists/${id.value}/pending`),
    ])
    pendingCount.value = records.status === 'fulfilled' ? records.value.pending_count : 0
    suggestionCount.value = suggestions.status === 'fulfilled' ? suggestions.value.pending_count : 0
  }
  watch(canEdit, (v) => { if (v) refreshPending() }, { immediate: true })

  const liked = ref(false)
  watch(data, (d) => { liked.value = !!d?.liked_by_me }, { immediate: true })

  async function toggleLike() {
    try {
      const res = await $fetch<{ liked: boolean; likes: number }>(
        `/api/custom-lists/${id.value}/like`, { method: 'POST' },
      )
      liked.value = res.liked
      if (list.value) list.value.likes = res.likes
    } catch { /* not logged in, or list went private */ }
  }

  return {
    data, error, pending, refresh,
    list, canEdit, canManage, editors, base,
    pendingCount, suggestionCount, refreshPending, liked, toggleLike,
  }
}
