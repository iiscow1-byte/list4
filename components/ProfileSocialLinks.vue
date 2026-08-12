<script setup lang="ts">
import { SOCIAL_LINKS, socialHandle } from '~/utils/social-links'
import { gdUserUrl } from '~/utils/gd-links'
import { profileChipClass, PROFILE_CHIP_ICON } from '~/utils/profile-chips'

/**
 * Where else to find someone, as a row of chips.
 *
 * One component so the public profile and your own copy of it can't drift —
 * they were two hand-written runs of the same markup, and the account page was
 * already missing the Geometry Dash chip the public one had.
 *
 * Discord is a handle rather than a link (there is nowhere to send anyone), so
 * it renders as a chip that copies itself instead of one that navigates.
 */
const props = defineProps<{
  account: Record<string, any> | null | undefined
  size?: 'sm' | 'md'
}>()

const links = computed(() =>
  SOCIAL_LINKS
    .map((def) => ({ def, url: (props.account?.[def.key] as string | null) ?? null }))
    .filter((l): l is { def: typeof SOCIAL_LINKS[number]; url: string } => !!l.url)
    .map((l) => ({ ...l, handle: socialHandle(l.def.key, l.url) ?? l.def.label })),
)

const gdUrl = computed(() => gdUserUrl(props.account?.gd_username))
const discord = computed(() => props.account?.discord_handle ?? null)

const copied = ref(false)
async function copyDiscord() {
  if (!discord.value) return
  try {
    await navigator.clipboard.writeText(discord.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch { /* no clipboard permission — the handle is on screen anyway */ }
}

// The same chip the facts beside these use — see `utils/profile-chips.ts`.
// These two rows sit three inches apart in the same header and used to be two
// different shapes.
const chip = computed(() => profileChipClass(props.size ?? 'md'))
const icon = computed(() => PROFILE_CHIP_ICON[props.size ?? 'md'])
</script>

<template>
  <div v-if="links.length || gdUrl || discord" class="flex items-center gap-1.5 flex-wrap">
    <!-- In-game first: it is the name everyone here actually knows. -->
    <a
      v-if="gdUrl"
      :href="gdUrl"
      target="_blank"
      rel="noopener"
      :class="[chip, 'hover:text-accent hover:border-accent/50']"
      :title="`${account!.gd_username} on gdbrowser`"
    >
      <GdCubeIcon :class="[icon, 'shrink-0']" />
      {{ account!.gd_username }}
    </a>

    <a
      v-for="l in links"
      :key="l.def.key"
      :href="l.url"
      target="_blank"
      rel="noopener"
      :class="[chip, l.def.tone]"
      :title="`${l.handle} on ${l.def.label}`"
    >
      <svg v-if="l.def.key === 'youtube_url'" viewBox="0 0 24 24" fill="currentColor" :class="[icon, 'shrink-0']" aria-hidden="true">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
      <svg v-else-if="l.def.key === 'twitch_url'" viewBox="0 0 24 24" fill="currentColor" :class="[icon, 'shrink-0']" aria-hidden="true">
        <path d="M2.149 0 .537 4.119v16.836h5.731V24h3.224l3.045-3.045h4.657L23.462 14.5V0zm19.164 13.612-3.582 3.582h-5.731l-3.045 3.045v-3.045H4.119V2.149h17.194z"/>
        <path d="M14.985 5.731h2.149v6.269h-2.149zm-5.911 0h2.149v6.269H9.074z"/>
      </svg>
      <svg v-else-if="l.def.key === 'twitter_url'" viewBox="0 0 24 24" fill="currentColor" :class="[icon, 'shrink-0']" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="currentColor" :class="[icon, 'shrink-0']" aria-hidden="true">
        <path d="M5.77 3.24C8.33 5.16 11.08 9.05 12 11.14c.92-2.09 3.67-5.98 6.23-7.9C20.07 1.85 23 .8 23 4.14c0 .67-.38 5.6-.61 6.4-.77 2.78-3.6 3.49-6.12 3.06 4.4.75 5.52 3.23 3.1 5.71-4.6 4.71-6.61-1.18-7.13-2.69-.1-.27-.14-.4-.14-.29 0-.11-.05.02-.14.29-.52 1.51-2.53 7.4-7.13 2.69-2.42-2.48-1.3-4.96 3.1-5.71-2.52.43-5.35-.28-6.12-3.06C1.38 9.74 1 4.81 1 4.14 1 .8 3.93 1.85 5.77 3.24"/>
      </svg>
      {{ l.handle }}
    </a>

    <button
      v-if="discord"
      type="button"
      :class="[chip, 'hover:text-[#5865F2] hover:border-indigo-900/60']"
      :title="copied ? 'Copied' : `Copy ${discord}`"
      @click="copyDiscord"
    >
      <svg viewBox="0 0 127.14 96.36" fill="currentColor" :class="[icon, 'shrink-0 text-[#5865F2]']" aria-hidden="true">
        <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"/>
      </svg>
      {{ copied ? 'Copied' : discord }}
    </button>
  </div>
</template>
