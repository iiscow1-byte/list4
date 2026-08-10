<script setup lang="ts">
/**
 * The staff-set free-text badge beside a name — "Founder", "Beta", whatever.
 *
 * Three copies of this existed: one in `UserName`, one in `ProfileHeader`, and
 * one in the account page's live preview, each re-deriving the same three CSS
 * values from the stored hex and each with its own idea of the chip's padding.
 * The preview and the real thing disagreeing is the worst kind of drift, since
 * the whole point of a preview is that it is the real thing.
 */
defineProps<{
  label: string | null | undefined
  /** A hex literal; anything else falls back to the neutral chip. */
  color?: string | null
  size?: 'sm' | 'md'
}>()
</script>

<template>
  <Badge v-if="label" :color="color" :size="size ?? 'md'" tone="neutral">{{ label }}</Badge>
</template>
