<script setup lang="ts">
import { roleBadgeClass } from '~/utils/role-styles'

definePageMeta({ middleware: 'mod', layout: 'level' })
useHead({ title: 'Admin — All Levels List' })

const route = useRoute()
const router = useRouter()
const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)
const isAdmin = computed(() => {
  const r = me.value?.role
  return r === 'admin' || r === 'owner' || r === 'developer'
})

type TabId = 'records' | 'opinions' | 'levels' | 'awaiting' | 'open-verifications' | 'claims' | 'accounts'
const allTabs: { id: TabId; label: string; adminOnly: boolean }[] = [
  { id: 'records',            label: 'Records',         adminOnly: false },
  { id: 'opinions',           label: 'Opinions',        adminOnly: false },
  { id: 'levels',             label: 'Levels',          adminOnly: false },
  { id: 'awaiting',           label: 'Awaiting',        adminOnly: false },
  { id: 'open-verifications', label: 'Open verif.',     adminOnly: false },
  { id: 'claims',             label: 'Claims',          adminOnly: true },
  { id: 'accounts',           label: 'Accounts',        adminOnly: true },
]
const tabs = computed(() => allTabs.filter((t) => !t.adminOnly || isAdmin.value))

const initial = (typeof route.query.tab === 'string' && allTabs.some((t) => t.id === route.query.tab))
  ? (route.query.tab as TabId)
  : 'records'
const tab = ref<TabId>(initial)

watch(tab, (v) => {
  router.replace({ query: { ...route.query, tab: v } })
})

// --- Claims tab state ---
type Claim = { id: number; player_name: string; created_at: string; username: string; account_id: number }
const claims = ref<Claim[]>([])
async function loadClaims() {
  if (!isAdmin.value) return
  const res = await $fetch<{ items: Claim[] }>('/api/admin/claims')
  claims.value = res.items
}

// --- Accounts tab state ---
type Role = 'user' | 'moderator' | 'admin' | 'owner' | 'developer'
type AdminUser = {
  id: number; username: string; role: Role
  claimed_player: string | null; created_at: string
  banned_at: string | null; banned_reason: string | null
}
const users = ref<AdminUser[]>([])
const userSearch = ref('')
const claimEdits = reactive<Record<number, string>>({})

async function loadUsers() {
  if (!isAdmin.value) return
  const res = await $fetch<{ items: AdminUser[] }>('/api/admin/users', {
    query: userSearch.value ? { search: userSearch.value } : undefined,
  })
  users.value = res.items
}

let userSearchDebounce: ReturnType<typeof setTimeout> | null = null
watch(userSearch, () => {
  if (userSearchDebounce) clearTimeout(userSearchDebounce)
  userSearchDebounce = setTimeout(loadUsers, 200)
})

watch(tab, (t) => {
  if (t === 'claims')   loadClaims()
  if (t === 'accounts') loadUsers()
}, { immediate: true })

// --- Banner ---
const banner = ref<{ kind: 'ok' | 'err'; msg: string } | null>(null)
function flash(kind: 'ok' | 'err', msg: string) {
  banner.value = { kind, msg }
  setTimeout(() => (banner.value = null), 3000)
}

