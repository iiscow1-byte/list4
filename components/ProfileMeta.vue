<script setup lang="ts">
import { countryName, normalizeCountry } from '~/utils/countries'
import { profileChipClass, PROFILE_CHIP_ICON, joinedOn, type ProfileChipSize } from '~/utils/profile-chips'

/**
 * Who somebody is, under their name: where they play from, what to call them,
 * and how long they have been here.
 *
 * These three were one run of 11px grey text — `Kent, United Kingdom
 * they/them joined March 2026` — separated by nothing but a gap, so it read as
 * a single sentence that had lost its punctuation, and the pronouns in the
 * middle of it were the hardest thing on the page to spot. They are three
 * different facts and they are three chips now, each with a shape that says
 * which kind of fact it is: a flag for a place, a person for pronouns, a
 * calendar for a date.
 *
 * The shape is shared with the social links beside them
 * (`utils/profile-chips.ts`), which is what stops the header from having two
 * different ideas of what a small fact looks like.
 *
 * Nothing renders for a field nobody filled in — a profile with no pronouns
 * gets no empty chip, and one with nothing at all gets no row.
 */
const props = withDefaults(defineProps<{
  account: Record<string, any>
  /** `joined March 2026`, when the caller wants it shown. */
  createdAt?: string | null
  size?: ProfileChipSize
}>(), { size: 'md', createdAt: null })

const code = computed(() => normalizeCountry(props.account?.country))

/**
 * Where, as one string.
 *
 * Written here rather than in the template because "Kent, United Kingdom",
 * "Kent" and "United Kingdom" are three different sentences depending on what
 * the account filled in, and a template that punctuates all three ends up
 * emitting a stray comma for the case it forgot.
 */
const place = computed(() => {
  const region = String(props.account?.subdivision ?? '').trim()
  const country = countryName(code.value) ?? String(props.account?.country ?? '').trim()
  return [region, country].filter(Boolean).join(', ') || null
})

const pronouns = computed(() => String(props.account?.pronouns ?? '').trim() || null)
const joined = computed(() => joinedOn(props.createdAt))
const chip = computed(() => profileChipClass(props.size))
const icon = computed(() => `${PROFILE_CHIP_ICON[props.size]} shrink-0 text-zinc-600`)
</script>

<template>
  <div v-if="place || pronouns || joined || $slots.default" class="flex flex-wrap items-center gap-1.5 min-w-0">
    <span v-if="place" :class="chip" :title="`Plays from ${place}`">
      <!-- The flag is the icon; a pin next to a flag would be two of the same
           thing. Falls back to a pin when the country isn't one we know. -->
      <CountryFlag v-if="code" :country="account.country" :size="size" class="shrink-0" />
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" :class="icon" aria-hidden="true">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
      <span class="truncate">{{ place }}</span>
    </span>

    <span v-if="pronouns" :class="chip" title="Pronouns">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="icon" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
      <span class="truncate">{{ pronouns }}</span>
    </span>

    <span v-if="joined" :class="chip" :title="`Joined ${joined.full}`">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="icon" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
      <span class="truncate">Joined {{ joined.month }}</span>
    </span>

    <slot />
  </div>
</template>
