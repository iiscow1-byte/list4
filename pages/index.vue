<script setup lang="ts">
const route = useRoute()
const router = useRouter()

const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
const page = ref(Math.max(1, Number(route.query.page) || 1))
const pageSize = 50

let debounce: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    page.value = 1
    router.replace({ query: { ...(v ? { q: v } : {}), page: '1' } })
  }, 250)
})
watch(page, (p) => {
  router.replace({ query: { ...(search.value ? { q: search.value } : {}), page: String(p) } })
})

const { data, pending } = await useFetch('/api/levels', {
  query: computed(() => ({ page: page.value, pageSize, search: search.value })),
})

const totalPages = computed(() => Math.max(1, Math.ceil(((data.value?.total) ?? 0) / pageSize)))

function rankClass(pos: number) {
  if (pos === 1) return 'bg-amber-400 text-amber-950'
  if (pos <= 3) return 'bg-amber-500/20 text-amber-300'
  if (pos <= 10) return 'bg-zinc-300/15 text-zinc-200'
  if (pos <= 50) return 'bg-zinc-700/40 text-zinc-300'
  return 'bg-zinc-800 text-zinc-400'
}
</script>

<template>
  <div class="container-tight py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-semibold tracking-tight">The All Levels List</h1>
      <p class="text-zinc-400 mt-1 text-sm">Every level worth playing, ranked by community vote.</p>
    </div>

    <div class="mb-4">
      <input
        v-model="search"
        type="search"
        placeholder="Search by level or creator..."
        class="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm placeholder:text-zinc-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>

    <div class="text-xs text-zinc-500 mb-3 flex justify-between">
      <span v-if="data">{{ data.total.toLocaleString() }} levels</span>
      <span v-if="pending" class="text-zinc-400">loading…</span>
    </div>

    <ul class="divide-y divide-zinc-900 rounded-md border border-zinc-900 bg-zinc-950 overflow-hidden">
      <li
        v-for="lvl in data?.items ?? []"
        :key="lvl.id"
        class="flex items-center gap-4 px-4 py-3 hover:bg-zinc-900/60 transition-colors"
      >
        <span class="rank-badge" :class="rankClass(lvl.position)">#{{ lvl.position }}</span>
        <div class="flex-1 min-w-0">
          <div class="font-medium truncate">{{ lvl.name }}</div>
          <div class="text-xs text-zinc-500 truncate">
            by {{ lvl.creator }} &middot; verified by {{ lvl.verifier }}
          </div>
        </div>
        <span class="text-xs text-zinc-500 font-mono shrink-0">{{ lvl.min_percent }}%</span>
      </li>
      <li v-if="!pending && (data?.items?.length ?? 0) === 0" class="px-4 py-12 text-center text-sm text-zinc-500">
        No levels matched.
      </li>
    </ul>

    <div v-if="totalPages > 1" class="flex items-center justify-between mt-6 text-sm">
      <button
        class="px-3 py-1.5 rounded border border-zinc-800 text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed"
        :disabled="page <= 1"
        @click="page = Math.max(1, page - 1)"
      >
        ← Prev
      </button>
      <span class="text-zinc-500 font-mono">page {{ page }} / {{ totalPages }}</span>
      <button
        class="px-3 py-1.5 rounded border border-zinc-800 text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed"
        :disabled="page >= totalPages"
        @click="page = Math.min(totalPages, page + 1)"
      >
        Next →
      </button>
    </div>
  </div>
</template>
