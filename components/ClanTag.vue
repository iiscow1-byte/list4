<script setup lang="ts">
import { hexBadgeStyle } from '~/utils/badge-styles'

/**
 * The clan somebody is in, beside their name.
 *
 * Deliberately **not** shaped like the other badges. A role chip and a source
 * chip are the site talking about an account; a clan tag is part of how a
 * player writes their own name — `[TSK] Wolfy` is the form this community
 * already uses — so it reads as a prefix rather than as an annotation. Hence
 * brackets instead of an uppercase pill, tighter tracking, a squarer corner,
 * and the clan's own colour rather than one of the tone palette's.
 *
 * The brackets are dimmed against the tag so the three or four letters that
 * identify the clan are what the eye lands on, and so a row of names with tags
 * in it still scans as names.
 *
 * It links to the clan unless told not to — on the clan's own page, and inside
 * something that is already a link, a nested anchor is invalid and swallows the
 * outer one's click.
 */
const props = withDefaults(defineProps<{
  tag: string | null | undefined
  /** The clan's full name, for the tooltip. */
  name?: string | null
  color?: string | null
  size?: 'sm' | 'md'
  /** `false` inside another link, or on the clan's own page. */
  link?: boolean
}>(), { size: 'md', link: true })

const style = computed(() => {
  const hex = hexBadgeStyle(props.color)
  // Without a colour the tag still has to be legible against the row, so it
  // falls back to the site accent rather than to the surrounding text colour —
  // a colourless tag that inherits looks like part of the username.
  if (!hex) return undefined
  return { backgroundColor: hex.backgroundColor, borderColor: hex.borderColor, color: hex.color }
})

const title = computed(() => (props.name ? `${props.name} — [${props.tag}]` : `Clan [${props.tag}]`))
const chip = computed(() =>
  'shrink-0 inline-flex items-baseline rounded-[3px] border font-bold leading-none '
  + 'whitespace-nowrap tracking-[0.08em] transition-colors '
  + (props.size === 'sm' ? 'text-[9px] px-1 py-[3px]' : 'text-[10px] px-1.5 py-[3.5px]')
  + (style.value ? '' : ' border-accent/40 bg-accent/10 text-accent'),
)
</script>

<template>
  <NuxtLink
    v-if="tag && link"
    :to="`/clans/${encodeURIComponent(tag)}`"
    :class="[chip, 'hover:brightness-125']"
    :style="style"
    :title="title"
    @click.stop
  ><span class="opacity-50">[</span>{{ tag }}<span class="opacity-50">]</span></NuxtLink>

  <span
    v-else-if="tag"
    :class="chip"
    :style="style"
    :title="title"
  ><span class="opacity-50">[</span>{{ tag }}<span class="opacity-50">]</span></span>
</template>
