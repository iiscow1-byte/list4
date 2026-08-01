<script setup lang="ts">
useHead({ title: 'Log in — All Levels List' })

const username = ref('')
const password = ref('')
const error = ref<string | null>(null)
const loading = ref(false)
const router = useRouter()
const route = useRoute()

const { data: meRes } = useCurrentUser()
const policy = computed(() => meRes.value?.site ?? null)

async function submit() {
  if (loading.value) return
  error.value = null
  loading.value = true
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { username: username.value, password: password.value },
    })
    await refreshNuxtData('auth-me')
    // Signing in doesn't imply access while the site is locked down; sending a
    // non-staff account to `next` would just bounce it straight back here.
    if (meRes.value?.site?.adminOnly && !meRes.value?.site?.canAccess) {
      await router.push('/locked')
      return
    }
    const next = typeof route.query.next === 'string' ? route.query.next : '/account'
    await router.push(next)
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Login failed.'
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
      <span class="font-semibold">The site is closed while it's in alpha.</span>
      Only team accounts can sign in right now.
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
      </label>
      <label class="block">
        <span class="text-xs uppercase tracking-widest text-zinc-500">Password <span class="text-red-400">*</span></span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>

      <p v-if="error" class="text-xs text-red-400">{{ error }}</p>

      <button
        type="submit"
        :disabled="loading"
        class="w-full rounded bg-accent text-zinc-950 font-medium text-sm py-2 hover:bg-accent/90 disabled:opacity-60 transition-colors"
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
