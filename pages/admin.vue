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

type TabId = 'records' | 'opinions' | 'levels' | 'imported-levels' | 'awaiting' | 'movements' | 'open-verifications' | 'imports' | 'claims' | 'accounts' | 'discord'
const allTabs: { id: TabId; label: string; adminOnly: boolean }[] = [
  { id: 'records',            label: 'Records',         adminOnly: false },
  { id: 'opinions',           label: 'Opinions',        adminOnly: false },
  { id: 'levels',             label: 'Levels',          adminOnly: false },
  { id: 'imported-levels',    label: 'Imported levels', adminOnly: false },
  { id: 'awaiting',           label: 'Awaiting',        adminOnly: false },
  { id: 'movements',          label: 'Movements',       adminOnly: false },
  { id: 'open-verifications', label: 'Open verif.',     adminOnly: false },
  { id: 'imports',            label: 'Imports',         adminOnly: true },
  { id: 'claims',             label: 'Claims',          adminOnly: true },
  { id: 'accounts',           label: 'Accounts',        adminOnly: true },
  { id: 'discord',            label: 'Discord',         adminOnly: true },
  { id: 'custom-lists',       label: 'Custom lists',    adminOnly: true },
]
const tabs = computed(() => allTabs.filter((t) => !t.adminOnly || isAdmin.value))

// "Pending" dropdown — groups the submission-queue tabs
const PENDING_TABS: TabId[] = ['levels', 'imported-levels', 'awaiting', 'movements', 'records', 'opinions']
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
  try {
    const res = await $fetch<{ items: Claim[] }>('/api/admin/claims')
    claims.value = res.items
  } catch { /* non-fatal on SSR or auth failure */ }
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
  try {
    const res = await $fetch<{ items: AdminUser[] }>('/api/admin/users', {
      query: userSearch.value ? { search: userSearch.value } : undefined,
    })
    users.value = res.items
  } catch { /* non-fatal on SSR or auth failure */ }
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
  try {
    const res = await $fetch<{ items: DiscordWebhook[] }>('/api/admin/discord-webhooks')
    webhooks.value = res.items
  } catch { /* non-fatal on SSR or auth failure */ }
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

// --- Imports tab state ---
type ImportSourceKey = 'sheet' | 'sheet-pending' | 'gdl' | 'tsl' | 'edi' | 'ccl' | 'll' | 'tcl' | 'sfl' | 'ddl' | 'aredl' | 'aredl-history' | 'pointercrate' | 'gsv' | 'cl' | 'mscl'
type PendingKey = 'sheet' | 'gdl' | 'tsl' | 'edi' | 'ccl' | 'll' | 'tcl' | 'sfl' | 'ddl' | 'cl'
type ImportSource = {
  key: ImportSourceKey
  label: string
  // Sources that don't write to pending_levels can't have anything to clear.
  pendingKey: PendingKey | null
}
type ImportGroup = { heading: string; sources: ImportSource[] }
const IMPORT_GROUPS: ImportGroup[] = [
  {
    heading: 'Sheet',
    sources: [
      { key: 'sheet',         label: 'Full re-import',   pendingKey: 'sheet' },
      { key: 'sheet-pending', label: 'Pending list only', pendingKey: 'sheet' },
    ],
  },
  {
    heading: 'Demon lists',
    sources: [
      { key: 'gdl',  label: 'GDL',  pendingKey: 'gdl' },
      { key: 'tsl',  label: 'TSL',  pendingKey: 'tsl' },
      { key: 'edi',  label: 'EDI',  pendingKey: 'edi' },
      { key: 'ccl',  label: 'CCL',  pendingKey: 'ccl' },
      { key: 'll',   label: 'LL',   pendingKey: 'll'  },
      { key: 'tcl',  label: 'TCL',  pendingKey: 'tcl' },
      { key: 'sfl',  label: 'SFL',  pendingKey: 'sfl' },
      { key: 'ddl',  label: 'DDL',             pendingKey: 'ddl' },
      { key: 'cl',   label: 'Challenge List',  pendingKey: 'cl'  },
      { key: 'mscl', label: 'MSCL',            pendingKey: null  },
    ],
  },
  {
    heading: 'Records & players',
    sources: [
      { key: 'aredl',         label: 'AREDL',         pendingKey: null },
      { key: 'aredl-history', label: 'AREDL history', pendingKey: null },
      { key: 'pointercrate',  label: 'Pointercrate',  pendingKey: null },
      { key: 'gsv',           label: 'Stats Viewer',  pendingKey: null },
    ],
  },
]
// Flat list kept for functions that need to iterate all sources.
const IMPORT_SOURCES = IMPORT_GROUPS.flatMap(g => g.sources)
// All groups start open; admins can collapse any section they're not using.
const groupsOpen = reactive<Record<string, boolean>>(
  Object.fromEntries(IMPORT_GROUPS.map(g => [g.heading, true])),
)

