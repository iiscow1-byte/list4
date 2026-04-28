<script setup lang="ts">
type Level = {
  position: number
  name: string
  gd_id: number | null
  gddl_tier: string | null
  rated: string | null
  difficulty: string | null
  placement_source: string | null
  points: number | null
  main_skillset: string | null
  verify_date: string | null
  verification: string | null
  verification_url: string | null
  pov_placement: number | null
  year_verified: number | null
  source_tab: string | null
}

const props = defineProps<{ level: Level }>()

const tags = computed(() => {
  const list: string[] = []
  if (props.level.gddl_tier) list.push(props.level.gddl_tier)
  if (props.level.difficulty) list.push(props.level.difficulty)
  if (props.level.main_skillset) list.push(props.level.main_skillset)
  if (props.level.rated) list.push(props.level.rated)
  return list
})

/** Pull a YouTube video ID from any of the URL forms YouTube uses. */
function youtubeId(url: string | null): string | null {
  if (!url) return null
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{6,})/,
    /youtu\.be\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/,
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (m) return m[1]!
  }
  return null
}

const ytId = computed(() => youtubeId(props.level.verification_url))
const fallbackSearch = computed(() => {
  if (!props.level.verification) return null
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(props.level.verification)}`
})

const gdLevelUrl = computed(() => {
  if (!props.level.gd_id) return null
  return `https://gdbrowser.com/${props.level.gd_id}`
})

function formatPoints(n: number | null) {
  if (n == null) return '—'
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return n.toFixed(2)
}
</script>

<template>
  <div class="px-8 py-6 max-w-3xl mx-auto w-full">
    <header class="mb-6">
      <div class="flex items-baseline gap-3 flex-wrap">
        <span class="tabular-nums text-accent text-sm">#{{ level.position }}</span>
        <h1 class="text-3xl font-semibold tracking-tight">{{ level.name }}</h1>
      </div>
      <p v-if="level.placement_source || level.year_verified" class="text-xs text-zinc-500 mt-1.5">
        <span v-if="level.placement_source">Source: {{ level.placement_source }}</span>
        <span v-if="level.placement_source && level.year_verified" class="mx-2">·</span>
        <span v-if="level.year_verified">verified {{ level.year_verified }}</span>
      </p>
    </header>

    <!-- Verification: real embed if YouTube; link card otherwise -->
    <div v-if="ytId" class="aspect-video rounded-md border border-zinc-800 bg-black mb-6 overflow-hidden">
      <iframe
        :src="`https://www.youtube.com/embed/${ytId}`"
        class="w-full h-full"
        :title="level.verification ?? 'Verification'"
        frameborder="0"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      />
    </div>
    <a
      v-else-if="level.verification_url || fallbackSearch"
      :href="(level.verification_url ?? fallbackSearch)!"
      target="_blank"
      rel="noopener"
      class="block aspect-video rounded-md border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900 mb-6 relative group overflow-hidden hover:border-accent/40 transition-colors"
    >
      <div class="absolute inset-0 flex items-center justify-center">
        <div class="text-center px-6">
          <div class="w-14 h-14 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center mx-auto mb-3 group-hover:bg-accent/30 transition-colors">
            <svg viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6 text-accent translate-x-0.5">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <p class="text-sm font-medium text-zinc-300 max-w-md mx-auto line-clamp-2">{{ level.verification ?? 'Watch verification' }}</p>
          <p class="text-[11px] text-zinc-500 mt-2 uppercase tracking-wider">
            {{ level.verification_url ? 'Open verification ↗' : 'Search YouTube' }}
          </p>
        </div>
      </div>
    </a>

    <!-- Tags -->
    <div v-if="tags.length" class="flex flex-wrap gap-2 mb-6">
      <span
        v-for="t in tags"
        :key="t"
        class="px-2.5 py-1 rounded-full text-[11px] font-medium bg-zinc-900 border border-zinc-800 text-zinc-300"
      >
        {{ t }}
      </span>
    </div>

    <!-- Stats grid -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 rounded-md overflow-hidden mb-3">
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Level ID</div>
        <a
          v-if="gdLevelUrl"
          :href="gdLevelUrl"
          target="_blank"
          rel="noopener"
          class="tabular-nums text-base text-zinc-100 hover:text-accent transition-colors"
        >{{ level.gd_id }}</a>
        <div v-else class="tabular-nums text-base text-zinc-600">—</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">List Points</div>
        <div class="tabular-nums text-base text-amber-300">{{ formatPoints(level.points) }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">GDDL Tier</div>
        <div class="tabular-nums text-base text-zinc-100">{{ level.gddl_tier ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Verify Date</div>
        <div class="tabular-nums text-sm text-zinc-100">{{ level.verify_date ?? '—' }}</div>
      </div>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 rounded-md overflow-hidden mb-6">
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Difficulty</div>
        <div class="text-sm text-zinc-100">{{ level.difficulty ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Rated</div>
        <div class="text-sm text-zinc-100">{{ level.rated ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Main Skillset</div>
        <div class="text-sm text-zinc-100">{{ level.main_skillset ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">POV Placement</div>
        <div class="tabular-nums text-sm text-zinc-100">{{ level.pov_placement ?? '—' }}</div>
      </div>
    </div>

    <!-- Metadata block -->
    <section class="rounded-md border border-zinc-800 bg-zinc-950/60 mb-6">
      <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 px-4 pt-3 font-medium">Information</h2>
      <dl class="px-4 py-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt class="text-zinc-500">Source list</dt><dd class="text-zinc-200">{{ level.placement_source ?? '—' }}</dd>
        <dt class="text-zinc-500">Imported from</dt><dd class="text-zinc-400 text-xs">{{ level.source_tab ?? '—' }}</dd>
        <dt class="text-zinc-500">Verification</dt>
        <dd class="text-zinc-200 truncate" :title="level.verification ?? ''">{{ level.verification ?? '—' }}</dd>
        <dt class="text-zinc-500">Year verified</dt><dd class="text-zinc-200">{{ level.year_verified ?? '—' }}</dd>
      </dl>
    </section>

    <!-- Position history (sheet doesn't expose this — placeholder) -->
    <section class="rounded-md border border-zinc-800 bg-zinc-950/60">
      <h2 class="text-[10px] uppercase tracking-[0.2em] tabular-nums text-zinc-500 px-4 pt-3 pb-2 flex items-center gap-2">
        Position History
        <span class="text-[10px] text-zinc-600 normal-case tracking-normal">— not tracked in this dataset</span>
      </h2>
      <div class="px-4 pb-4 text-xs text-zinc-600">
        No placement history available. Current placement: <span class="text-zinc-300 tabular-nums">#{{ level.position }}</span>.
      </div>
    </section>
  </div>
</template>
