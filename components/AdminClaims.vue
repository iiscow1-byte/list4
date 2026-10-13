<script setup lang="ts">
import { timeAgo, absoluteTime } from '~/utils/relative-time'

/** People asking to be recognised as a player on the list, oldest first. */
const emit = defineEmits<{ (e: 'changed'): void }>()
const toast = useAdminToast()

type Claim = { id: number; player_name: string; created_at: string; username: string; account_id: number }
const claims = ref<Claim[]>([])
const loading = ref(true)
const busy = ref<number | null>(null)

async function load() {
  try {
    claims.value = (await $fetch<{ items: Claim[] }>('/api/admin/claims')).items
  } catch (e) {
    toast.fail(e, 'Could not load claims.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function decide(c: Claim, action: 'approve' | 'reject') {
  if (busy.value) return
  busy.value = c.id
  try {
    await $fetch(`/api/admin/claims/${c.id}`, { method: 'POST', body: { action } })
    toast.ok(action === 'approve' ? `${c.username} now plays as ${c.player_name}.` : `Rejected ${c.username}’s claim.`)
    claims.value = claims.value.filter((x) => x.id !== c.id)
    emit('changed')
  } catch (e) {
    toast.fail(e)
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <AdminSection title="Claims" description="Approving one links the account to that player, and their records here count for the account.">
    <div v-if="loading" class="card h-24 animate-pulse" />
    <div v-else-if="!claims.length" class="card px-4 py-10 text-center">
      <p class="text-sm text-zinc-300">No claims waiting.</p>
    </div>
    <ul v-else class="card divide-y divide-zinc-800/60">
      <li v-for="c in claims" :key="c.id" class="px-4 py-3 flex flex-wrap gap-3 items-center">
        <div class="flex-1 min-w-0 text-sm">
          <NuxtLink :to="`/users/${c.username}`" class="font-medium text-zinc-100 hover:text-accent">{{ c.username }}</NuxtLink>
          <span class="text-zinc-500"> says they are </span>
          <NuxtLink :to="`/users/by-player/${encodeURIComponent(c.player_name)}`" class="font-medium text-accent hover:underline">{{ c.player_name }}</NuxtLink>
          <div class="text-xs text-zinc-500 mt-0.5" :title="absoluteTime(c.created_at)">Asked {{ timeAgo(c.created_at) }}</div>
        </div>
        <div class="flex gap-2">
          <button type="button" :disabled="busy === c.id" class="btn btn-sm btn-ghost hover:border-red-700 hover:text-red-300" @click="decide(c, 'reject')">Reject</button>
          <button type="button" :disabled="busy === c.id" class="btn btn-sm bg-emerald-600 text-white hover:bg-emerald-500" @click="decide(c, 'approve')">Approve</button>
        </div>
      </li>
    </ul>
  </AdminSection>
</template>
