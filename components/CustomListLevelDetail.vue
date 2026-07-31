<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'
import { youtubeIdFrom } from '~/utils/level-thumbs'

/** Centre panel of a custom list: the selected level in full. */
const props = defineProps<{
  item: any
  listTitle: string
  totalItems: number
  canEdit?: boolean
}>()

const videoId = computed(() => youtubeIdFrom(props.item?.verification_url))
</script>

<template>
  <section v-if="item" class="relative min-h-0 overflow-y-auto">
    <!-- Hero backdrop -->
    <div class="absolute inset-x-0 top-0 h-[22rem] overflow-hidden pointer-events-none" aria-hidden="true">
      <LevelThumbBg
        :gd-id="item.gd_id"
        :video-url="item.verification_url"
        res="high"
        img-class="opacity-40 scale-105"
        overlay-class="bg-gradient-to-b from-zinc-950/20 via-zinc-950/70 to-zinc-950"
      />
    </div>

    <div class="relative px-5 sm:px-8 py-6 space-y-6 max-w-4xl mx-auto">
      <header class="space-y-2">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="tabular-nums text-accent text-base font-bold drop-shadow">#{{ item.rank }}</span>
          <span class="text-[11px] text-zinc-400">of {{ totalItems }} on {{ listTitle }}</span>
          <span
            v-if="item.gddl_tier"
            class="text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold"
            :style="{ backgroundColor: tierColor(item.gddl_tier), color: textOn(tierColor(item.gddl_tier)) }"
          >{{ item.gddl_tier }}</span>
        </div>
        <h1 class="text-2xl sm:text-4xl font-bold tracking-tight text-zinc-50 drop-shadow">{{ item.name }}</h1>
        <p class="text-sm text-zinc-300">
          <template v-if="item.creator">by {{ item.creator }}</template>
          <template v-if="item.creator && item.verifier"> · </template>
          <template v-if="item.verifier">verified by {{ item.verifier }}</template>
        </p>
      </header>

      <!-- Verification video -->
      <div v-if="videoId" class="aspect-video rounded-xl overflow-hidden border border-zinc-800 bg-black shadow-xl shadow-black/40">
        <iframe
          :src="`https://www.youtube.com/embed/${videoId}`"
          class="w-full h-full" frameborder="0" allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin" :title="item.name"
        />
      </div>
      <a
        v-else-if="item.verification_url"
        :href="item.verification_url" target="_blank" rel="noopener"
        class="inline-block rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:border-accent/50 hover:text-accent transition-colors"
      >Watch the verification ↗</a>

      <!-- Stats -->
      <dl class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 rounded-xl overflow-hidden">
        <div class="bg-zinc-950 px-3 py-2.5">
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Points</dt>
          <dd class="tabular-nums text-lg font-semibold text-amber-300">{{ item.points }}</dd>
        </div>
        <div class="bg-zinc-950 px-3 py-2.5">
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">To qualify</dt>
          <dd class="tabular-nums text-lg font-semibold text-zinc-100">{{ item.percent_to_qualify }}%</dd>
        </div>
        <div class="bg-zinc-950 px-3 py-2.5">
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Records</dt>
          <dd class="tabular-nums text-lg font-semibold text-zinc-100">{{ item.records.length }}</dd>
        </div>
        <div class="bg-zinc-950 px-3 py-2.5">
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Level ID</dt>
          <dd class="tabular-nums text-sm text-zinc-300 truncate">{{ item.gd_id ?? '—' }}</dd>
        </div>
      </dl>

      <!-- Metadata -->
      <dl class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div v-if="item.difficulty">
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Difficulty</dt>
          <dd class="text-zinc-200">{{ item.difficulty }}</dd>
        </div>
        <div v-if="item.fps">
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">FPS</dt>
          <dd class="text-zinc-200">{{ item.fps }}</dd>
        </div>
        <div v-if="item.game_version">
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Game version</dt>
          <dd class="text-zinc-200">{{ item.game_version }}</dd>
        </div>
        <div v-if="item.position">
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">On the ALL list</dt>
          <dd>
            <NuxtLink :to="`/levels/${item.position}`" class="text-accent hover:underline tabular-nums">
              #{{ item.sheet_placement ?? item.position }}
            </NuxtLink>
          </dd>
        </div>
      </dl>

      <p v-if="item.notes" class="text-sm text-zinc-400 border-l-2 border-zinc-800 pl-3">{{ item.notes }}</p>
    </div>
  </section>

  <section v-else class="flex items-center justify-center text-sm text-zinc-500">
    This list has no levels yet.
  </section>
</template>
