<script setup lang="ts">
import { gdLevelUrl } from '~/utils/gd-links'
import { isEmbeddableVideo } from '~/utils/video-embed'
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

const showThumbs = useShowThumbnails()

/**
 * Whether the verification link is playable inline — YouTube, a Medal.tv clip
 * or a clip uploaded here. Anything else falls through to the link card below.
 */
const hasVideoEmbed = computed(() => isEmbeddableVideo(props.level.verification_url))
// No video means no video box — see the matching note in LevelDetail.vue.
const levelUrl = computed(() => gdLevelUrl(props.level.gd_id))

const tagList = computed(() => {
  if (!props.level.tags) return []
  return props.level.tags.split(',').map((t) => t.trim()).filter(Boolean)
})
</script>

<template>
  <div class="relative">
    <!-- The level's thumbnail, fading into the page, as on the main list. -->
    <div v-if="showThumbs" class="absolute inset-x-0 top-0 h-[24rem] overflow-hidden pointer-events-none" aria-hidden="true">
      <LevelThumbBg
        :gd-id="level.gd_id"
        :video-url="level.verification_url"
        res="high"
        priority
        img-class="opacity-45 scale-105"
        overlay-class="bg-gradient-to-b from-zinc-950/20 via-zinc-950/70 to-zinc-950"
      />
    </div>
  <div class="relative px-4 sm:px-8 pt-6 sm:pt-10 pb-12 max-w-4xl mx-auto w-full">
    <header class="mb-6">
      <p class="text-sm font-medium text-sky-300">Awaiting placement</p>
      <h1 class="mt-1 font-display text-3xl sm:text-[2.6rem] sm:leading-[1.1] font-bold tracking-tight text-zinc-50 break-words">{{ level.name }}</h1>
      <p class="text-sm text-zinc-400 mt-2">
        Approved on {{ level.approved_at }}<span v-if="level.submitter">
          · submitted by
          <NuxtLink :to="`/users/${level.submitter}`" class="hover:text-accent">{{ level.submitter }}</NuxtLink>
        </span>
      </p>
    </header>

    <!-- Verification -->
    <VideoEmbed
      v-if="hasVideoEmbed"
      :url="level.verification_url"
      :title="level.verification ?? 'Verification'"
      frame-class="aspect-video rounded-xl border border-zinc-800 bg-black mb-6 overflow-hidden"
    />
    <a
      v-else-if="level.verification_url"
      :href="level.verification_url"
      target="_blank"
      rel="noopener"
      class="block aspect-video rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900 mb-6 relative group overflow-hidden hover:border-accent/40 transition-colors"
    >
      <div class="absolute inset-0 flex items-center justify-center">
        <div class="text-center px-6">
          <div class="w-14 h-14 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center mx-auto mb-3 group-hover:bg-accent/30 transition-colors">
            <svg viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6 text-accent translate-x-0.5">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <p class="text-sm font-medium text-zinc-300 max-w-md mx-auto line-clamp-2">{{ level.verification ?? 'Watch verification' }}</p>
          <p class="text-xs text-zinc-500 mt-2">Open verification ↗</p>
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
        <div class="text-xs text-zinc-500 mb-1">Level ID</div>
        <a
          v-if="levelUrl"
          :href="levelUrl"
          target="_blank"
          rel="noopener"
          class="tabular-nums text-base text-zinc-100 hover:text-accent transition-colors"
        >{{ level.gd_id }}</a>
        <div v-else class="tabular-nums text-base text-zinc-600">—</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-xs text-zinc-500 mb-1">Verify date</div>
        <div class="tabular-nums text-sm text-zinc-100">{{ level.verify_date ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-xs text-zinc-500 mb-1">GDDL Tier</div>
        <div class="text-base text-zinc-100">{{ level.gddl_tier ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-xs text-zinc-500 mb-1">Difficulty</div>
        <div class="text-base text-zinc-100">{{ level.difficulty ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-xs text-zinc-500 mb-1">Skillset</div>
        <div class="text-base text-zinc-100">{{ level.main_skillset ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-xs text-zinc-500 mb-1">Enjoyment</div>
        <div class="tabular-nums text-base text-zinc-100">{{ level.enjoyment != null ? Number(level.enjoyment).toFixed(1) : '—' }}</div>
      </div>
    </div>

    <!-- Verification metadata -->
    <section class="card mb-6">
      <h2 class="text-xs text-zinc-500 px-4 pt-3 font-medium">Verification</h2>
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
      <h3 class="section-title mb-1.5">Notes</h3>
      <p class="text-sm text-zinc-200 whitespace-pre-wrap">{{ level.admin_notes }}</p>
    </section>

    <section v-if="level.notes" class="card px-4 py-3">
      <h3 class="text-sm font-semibold text-zinc-200 mb-1.5">Notes from submitter</h3>
      <p class="text-sm text-zinc-200 whitespace-pre-wrap">{{ level.notes }}</p>
    </section>
  </div>
  </div>
</template>
