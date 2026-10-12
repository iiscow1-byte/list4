<script setup lang="ts">
/**
 * A stored video URL as a player: YouTube and Medal embeds, or an uploaded clip.
 *
 * YouTube starts as its thumbnail with a play button and only loads the real
 * player when clicked. The player is about a megabyte of script, and people
 * click through dozens of levels without watching most of them.
 */
import { resolveVideo } from '~/utils/video-embed'

const props = withDefaults(
  defineProps<{
    url?: string | null
    title?: string
    frameClass?: string
  }>(),
  {
    url: null,
    title: '',
    frameClass: 'aspect-video rounded-lg bg-black overflow-hidden',
  },
)

const source = computed(() => resolveVideo(props.url))
const label = computed(() => props.title || 'Video')
const playing = ref(false)
watch(() => props.url, () => { playing.value = false })

// HD poster when the video has one; YouTube answers a missing one with an
// error or a 120px placeholder, either of which drops to the 480px one.
const hd = ref(true)
watch(() => props.url, () => { hd.value = true })
const youtubeThumb = computed(() => {
  if (source.value.kind !== 'youtube' || !source.value.embedUrl) return null
  const id = source.value.embedUrl.split('/embed/')[1]
  return id ? `https://i.ytimg.com/vi/${id}/${hd.value ? 'maxresdefault' : 'hqdefault'}.jpg` : null
})
function onPosterLoad(e: Event) {
  if ((e.target as HTMLImageElement).naturalWidth < 200) hd.value = false
}
// A server-rendered poster can finish before hydration attaches the handlers.
const poster = ref<HTMLImageElement | null>(null)
onMounted(() => {
  const el = poster.value
  if (el?.complete && el.naturalWidth < 200) hd.value = false
})
const playerUrl = computed(() => {
  const base = source.value.embedUrl
  if (!base) return undefined
  return source.value.kind === 'youtube' ? `${base}?autoplay=1&rel=0` : base
})
</script>

<template>
  <div v-if="source.kind !== 'none'" :class="frameClass">
    <button
      v-if="source.kind === 'youtube' && !playing"
      type="button"
      class="group relative w-full h-full block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      :aria-label="`Play: ${label}`"
      @click="playing = true"
    >
      <img
        v-if="youtubeThumb"
        ref="poster"
        :src="youtubeThumb"
        alt=""
        class="absolute inset-0 w-full h-full object-cover"
        decoding="async"
        @load="onPosterLoad"
        @error="hd = false"
      />
      <span class="absolute inset-0 bg-black/20 group-hover:bg-black/5 transition-colors" />
      <span class="absolute inset-0 flex items-center justify-center">
        <span class="w-16 h-11 rounded-xl bg-[#ff0033] group-hover:scale-105 transition-transform flex items-center justify-center shadow-lg shadow-black/40">
          <svg viewBox="0 0 24 24" fill="white" class="w-6 h-6 translate-x-px" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        </span>
      </span>
      <span class="absolute left-3 right-3 bottom-2.5 text-left text-sm font-medium text-white line-clamp-1 drop-shadow">{{ label }}</span>
    </button>
    <iframe
      v-else-if="source.kind === 'youtube' || source.kind === 'medal'"
      :src="playerUrl"
      class="w-full h-full"
      :title="label"
      frameborder="0"
      loading="lazy"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"
    />
    <video
      v-else
      :src="source.embedUrl ?? undefined"
      class="w-full h-full"
      controls
      preload="metadata"
      playsinline
      :title="label"
    />
  </div>
</template>