const importsStatus = ref<{ pendingCounts: Record<string, number>; running: string[]; queued: string[] }>({
  pendingCounts: {}, running: [], queued: [],
})
const importBusy = reactive<Record<string, boolean>>({})

const totalUnaccepted = computed(() =>
  IMPORT_SOURCES.reduce((n, s) => n + (s.pendingKey ? (importsStatus.value.pendingCounts[s.pendingKey] ?? 0) : 0), 0),
)

async function loadImportsStatus() {
  if (!isAdmin.value) return
  try {
    importsStatus.value = await $fetch('/api/admin/imports/status')
  } catch { /* non-fatal */ }
}

async function runImport(source: ImportSourceKey) {
  if (importBusy[source]) return
  importBusy[source] = true
  try {
    const res = await $fetch<{ started: boolean; queued: boolean }>('/api/admin/imports/run', { method: 'POST', body: { source } })
    if (res.queued) flash('ok', `${source} queued — will start when current run finishes.`)
    else flash('ok', `Started ${source} import.`)
    await loadImportsStatus()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  } finally {
    importBusy[source] = false
  }
}

/**
 * Re-derive every level's displayed placement from its list order. Reports the
 * inversion count on both sides so "it did nothing" and "it fixed nothing" are
 * distinguishable.
 */
const repairingPlacements = ref(false)
const repairResult = ref<string | null>(null)

async function repairPlacements() {
  if (repairingPlacements.value) return
  repairingPlacements.value = true
  repairResult.value = null
  try {
    const res = await $fetch<{ changed: number; inversions_before: number; inversions_after: number }>(
      '/api/admin/repair-placements', { method: 'POST' },
    )
    repairResult.value = res.changed === 0
      ? 'Placements were already in order — nothing to fix.'
      : `Rewrote ${res.changed.toLocaleString()} placement${res.changed === 1 ? '' : 's'} `
        + `(${res.inversions_before} out-of-order → ${res.inversions_after}).`
  } catch (e: any) {
    repairResult.value = `Failed: ${e?.data?.statusMessage ?? e?.statusMessage ?? 'unknown error'}`
  } finally {
    repairingPlacements.value = false
  }
}

