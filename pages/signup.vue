<script setup lang="ts">
import { LOCKDOWN_LINES } from '~/utils/lockdown'

useHead({ title: 'Sign up — All Levels List' })

// Whether registration is open at all, which admins control from the panel.
// The server enforces it; this only picks which of the two states to render.
const { data: meRes } = useCurrentUser()
const signupsOpen = computed(() => meRes.value?.site?.signupsEnabled ?? false)

/** What the server can actually offer — see /api/site/signup-requirements. */
const { data: mailConfig } = await useFetch<{
  discordEnabled: boolean
  discordInviteUrl: string | null
}>('/api/site/signup-requirements')

/**
 * Discord is the only way to make an account.
 *
 * The password form that used to be here is gone, and `/api/auth/signup`
 * refuses regardless — an email address costs a throwaway inbox, while being in
 * the community's server costs an invite and can be taken away again. A plain
 * link rather than a fetch, because OAuth is a full-page trip to another origin
 * and back, which XHR cannot make.
 */
const discordEnabled = computed(() => mailConfig.value?.discordEnabled ?? false)
const discordInvite = computed(() => mailConfig.value?.discordInviteUrl ?? null)

const DISCORD_ERRORS: Record<string, string> = {
  cancelled: 'Discord sign-up was cancelled.',
  not_in_server: 'You need to be in the All Levels List Discord server to sign up this way.',
  missing_role: "Your Discord account is in the server but doesn't have the role needed to sign up.",
  discord_taken: 'That Discord account is already linked to an account here. Log in instead.',
  banned: 'That account is banned.',
  signups_closed: 'Account creation is closed at the moment.',
  discord_unavailable: "Couldn't reach Discord. Try again in a minute.",
  bad_state: 'That sign-up link expired. Try again.',
  no_code: 'Discord did not send anything back. Try again.',
}
const route = useRoute()
const discordError = computed(() => {
  const code = String(route.query.discord_error ?? '')
  if (!code) return null
  return DISCORD_ERRORS[code] ?? 'Discord sign-up failed. Try again.'
})
</script>

<template>
  <div v-if="!signupsOpen" class="container-tight py-20 max-w-md text-center">
    <div class="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
      <span class="w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden="true" />
      In development
    </div>
    <h1 class="mt-4 text-2xl font-bold tracking-tight">Sign-ups are closed</h1>
    <p
      v-for="(line, i) in LOCKDOWN_LINES"
      :key="line"
      class="text-sm leading-relaxed"
      :class="i === 0 ? 'mt-3 text-zinc-300' : 'mt-1 text-zinc-500'"
    >{{ line }}</p>
    <p class="mt-6 text-xs text-zinc-500">
      Already have an account?
      <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink>.
    </p>
  </div>

  <div v-else class="container-tight py-12 max-w-sm">
    <h1 class="text-3xl font-semibold tracking-tight mb-1">Create an account</h1>
    <p class="text-sm text-zinc-400 mb-6">
      Sign up, then claim your leaderboard player from your account page.
    </p>

    <div v-if="discordError" class="mb-4 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2.5 text-xs text-red-300 leading-relaxed">
      {{ discordError }}
      <a
        v-if="discordInvite && String(route.query.discord_error) === 'not_in_server'"
        :href="discordInvite"
        target="_blank"
        rel="noopener noreferrer"
        class="block mt-1 text-red-200 underline underline-offset-2 hover:text-red-100"
      >Join the Discord server ↗</a>
    </div>

    <template v-if="discordEnabled">
      <a
        href="/api/auth/discord?return_to=%2Fsignup"
        class="btn btn-md w-full justify-center gap-2 bg-[#5865F2] text-white hover:bg-[#4752c4] transition-colors"
      >
        <svg viewBox="0 0 127.14 96.36" fill="currentColor" class="w-4 h-4" aria-hidden="true">
          <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"/>
        </svg>
        Sign up with Discord
      </a>
      <p class="mt-2 text-[11px] text-zinc-600 leading-relaxed">
        You'll need to be in the All Levels List Discord server. No email or password needed.
      </p>
      <a
        v-if="discordInvite"
        :href="discordInvite"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-2 inline-block text-[11px] text-zinc-500 hover:text-accent underline underline-offset-2"
      >Not in the server yet? Join it first ↗</a>
    </template>

    <!--
      Discord is the only way to make an account, so a server that hasn't got it
      configured has nothing to offer here. Saying so is the honest state: a
      dead button, or a password form the server refuses, would both waste
      somebody's time before failing.
    -->
    <div v-else class="rounded-lg border border-amber-900/50 bg-amber-950/25 px-4 py-3 text-sm text-amber-200/90 leading-relaxed">
      <span class="block font-semibold text-amber-200">Sign-ups aren't available right now</span>
      <span class="block mt-1 text-amber-200/70">
        Accounts are made through Discord, and Discord sign-in isn't set up on this server yet.
      </span>
    </div>

    <p class="text-xs text-zinc-500 mt-6">
      Already registered?
      <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink>.
    </p>
  </div>
</template>
