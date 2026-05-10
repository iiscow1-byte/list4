<script setup lang="ts">
type AwaitingLevel = {
  id: number
  gd_id: number | null
  name: string
  fps: string | null
  game_version: string | null
  verification: string | null
  verification_url: string | null
  verifier: string | null
  verify_date: string | null
  gddl_tier: string | null
  difficulty: string | null
  enjoyment: number | null
  main_skillset: string | null
  tags: string | null
  notes: string | null
  admin_notes: string | null
  submitter: string | null
  approved_at: string
}

const props = defineProps<{ level: AwaitingLevel }>()

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

const tagList = computed(() => {
  if (!props.level.tags) return []
  return props.level.tags.split(',').map((t) => t.trim()).filter(Boolean)
})
</script>

<template>
  <div class="px-8 py-6 max-w-3xl mx-auto w-full">
    <header class="mb-6">
      <div class="flex items-baseline gap-3 flex-wrap">
        <h1 class="text-3xl font-semibold tracking-tight">{{ level.name }}</h1>
        <span class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-sky-900/40 text-sky-300 border border-sky-800/60">
          Awaiting placement
        </span>
      </div>
      <p class="text-xs text-zinc-500 mt-1.5">
        Approved on {{ level.approved_at }}<span v-if="level.submitter">
          · submitted by
          <NuxtLink :to="`/users/${level.submitter}`" class="hover:text-accent">{{ level.submitter }}</NuxtLink>
        </span>
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
    <div v-if="tagList.length" class="flex flex-wrap items-center gap-2 mb-6">
      <span
        v-for="t in tagList"
        :key="t"
        class="px-2.5 py-1 rounded-full text-[11px] font-medium bg-zinc-900 border border-zinc-800 text-zinc-300 capitalize"
      >
        {{ t === 'uldm' ? 'ULDM' : t }}
      </span>
    </div>

    <!-- Stats grid -->
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-px bg-zinc-800 rounded-md overflow-hidden mb-6">
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
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Verify date</div>
        <div class="tabular-nums text-sm text-zinc-100">{{ level.verify_date ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">GDDL Tier</div>
        <div class="text-base text-zinc-100">{{ level.gddl_tier ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Difficulty</div>
        <div class="text-base text-zinc-100">{{ level.difficulty ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Skillset</div>
        <div class="text-base text-zinc-100">{{ level.main_skillset ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Enjoyment</div>
        <div class="tabular-nums text-base text-zinc-100">{{ level.enjoyment != null ? Number(level.enjoyment).toFixed(1) : '—' }}</div>
      </div>
    </div>

    <!-- Verification metadata -->
    <section class="rounded-md border border-zinc-800 bg-zinc-950/60 mb-6">
      <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 px-4 pt-3 font-medium">Verification</h2>
      <dl class="px-4 py-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt class="text-zinc-500">Verifier</dt><dd class="text-zinc-200">{{ level.verifier ?? '—' }}</dd>
        <dt class="text-zinc-500">Title</dt><dd class="text-zinc-200">{{ level.verification ?? '—' }}</dd>
        <dt class="text-zinc-500">Link</dt>
        <dd class="text-zinc-200 truncate">
          <a v-if="level.verification_url" :href="level.verification_url" target="_blank" rel="noopener" class="text-accent hover:underline break-all">{{ level.verification_url }}</a>
          <span v-else class="text-zinc-600">—</span>
        </dd>
      </dl>
    </section>

    <section v-if="level.admin_notes" class="rounded-md border border-accent/20 bg-accent/5 px-4 py-3 mb-6">
      <h3 class="text-[10px] uppercase tracking-widest text-accent font-medium mb-1.5">Notes</h3>
      <p class="text-sm text-zinc-200 whitespace-pre-wrap">{{ level.admin_notes }}</p>
    </section>

    <section v-if="level.notes" class="rounded-md border border-zinc-800 bg-zinc-950/60 px-4 py-3">
      <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Notes from submitter</h3>
      <p class="text-sm text-zinc-200 whitespace-pre-wrap">{{ level.notes }}</p>
    </section>
  </div>
</template>
