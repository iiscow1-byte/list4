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
 * Retrying a video thumbnail before believing it is missing.
 *
 * An <img> error carries no status code, so a 404 (this video genuinely has no
 * HD thumbnail) and a 429 (YouTube is rate-limiting us) arrive identically —
 * and the miss cache treated both as "there is no thumbnail here", writing the
 * rate-limit to localStorage for a week. A profile listing fifty levels asks
 * i.ytimg.com for fifty images at once, which is exactly when 429s happen, so
 * one busy page could permanently blank the thumbnails on it.
 *
 * A 404 fails again immediately; a rate-limit usually doesn't. So retry with a
 * jittered backoff, and only record a miss once the retries agree. The jitter
 * matters as much as the delay: without it, fifty rows would retry in lockstep
 * and rebuild the same burst that failed.
 */
const MAX_RETRIES = 2
const retries = ref(0)
/** Appended to the URL so a retry is a fresh request, not a cached failure. */
const nonce = ref(0)
let retryTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer)
  const backoff = 400 * 2 ** retries.value
  retryTimer = setTimeout(() => {
    retryTimer = null
    retries.value++
    nonce.value++
  }, backoff + Math.random() * 400)
}

onBeforeUnmount(() => { if (retryTimer) clearTimeout(retryTimer) })

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
  const base = stage.value === 'videoMax'
    ? videoMaxUrl.value
    : stage.value === 'video' ? videoUrl.value : null
  if (!base) return null
  // i.ytimg.com ignores unknown query params, so this only defeats the cache.
  return nonce.value > 0 ? `${base}?r=${nonce.value}` : base
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
    resetRetries()
    return
  }

  // Video stages only: give a possible rate-limit a chance to clear before
  // concluding anything about the video itself.
  if (retries.value < MAX_RETRIES) {
    scheduleRetry()
    return
  }

  if (stage.value === 'videoMax') {
    // Failed every attempt, so it really isn't uploaded in HD — the common
    // case, not an error. Remembered so the next render doesn't spend it again.
    rememberMaxresMiss(videoId.value)
    stage.value = videoUrl.value ? 'video' : 'done'
    resetRetries()
    return
  }
  stage.value = 'done'
}

function resetRetries() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  retries.value = 0
  nonce.value = 0
}

watch(
  () => [props.gdId, props.videoUrl],
  () => {
    loaded.value = false
    resetRetries()
    stage.value = import.meta.client ? initialStage() : 'primary'
  },
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
