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
