<script setup lang="ts">
/**
 * Where a signed-in non-staff visitor lands while the site is closed.
 *
 * Separate from /login because sending someone to a login form they can
 * already satisfy reads as a broken site — they'd sign in, get bounced, and
 * try again. This says what is actually happening.
 */
import { LOCKDOWN_LINES } from '~/utils/lockdown'

useHead({ title: 'Closed — All Levels List' })

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)
const policy = computed(() => meRes.value?.site ?? null)

// Somebody who *can* get in has no business on this page — most likely they
// just signed in as staff on the other tab.
watchEffect(() => {
  if (policy.value && !policy.value.adminOnly) navigateTo('/')
  else if (policy.value?.canAccess) navigateTo('/')
})

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await refreshNuxtData('auth-me')
  await navigateTo('/login')
}
</script>

<template>
  <div class="container-tight py-20 max-w-md text-center">
    <div class="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
      <span class="w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden="true" />
      In development
    </div>

    <h1 class="mt-4 text-2xl font-bold tracking-tight">The All Levels List is closed</h1>
    <!-- One line each: the three sentences answer three different questions,
         and running them together buried the last one. -->
    <p
      v-for="(line, i) in LOCKDOWN_LINES"
      :key="line"
      class="text-sm leading-relaxed"
      :class="i === 0 ? 'mt-3 text-zinc-300' : 'mt-1 text-zinc-500'"
    >{{ line }}</p>

    <p v-if="me" class="mt-6 text-xs text-zinc-500">
      Signed in as <span class="text-zinc-300">{{ me.username }}</span>.
      This account doesn't have access.
    </p>

    <div class="mt-6 flex items-center justify-center gap-2">
      <button
        type="button"
        class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
        @click="logout"
      >Log out</button>
      <a
        href="https://discord.gg/KfZvUpS3PB"
        target="_blank"
        rel="noopener noreferrer"
        class="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-accent hover:border-accent/40 transition-colors"
      >Discord ↗</a>
    </div>
  </div>
</template>
