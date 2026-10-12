<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { tierColor, textOn } from '~/utils/tier-colors'

/**
 * One level in a list: the rank badge, the name, and the level's thumbnail
 * behind them when thumbnails are on.
 *
 * Every list of levels on the site draws its rows with this (the main list,
 * the void, awaiting and open verification lists, custom lists, the builder,
 * the changelog, profiles), so they look alike and the thumbnail setting
 * reaches all of them. With thumbnails off a row keeps the same size and
 * layout, only without the picture.
 *
 * Anything a list adds to a row goes in a slot, and slot content has to be
 * positioned (`relative`) to paint above the thumbnail. The wrappers here
 * already are.
 */
const props = withDefaults(defineProps<{
  /** Where the row goes. Without it, the row is a button with `button`, or plain. */
  to?: RouteLocationRaw | null
  /** A button that emits `select`, for pickers. */
  button?: boolean
  rank?: string | number | null
  name: string
  /** The level's tier, which colours the badge. */
  tier?: string | null
  /** A badge colour that beats the tier's, like a custom list's own. */
  color?: string | null
  gdId?: number | null
  videoUrl?: string | null
  thumbs?: boolean
  /** The level being read. */
  active?: boolean
  /** Picked in a picker. */
  selected?: boolean
  /** Left the list: dimmed and struck through. */
  removed?: boolean
  compact?: boolean
  /** Classes for the name, to override truncating it. */
  nameClass?: string
  /** Classes for the line under the name, e.g. to show it on phones only. */
  subClass?: string
}>(), {
  to: null,
  rank: null,
  tier: null,
  color: null,
  gdId: null,
  videoUrl: null,
  nameClass: 'truncate',
})
const emit = defineEmits<{ (e: 'select'): void }>()

const NuxtLink = resolveComponent('NuxtLink')
const tag = computed(() => (props.to ? NuxtLink : props.button ? 'button' : 'div'))
const attrs = computed(() => (props.to ? { to: props.to } : props.button ? { type: 'button' } : {}))
const badge = computed(() => props.color ?? tierColor(props.tier))
</script>

<template>
  <component
    :is="tag"
    v-bind="attrs"
    class="level-row group"
    :class="[
      compact ? 'py-1' : 'py-1.5',
      selected ? 'is-selected' : active ? 'is-active' : '',
      removed ? 'is-removed' : '',
    ]"
    :aria-current="active && to ? 'page' : undefined"
    @click="button && emit('select')"
  >
    <!-- At most 22rem wide at the row's right end, fading out to the left: it
         fills a sidebar row, and in a wide list it stays sharp instead of
         stretching. A mask rather than a dark overlay, so it blends into
         whatever is behind the row. -->
    <span v-if="thumbs" class="level-row-thumb" aria-hidden="true">
      <LevelThumbBg
        :gd-id="gdId"
        :video-url="videoUrl"
        res="small"
        sizes="352px"
        :img-class="active || selected ? 'opacity-70' : 'opacity-45 group-hover:opacity-70'"
        overlay-class="bg-zinc-950/30"
      />
    </span>
    <span v-if="$slots.leading" class="relative shrink-0 flex items-center"><slot name="leading" /></span>
    <slot name="rank">
      <span
        v-if="rank != null"
        class="rank-pill"
        :style="{ backgroundColor: badge, color: textOn(badge) }"
        :title="tier ?? undefined"
      >{{ rank }}</span>
    </slot>
    <span class="relative min-w-0 flex-1">
      <slot>
        <span class="block font-medium" :class="nameClass" :title="name">{{ name }}</span>
      </slot>
      <span v-if="$slots.sub" class="block truncate text-[11px] text-zinc-500" :class="subClass"><slot name="sub" /></span>
    </span>
    <span v-if="$slots.trailing" class="relative shrink-0 flex items-center gap-2"><slot name="trailing" /></span>
  </component>
</template>

<style scoped>
.level-row {
  @apply relative overflow-hidden w-full flex items-center gap-2.5 pl-1.5 pr-2.5 rounded-lg text-left text-sm text-zinc-300 transition-colors
         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70;
}
.level-row-thumb {
  @apply absolute inset-y-0 right-0 w-full max-w-[22rem];
  -webkit-mask-image: linear-gradient(to right, transparent, rgb(0 0 0 / 0.6) 45%, #000);
  mask-image: linear-gradient(to right, transparent, rgb(0 0 0 / 0.6) 45%, #000);
}
.level-row:hover {
  @apply text-zinc-50 bg-zinc-900/70;
}
.level-row.is-active {
  @apply text-zinc-50 bg-zinc-900 ring-1 ring-inset ring-accent/70;
}
.level-row.is-selected {
  @apply text-zinc-50 bg-accent/10 ring-2 ring-inset ring-accent;
}
.level-row.is-removed {
  @apply text-zinc-500;
}
.level-row.is-removed :deep(.rank-pill) {
  @apply opacity-50;
}
</style>
