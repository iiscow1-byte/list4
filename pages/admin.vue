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

type TabId = 'records' | 'opinions' | 'levels' | 'awaiting' | 'movements' | 'open-verifications' | 'claims' | 'accounts' | 'discord'
const allTabs: { id: TabId; label: string; adminOnly: boolean }[] = [
  { id: 'records',            label: 'Records',         adminOnly: false },
  { id: 'opinions',           label: 'Opinions',        adminOnly: false },
  { id: 'levels',             label: 'Levels',          adminOnly: false },
  { id: 'awaiting',           label: 'Awaiting',        adminOnly: false },
  { id: 'movements',          label: 'Movements',       adminOnly: false },
  { id: 'open-verifications', label: 'Open verif.',     adminOnly: false },
  { id: 'claims',             label: 'Claims',          adminOnly: true },
  { id: 'accounts',           label: 'Accounts',        adminOnly: true },
  { id: 'discord',            label: 'Discord',         adminOnly: true },
]
const tabs = computed(() => allTabs.filter((t) => !t.adminOnly || isAdmin.value))

// "Pending" dropdown — groups the submission-queue tabs
const PENDING_TABS: TabId[] = ['levels', 'awaiting', 'movements', 'records', 'opinions']
const pendingDropdownOpen = ref(false)
const isPendingTab = computed(() => PENDING_TABS.includes(tab.value))

const pendingMenuRef = ref<HTMLElement | null>(null)
function onPendingDocClick(e: MouseEvent) {
  if (!pendingDropdownOpen.value) return
  if (pendingMenuRef.value?.contains(e.target as Node)) return
  pendingDropdownOpen.value = false
}
onMounted(() => document.addEventListener('click', onPendingDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onPendingDocClick))

const initial = (typeof route.query.tab === 'string' && allTabs.some((t) => t.id === route.query.tab))
  ? (route.query.tab as TabId)
  : 'levels'
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

// --- Discord tab state ---
type WebhookKind = 'changes' | 'leaderboard' | 'level_status' | 'challenge_changes'
type DiscordWebhook = {
  id: number
  url: string
  label: string | null
  active: 0 | 1
  tier_emoji: 0 | 1
  kind: WebhookKind
  created_at: string
  created_by: string | null
  last_posted_date: string | null
  last_post_status: string | null
}
const WEBHOOK_KIND_LABELS: Record<WebhookKind, string> = {
  changes: 'Daily changes',
  leaderboard: 'Leaderboard updates',
  level_status: 'Level status',
  challenge_changes: 'Challenge changes',
}
const webhooks = ref<DiscordWebhook[]>([])
const newWebhookUrl = ref('')
const newWebhookLabel = ref('')
const newWebhookKind = ref<WebhookKind>('changes')
const webhookBusy = ref(false)

async function loadWebhooks() {
  if (!isAdmin.value) return
  const res = await $fetch<{ items: DiscordWebhook[] }>('/api/admin/discord-webhooks')
  webhooks.value = res.items
}

async function addWebhook() {
  if (webhookBusy.value) return
  webhookBusy.value = true
  try {
    await $fetch('/api/admin/discord-webhooks', {
      method: 'POST',
      body: { url: newWebhookUrl.value.trim(), label: newWebhookLabel.value.trim() || null, kind: newWebhookKind.value },
    })
    flash('ok', 'Webhook added.')
    newWebhookUrl.value = ''
    newWebhookLabel.value = ''
    newWebhookKind.value = 'changes'
    await loadWebhooks()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  } finally {
    webhookBusy.value = false
  }
}

