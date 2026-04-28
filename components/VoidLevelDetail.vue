<script setup lang="ts">
type VoidLevel = {
  position: number
  name: string
  gd_id: number | null
  verify_date: string | null
  days: number | null
  demon_ranking: string | null
  placement_source: string | null
  verification: string | null
  verification_url: string | null
  added_on: string | null
}

const props = defineProps<{ level: VoidLevel }>()

const tags = computed(() => {
  const list: string[] = []
  if (props.level.demon_ranking) list.push(props.level.demon_ranking)
  if (props.level.placement_source) list.push(props.level.placement_source)
  return list
})

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
const gdLevelUrl = computed(() => props.level.gd_id ? `https://gdbrowser.com/${props.level.gd_id}` : null)
</script>

<template>
  <div class="px-8 py-6 max-w-3xl mx-auto w-full">
    <header class="mb-6">
      <div class="flex items-baseline gap-3 flex-wrap">
        <span class="tabular-nums text-fuchsia-300 text-sm">#{{ level.position }}</span>
        <h1 class="text-3xl font-semibold tracking-tight">{{ level.name }}</h1>
        <span class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-fuchsia-900/40 text-fuchsia-300 border border-fuchsia-800/60">
          Void
        </span>
      </div>
      <p class="text-xs text-zinc-500 mt-1.5">
        Levels in the void list have no difficulty opinion.
      </p>
    </header>

    <!-- Verification -->
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
    <div v-if="tags.length" class="flex flex-wrap items-center gap-2 mb-6">
      <span
        v-for="t in tags"
        :key="t"
        class="px-2.5 py-1 rounded-full text-[11px] font-medium bg-zinc-900 border border-zinc-800 text-zinc-300"
      >
        {{ t }}
      </span>
    </div>

    <!-- Stats grid -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 rounded-md overflow-hidden mb-6">
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
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Days</div>
        <div class="tabular-nums text-base text-zinc-100">{{ level.days != null ? level.days.toLocaleString() : '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Verify date</div>
        <div class="tabular-nums text-sm text-zinc-100">{{ level.verify_date ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Added to pending</div>
        <div class="tabular-nums text-sm text-zinc-100">{{ level.added_on ?? '—' }}</div>
      </div>
    </div>

    <!-- Source / verification metadata -->
    <section class="rounded-md border border-zinc-800 bg-zinc-950/60">
      <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 px-4 pt-3 font-medium">Information</h2>
      <dl class="px-4 py-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt class="text-zinc-500">Source</dt><dd class="text-zinc-200">{{ level.placement_source ?? '—' }}</dd>
        <dt class="text-zinc-500">Demon ranking</dt><dd class="text-zinc-200">{{ level.demon_ranking ?? '—' }}</dd>
        <dt class="text-zinc-500">Verification</dt>
        <dd class="text-zinc-200 truncate" :title="level.verification ?? ''">{{ level.verification ?? '—' }}</dd>
      </dl>
    </section>
  </div>
</template>
