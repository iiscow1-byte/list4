<script setup lang="ts">
const props = defineProps<{ activePosition?: number | null }>()

const route = useRoute()
const router = useRouter()

const search = ref(typeof route.query.q === 'string' ? route.query.q : '')

let debounce: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    router.replace({ query: { ...route.query, q: v || undefined } })
  }, 200)
})

const { data, pending } = await useFetch('/api/levels', {
  query: computed(() => ({ pageSize: 500, search: search.value })),
})

const listEl = ref<HTMLElement | null>(null)
watch(
  () => props.activePosition,
  async (pos) => {
    if (pos == null) return
    await nextTick()
    const el = listEl.value?.querySelector<HTMLElement>(`[data-pos="${pos}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  },
  { immediate: true },
)
</script>

<template>
  <aside class="flex flex-col min-h-0 border-r border-zinc-800 bg-zinc-950">
    <div class="p-3 border-b border-zinc-800 shrink-0">
      <div class="flex items-center gap-2 mb-3 px-1">
        <span class="text-xs uppercase tracking-widest text-accent font-semibold">Classic</span>
      </div>
      <input
        v-model="search"
        type="search"
        placeholder="Search…"
        class="w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>

    <div ref="listEl" class="flex-1 min-h-0 overflow-y-auto">
      <div v-if="pending" class="px-3 py-4 text-xs text-zinc-500">loading…</div>
      <ul v-else class="divide-y divide-zinc-900/60">
        <li v-for="lvl in data?.items ?? []" :key="lvl.position" :data-pos="lvl.position">
          <NuxtLink
            :to="`/levels/${lvl.position}`"
            class="flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-900/70 transition-colors"
            :class="lvl.position === activePosition ? 'bg-accent text-zinc-950 hover:bg-accent' : 'text-zinc-300'"
          >
            <span class="text-xs w-12 shrink-0 tabular-nums" :class="lvl.position === activePosition ? 'text-zinc-950/80' : 'text-zinc-500'">
              #{{ lvl.position }}
            </span>
            <span class="truncate">{{ lvl.name }}</span>
          </NuxtLink>
        </li>
        <li v-if="!pending && (data?.items?.length ?? 0) === 0" class="px-3 py-6 text-xs text-zinc-500 text-center">
          No matches.
        </li>
      </ul>
      <div v-if="data && data.total > (data.items?.length ?? 0)" class="px-3 py-3 text-[11px] text-zinc-600 text-center">
        Showing {{ data.items?.length ?? 0 }} of {{ data.total.toLocaleString() }} — refine your search
      </div>
    </div>
  </aside>
</template>
