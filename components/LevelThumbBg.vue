<script setup lang="ts">
import {
  levelThumbUrl, levelThumbSrcset, videoThumbUrl, videoThumbUrlMax,
  isKnownThumbMiss, rememberThumbMiss,
  isKnownMaxresMiss, rememberMaxresMiss, youtubeIdFrom,
  THUMB_SIZES, type ThumbRes,
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
 *
 * ## Resolution
 *
 * `res` is a **ceiling**, not a choice. Every size up to it is offered as a
 * `srcset` and the browser picks using `sizes` and the device's pixel ratio.
 * That cuts both ways, which is the point: a full-bleed header on a phone stops
 * downloading the 1.35 MB 1920 px file it cannot show, and the same header on a
 * HiDPI desktop stops stretching a 640 px one across 1400 px. The ceiling is
 * what keeps a 50-row list from ever reaching for the big files at all.
 */
const props = defineProps<{
  gdId?: number | null
  /** Verification video, used for the fallback thumbnail. */
  videoUrl?: string | null
  /** Largest size worth fetching here. Defaults to `small`. */
  res?: ThumbRes
  /**
   * The element's rendered width, in `sizes` syntax. The component cannot
   * measure its own parent, so a call site with an unusual layout should say;
   * otherwise a sensible default for `res` is used.
   */
  sizes?: string
  /**
   * Above the fold. Loads eagerly at high priority instead of lazily at low —
   * for the one hero image a page opens on, never for rows.
   */
  priority?: boolean
  /** Extra classes for the <img> itself (opacity, hover states, …). */
  imgClass?: string
  /** Tailwind gradient classes painted over the image for text legibility. */
  overlayClass?: string
}>()

const res = computed<ThumbRes>(() => props.res ?? 'small')
const sizes = computed(() => props.sizes ?? THUMB_SIZES[res.value])

/**
 * Stages, in the order they are tried:
 *   primary   — the community thumbnail
 *   videoMax  — YouTube's 1280×720, large contexts only; often missing
 *   video     — YouTube's hqdefault, which always exists
 *   done      — nothing to show
 */
type Stage = 'primary' | 'videoMax' | 'video' | 'done'
const stage = ref<Stage>('primary')
const loaded = ref(false)

const videoId = computed(() => youtubeIdFrom(props.videoUrl))
const videoMaxUrl = computed(() =>
  res.value === 'small' ? null : videoThumbUrlMax(props.videoUrl),
)
const videoUrl = computed(() => videoThumbUrl(props.videoUrl, res.value))

/**
 * The first video stage worth trying, or 'done' when there is no video.
 *
 * A video already known to have no HD thumbnail skips straight past that stage,
 * the same way a level known to have no community image skips 'primary'. Only
 * consulted on the client: the cache is localStorage, and a server render that
 * read it would produce markup the browser then has to correct.
 */
function firstVideoStage(): Stage {
  if (videoMaxUrl.value && !(import.meta.client && isKnownMaxresMiss(videoId.value))) return 'videoMax'
  return videoUrl.value ? 'video' : 'done'
}

function initialStage(): Stage {
  if (!props.gdId || isKnownThumbMiss(props.gdId)) return firstVideoStage()
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
  if (stage.value === 'videoMax') return videoMaxUrl.value
  if (stage.value === 'video') return videoUrl.value
  return null
})

/**
 * Only the community thumbnail comes in several sizes. YouTube's are fixed, so
 * offering one as a srcset would just be a single candidate with a width glued
 * to it — and would stop the browser applying `sizes` sensibly.
 */
const srcset = computed(() =>
  stage.value === 'primary' ? levelThumbSrcset(props.gdId, res.value) : null,
)

function onError() {
  if (stage.value === 'primary') {
    rememberThumbMiss(props.gdId)
    stage.value = firstVideoStage()
    return
  }
  if (stage.value === 'videoMax') {
    // Not uploaded in HD — the common case, not an error. Remembered so the
    // next render of this video doesn't spend the same 404 again.
    rememberMaxresMiss(videoId.value)
    stage.value = videoUrl.value ? 'video' : 'done'
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
      :srcset="srcset || undefined"
      :sizes="srcset ? sizes : undefined"
      alt=""
      :loading="priority ? 'eager' : 'lazy'"
      :fetchpriority="priority ? 'high' : 'low'"
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
