<script setup lang="ts">
import { LIST_SOURCES, findListSource } from '~/utils/list-source-catalog'
import { TIER_MAX_NUMBER } from '~/utils/tier-ordinal'

/**
 * Admin tool: spin a custom list out of a slice of any list the site imports.
 *
 * Useful for building a themed list (a tier bracket, a rating band, the top N,
 * all of CCL) without dragging every level in by hand — the result is an
 * ordinary custom list the admin owns and can then edit in the builder.
 */
const { loadFrom } = useListBuilder()
const router = useRouter()

// Ascending tiers then the subtiers, which is the order this dropdown has
// always read in. Derived from `TIER_MAX_NUMBER` so raising the ceiling adds
// the new tiers here without anyone remembering to.
const TIERS = [
  '',
  ...Array.from({ length: TIER_MAX_NUMBER }, (_, i) => `Tier ${i + 1}`),
  'Subtier 0', 'Subtier 1', 'Subtier 2', 'Subtier 3', 'Subtier 4', 'Subtier 5',
]
const RATINGS = ['', 'Challenge', 'Unrated', 'Rated', 'Featured', 'Epic', 'Legendary', 'Mythic']

const form = reactive({
  title: '',
  description: '',
  source: 'all',
  from_position: '1',
  to_position: '50',
  tier: '',
  rated: '',
  limit: '100',
  is_public: false,
})

/** The tier / rating filters only mean anything for the ALL list. */
const activeSource = computed(() => findListSource(form.source))
const supportsFilters = computed(() => !!activeSource.value?.supportsFilters)

// Switching to a mirror clears filters it can't honour, so the preview count
// never reflects a filter the create call is about to ignore.
watch(supportsFilters, (ok) => {
  if (!ok) { form.tier = ''; form.rated = '' }
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
          source: form.source,
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
  () => [form.source, form.from_position, form.to_position, form.tier, form.rated],
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
        source: form.source,
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

const field = 'mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-40'
const label = 'text-[10px] uppercase tracking-widest text-zinc-500 font-medium'
</script>

<template>
  <div class="space-y-4">
    <header>
      <h2 class="text-sm font-semibold text-zinc-100">Create a custom list from an imported list</h2>
      <p class="text-xs text-zinc-500 mt-1">
        Pick a slice of the ALL list — or of any list the site mirrors — and turn it into a
        custom list you own. It behaves like any other custom list (leaderboard, records,
        packs) and you can reorder it in the builder. Levels that also exist on the ALL list
        stay linked to it.
      </p>
    </header>

    <div class="card p-4 grid gap-3 sm:grid-cols-2">
      <!-- Source: the toggle between the ALL list and every mirror -->
      <div class="sm:col-span-2">
        <span :class="label">Source list</span>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          <button
            v-for="s in LIST_SOURCES"
            :key="s.key"
            type="button"
            class="rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors"
            :class="form.source === s.key
              ? 'border-accent/60 text-accent bg-accent/10'
              : 'border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'"
            :title="s.hint"
            @click="form.source = s.key"
          >{{ s.label.split(' — ')[0] }}</button>
        </div>
        <p v-if="activeSource" class="mt-1 text-[11px] text-zinc-600">
          {{ activeSource.label }} · {{ activeSource.hint }}
        </p>
      </div>

      <label class="block sm:col-span-2">
        <span :class="label">Title</span>
        <input v-model="form.title" type="text" placeholder="Leave blank to name it automatically" :class="field" />
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
        <select v-model="form.tier" :class="field" :disabled="!supportsFilters">
          <option v-for="t in TIERS" :key="t" :value="t">{{ t || 'Any tier' }}</option>
        </select>
        <span v-if="!supportsFilters" class="text-[10px] text-zinc-600">ALL list only</span>
      </label>
      <label class="block">
        <span :class="label">Rating</span>
        <select v-model="form.rated" :class="field" :disabled="!supportsFilters">
          <option v-for="r in RATINGS" :key="r" :value="r">{{ r || 'Any rating' }}</option>
        </select>
        <span v-if="!supportsFilters" class="text-[10px] text-zinc-600">ALL list only</span>
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
          <template v-else-if="previewCount === 0">Nothing matches — has this list been imported yet?</template>
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
          :disabled="busy || previewCount === 0"
          class="rounded-lg bg-accent text-zinc-950 font-semibold text-xs px-3 py-1.5 hover:bg-accent/90 disabled:opacity-50 transition-colors"
          @click="create(false)"
        >{{ busy ? 'Creating…' : 'Create list' }}</button>
        <button
          type="button"
          :disabled="busy || previewCount === 0"
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
