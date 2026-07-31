<script setup lang="ts">
import { levelThumbUrl, type ThumbRes } from '~/utils/level-thumbs'

/**
 * Absolutely-positioned level thumbnail used as a row / hero background.
 * Renders nothing until the image actually loads, so levels without a
 * thumbnail (the API 404s) keep the plain flat background instead of a
 * broken-image flash. Parent must be `relative` + `overflow-hidden`.
 */
const props = defineProps<{
  gdId?: number | null
  res?: ThumbRes
  /** Extra classes for the <img> itself (opacity, hover states, …). */
  imgClass?: string
  /** Tailwind gradient classes painted over the image for text legibility. */
  overlayClass?: string
}>()

const failed = ref(false)
const loaded = ref(false)
const url = computed(() => levelThumbUrl(props.gdId, props.res ?? 'small'))
watch(() => props.gdId, () => { failed.value = false; loaded.value = false })
</script>

<template>
  <div
    v-if="url && !failed"
    class="absolute inset-0 pointer-events-none select-none"
    aria-hidden="true"
  >
    <img
      :src="url"
      alt=""
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      draggable="false"
      class="w-full h-full object-cover transition-opacity duration-300"
      :class="[imgClass, loaded ? '' : '!opacity-0']"
      @load="loaded = true"
      @error="failed = true"
    />
    <div v-if="overlayClass && loaded" class="absolute inset-0" :class="overlayClass" />
  </div>
</template>
