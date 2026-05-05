<script setup lang="ts">
const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await refreshNuxtData('auth-me')
  await navigateTo('/login')
}
</script>

<template>
  <footer class="border-t border-zinc-800 mt-16">
    <div class="container-tight py-6 text-xs text-zinc-500 flex flex-wrap items-center justify-between gap-3">
      <span>The All Levels List [ALL] &middot; Google Sheet by Cinder, website created by GERG and Silk &lt;3</span>
      <button
        v-if="me"
        type="button"
        class="px-3 py-1.5 rounded border border-zinc-800 text-zinc-400 hover:border-red-900 hover:text-red-400 transition-colors"
        @click="logout"
      >Log out</button>
    </div>
  </footer>
</template>
