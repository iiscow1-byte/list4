<script setup lang="ts">
/**
 * Admin tool: spin a custom list out of a slice of the ALL list. Useful for
 * building a themed list (a tier bracket, a rating band, the top N) without
 * dragging every level in by hand — the result is an ordinary custom list the
 * admin owns and can then edit in the builder.
 */
const { loadFrom } = useListBuilder()
const router = useRouter()

const TIERS = [
  '', 'Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5', 'Tier 6', 'Tier 7', 'Tier 8',
  'Tier 9', 'Tier 10', 'Tier 11', 'Tier 12', 'Tier 13', 'Tier 14', 'Tier 15', 'Tier 16',
  'Tier 17', 'Tier 18', 'Tier 19', 'Tier 20', 'Tier 21', 'Tier 22', 'Tier 23', 'Tier 24',
  'Tier 25', 'Tier 26', 'Tier 27', 'Tier 28', 'Tier 29', 'Tier 30', 'Tier 31', 'Tier 32',
  'Tier 33', 'Tier 34', 'Tier 35', 'Tier 36', 'Tier 37', 'Tier 38', 'Tier 39',
  'Subtier 0', 'Subtier 1', 'Subtier 2', 'Subtier 3', 'Subtier 4', 'Subtier 5',
]
const RATINGS = ['', 'Challenge', 'Unrated', 'Rated', 'Featured', 'Epic', 'Legendary', 'Mythic']

const form = reactive({
  title: '',
  description: '',
  from_position: '1',
  to_position: '50',
  tier: '',
  rated: '',
  limit: '100',
  is_public: false,
})

const busy = ref(false)
const error = ref<string | null>(null)
const created = ref<{ public_id: string; title: string; count: number } | null>(null)

/** Live count of what the current filters would pull in. */
const previewCount = ref<number | null>(null)
const previewing = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | null = null

const previewSample = ref<{ position: number; sheet_placement: number | null; name: string }[]>([])

async function runPreview() {
  previewing.value = true
  try {
    const res = await $fetch<{ total: number; sample: typeof previewSample.value }>(
      '/api/admin/custom-list-preview',
      {
        query: {
          from_position: Number(form.from_position) || undefined,
          to_position: Number(form.to_position) || undefined,
          tier: form.tier || undefined,
          rated: form.rated || undefined,
        },
      },
    )
    previewCount.value = res.total
    previewSample.value = res.sample
  } catch {
    previewCount.value = null
    previewSample.value = []
  } finally {
    previewing.value = false
  }
}
watch(
  () => [form.from_position, form.to_position, form.tier, form.rated],
  () => {
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = setTimeout(runPreview, 400)
  },
  { immediate: true },
)

const willTake = computed(() => {
  const cap = Number(form.limit) || 0
  if (previewCount.value == null) return null
  return Math.min(previewCount.value, cap || previewCount.value)
})

async function create(openInBuilder: boolean) {
  if (busy.value) return
  busy.value = true
  error.value = null
  created.value = null
  try {
    const res = await $fetch<{ list: any; count: number }>('/api/admin/custom-list-from-levels', {
      method: 'POST',
      body: {
        title: form.title.trim() || undefined,
        description: form.description.trim() || undefined,
        from_position: Number(form.from_position) || undefined,
        to_position: Number(form.to_position) || undefined,
        tier: form.tier || undefined,
        rated: form.rated || undefined,
        limit: Number(form.limit) || undefined,
        is_public: form.is_public,
      },
    })
    created.value = { public_id: res.list.public_id, title: res.list.title, count: res.count }
    if (openInBuilder) {
      loadFrom(res.list)
      await router.push('/builder')
    }
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not create the list.'
  } finally {
    busy.value = false
  }
}

const field = 'mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'
const label = 'text-[10px] uppercase tracking-widest text-zinc-500 font-medium'
</script>

<template>
  <div class="space-y-4">
    <header>
      <h2 class="text-sm font-semibold text-zinc-100">Create a custom list from the ALL list</h2>
      <p class="text-xs text-zinc-500 mt-1">
        Pick a slice of the list and turn it into a custom list you own. It behaves like any
        other custom list — leaderboard, records, packs — and you can reorder it in the builder.
      </p>
    </header>

    <div class="card p-4 grid gap-3 sm:grid-cols-2">
      <label class="block sm:col-span-2">
        <span :class="label">Title</span>
        <input v-model="form.title" type="text" placeholder="Top 50 of the ALL list" :class="field" />
      </label>
      <label class="block sm:col-span-2">
        <span :class="label">Description</span>
        <input v-model="form.description" type="text" placeholder="Optional" :class="field" />
      </label>

      <label class="block">
        <span :class="label">From placement</span>
        <input v-model="form.from_position" inputmode="numeric" :class="field" />
      </label>
      <label class="block">
        <span :class="label">To placement</span>
        <input v-model="form.to_position" inputmode="numeric" :class="field" />
      </label>

      <label class="block">
        <span :class="label">Tier</span>
        <select v-model="form.tier" :class="field">
          <option v-for="t in TIERS" :key="t" :value="t">{{ t || 'Any tier' }}</option>
        </select>
      </label>
      <label class="block">
        <span :class="label">Rating</span>
        <select v-model="form.rated" :class="field">
          <option v-for="r in RATINGS" :key="r" :value="r">{{ r || 'Any rating' }}</option>
        </select>
      </label>

      <label class="block">
        <span :class="label">Max levels</span>
        <input v-model="form.limit" inputmode="numeric" :class="field" />
      </label>
      <label class="flex items-end gap-2 pb-1.5 cursor-pointer select-none">
        <input v-model="form.is_public" type="checkbox" class="accent-accent" />
        <span class="text-xs text-zinc-400">Publish to the gallery</span>
      </label>

      <div class="sm:col-span-2">
        <p class="text-[11px] text-zinc-500 tabular-nums">
          <template v-if="previewing">Counting matching levels…</template>
          <template v-else-if="previewCount == null">Set a range to see how many levels match.</template>
          <template v-else>
            {{ previewCount.toLocaleString() }} level{{ previewCount === 1 ? '' : 's' }} match —
            <span class="text-zinc-300">{{ willTake?.toLocaleString() }}</span> will be added.
          </template>
        </p>
        <p v-if="previewSample.length" class="text-[11px] text-zinc-600 truncate mt-0.5">
          Starting with:
          <span v-for="(s, i) in previewSample" :key="s.position">
            <span v-if="i"> · </span>#{{ s.sheet_placement ?? s.position }} {{ s.name }}
          </span>
        </p>
      </div>

      <div class="sm:col-span-2 flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          :disabled="busy"
          class="rounded-lg bg-accent text-zinc-950 font-semibold text-xs px-3 py-1.5 hover:bg-accent/90 disabled:opacity-50 transition-colors"
          @click="create(false)"
        >{{ busy ? 'Creating…' : 'Create list' }}</button>
        <button
          type="button"
          :disabled="busy"
          class="rounded-lg border border-zinc-700 text-zinc-200 text-xs px-3 py-1.5 hover:border-accent/60 hover:text-accent disabled:opacity-50 transition-colors"
          @click="create(true)"
        >Create and open in builder</button>
        <span v-if="error" class="text-xs text-red-400">{{ error }}</span>
      </div>

      <p v-if="created" class="sm:col-span-2 text-xs text-emerald-400">
        Created “{{ created.title }}” with {{ created.count }} levels —
        <NuxtLink :to="`/lists/${created.public_id}`" class="underline hover:text-emerald-300">open it →</NuxtLink>
      </p>
    </div>
  </div>
</template>
