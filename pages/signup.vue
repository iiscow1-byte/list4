<script setup lang="ts">
import { LOCKDOWN_LINES } from '~/utils/lockdown'

useHead({ title: 'Sign up — All Levels List' })

// The server refuses signups outright; this only decides which of the two
// states the page renders, so the form isn't offered when it can't work.
const { data: meRes } = useCurrentUser()
const signupsOpen = computed(() => meRes.value?.site?.signupsEnabled ?? false)

const username = ref('')
const password = ref('')
const email = ref('')
const error = ref<string | null>(null)
const loading = ref(false)
const router = useRouter()

/**
 * The captcha token, and a handle on the widget so a failed submit can throw it
 * away. A token is spent whether or not the request it accompanied succeeded,
 * so retrying with the same one always fails.
 */
const captchaToken = ref('')
const captcha = ref<{ reset: () => void; enabled: boolean } | null>(null)

/** Whether an address is required, which depends on the server having a mailer. */
const { data: mailConfig } = await useFetch<{ emailRequired: boolean }>('/api/site/signup-requirements')
const emailRequired = computed(() => mailConfig.value?.emailRequired ?? false)

/** Whether a captcha is on the page and still unsolved. */
const captchaPending = computed(() => !!captcha.value?.enabled && !captchaToken.value)

async function submit() {
  if (loading.value) return
  error.value = null
  loading.value = true
  try {
    const res = await $fetch<{ needsVerification: boolean; verificationSent: boolean }>(
      '/api/auth/signup',
      {
        method: 'POST',
        body: {
          username: username.value,
          password: password.value,
          email: email.value.trim() || undefined,
          captcha_token: captchaToken.value || undefined,
        },
      },
    )
    await refreshNuxtData('auth-me')
    // Somebody who has to go and click a link needs telling where to look,
    // which the account page says. Landing them on the list instead would be
    // landing them somewhere they cannot yet post.
    await router.push(res.needsVerification ? '/account?verify=1' : '/account')
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Signup failed.'
    captcha.value?.reset()
  } finally {
    loading.value = false
  }
}
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

    <form class="space-y-4" @submit.prevent="submit">
      <label class="block">
        <span class="text-xs uppercase tracking-widest text-zinc-500">Username <span class="text-red-400">*</span></span>
        <input
          v-model="username"
          autocomplete="username"
          required
          class="field field-md mt-1"
        />
        <span class="text-[11px] text-zinc-500 mt-1 block">3–32 chars: letters, numbers, underscore, hyphen.</span>
      </label>
      <label class="block">
        <span class="text-xs uppercase tracking-widest text-zinc-500">Password <span class="text-red-400">*</span></span>
        <input
          v-model="password"
          type="password"
          autocomplete="new-password"
          required
          minlength="8"
          class="field field-md mt-1"
        />
        <span class="text-[11px] text-zinc-500 mt-1 block">At least 8 characters.</span>
      </label>

      <!-- Asked for only when the server can send to it. On a deployment with
           no mail provider this field is absent rather than optional-and-
           pointless — see /api/site/signup-requirements. -->
      <label v-if="emailRequired" class="block">
        <span class="text-xs uppercase tracking-widest text-zinc-500">Email <span class="text-red-400">*</span></span>
        <input
          v-model="email"
          type="email"
          autocomplete="email"
          required
          class="field field-md mt-1"
        />
        <span class="text-[11px] text-zinc-500 mt-1 block">
          You'll get a link to confirm it. Until you do, you can look around but not post.
        </span>
      </label>

      <!-- Renders nothing unless a captcha provider is configured. -->
      <CaptchaBox ref="captcha" @update:token="captchaToken = $event" />

      <p v-if="error" class="text-xs text-red-400">{{ error }}</p>

      <button
        type="submit"
        :disabled="loading || captchaPending"
        class="btn btn-md btn-primary w-full"
      >
        {{ loading ? 'Creating…' : captchaPending ? 'Complete the captcha' : 'Sign up' }}
      </button>
    </form>

    <p class="text-xs text-zinc-500 mt-6">
      Already registered?
      <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink>.
    </p>
  </div>
</template>
