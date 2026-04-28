<script setup lang="ts">
definePageMeta({ middleware: 'admin' })
useHead({ title: 'Admin — All Levels List' })

type Claim = { id: number; player_name: string; created_at: string; username: string; account_id: number }
type AdminUser = { id: number; username: string; role: 'user'|'moderator'|'admin'; claimed_player: string | null; created_at: string }

const claims = ref<Claim[]>([])
const users = ref<AdminUser[]>([])
const userSearch = ref('')
const banner = ref<{ kind: 'ok' | 'err'; msg: string } | null>(null)

function flash(kind: 'ok' | 'err', msg: string) {
  banner.value = { kind, msg }
  setTimeout(() => (banner.value = null), 3000)
}

async function loadClaims() {
  const res = await $fetch<{ items: Claim[] }>('/api/admin/claims')
  claims.value = res.items
}
async function loadUsers() {
  const res = await $fetch<{ items: AdminUser[] }>('/api/admin/users', {
    query: userSearch.value ? { search: userSearch.value } : undefined,
  })
  users.value = res.items
}

onMounted(async () => {
  await Promise.all([loadClaims(), loadUsers()])
})

let searchDebounce: ReturnType<typeof setTimeout> | null = null
watch(userSearch, () => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(loadUsers, 200)
})

async function decideClaim(c: Claim, action: 'approve' | 'reject') {
  try {
    await $fetch(`/api/admin/claims/${c.id}`, { method: 'POST', body: { action } })
    flash('ok', `Claim ${action === 'approve' ? 'approved' : 'rejected'}.`)
    await Promise.all([loadClaims(), loadUsers()])
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}

async function setRole(u: AdminUser, role: 'user' | 'moderator' | 'admin') {
  if (u.role === role) return
  try {
    await $fetch('/api/admin/role', { method: 'POST', body: { username: u.username, role } })
    flash('ok', `${u.username} is now ${role}.`)
    await loadUsers()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}

const claimEdits = reactive<Record<number, string>>({})
async function setClaim(u: AdminUser) {
  const player = (claimEdits[u.id] ?? '').trim()
  try {
    await $fetch('/api/admin/set-claim', {
      method: 'POST',
      body: { username: u.username, player_name: player || null },
    })
    flash('ok', player ? `${u.username} claimed as ${player}.` : `Cleared claim for ${u.username}.`)
    delete claimEdits[u.id]
    await Promise.all([loadClaims(), loadUsers()])
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}
</script>

<template>
  <div class="container-tight py-8 max-w-4xl space-y-8">
    <header>
      <h1 class="text-3xl font-semibold tracking-tight">Admin</h1>
      <p class="text-sm text-zinc-400 mt-1">Review claim requests, manage roles, bind accounts to leaderboard players.</p>
    </header>

    <div
      v-if="banner"
      class="rounded border px-3 py-2 text-sm"
      :class="banner.kind === 'ok' ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-300' : 'border-red-900/50 bg-red-950/30 text-red-300'"
    >{{ banner.msg }}</div>

    <!-- Claim queue -->
    <section class="rounded-md border border-zinc-800 bg-zinc-950/60">
      <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium px-4 pt-3 pb-2 flex items-baseline gap-2">
        Pending claims
        <span class="text-[11px] text-zinc-600 normal-case tracking-normal">{{ claims.length }}</span>
      </h2>
      <div v-if="claims.length === 0" class="px-4 pb-4 text-xs text-zinc-600">Nothing pending.</div>
      <ul v-else class="divide-y divide-zinc-900">
        <li v-for="c in claims" :key="c.id" class="px-4 py-3 flex flex-wrap gap-3 items-center">
          <div class="flex-1 min-w-0 text-sm">
            <NuxtLink :to="`/users/${c.username}`" class="text-zinc-100 font-medium hover:text-accent">{{ c.username }}</NuxtLink>
            <span class="text-zinc-500"> wants to claim </span>
            <span class="text-accent font-medium">{{ c.player_name }}</span>
            <div class="text-[11px] text-zinc-500 mt-0.5">{{ c.created_at }}</div>
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              class="rounded bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-medium text-xs px-3 py-1.5 transition-colors"
              @click="decideClaim(c, 'approve')"
            >Approve</button>
            <button
              type="button"
              class="rounded border border-zinc-700 hover:border-red-600 hover:text-red-400 text-xs px-3 py-1.5 transition-colors"
              @click="decideClaim(c, 'reject')"
            >Reject</button>
          </div>
        </li>
      </ul>
    </section>

    <!-- Users -->
    <section class="rounded-md border border-zinc-800 bg-zinc-950/60">
      <div class="px-4 pt-3 pb-2 flex items-center gap-3 flex-wrap">
        <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium">Accounts</h2>
        <input
          v-model="userSearch"
          type="search"
          placeholder="Search by username or player…"
          class="ml-auto w-64 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div v-if="users.length === 0" class="px-4 pb-4 text-xs text-zinc-600">No accounts.</div>
      <ul v-else class="divide-y divide-zinc-900">
        <li v-for="u in users" :key="u.id" class="px-4 py-3 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-center">
          <div class="min-w-0">
            <div class="flex items-baseline gap-2 flex-wrap">
              <NuxtLink :to="`/users/${u.username}`" class="font-medium text-zinc-100 hover:text-accent">{{ u.username }}</NuxtLink>
              <span class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border" :class="{
                'bg-accent/15 text-accent border-accent/30': u.role !== 'user',
                'bg-zinc-900 text-zinc-500 border-zinc-800': u.role === 'user',
              }">{{ u.role }}</span>
              <span v-if="u.claimed_player" class="text-[11px] text-zinc-400">→ {{ u.claimed_player }}</span>
            </div>
            <div class="text-[11px] text-zinc-500 mt-0.5">{{ u.created_at }}</div>
          </div>
          <div class="flex items-center gap-2">
            <input
              :value="claimEdits[u.id] ?? u.claimed_player ?? ''"
              :placeholder="u.claimed_player ? 'edit claim' : 'claim player'"
              class="w-44 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none"
              @input="(e) => (claimEdits[u.id] = (e.target as HTMLInputElement).value)"
            />
            <button
              type="button"
              class="rounded border border-zinc-700 hover:border-accent hover:text-accent text-xs px-2.5 py-1 transition-colors"
              @click="setClaim(u)"
            >Set</button>
          </div>
          <div class="flex items-center gap-1 text-xs">
            <button
              v-for="r in (['user','moderator','admin'] as const)"
              :key="r"
              type="button"
              class="px-2 py-1 rounded border transition-colors"
              :class="u.role === r
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'"
              @click="setRole(u, r)"
            >{{ r }}</button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
