<script setup lang="ts">
/**
 * The one thing that turns a stored video URL into a player.
 *
 * Before this, eight components each carried a private copy of the same
 * YouTube-id regex and hand-built the same `<iframe>`, which meant every
 * non-YouTube link on the site rendered as nothing — the `v-if` gated on a
 * YouTube id, so a Medal clip was indistinguishable from no video at all.
 * Those call sites now hand the raw column value here and let `resolveVideo`
 * decide what it is.
 *
 * `frameClass` exists because the wrapper is not the same everywhere: the level
 * pages use a rounded card, the admin review drawers inset theirs with margins.
 * Passing the class in rather than merging fallthrough classes avoids two
 * Tailwind radius utilities fighting, where the winner is decided by
 * stylesheet order rather than by the call site.
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
    frameClass: 'aspect-video rounded-xl border border-zinc-800 bg-black overflow-hidden',
  },
)

const source = computed(() => resolveVideo(props.url))
const label = computed(() => props.title || 'Video')
</script>

<template>
  <div v-if="source.kind !== 'none'" :class="frameClass">
    <iframe
      v-if="source.kind === 'youtube' || source.kind === 'medal'"
      :src="source.embedUrl ?? undefined"
      class="w-full h-full"
      :title="label"
      frameborder="0"
      loading="lazy"
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"
    />
    <!-- An uploaded clip is served from this origin, so it plays natively —
         no third-party player, no cookies, and the browser's own controls. -->
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
