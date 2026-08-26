<script setup lang="ts">
import { SITE_VERSION, versionLabel } from '~/utils/site-updates'

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

/**
 * Kept as data, and deliberately the same names the Credits dialog in the
 * header shows — the footer line used to credit two of the four people who
 * built the site, so the two disagreed with each other.
 */
const SITE_AUTHORS = ['GERG', 'cinnamings', 'Silk', 'Farm']
const DATA_AUTHORS = ['Cinder']

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await refreshNuxtData('auth-me')
  await navigateTo('/login')
}
</script>

<template>
  <footer class="border-t border-zinc-800/80 mt-16">
    <div class="container-wide py-6 space-y-3">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-zinc-500">
        <span class="font-medium text-zinc-300">The All Levels List</span>
        <span class="text-zinc-700" aria-hidden="true">·</span>
        <span class="text-zinc-600">ALL</span>

        <span
          class="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-300"
          title="The site is still in development. Things may break or change without warning."
        >
          <span class="w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden="true" />
          In development
        </span>

        <NuxtLink
          to="/updates"
          class="rounded-full border border-zinc-800 px-2 py-0.5 text-[11px] tabular-nums text-zinc-500 hover:border-accent/40 hover:text-accent transition-colors"
          :title="`Website version ${versionLabel(SITE_VERSION)} — see what changed`"
        >{{ versionLabel(SITE_VERSION) }}</NuxtLink>

        <nav class="flex items-center gap-3 ml-auto">
          <NuxtLink to="/about" class="hover:text-zinc-300 transition-colors">About &amp; stats</NuxtLink>
          <NuxtLink to="/changelog" class="hover:text-zinc-300 transition-colors">Changelog</NuxtLink>
          <NuxtLink to="/leaderboard" class="hover:text-zinc-300 transition-colors">Leaderboard</NuxtLink>
          <NuxtLink to="/updates" class="hover:text-zinc-300 transition-colors">Updates</NuxtLink>
        </nav>

        <button
          v-if="me"
          type="button"
          class="px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:border-red-900 hover:text-red-400 transition-colors"
          @click="logout"
        >Log out</button>
      </div>

      <p class="text-[11px] text-zinc-600 leading-relaxed">
        List data by <span class="text-zinc-400">{{ DATA_AUTHORS.join(', ') }}</span>
        <span class="text-zinc-700" aria-hidden="true"> · </span>
        Website by <span class="text-zinc-400">{{ SITE_AUTHORS.join(', ') }}</span>
        <span class="text-zinc-700">, and everyone who submits records and levels.</span>
      </p>
    </div>
  </footer>
</template>
