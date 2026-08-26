<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

/**
 * The two levels somebody chooses to be known for.
 *
 * Shared for the same reason as the header: this pair existed twice, once on
 * the public profile and once on the account page, and the account copy had
 * already lost the points, the watch link and the favourite's note. Both pages
 * now draw the same card from the same code, which is what "make them similar"
 * has to mean if it is to stay true.
 */
type ShowcaseLevel = {
  position: number
  sheet_placement?: number | null
  name: string
  gd_id: number | null
  gddl_tier?: string | null
  creator?: string | null
  points?: number | null
  percent?: number | null
  video?: string | null
  verification_url?: string | null
}

const props = defineProps<{
  hardest?: ShowcaseLevel | null
  favorite?: ShowcaseLevel | null
  favoriteNote?: string | null
  /** Shown instead of the cards when there is nothing pinned and it's your page. */
  isSelf?: boolean
}>()

function fmt(n: number | null | undefined) {
  if (n == null) return null
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

const cards = computed(() => {
  const out: {
    key: 'hardest' | 'favorite'
    title: string
    tone: string
    level: ShowcaseLevel
    note?: string | null
  }[] = []
  if (props.hardest) {
    out.push({ key: 'hardest', title: 'Hardest completion', tone: 'text-accent', level: props.hardest })
  }
  if (props.favorite) {
    out.push({ key: 'favorite', title: 'Favourite level', tone: 'text-pink-400', level: props.favorite, note: props.favoriteNote })
  }
  return out
})
</script>

<template>
  <section v-if="cards.length" class="grid gap-3 sm:grid-cols-2">
    <article
      v-for="c in cards"
      :key="c.key"
      class="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 group"
    >
      <LevelThumbBg
        :gd-id="c.level.gd_id"
        :video-url="c.level.video ?? c.level.verification_url"
        res="medium"
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 460px"
        img-class="opacity-25 group-hover:opacity-40"
        overlay-class="bg-gradient-to-r from-zinc-950/95 via-zinc-950/80 to-zinc-950/40"
      />
      <div class="relative p-4">
        <h2 class="text-[10px] uppercase tracking-widest font-semibold" :class="c.tone">{{ c.title }}</h2>
        <NuxtLink :to="`/levels/${c.level.position}`" class="mt-1.5 block group/link">
          <span class="text-lg font-bold text-zinc-50 group-hover/link:text-accent transition-colors">{{ c.level.name }}</span>
          <span v-if="c.level.creator" class="block text-[11px] text-zinc-500 truncate">by {{ c.level.creator }}</span>
        </NuxtLink>
        <div class="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span class="tabular-nums rounded px-1.5 py-0.5 bg-zinc-900 text-zinc-300 border border-zinc-800">
            #{{ c.level.sheet_placement ?? c.level.position }}
          </span>
          <span
            v-if="c.level.gddl_tier"
            class="tabular-nums rounded px-1.5 py-0.5 font-semibold"
            :style="{ backgroundColor: tierColor(c.level.gddl_tier), color: textOn(tierColor(c.level.gddl_tier)) }"
          >{{ c.level.gddl_tier }}</span>
          <span v-if="fmt(c.level.points)" class="tabular-nums text-amber-300">{{ fmt(c.level.points) }} pts</span>
          <span v-if="c.level.percent != null && c.level.percent < 100" class="tabular-nums text-zinc-400">{{ c.level.percent }}%</span>
          <a
            v-if="c.level.video"
            :href="c.level.video"
            target="_blank"
            rel="noopener"
            class="text-zinc-500 hover:text-accent transition-colors"
          >watch ↗</a>
        </div>
        <p v-if="c.note" class="mt-2 text-xs text-zinc-400 whitespace-pre-wrap">{{ c.note }}</p>
      </div>
    </article>
  </section>

  <p
    v-else-if="isSelf"
    class="rounded-xl border border-dashed border-zinc-800 px-4 py-5 text-center text-xs text-zinc-500"
  >
    Pick your hardest completion and favourite level below to show them here.
  </p>
</template>
