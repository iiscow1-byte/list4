<script setup lang="ts">
import { BADGE_BASE, BADGE_DOT, BADGE_SIZE, BADGE_TONE, hexBadgeStyle, type BadgeSize, type BadgeTone } from '~/utils/badge-styles'

/**
 * The chip itself. Everything visual about a badge is here or in
 * `utils/badge-styles.ts`, and nowhere else.
 *
 * `color` beats `tone` when it is a valid hex literal, so a clan colour or a
 * staff-set badge colour can be honoured without every one of those call sites
 * re-deriving the same three CSS values from it.
 *
 * `dot` puts a small filled circle before the label. It is for badges whose
 * *colour* carries meaning — the role chips, where violet-versus-amber is the
 * difference between an admin and the owner. A dot gives that colour a solid
 * shape to live in instead of leaving it as a tint behind small text, which is
 * where a colour is hardest to judge.
 */
const props = withDefaults(defineProps<{
  tone?: BadgeTone
  size?: BadgeSize
  /** A hex literal chosen by a person, used instead of `tone`. */
  color?: string | null
  title?: string | null
  dot?: boolean
}>(), { tone: 'neutral', size: 'md', color: null, title: null, dot: false })

const style = computed(() => hexBadgeStyle(props.color))
</script>

<template>
  <span
    :class="[BADGE_BASE, BADGE_SIZE[size], style ? '' : BADGE_TONE[tone]]"
    :style="style"
    :title="title ?? undefined"
  >
    <span v-if="dot" :class="BADGE_DOT[size]" aria-hidden="true" />
    <slot />
  </span>
</template>