async function decideClaim(c: Claim, action: 'approve' | 'reject') {
  try {
    await $fetch(`/api/admin/claims/${c.id}`, { method: 'POST', body: { action } })
    flash('ok', `Claim ${action === 'approve' ? 'approved' : 'rejected'}.`)
    await Promise.all([loadClaims(), loadUsers()])
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}

async function setRole(u: AdminUser, role: Role) {
  if (u.role === role) return
  try {
    await $fetch('/api/admin/role', { method: 'POST', body: { username: u.username, role } })
    flash('ok', `${u.username} is now ${role}.`)
    await loadUsers()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}

async function toggleBan(u: AdminUser) {
  if (u.banned_at) {
    if (!confirm(`Unban ${u.username}?`)) return
    try {
      await $fetch('/api/admin/ban', { method: 'POST', body: { username: u.username, action: 'unban' } })
      flash('ok', `${u.username} unbanned.`)
      await loadUsers()
    } catch (e: any) {
      flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
    }
    return
  }
  const reason = prompt(`Ban ${u.username}? Optional reason (shown to them on next login):`, '')
  if (reason === null) return // cancelled
  try {
    await $fetch('/api/admin/ban', {
      method: 'POST',
      body: { username: u.username, action: 'ban', reason: reason.trim() || undefined },
    })
    flash('ok', `${u.username} banned.`)
    await loadUsers()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}

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
  <div class="h-full flex flex-col">
    <nav class="border-b border-zinc-800 bg-zinc-950 shrink-0">
      <div class="container-tight flex gap-1 py-2">
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          class="px-3 py-1.5 rounded text-sm font-medium transition-colors"
          :class="tab === t.id
            ? 'bg-zinc-900 text-zinc-100'
            : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'"
          @click="tab = t.id"
        >{{ t.label }}</button>
      </div>
    </nav>

    <div v-if="banner" class="container-tight pt-3 shrink-0">
      <div
        class="rounded border px-3 py-2 text-sm"
        :class="banner.kind === 'ok'
          ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-300'
          : 'border-red-900/50 bg-red-950/30 text-red-300'"
      >{{ banner.msg }}</div>
    </div>

    <!-- Records tab — full-width 3-panel review layout -->
    <AdminRecordsReview v-if="tab === 'records'" class="flex-1 min-h-0" />

    <!-- Opinions tab — community rating submissions -->
    <AdminOpinionsReview v-else-if="tab === 'opinions'" class="flex-1 min-h-0" />

    <!-- Levels tab — pending level submissions -->
    <AdminLevelsReview v-else-if="tab === 'levels'" class="flex-1 min-h-0" />

    <!-- Awaiting tab — approved but unplaced levels -->
    <AdminAwaitingReview v-else-if="tab === 'awaiting'" class="flex-1 min-h-0" />

    <!-- Open verifications tab — pending unverified-level submissions -->
    <AdminOpenVerificationsReview v-else-if="tab === 'open-verifications'" class="flex-1 min-h-0" />

    <!-- Claims tab -->
    <div v-else-if="tab === 'claims'" class="flex-1 overflow-y-auto">
      <div class="container-tight py-8 max-w-4xl">
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
      </div>
    </div>

    <!-- Accounts tab -->
    <div v-else-if="tab === 'accounts'" class="flex-1 overflow-y-auto">
      <div class="container-tight py-8 max-w-4xl">
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
            <li v-for="u in users" :key="u.id" class="px-4 py-3 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-center" :class="{ 'opacity-70': u.banned_at }">
              <div class="min-w-0">
                <div class="flex items-baseline gap-2 flex-wrap">
                  <NuxtLink :to="`/users/${u.username}`" class="font-medium text-zinc-100 hover:text-accent">{{ u.username }}</NuxtLink>
                  <span class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded" :class="roleBadgeClass(u.role)">{{ u.role }}</span>
                  <span
                    v-if="u.banned_at"
                    class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border bg-red-950/40 text-red-300 border-red-900/60"
                    :title="u.banned_reason ?? 'banned'"
                  >Banned</span>
                  <span v-if="u.claimed_player" class="text-[11px] text-zinc-400">→ {{ u.claimed_player }}</span>
                </div>
                <div class="text-[11px] text-zinc-500 mt-0.5">{{ u.created_at }}</div>
                <div v-if="u.banned_at && u.banned_reason" class="text-[11px] text-red-300/80 mt-0.5 truncate" :title="u.banned_reason">
                  Reason: {{ u.banned_reason }}
                </div>
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
              <div class="flex items-center gap-1 text-xs flex-wrap">
                <button
                  v-for="r in (['user','moderator','owner','developer','admin'] as const)"
                  :key="r"
                  type="button"
                  class="px-2 py-1 rounded border transition-colors"
                  :class="u.role === r
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'"
                  @click="setRole(u, r)"
                >{{ r }}</button>
                <button
                  type="button"
                  class="ml-1 px-2 py-1 rounded border transition-colors"
                  :class="u.banned_at
                    ? 'border-emerald-800 text-emerald-300 hover:bg-emerald-950/40'
                    : 'border-red-900/60 text-red-300 hover:bg-red-950/40'"
                  @click="toggleBan(u)"
                >{{ u.banned_at ? 'Unban' : 'Ban' }}</button>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>
