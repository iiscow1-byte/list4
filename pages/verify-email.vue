<script setup lang="ts">
/**
 * Where a verification link lands.
 *
 * Spends the token on mount rather than behind a button. The click in the inbox
 * *was* the confirmation — asking somebody to confirm their confirmation is a
 * step that exists only to make the page feel busy.
 *
 * It does mean a mail client that prefetches links can burn the token before a
 * human sees it. That is why the outcome reads "this address is confirmed"
 * rather than "thanks for clicking": the account ends up in the right state
 * either way, and `claimToken` makes the second click a no-op rather than an
 * error the user has to interpret.
 */
useHead({ title: 'Confirm your email — All Levels List' })

const route = useRoute()
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))

const state = ref<'working' | 'done' | 'failed'>('working')
const message = ref('')
const username = ref<string | null>(null)

const { refresh: refreshMe } = useCurrentUser()

onMounted(async () => {
  if (!token.value) {
    state.value = 'failed'
    message.value = 'That link is missing its token.'
    return
  }
  try {
    const res = await $fetch<{ username: string | null }>('/api/auth/verify-email', {
      method: 'POST',
      body: { token: token.value },
    })
    username.value = res.username
    state.value = 'done'
    // The signed-in copy of the account carries the verified flag, and the
    // banner asking them to verify reads from it.
    await refreshMe().catch(() => {})
  } catch (e: any) {
    state.value = 'failed'
    message.value = e?.data?.statusMessage ?? 'That link could not be used.'
  }
})
</script>

<template>
  <div class="container-tight max-w-md py-20 text-center space-y-4">
    <AllLogo :size="48" class="mx-auto" />

    <template v-if="state === 'working'">
      <h1 class="text-xl font-semibold text-zinc-100">Confirming…</h1>
      <p class="text-sm text-zinc-500">One moment.</p>
    </template>

    <template v-else-if="state === 'done'">
      <h1 class="text-xl font-semibold text-zinc-100">Address confirmed</h1>
      <p class="text-sm text-zinc-400">
        <template v-if="username">You're all set, {{ username }}.</template>
        <template v-else>You're all set.</template>
        Everything on the site is open to you now.
      </p>
      <div class="flex items-center justify-center gap-2 pt-2">
        <NuxtLink to="/levels/1" class="btn btn-md btn-primary">Open the list</NuxtLink>
        <NuxtLink to="/account" class="btn btn-md btn-ghost">Your account</NuxtLink>
      </div>
    </template>

    <template v-else>
      <h1 class="text-xl font-semibold text-zinc-100">That link didn't work</h1>
      <p class="text-sm text-zinc-400">{{ message }}</p>
      <div class="flex items-center justify-center gap-2 pt-2">
        <NuxtLink to="/account" class="btn btn-md btn-primary">Send a new one</NuxtLink>
        <NuxtLink to="/" class="btn btn-md btn-ghost">Home</NuxtLink>
      </div>
    </template>
  </div>
</template>
