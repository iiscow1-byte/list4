<script setup lang="ts">
useHead({ title: 'Sign up — All Levels List' })

// The server refuses signups outright; this only decides which of the two
// states the page renders, so the form isn't offered when it can't work.
const { data: meRes } = useCurrentUser()
const signupsOpen = computed(() => meRes.value?.site?.signupsEnabled ?? false)

const username = ref('')
const password = ref('')
const error = ref<string | null>(null)
const loading = ref(false)
const router = useRouter()

async function submit() {
  if (loading.value) return
  error.value = null
  loading.value = true
  try {
    await $fetch('/api/auth/signup', {
      method: 'POST',
      body: { username: username.value, password: password.value },
    })
    await refreshNuxtData('auth-me')
    await router.push('/account')
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Signup failed.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="!signupsOpen" class="container-tight py-20 max-w-md text-center">
    <div class="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
      <span class="w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden="true" />
      Alpha
    </div>
    <h1 class="mt-4 text-2xl font-bold tracking-tight">Sign-ups are closed</h1>
    <p class="mt-2 text-sm text-zinc-400 leading-relaxed">
      The All Levels List isn't taking new accounts while it's in alpha.
    </p>
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
          class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
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
          class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <span class="text-[11px] text-zinc-500 mt-1 block">At least 8 characters.</span>
      </label>

      <p v-if="error" class="text-xs text-red-400">{{ error }}</p>

      <button
        type="submit"
        :disabled="loading"
        class="w-full rounded bg-accent text-zinc-950 font-medium text-sm py-2 hover:bg-accent/90 disabled:opacity-60 transition-colors"
      >
        {{ loading ? 'Creating…' : 'Sign up' }}
      </button>
    </form>

    <p class="text-xs text-zinc-500 mt-6">
      Already registered?
      <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink>.
    </p>
  </div>
</template>