async function toggleWebhook(w: DiscordWebhook) {
  try {
    await $fetch(`/api/admin/discord-webhooks/${w.id}`, {
      method: 'PATCH', body: { active: !w.active },
    })
    await loadWebhooks()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}

async function toggleTierEmoji(w: DiscordWebhook) {
  try {
    await $fetch(`/api/admin/discord-webhooks/${w.id}`, {
      method: 'PATCH', body: { tier_emoji: !w.tier_emoji },
    })
    await loadWebhooks()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}

async function changeWebhookKind(w: DiscordWebhook, kind: WebhookKind) {
  try {
    await $fetch(`/api/admin/discord-webhooks/${w.id}`, {
      method: 'PATCH', body: { kind },
    })
    await loadWebhooks()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}

async function removeWebhook(w: DiscordWebhook) {
  if (!confirm(`Remove webhook ${w.label || w.url}?`)) return
  try {
    await $fetch(`/api/admin/discord-webhooks/${w.id}`, { method: 'DELETE' })
    flash('ok', 'Webhook removed.')
    await loadWebhooks()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}

async function testWebhook(w: DiscordWebhook) {
  try {
    await $fetch(`/api/admin/discord-webhooks/${w.id}/test`, { method: 'POST' })
    flash('ok', 'Test message sent.')
    await loadWebhooks()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Test failed.')
  }
}

async function postYesterday() {
  try {
    const res = await $fetch<{ posted: { webhookId: number; date: string; status: string }[] }>(
      '/api/admin/discord-webhooks/post-yesterday',
      { method: 'POST' },
    )
    if (res.posted.length === 0) {
      flash('err', 'No changes webhooks found.')
    } else {
      const ok = res.posted.filter((p) => p.status === 'ok')
      const errors = res.posted.filter((p) => p.status !== 'ok' && p.status !== 'no changes')
      if (errors.length) {
        flash('err', `Webhook error: ${errors[0]!.status}`)
      } else if (ok.length) {
        flash('ok', `Posted last changes to Discord. (${ok.length} webhook${ok.length === 1 ? '' : 's'})`)
      } else {
        flash('ok', 'No new changes to post.')
      }
    }
    await loadWebhooks()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}

async function postNow() {
  try {
    const res = await $fetch<{ posted: { webhookId: number; date: string; status: string }[] }>(
      '/api/admin/discord-webhooks/post-now',
      { method: 'POST' },
    )
    if (res.posted.length === 0) {
      flash('err', 'No webhooks found — add one above or check that at least one is configured.')
    } else {
      const ok = res.posted.filter((p) => p.status === 'ok')
      const noChanges = res.posted.filter((p) => p.status === 'no changes')
      const errors = res.posted.filter((p) => p.status !== 'ok' && p.status !== 'no changes')
      if (errors.length) {
        flash('err', `Webhook error: ${errors[0]!.status}`)
      } else if (ok.length) {
        flash('ok', `Posted to Discord. (${ok.length} webhook${ok.length === 1 ? '' : 's'})`)
      } else {
        flash('ok', `No changes to post for today — only level placements and moves appear in the summary.`)
      }
    }
    await loadWebhooks()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}

watch(tab, (t) => {
  if (t === 'claims')   loadClaims()
  if (t === 'accounts') loadUsers()
  if (t === 'discord')  loadWebhooks()
  // Mark tab as seen so its badge clears
  if (liveCounts.value) seenCounts[t] = liveCounts.value[t as keyof typeof liveCounts.value] ?? 0
}, { immediate: true })

// --- Notification counts ---
type Counts = Record<string, number>
const liveCounts = ref<Counts | null>(null)
const seenCounts = reactive<Counts>({})

async function fetchCounts() {
  try {
    const res = await $fetch<Counts>('/api/admin/counts')
    liveCounts.value = res
    // On first load, initialise seenCounts so only future increases show badges.
    for (const [k, v] of Object.entries(res)) {
      if (!(k in seenCounts)) seenCounts[k] = v
    }
  } catch { /* non-fatal */ }
}

function tabBadge(id: string): number {
  if (!liveCounts.value) return 0
  const live = liveCounts.value[id] ?? 0
  const seen = seenCounts[id] ?? live
  return Math.max(0, live - seen)
}

let countTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  fetchCounts()
  countTimer = setInterval(fetchCounts, 30_000)
})
onBeforeUnmount(() => { if (countTimer) clearInterval(countTimer) })

// Role hierarchy — owner and developer outrank admin
const ROLE_RANK: Record<string, number> = {
  user: 0,
  moderator: 1,
  admin: 2,
  owner: 3,
  developer: 3,
}
function roleAboveMe(role: string): boolean {
  const myRank = ROLE_RANK[me.value?.role ?? 'user'] ?? 0
  return (ROLE_RANK[role] ?? 0) > myRank
}

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
      <div class="container-tight flex gap-1 py-2 items-center">
        <!-- Pending dropdown: groups submission-queue tabs -->
        <div ref="pendingMenuRef" class="relative flex items-stretch">
          <button
            type="button"
            class="pl-3 pr-2 py-1.5 rounded-l text-sm font-medium transition-colors relative"
            :class="isPendingTab && !pendingDropdownOpen
              ? 'bg-zinc-900 text-zinc-100'
              : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'"
            @click="pendingDropdownOpen = !pendingDropdownOpen"
          >
            {{ isPendingTab ? allTabs.find(t => t.id === tab)?.label : 'Pending' }}
            <!-- Badge sum for all pending tabs -->
            <span
              v-if="PENDING_TABS.reduce((s, id) => s + tabBadge(id), 0) > 0"
              class="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-0.5 leading-none"
            >{{ PENDING_TABS.reduce((s, id) => s + tabBadge(id), 0) }}</span>
          </button>
          <button
            type="button"
            class="px-1.5 py-1.5 rounded-r text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
            :class="{ 'text-zinc-100 bg-zinc-900': pendingDropdownOpen || isPendingTab }"
            :aria-expanded="pendingDropdownOpen"
            aria-haspopup="menu"
            aria-label="Pending tabs"
            @click="pendingDropdownOpen = !pendingDropdownOpen"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5 transition-transform" :class="{ 'rotate-180': pendingDropdownOpen }" aria-hidden="true">
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z" clip-rule="evenodd" />
            </svg>
          </button>
          <div
            v-if="pendingDropdownOpen"
            role="menu"
            class="absolute left-0 top-full mt-1 min-w-[11rem] rounded-md border border-zinc-800 bg-zinc-950 shadow-lg shadow-black/40 py-1 z-40"
          >
            <button
              v-for="id in PENDING_TABS"
              :key="id"
              type="button"
              role="menuitem"
              class="relative w-full text-left px-3 py-1.5 text-sm transition-colors"
              :class="tab === id
                ? 'text-zinc-100 bg-zinc-900'
                : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900'"
              @click="tab = id; pendingDropdownOpen = false"
            >
              {{ allTabs.find(t => t.id === id)?.label }}
              <span
                v-if="tabBadge(id) > 0"
                class="absolute top-1.5 right-2 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-0.5 leading-none"
              >{{ tabBadge(id) }}</span>
            </button>
          </div>
        </div>

        <span class="w-px h-5 bg-zinc-800 mx-0.5" />

        <!-- Non-pending tabs: open-verifications + admin-only -->
        <button
          v-for="t in tabs.filter(t => !PENDING_TABS.includes(t.id))"
          :key="t.id"
          type="button"
          class="relative px-3 py-1.5 rounded text-sm font-medium transition-colors"
          :class="tab === t.id
            ? 'bg-zinc-900 text-zinc-100'
            : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'"
          @click="tab = t.id"
        >
          {{ t.label }}
          <span
            v-if="tabBadge(t.id) > 0"
            class="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-0.5 leading-none"
          >{{ tabBadge(t.id) }}</span>
        </button>
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

    <!-- Movements tab — pending level-position movement requests -->
    <AdminMovementsReview v-else-if="tab === 'movements'" class="flex-1 min-h-0" />

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
                  :disabled="roleAboveMe(r)"
                  class="px-2 py-1 rounded border transition-colors"
                  :class="roleAboveMe(r)
                    ? 'border-zinc-800 text-zinc-700 cursor-not-allowed'
                    : u.role === r
                      ? 'border-accent bg-accent/15 text-accent'
                      : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'"
                  @click="!roleAboveMe(r) && setRole(u, r)"
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

    <!-- Discord tab -->
    <div v-else-if="tab === 'discord'" class="flex-1 overflow-y-auto">
      <div class="container-tight py-8 max-w-3xl space-y-6">
        <section class="rounded-md border border-zinc-800 bg-zinc-950/60">
          <div class="px-4 pt-3 pb-2 flex items-baseline justify-between gap-3">
            <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium">Discord webhooks</h2>
            <div class="flex items-center gap-3">
              <button
                type="button"
                class="text-[11px] text-accent hover:underline"
                @click="postYesterday"
                title="Post yesterday's completed changes (same as the auto-scheduler)"
              >Post last changes</button>
              <button
                type="button"
                class="text-[11px] text-zinc-400 hover:underline"
                @click="postNow"
                title="Post today's changes so far (partial day)"
              >Post today's changes</button>
            </div>
          </div>
          <p class="px-4 pb-3 text-[11px] text-zinc-500 leading-relaxed">
            Webhooks are grouped by type: <strong class="text-zinc-400">Daily changes</strong> receives a nightly summary of level moves,
            <strong class="text-zinc-400">Challenge changes</strong> is the same but filtered to challenge-rated levels only (with challenge ranks),
            <strong class="text-zinc-400">Leaderboard updates</strong> fires when a record is approved,
            and <strong class="text-zinc-400">Level status</strong> fires when a level reaches Awaiting Placement or the Void list.
            Set the <code class="text-zinc-300">SITE_URL</code> env var to enable level links inside the embeds.
          </p>

          <div class="px-4 pb-4 border-t border-zinc-900 pt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2">
            <input
              v-model="newWebhookUrl"
              placeholder="https://discord.com/api/webhooks/…/…"
              class="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <input
              v-model="newWebhookLabel"
              placeholder="Label"
              class="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <select
              v-model="newWebhookKind"
              class="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="changes">Daily changes</option>
              <option value="challenge_changes">Challenge changes</option>
              <option value="leaderboard">Leaderboard updates</option>
              <option value="level_status">Level status</option>
            </select>
            <button
              type="button"
              :disabled="webhookBusy || !newWebhookUrl.trim()"
              class="rounded bg-accent text-zinc-950 font-medium text-xs px-3 py-1.5 hover:bg-accent/90 disabled:opacity-60 transition-colors"
              @click="addWebhook"
            >{{ webhookBusy ? 'Adding…' : 'Add' }}</button>
          </div>

          <ul v-if="webhooks.length" class="divide-y divide-zinc-900">
            <li v-for="w in webhooks" :key="w.id" class="px-4 py-3 flex flex-wrap gap-3 items-center" :class="{ 'opacity-60': !w.active }">
              <div class="flex-1 min-w-0">
                <div class="flex items-baseline gap-2 flex-wrap">
                  <span class="font-medium text-zinc-100 text-sm truncate">{{ w.label || 'Unnamed webhook' }}</span>
                  <span
                    class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border"
                    :class="w.active
                      ? 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-500'"
                  >{{ w.active ? 'Active' : 'Paused' }}</span>
                  <span
                    class="text-[10px] px-1.5 py-0.5 rounded border"
                    :class="{
                      'border-blue-900/60 bg-blue-950/40 text-blue-300': w.kind === 'changes',
                      'border-amber-900/60 bg-amber-950/40 text-amber-300': w.kind === 'challenge_changes',
                      'border-emerald-900/60 bg-emerald-950/30 text-emerald-400': w.kind === 'leaderboard',
                      'border-purple-900/60 bg-purple-950/30 text-purple-300': w.kind === 'level_status',
                    }"
                  >{{ WEBHOOK_KIND_LABELS[w.kind] ?? w.kind }}</span>
                </div>
                <div class="text-[11px] text-zinc-500 truncate font-mono" :title="w.url">{{ w.url }}</div>
                <div class="text-[10px] text-zinc-600 mt-0.5">
                  Added {{ w.created_at }}<span v-if="w.created_by"> by {{ w.created_by }}</span>
                  <template v-if="w.kind === 'changes'">
                    · Last posted: <span class="text-zinc-400">{{ w.last_posted_date ?? '—' }}</span>
                    <span v-if="w.last_post_status" class="text-zinc-500"> ({{ w.last_post_status }})</span>
                  </template>
                </div>
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                <select
                  :value="w.kind"
                  class="rounded border border-zinc-700 bg-zinc-900 text-xs px-2 py-1 text-zinc-300 focus:border-accent focus:outline-none"
                  @change="changeWebhookKind(w, ($event.target as HTMLSelectElement).value as WebhookKind)"
                >
                  <option value="changes">Daily changes</option>
                  <option value="challenge_changes">Challenge changes</option>
                  <option value="leaderboard">Leaderboard updates</option>
                  <option value="level_status">Level status</option>
                </select>
                <label
                  v-if="w.kind === 'changes' || w.kind === 'challenge_changes'"
                  class="flex items-center gap-1.5 cursor-pointer select-none text-xs transition-colors"
                  :class="w.tier_emoji ? 'text-accent' : 'text-zinc-500 hover:text-zinc-300'"
                  :title="w.tier_emoji ? 'Tier emojis enabled — click to disable' : 'Enable tier emojis in embeds'"
                >
                  <input type="checkbox" :checked="!!w.tier_emoji" class="accent-accent" @change="toggleTierEmoji(w)" />
                  Tier emoji
                </label>
                <button
                  type="button"
                  class="rounded border border-zinc-700 hover:border-accent hover:text-accent text-xs px-2.5 py-1 transition-colors"
                  @click="testWebhook(w)"
                >Test</button>
                <button
                  type="button"
                  class="rounded border border-zinc-700 text-xs px-2.5 py-1 transition-colors"
                  :class="w.active ? 'hover:border-amber-700 hover:text-amber-300' : 'hover:border-emerald-700 hover:text-emerald-300'"
                  @click="toggleWebhook(w)"
                >{{ w.active ? 'Pause' : 'Resume' }}</button>
                <button
                  type="button"
                  class="rounded border border-zinc-700 hover:border-red-600 hover:text-red-400 text-xs px-2.5 py-1 transition-colors"
                  @click="removeWebhook(w)"
                >Remove</button>
              </div>
            </li>
          </ul>
          <div v-else class="px-4 pb-4 text-xs text-zinc-600">No webhooks configured.</div>
        </section>
      </div>
    </div>
  </div>
</template>
