<script setup lang="ts">
import { LOCKDOWN_LINES } from '~/utils/lockdown'
import { safeNext } from '~/utils/safe-redirect'

useHead({ title: 'Log in — All Levels List' })

const username = ref('')
const password = ref('')
const error = ref<string | null>(null)
const loading = ref(false)
const router = useRouter()
const route = useRoute()

const { data: meRes } = useCurrentUser()
const policy = computed(() => meRes.value?.site ?? null)

/**
 * The captcha only appears once the server has asked for one.
 *
 * It does that after a few failed attempts from this address — see
 * `CAPTCHA_AFTER_FAILURES` in the login endpoint. Rendering it up front would
 * put a third-party round trip in front of the most-used form on the site to
 * stop something that only matters in bulk.
 */
/**
 * Discord sign-in, when the server has it configured.
 *
 * The button is a plain link rather than a fetch: OAuth is a full-page journey
 * to another origin and back, and an XHR cannot make that trip. `return_to`
 * carries where the person was heading so the round trip doesn't lose it.
 */
const { data: siteConfig } = await useFetch<{
  discordEnabled: boolean
  discordInviteUrl: string | null
}>('/api/site/signup-requirements')
const discordEnabled = computed(() => siteConfig.value?.discordEnabled ?? false)
const discordInvite = computed(() => siteConfig.value?.discordInviteUrl ?? null)
const discordHref = computed(() => {
  const next = safeNext(route.query.next)
  return `/api/auth/discord${next && next !== '/' ? `?return_to=${encodeURIComponent(next)}` : ''}`
})

/** What came back on `?discord_error=`, in words. */
const DISCORD_ERRORS: Record<string, string> = {
  cancelled: 'Discord sign-in was cancelled.',
  not_in_server: 'You need to be in the All Levels List Discord server to sign in this way.',
  missing_role: "Your Discord account is in the server but doesn't have the role needed to sign in.",
  discord_taken: 'That Discord account is already linked to a different account here.',
  banned: 'That account is banned.',
  signups_closed: 'Account creation is closed at the moment.',
  discord_unavailable: "Couldn't reach Discord. Try again in a minute.",
  bad_state: 'That sign-in link expired. Try again.',
  no_code: 'Discord did not send anything back. Try again.',
}
const discordError = computed(() => {
  const code = String(route.query.discord_error ?? '')
  if (!code) return null
  return DISCORD_ERRORS[code] ?? 'Discord sign-in failed. Try again.'
})

const captchaNeeded = ref(false)
const captchaToken = ref('')
const captcha = ref<{ reset: () => void; enabled: boolean } | null>(null)

async function submit() {
  if (loading.value) return
  error.value = null
  loading.value = true
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: {
        username: username.value,
        password: password.value,
        captcha_token: captchaToken.value || undefined,
      },
    })
    await refreshNuxtData('auth-me')
    // Signing in doesn't imply access while the site is locked down; sending a
    // non-staff account to `next` would just bounce it straight back here.
    if (meRes.value?.site?.adminOnly && !meRes.value?.site?.canAccess) {
      await router.push('/locked')
      return
    }
    await router.push(safeNext(route.query.next))
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Login failed.'
    // The server says when a captcha has become mandatory. Once shown it stays
    // shown for this page load: the requirement is per address and does not go
    // away because the next attempt happened to be the right password.
    if (e?.data?.data?.captchaRequired) captchaNeeded.value = true
    // A token is spent on use, successful or not, so the next attempt needs a
    // fresh one.
    captcha.value?.reset()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="container-tight py-12 max-w-sm">
    <h1 class="text-3xl font-semibold tracking-tight mb-1">Log in</h1>
    <p class="text-sm text-zinc-400 mb-6">Sign in to your All Levels List account.</p>

    <p
      v-if="policy?.adminOnly"
      class="mb-6 rounded-lg border border-amber-900/50 bg-amber-950/25 px-3 py-2.5 text-xs text-amber-200/90 leading-relaxed"
    >
      <span class="block font-semibold text-amber-200">{{ LOCKDOWN_LINES[0] }}</span>
      <span class="block mt-0.5">{{ LOCKDOWN_LINES[1] }}</span>
      <span class="block mt-0.5 text-amber-200/70">{{ LOCKDOWN_LINES[2] }}</span>
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
      <a :href="discordHref" class="btn btn-md w-full justify-center gap-2 bg-[#5865F2] text-white hover:bg-[#4752c4] transition-colors">
        <svg viewBox="0 0 127.14 96.36" fill="currentColor" class="w-4 h-4" aria-hidden="true">
          <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"/>
        </svg>
        Continue with Discord
      </a>
      <p class="mt-2 text-[11px] text-zinc-600 leading-relaxed">
        You'll need to be in the All Levels List Discord server. No email needed.
      </p>
      <div class="flex items-center gap-3 my-5">
        <span class="h-px flex-1 bg-zinc-800" />
        <span class="text-[10px] uppercase tracking-widest text-zinc-600">or</span>
        <span class="h-px flex-1 bg-zinc-800" />
      </div>
    </template>

    <form class="space-y-4" @submit.prevent="submit">
      <label class="block">
        <span class="text-xs uppercase tracking-widest text-zinc-500">Username <span class="text-red-400">*</span></span>
        <input
          v-model="username"
          autocomplete="username"
          required
          class="field field-md mt-1"
        />
      </label>
      <label class="block">
        <span class="text-xs uppercase tracking-widest text-zinc-500">Password <span class="text-red-400">*</span></span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          class="field field-md mt-1"
        />
      </label>

      <!-- Only after the server has started asking. See `captchaNeeded`. -->
      <CaptchaBox v-if="captchaNeeded" ref="captcha" @update:token="captchaToken = $event" />

      <p v-if="error" class="text-xs text-red-400">{{ error }}</p>

      <button
        type="submit"
        :disabled="loading"
        class="btn btn-md btn-primary w-full"
      >
        {{ loading ? 'Signing in…' : 'Log in' }}
      </button>
    </form>

    <p v-if="policy?.signupsEnabled" class="text-xs text-zinc-500 mt-6">
      Don't have an account?
      <NuxtLink to="/signup" class="text-accent hover:underline">Sign up</NuxtLink>.
    </p>
    <p v-else class="text-xs text-zinc-500 mt-6">
      Sign-ups are closed for now.
    </p>
  </div>
</template>
