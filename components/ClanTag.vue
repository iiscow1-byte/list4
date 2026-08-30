<script setup lang="ts">
import { textOn } from '~/utils/tier-colors'

/**
 * The clan somebody is in, beside their name.
 *
 * Deliberately **not** shaped like the other badges. A role chip is the site
 * talking *about* an account; a clan tag is part of how a player writes their
 * own name — `[TSK] Wolfy` is the form this community already uses — so it
 * reads as a prefix rather than as an annotation.
 *
 * The revamp took the border off. A bordered chip in front of every name turned
 * a leaderboard into a column of boxes, and the border was doing the same job as
 * the tint behind it — twice, in the same three-letter space. What is left is a
 * soft block of the clan's colour with the tag on it: still unmistakably a tag,
 * a third of the visual weight. The brackets sit at 45% so the letters that
 * identify the clan are what the eye lands on, and a row of names with tags in
 * it still scans as names.
 *
 * Two variants:
 * - `soft` (default) — the tinted block above, for beside a name.
 * - `solid` — filled with the clan's own colour, for the one place on a page
 *   where the clan *is* the subject: its own header, and the "your clan" chip.
 *   The label colour is picked against the fill so a pale clan colour doesn't
 *   produce white-on-yellow.
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
  variant?: 'soft' | 'solid'
  /** `false` inside another link, or on the clan's own page. */
  link?: boolean
}>(), { size: 'md', variant: 'soft', link: true })

const hex = computed(() => {
  const c = props.color
  return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null
})

const style = computed(() => {
  const c = hex.value
  if (!c) return undefined
  return props.variant === 'solid'
    ? { backgroundColor: c, color: textOn(c) }
    // 20% tint, and the text at full strength. No border: the block is the
    // shape, and an outline around a three-letter tag is one edge too many.
    : { backgroundColor: `${c}2e`, color: c }
})

/** The fallback when a clan never picked a colour — the site accent, softly. */
const fallback = computed(() =>
  props.variant === 'solid'
    ? 'bg-accent text-zinc-950'
    : 'bg-accent/15 text-accent',
)

const title = computed(() => (props.name ? `${props.name} — [${props.tag}]` : `Clan [${props.tag}]`))

const chip = computed(() => [
  'shrink-0 inline-flex items-baseline rounded-[4px] font-bold leading-none align-middle',
  'whitespace-nowrap tracking-[0.06em] transition-[filter,background-color] duration-150',
  props.size === 'sm' ? 'text-[9px] px-[5px] py-[3px]' : 'text-[10px] px-1.5 py-[4px]',
  style.value ? '' : fallback.value,
].join(' '))
</script>

<template>
  <NuxtLink
    v-if="tag && link"
    :to="`/clans/${encodeURIComponent(tag)}`"
    :class="[chip, 'hover:brightness-125 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60']"
    :style="style"
    :title="title"
    @click.stop
  ><span class="opacity-45">[</span>{{ tag }}<span class="opacity-45">]</span></NuxtLink>

  <span
    v-else-if="tag"
    :class="chip"
    :style="style"
    :title="title"
  ><span class="opacity-45">[</span>{{ tag }}<span class="opacity-45">]</span></span>
</template>