async function clearPending(source: PendingKey) {
  const count = importsStatus.value.pendingCounts[source] ?? 0
  if (count === 0) { flash('ok', 'Nothing to clear.'); return }
  if (!confirm(`Delete ${count} unaccepted pending level${count === 1 ? '' : 's'} imported from ${source}? This can't be undone.`)) return
  try {
    const res = await $fetch<{ deleted: number }>('/api/admin/imports/clear-pending', {
      method: 'POST', body: { source },
    })
    flash('ok', `Removed ${res.deleted} unaccepted level${res.deleted === 1 ? '' : 's'}.`)
    await loadImportsStatus()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}

async function clearAllPending() {
  const total = totalUnaccepted.value
  if (total === 0) { flash('ok', 'Nothing to clear.'); return }
  if (!confirm(`Delete all ${total} unaccepted imported pending level${total === 1 ? '' : 's'}? This can't be undone.`)) return
  try {
    const res = await $fetch<{ deleted: number }>('/api/admin/imports/clear-pending', {
      method: 'POST', body: { source: 'all' },
    })
    flash('ok', `Removed ${res.deleted} unaccepted level${res.deleted === 1 ? '' : 's'}.`)
    await loadImportsStatus()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}

let importsTimer: ReturnType<typeof setInterval> | null = null
watch(tab, (t) => {
  if (importsTimer) { clearInterval(importsTimer); importsTimer = null }
  // Poll the status endpoint while the imports tab is open so the running
  // indicator and pending counts refresh without the admin reloading.
  if (t === 'imports' && import.meta.client) {
    importsTimer = setInterval(loadImportsStatus, 5_000)
  }
}, { immediate: true })
onBeforeUnmount(() => { if (importsTimer) clearInterval(importsTimer) })

// --- Notification counts ---
// Declared before the watch(tab) below so the immediate callback doesn't hit
// a temporal dead zone when it references liveCounts / seenCounts.
type Counts = Record<string, number>
const liveCounts = ref<Counts | null>(null)
const seenCounts = reactive<Counts>({})

watch(tab, (t) => {
  if (!import.meta.client) return
  if (t === 'claims')   loadClaims()
  if (t === 'accounts') loadUsers()
  if (t === 'discord')  loadWebhooks()
  if (t === 'imports')  loadImportsStatus()
  // Mark tab as seen so its badge clears, and persist to server
  if (liveCounts.value) {
    const n = liveCounts.value[t as keyof typeof liveCounts.value] ?? 0
    seenCounts[t] = n
    $fetch('/api/admin/mark-seen', { method: 'POST', body: { counts: { [t]: n } } }).catch(() => {})
  }
}, { immediate: true })

async function fetchCounts() {
  try {
    const res = await $fetch<Counts>('/api/admin/counts')
    liveCounts.value = res
    // Only seed seenCounts for tabs not yet stored server-side (new tab types).
    for (const [k, v] of Object.entries(res)) {
      if (!(k in seenCounts)) seenCounts[k] = v
    }
  } catch { /* non-fatal */ }
}

async function loadSeenCounts() {
  try {
    const res = await $fetch<Counts>('/api/admin/seen-counts')
    for (const [k, v] of Object.entries(res)) seenCounts[k] = v
  } catch { /* non-fatal */ }
}

function tabBadge(id: string): number {
  if (!liveCounts.value) return 0
  const live = liveCounts.value[id] ?? 0
  const seen = seenCounts[id] ?? live
  return Math.max(0, live - seen)
}

let countTimer: ReturnType<typeof setInterval> | null = null
onMounted(async () => {
  await loadSeenCounts()  // load before fetchCounts so seenCounts aren't reset to live
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
    <nav class="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-sm shrink-0">
      <div class="container-wide flex gap-1 py-2 items-center overflow-x-auto">
        <!-- Pending dropdown: groups submission-queue tabs -->
        <div ref="pendingMenuRef" class="relative flex items-stretch">
          <button
            type="button"
            class="pl-3 pr-2 py-1.5 rounded-l-lg text-sm font-medium transition-colors relative"
            :class="isPendingTab && !pendingDropdownOpen
              ? 'bg-accent/10 text-accent ring-1 ring-inset ring-accent/25'
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
            class="px-1.5 py-1.5 rounded-r-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
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
            class="absolute left-0 top-full mt-1 min-w-[11rem] rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl shadow-black/50 p-1 z-40"
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
          class="relative whitespace-nowrap px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          :class="tab === t.id
            ? 'bg-accent/10 text-accent ring-1 ring-inset ring-accent/25'
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
    <AdminLevelsReview v-else-if="tab === 'levels'" source="submitted" class="flex-1 min-h-0" />

    <!-- Imported levels tab — auto-imported from the GDL API -->
    <AdminLevelsReview v-else-if="tab === 'imported-levels'" source="gdl_import" class="flex-1 min-h-0" />

    <!-- Awaiting tab — approved but unplaced levels -->
    <AdminAwaitingReview v-else-if="tab === 'awaiting'" class="flex-1 min-h-0" />

    <!-- Movements tab — pending level-position movement requests -->
    <AdminMovementsReview v-else-if="tab === 'movements'" class="flex-1 min-h-0" />

    <!-- Open verifications tab — pending unverified-level submissions -->
    <AdminOpenVerificationsReview v-else-if="tab === 'open-verifications'" class="flex-1 min-h-0" />

    <!-- Imports tab — manually re-run any of the data importers and clear
         out unaccepted pending rows from each source. -->
    <div v-else-if="tab === 'imports'" class="flex-1 overflow-y-auto">
      <div class="container-tight py-8 max-w-3xl space-y-6">

        <!-- Placement repair -->
        <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 class="text-sm font-semibold text-zinc-100">Repair placements</h2>
              <p class="text-xs text-zinc-500 mt-0.5 max-w-lg">
                Re-attaches every placement number to the slot it belongs to, so the numbers
                the list prints climb in list order. Runs automatically at boot and after every
                move; this is here for lists that drifted before that. Safe to run any time.
              </p>
            </div>
            <button
              type="button"
              :disabled="repairingPlacements"
              class="shrink-0 rounded border border-zinc-700 text-zinc-200 hover:border-accent/60 hover:text-accent text-xs px-3 py-1.5 disabled:opacity-40 transition-colors"
              @click="repairPlacements"
            >{{ repairingPlacements ? 'Repairing…' : 'Repair now' }}</button>
          </div>
          <p v-if="repairResult" class="mt-2 text-xs" :class="repairResult.startsWith('Failed') ? 'text-red-400' : 'text-emerald-400'">
            {{ repairResult }}
          </p>
        </section>

        <!-- Header + global clear -->
        <div class="flex items-center justify-between gap-4">
          <div>
            <h2 class="text-base font-semibold tracking-tight">Manage imports</h2>
            <p class="text-xs text-zinc-500 mt-0.5">
              Importers are idempotent — re-running won't create duplicates. Status refreshes every 5 s.
            </p>
          </div>
          <button
            type="button"
            :disabled="totalUnaccepted === 0"
            class="shrink-0 rounded border border-red-800/60 text-red-400 hover:bg-red-950/40 text-xs px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            @click="clearAllPending"
          >
            Clear all unaccepted
            <span v-if="totalUnaccepted > 0" class="ml-1 tabular-nums">({{ totalUnaccepted }})</span>
          </button>
        </div>

        <!-- Grouped source tables — each group is collapsible -->
        <section
          v-for="group in IMPORT_GROUPS"
          :key="group.heading"
          class="rounded-md border border-zinc-800 bg-zinc-950/60 overflow-hidden"
        >
          <!-- Group heading / toggle -->
          <button
            type="button"
            class="w-full flex items-center justify-between gap-2 px-4 py-2.5 bg-zinc-900/40 hover:bg-zinc-900/70 transition-colors text-left"
            @click="groupsOpen[group.heading] = !groupsOpen[group.heading]"
          >
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">{{ group.heading }}</span>
            <span
              class="text-zinc-600 transition-transform text-[11px]"
              :class="groupsOpen[group.heading] ? 'rotate-180' : ''"
            >▾</span>
          </button>

          <!-- Rows (collapsed when group toggled) -->
          <ul v-if="groupsOpen[group.heading]" class="divide-y divide-zinc-900/60 border-t border-zinc-800">
            <li
              v-for="src in group.sources"
              :key="src.key"
              class="flex items-center gap-3 px-4 py-2.5"
            >
              <!-- Name + running/queued badge -->
              <div class="flex items-center gap-2 w-44 shrink-0">
                <span class="text-sm text-zinc-100 font-medium">{{ src.label }}</span>
                <span
                  v-if="importsStatus.running.includes(src.key)"
                  class="text-[9px] uppercase tracking-widest px-1.5 py-px rounded bg-amber-900/40 text-amber-300 border border-amber-800/60 animate-pulse"
                >Running</span>
                <span
                  v-else-if="importsStatus.queued.includes(src.key)"
                  class="text-[9px] uppercase tracking-widest px-1.5 py-px rounded bg-sky-900/40 text-sky-300 border border-sky-800/60"
                >Queued</span>
              </div>
              <!-- Unaccepted count -->
              <span class="flex-1 text-xs text-zinc-500 tabular-nums">
                <template v-if="src.pendingKey != null">
                  {{ importsStatus.pendingCounts[src.pendingKey] ?? 0 }} unaccepted
                </template>
                <template v-else>
                  <span class="text-zinc-700">positions only</span>
                </template>
              </span>
              <!-- Actions -->
              <div class="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  :disabled="importBusy[src.key] || importsStatus.queued.includes(src.key)"
                  class="rounded bg-accent text-zinc-950 font-medium text-xs px-3 py-1 hover:bg-accent/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  @click="runImport(src.key)"
                >{{ importsStatus.queued.includes(src.key) ? 'Queued' : importsStatus.running.includes(src.key) ? 'Queue' : 'Reimport' }}</button>
                <button
                  v-if="src.pendingKey != null"
                  type="button"
                  :disabled="(importsStatus.pendingCounts[src.pendingKey] ?? 0) === 0"
                  class="rounded border border-zinc-700 hover:border-red-600 hover:text-red-400 text-xs px-3 py-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  @click="clearPending(src.pendingKey)"
                >Clear</button>
              </div>
            </li>
          </ul>
        </section>

      </div>
    </div>

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
    <div v-else-if="tab === 'custom-lists'" class="flex-1 overflow-y-auto">
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-5">
        <AdminCustomLists />
      </div>
    </div>

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
