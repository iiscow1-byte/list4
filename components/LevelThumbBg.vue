<script setup lang="ts">
import {
  levelThumbUrl, videoThumbUrl, isKnownThumbMiss, rememberThumbMiss, type ThumbRes,
} from '~/utils/level-thumbs'

/**
 * Absolutely-positioned level thumbnail used as a row / hero background.
 *
 * Tries the community thumbnail first and falls back to the verification
 * video's YouTube thumbnail when there isn't one. Renders nothing until an
 * image actually loads, so a level with neither keeps the plain background
 * instead of flashing a broken image. Parent must be `relative` +
 * `overflow-hidden`.
 *
 * Levels already known to have no community thumbnail skip straight to the
 * video fallback — see `utils/level-thumbs.ts` for that cache.
 */
const props = defineProps<{
  gdId?: number | null
  /** Verification video, used for the fallback thumbnail. */
  videoUrl?: string | null
  res?: ThumbRes
  /** Extra classes for the <img> itself (opacity, hover states, …). */
  imgClass?: string
  /** Tailwind gradient classes painted over the image for text legibility. */
  overlayClass?: string
}>()

const res = computed<ThumbRes>(() => props.res ?? 'small')
const fallbackUrl = computed(() => videoThumbUrl(props.videoUrl, res.value))

type Stage = 'primary' | 'fallback' | 'done'
const stage = ref<Stage>('primary')
const loaded = ref(false)

function initialStage(): Stage {
  if (!props.gdId || isKnownThumbMiss(props.gdId)) {
    return fallbackUrl.value ? 'fallback' : 'done'
  }
  return 'primary'
}

const imgEl = ref<HTMLImageElement | null>(null)

/**
 * A server-rendered <img> often finishes loading (or fails) before hydration
 * attaches these handlers — from cache that's essentially always. The events
 * are gone by then, so `loaded` would stay false and the image would sit at
 * opacity-0 forever: the "thumbnails sometimes don't show after a refresh"
 * bug. Reconcile against the element's own state on mount instead of waiting
 * for an event that has already fired.
 */
function syncFromDom() {
  const el = imgEl.value
  if (!el) return
  if (el.complete) {
    if (el.naturalWidth > 0) loaded.value = true
    else onError()
  }
}

// `isKnownThumbMiss` reads localStorage, so the server has no idea which
// levels are misses. Starting at 'primary' on both sides keeps the markup
// identical during hydration; the cache is consulted once mounted.
onMounted(() => {
  const next = initialStage()
  if (next === stage.value) syncFromDom()
  else stage.value = next
})

// Each stage swaps the src, so re-check once the new <img> is in the DOM.
watch(stage, () => nextTick(syncFromDom))

const url = computed(() => {
  if (stage.value === 'primary') return levelThumbUrl(props.gdId, res.value)
  if (stage.value === 'fallback') return fallbackUrl.value
  return null
})

function onError() {
  if (stage.value === 'primary') {
    rememberThumbMiss(props.gdId)
    stage.value = fallbackUrl.value ? 'fallback' : 'done'
    return
  }
  stage.value = 'done'
}

watch(
  () => [props.gdId, props.videoUrl],
  () => { loaded.value = false; stage.value = import.meta.client ? initialStage() : 'primary' },
)
</script>

<template>
  <div
    v-if="url"
    class="absolute inset-0 pointer-events-none select-none"
    aria-hidden="true"
  >
    <img
      :key="url"
      ref="imgEl"
      :src="url"
      alt=""
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      draggable="false"
      class="w-full h-full object-cover transition-opacity duration-300"
      :class="[imgClass, loaded ? '' : '!opacity-0']"
      @load="loaded = true"
      @error="onError"
    />
    <div v-if="overlayClass && loaded" class="absolute inset-0" :class="overlayClass" />
  </div>
</template>
