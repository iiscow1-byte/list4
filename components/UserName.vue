<script setup lang="ts">
// Imported rather than resolved by name. `resolveComponent('NuxtLink')` inside
// a template expression returns the *string* when the name isn't registered on
// the instance, and `<component :is>` then renders a literal `<NuxtLink>`
// element: the name still shows, styled, and is silently not a link.
import { NuxtLink } from '#components'
import { roleBadgeClass } from '~/utils/role-styles'

/**
 * A username, with whatever the account has earned or been given beside it.
 *
 * One component because a name appears in a dozen places — profile headers,
 * leaderboard rows, comments, the community feed — and every one of them had
 * its own idea of what goes next to it. A decoration added to the account was
 * therefore visible in exactly the place somebody remembered to change.
 *
 * The order is fixed: name, then emoji, then the custom badge, then the role.
 * Emoji sit closest to the name because they read as part of it; the role chip
 * is last because it is the site's statement rather than the account's.
 */
const props = withDefaults(defineProps<{
  username: string
  /** Staff-set emoji, up to three. */
  emoji?: string | null
  /** Staff-set free-text badge. */
  badge?: string | null
  /** Hex colour for that badge. */
  badgeColor?: string | null
  /** `moderator` / `admin` / `owner` / `developer`, when it should be shown. */
  role?: string | null
  /** Wrap the name in a link to the profile. */
  to?: string | null
  /** Smaller type, for dense rows. */
  size?: 'sm' | 'md'
}>(), { size: 'md' })

const badgeStyle = computed(() => {
  const hex = props.badgeColor
  // Only a hex literal reaches a style attribute — the write path enforces the
  // same rule, and this is the second gate rather than the only one.
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return undefined
  return { backgroundColor: `${hex}22`, borderColor: `${hex}66`, color: hex }
})

const chip = computed(() =>
  props.size === 'sm'
    ? 'text-[9px] px-1 py-0.5'
    : 'text-[10px] px-1.5 py-0.5',
)
</script>

<template>
  <span class="inline-flex items-center gap-1.5 min-w-0">
    <component
      :is="to ? NuxtLink : 'span'"
      :to="to ?? undefined"
      class="truncate"
      :class="to ? 'hover:text-accent transition-colors' : ''"
    >{{ username }}</component>

    <span v-if="emoji" class="shrink-0 leading-none" aria-hidden="true">{{ emoji }}</span>

    <span
      v-if="badge"
      class="shrink-0 rounded border font-semibold uppercase tracking-wider leading-none"
      :class="[chip, badgeStyle ? '' : 'border-zinc-700 bg-zinc-800 text-zinc-300']"
      :style="badgeStyle"
    >{{ badge }}</span>

    <span
      v-if="role"
      class="shrink-0 rounded uppercase tracking-widest leading-none"
      :class="[chip, roleBadgeClass(role)]"
    >{{ role }}</span>
  </span>
</template>
