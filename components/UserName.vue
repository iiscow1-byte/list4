<script setup lang="ts">
// Imported rather than resolved by name. `resolveComponent('NuxtLink')` inside
// a template expression returns the *string* when the name isn't registered on
// the instance, and `<component :is>` then renders a literal `<NuxtLink>`
// element: the name still shows, styled, and is silently not a link.
import { NuxtLink } from '#components'

/**
 * A username, with whatever the account has earned or been given beside it.
 *
 * One component because a name appears in a dozen places — profile headers,
 * leaderboard rows, comments, the community feed — and every one of them had
 * its own idea of what goes next to it. A decoration added to the account was
 * therefore visible in exactly the place somebody remembered to change.
 *
 * The order is fixed, and it is an order of *ownership*. The clan tag comes
 * first because it is a prefix somebody has chosen to write their name with,
 * the way the community already writes it. Then the name, then the emoji, which
 * reads as part of the name. Then the staff-set badge, then the role chip last,
 * because that one is the site's statement rather than the account's.
 */
withDefaults(defineProps<{
  username: string
  /** Staff-set emoji, up to three. */
  emoji?: string | null
  /** Staff-set free-text badge. */
  badge?: string | null
  /** Hex colour for that badge. */
  badgeColor?: string | null
  /** `moderator` / `admin` / `owner` / `developer`, when it should be shown. */
  role?: string | null
  /** The clan this account is in, when the caller knows it. */
  clan?: { tag: string; name?: string | null; color?: string | null } | null
  /** Wrap the name in a link to the profile. */
  to?: string | null
  /** Smaller type, for dense rows. */
  size?: 'sm' | 'md'
  /** `false` when this sits inside another link — a nested anchor is invalid. */
  clanLink?: boolean
}>(), { size: 'md', clanLink: true })
</script>

<template>
  <span class="inline-flex items-center gap-1.5 min-w-0">
    <ClanTag
      v-if="clan"
      :tag="clan.tag"
      :name="clan.name"
      :color="clan.color"
      :size="size"
      :link="clanLink"
    />

    <component
      :is="to ? NuxtLink : 'span'"
      :to="to ?? undefined"
      class="truncate"
      :class="to ? 'hover:text-accent transition-colors' : ''"
    >{{ username }}</component>

    <span v-if="emoji" class="shrink-0 leading-none" aria-hidden="true">{{ emoji }}</span>

    <NameBadge :label="badge" :color="badgeColor" :size="size" />

    <RoleBadge :role="role" :size="size" />
  </span>
</template>
