<script setup lang="ts">
import { roleMeta } from '~/utils/role-styles'
import { GDTPL_LISTS } from '~/utils/list-source-catalog'

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

const isHelper = computed(() => me.value?.role === 'list_helper')

type TabId = 'records' | 'opinions' | 'levels' | 'imported-levels' | 'awaiting' | 'movements' | 'imported-movements' | 'open-verifications' | 'statistics' | 'imports' | 'claims' | 'accounts' | 'discord' | 'custom-lists' | 'helper-requests' | 'reports' | 'log'

/**
 * Who each tab is for.
 *
 * `helper` is an allow-list rather than a level: a list helper sees exactly the
 * tabs marked for them and nothing else, so a tab added later is closed to
 * helpers until somebody deliberately opens it. That is the safe default for a
 * role whose entire point is being narrow, and it means this table is the one
 * place to read to find out what the role can reach.
 *
 * None of it is enforcement. Every endpoint behind these tabs checks the role
 * itself; this only decides what is worth rendering.
 */
type TabAudience = 'staff' | 'admin' | 'helper'
const allTabs: { id: TabId; label: string; audience: TabAudience }[] = [
  // Helpers see these three. Placing levels, deciding level submissions and
  // deciding records is the whole of the role.
  { id: 'records',            label: 'Records',         audience: 'helper' },
  { id: 'levels',             label: 'Levels',          audience: 'helper' },
  { id: 'awaiting',           label: 'Awaiting',        audience: 'helper' },

  { id: 'opinions',           label: 'Opinions',        audience: 'staff' },
  { id: 'imported-levels',    label: 'Imported levels', audience: 'staff' },
  { id: 'movements',          label: 'Movements',       audience: 'staff' },
  { id: 'imported-movements', label: 'Imported moves',  audience: 'staff' },
  { id: 'open-verifications', label: 'Open verif.',     audience: 'staff' },
  { id: 'reports',            label: 'Reports',         audience: 'staff' },
  { id: 'statistics',         label: 'Statistics',      audience: 'staff' },

  // Applying a helper's request is an admin decision by definition — the point
  // of the request is that a helper could not do it themselves.
  { id: 'helper-requests',    label: 'Helper requests', audience: 'admin' },
  { id: 'log',                label: 'Activity log',    audience: 'admin' },
  { id: 'imports',            label: 'Imports',         audience: 'admin' },
  { id: 'claims',             label: 'Claims',          audience: 'admin' },
  { id: 'accounts',           label: 'Accounts',        audience: 'admin' },
  { id: 'discord',            label: 'Discord',         audience: 'admin' },
  { id: 'custom-lists',       label: 'Custom lists',    audience: 'admin' },
]
const tabs = computed(() => allTabs.filter((t) => {
  if (isHelper.value) return t.audience === 'helper'
  if (isAdmin.value) return true
  return t.audience !== 'admin'
}))

/**
 * The tab bar, as four menus instead of eleven controls.
 *
 * It had one dropdown ("Pending", holding seven queues) and then ten loose
 * buttons beside it, in a row that scrolled sideways once the window was
 * anything less than wide. Finding the activity log meant reading eleven
 * controls and usually dragging the row to see the last three.
 *
 * Grouped by *what you are doing*, which is how somebody arrives at the panel —
 * "something is waiting for me", "someone reported something", "I want to see
 * what happened", "I need to change a setting" — rather than by which table the
 * data lives in.
 *
 * Membership is declared here and filtered through `tabs`, so a group a
 * particular role cannot see anything in disappears rather than opening onto an
 * empty menu. A list helper ends up with one menu holding three queues, which
 * is the whole panel for them.
 */
const TAB_GROUPS: { key: string; label: string; ids: TabId[] }[] = [
  {
    key: 'queues',
    label: 'Queues',
    ids: ['levels', 'imported-levels', 'awaiting', 'movements', 'imported-movements', 'records', 'opinions'],
  },
  {
    key: 'moderation',
    label: 'Moderation',
    ids: ['reports', 'helper-requests', 'open-verifications'],
  },
  {
    key: 'insight',
    label: 'Insight',
    ids: ['statistics', 'log'],
  },
  {
    key: 'manage',
    label: 'Manage',
    ids: ['accounts', 'claims', 'custom-lists', 'imports', 'discord'],
  },
]

/** The groups this account can see, each with only the tabs it can open. */
const visibleGroups = computed(() =>
  TAB_GROUPS
    .map((g) => ({
      ...g,
      tabs: g.ids
        .map((id) => tabs.value.find((t) => t.id === id))
        .filter((t): t is typeof allTabs[number] => !!t),
    }))
    .filter((g) => g.tabs.length > 0),
)

/**
 * Badges for every tab, in one object, so each menu can sum its own.
 *
 * Built once per change rather than by calling `tabBadge` from the template —
 * that runs per tab per render, and the menus would each call it for every
 * member on every tick of the 30-second count poll.
 */
const tabBadges = computed(() => {
  const out: Record<string, number> = {}
  for (const t of allTabs) out[t.id] = tabBadge(t.id)
  return out
})


const initial = (typeof route.query.tab === 'string' && allTabs.some((t) => t.id === route.query.tab))
  ? (route.query.tab as TabId)
  : 'levels'
const tab = ref<TabId>(initial)

/**
 * Keep the open tab to one this account can see.
 *
 * `?tab=accounts` is typeable, and the role arrives asynchronously — the first
 * render happens before `useCurrentUser` resolves, so a check done once at
 * setup would let a helper sit on a tab that is about to disappear from the bar
 * beneath them. Watching `tabs` instead re-checks whenever the answer changes,
 * and falls back to the first tab they *do* have.
 *
 * This is not a security boundary. The endpoints behind every one of these tabs
 * check the role themselves; this is here so the panel is never showing
 * somebody a tab that will only ever answer 403.
 */
watch(tabs, (list) => {
  if (!list.length) return
  if (!list.some((t) => t.id === tab.value)) tab.value = list[0]!.id
}, { immediate: true })

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
type Role = 'user' | 'list_helper' | 'moderator' | 'admin' | 'owner' | 'developer'
type ClaimKind = 'player' | 'aredl' | 'gdl' | 'pointercrate'
type AdminUser = {
  id: number; username: string; role: Role
  claimed_player: string | null; created_at: string
  banned_at: string | null; banned_reason: string | null
  claimed_aredl_uuid: string | null; claimed_aredl_name: string | null
  claimed_gdl_id: number | null; claimed_gdl_name: string | null
  claimed_pointercrate_id: number | null; claimed_pointercrate_name: string | null
  claimed_records: { aredl: number; gdl: number; pointercrate: number }
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
  split_long: 0 | 1
  kind: WebhookKind
  created_at: string
  created_by: string | null
  last_posted_date: string | null
  last_post_status: string | null
}
/**
 * The four kinds, each with what it actually posts.
 *
 * One table rather than a labels map plus a paragraph plus two hard-coded
 * `<select>` lists: those were four places to edit whenever a kind changed, and
 * the paragraph explaining them had already drifted from the options beside it.
 */
const WEBHOOK_KINDS: { id: WebhookKind; label: string; blurb: string; tone: string }[] = [
  {
    id: 'changes',
    label: 'Daily changes',
    blurb: 'A nightly summary of every level that moved.',
    tone: 'border-blue-900/60 bg-blue-950/40 text-blue-300',
  },
  {
    id: 'challenge_changes',
    label: 'Challenge changes',
    blurb: 'The same summary, filtered to challenge-rated levels and numbered by challenge rank.',
    tone: 'border-amber-900/60 bg-amber-950/40 text-amber-300',
  },
  {
    id: 'leaderboard',
    label: 'Leaderboard updates',
    blurb: 'Fires when a record is approved.',
    tone: 'border-emerald-900/60 bg-emerald-950/30 text-emerald-400',
  },
  {
    id: 'level_status',
    label: 'Level status',
    blurb: 'Fires when a level reaches Awaiting Placement or the Void list.',
    tone: 'border-purple-900/60 bg-purple-950/30 text-purple-300',
  },
]
const WEBHOOK_KIND_LABELS: Record<WebhookKind, string> =
  Object.fromEntries(WEBHOOK_KINDS.map((k) => [k.id, k.label])) as Record<WebhookKind, string>
const webhooks = ref<DiscordWebhook[]>([])
const newWebhookUrl = ref('')
const newWebhookLabel = ref('')
const newWebhookKind = ref<WebhookKind>('changes')
const webhookBusy = ref(false)

// Declared after `webhooks` on purpose: a computed reading a `const` declared
// below it is a temporal-dead-zone crash waiting for the first render that
// touches it during setup.
/** Webhooks grouped by kind, so no row has to restate its own type. */
const webhooksByKind = computed(() =>
  WEBHOOK_KINDS.map((k) => ({ ...k, hooks: webhooks.value.filter((w) => w.kind === k.id) })),
)
/** Anything stored under a kind this build doesn't know — `kind` is free text in SQLite. */
const strayWebhooks = computed(() =>
  webhooks.value.filter((w) => !WEBHOOK_KINDS.some((k) => k.id === w.kind)),
)

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

/** Send a long day as several messages instead of cutting it off. */
async function toggleSplitLong(w: DiscordWebhook) {
  try {
    await $fetch(`/api/admin/discord-webhooks/${w.id}`, {
      method: 'PATCH', body: { split_long: !w.split_long },
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
type ImportSourceKey = string
type PendingKey = string
type ImportSource = {
  key: ImportSourceKey
  label: string
  /** One line under the name, so a four-letter acronym says what it is. */
  blurb?: string
  /** The list's own website, when it has one. */
  href?: string
  // Sources that don't write to pending_levels can't have anything to clear.
  pendingKey: PendingKey | null
}
type ImportGroup = { heading: string; note?: string; sources: ImportSource[] }

/**
 * The GDListTemplate lists, straight from the server-side registry, so the
 * panel can never offer a list the runner doesn't know or miss one it does.
 */
const gdtplIn = (group: 'demon' | 'challenge' | 'community'): ImportSource[] =>
  GDTPL_LISTS.filter((l) => l.group === group).map((l) => ({
    key: l.slug,
    label: l.short,
    blurb: l.blurb,
    pendingKey: l.slug,
    // The panel says a list imported N levels; this is how you go and read it.
    // The list's own site, from the same catalog the importer uses, so it can
    // never point somewhere the importer isn't actually reading.
    href: l.url,
  }))

const IMPORT_GROUPS: ImportGroup[] = [
  {
    heading: 'The list',
    note: 'The Google Sheet this site is built from. Start here.',
    sources: [
      { key: 'sheet',         label: 'Full re-import',    blurb: 'Every tab, then re-order the list', pendingKey: 'sheet' },
      { key: 'sheet-pending', label: 'Pending list only', blurb: 'Just the sheet’s pending tab', pendingKey: 'sheet' },
    ],
  },
  {
    heading: 'Demon lists',
    note: 'Third-party demon lists. Levels they carry that this list doesn’t arrive as pending.',
    sources: [
      { key: 'gdl', label: 'GDL', blurb: 'Geometry Dash Demonlist', pendingKey: 'gdl' },
      ...gdtplIn('demon'),
    ],
  },
  {
    heading: 'Challenge lists',
    note: 'Scored on the challenge scale rather than the main one.',
    sources: [
      { key: 'mscl', label: 'MSCL', blurb: 'Mega Spam Challenge List', pendingKey: null },
      // A separate community challenge sheet, not run by this project — it sits
      // with the other challenge lists rather than beside the ALL's own sheet,
      // where its old label ("Challenges sheet") implied it was ours.
      { key: 'acs', label: 'ACS', blurb: 'ALL Challenges Sheet — community-run', pendingKey: 'acs' },
      ...gdtplIn('challenge'),
    ],
  },
  {
    heading: 'Community lists',
    note: 'Smaller and joke lists. Useful for coverage, rarely urgent.',
    sources: gdtplIn('community'),
  },
  {
    heading: 'Records & players',
    note: 'Feeds the leaderboards. Does not add levels.',
    sources: [
      { key: 'aredl',         label: 'AREDL',         blurb: 'Records, players, creators — slow', pendingKey: null },
      // The full import makes two detail calls per level; placements need none
      // of that, and this is the repair when a long run dies partway.
      { key: 'aredl-placements', label: 'AREDL placements', blurb: 'Re-fetch list positions only — fast', pendingKey: null },
      { key: 'aredl-history', label: 'AREDL history', blurb: 'Past placements — slow', pendingKey: null },
      { key: 'pointercrate',  label: 'Pointercrate',  blurb: 'Records and players', pendingKey: null },
      { key: 'gsv',           label: 'Stats Viewer',  blurb: 'Player stats', pendingKey: null },
    ],
  },
]
/** Unaccepted rows waiting under one group, so a collapsed section still reports. */
function groupUnaccepted(group: ImportGroup): number {
  return group.sources.reduce(
    (n, s) => n + (s.pendingKey ? (importsStatus.value.pendingCounts[s.pendingKey] ?? 0) : 0), 0,
  )
}

// Flat list kept for functions that need to iterate all sources.
const IMPORT_SOURCES = IMPORT_GROUPS.flatMap(g => g.sources)
// All groups start open; admins can collapse any section they're not using.
const groupsOpen = reactive<Record<string, boolean>>(
  Object.fromEntries(IMPORT_GROUPS.map(g => [g.heading, true])),
)

type ImportProgress = {
  phase: string
  done: number
  total: number | null
  startedAt: number
  updatedAt: number
}
const importsStatus = ref<{
  pendingCounts: Record<string, number>
  running: string[]
  queued: string[]
  progress: Record<string, ImportProgress>
}>({ pendingCounts: {}, running: [], queued: [], progress: {} })

/** Whole seconds since an import started, for the "running for" readout. */
const nowTick = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | null = null

function elapsed(ms: number): string {
  const s = Math.max(0, Math.round((nowTick.value - ms) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(s % 60).padStart(2, '0')}s`
}

/**
 * A percentage, or null when the phase can't count itself.
 *
 * Null is a real answer, not a missing one: "fetching the sheet" has no
 * denominator until the fetch returns, and a bar that invents one is worse than
 * a bar that says it doesn't know.
 */
function progressPct(p: ImportProgress | undefined): number | null {
  if (!p || p.total == null || p.total <= 0) return null
  return Math.max(0, Math.min(100, Math.round((p.done / p.total) * 100)))
}
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

/**
 * Sheet-vs-site reconciliation download.
 *
 * Fetched rather than linked so the admin session cookie and the endpoint's
 * error handling both apply — a plain <a href> to an admin route would render
 * a 403 page into the tab instead of reporting it here.
 */
type ReportKind = 'json' | 'csv' | 'full'
const reportBusy = ref<ReportKind | null>(null)
const reportError = ref<string | null>(null)
const reportSummary = ref<string | null>(null)

async function downloadSheetReport(kind: ReportKind) {
  if (reportBusy.value) return
  reportBusy.value = kind
  reportError.value = null
  try {
    const blob = await $fetch<Blob>('/api/admin/sheet-report', {
      query: kind === 'csv'
        ? { format: 'csv' }
        : kind === 'full'
          ? { full: '1' }
          : {},
      responseType: 'blob',
    })
    const stamp = new Date().toISOString().slice(0, 10)
    if (kind !== 'csv') {
      // Summarise while we have it in hand, so the admin knows whether the
      // file is worth opening.
      try {
        const t = JSON.parse(await blob.text()).totals ?? {}
        reportSummary.value =
          `${(t.drift_points ?? 0).toLocaleString()} drift point(s) across `
          + `${(t.offset_runs ?? 0).toLocaleString()} offset run(s); `
          + `${(t.placement_mismatches ?? 0).toLocaleString()} level(s) numbered differently. `
          + `${(t.site_only ?? 0).toLocaleString()} site-only, `
          + `${(t.sheet_exclusive ?? 0).toLocaleString()} sheet-exclusive.`
      } catch { reportSummary.value = null }
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = kind === 'csv'
      ? `all-placement-drift-${stamp}.csv`
      : `all-sheet-report-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    reportError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Could not build the report.'
  } finally {
    reportBusy.value = null
  }
}

/**
 * Placement snapshots — download the list's order, put one back.
 *
 * Every write is previewed first. The preview and the apply are the same
 * request with one flag flipped, so what the admin approves is exactly what
 * runs, rather than a summary produced by different code than the write.
 */
type RestoreMove = {
  level_id: number; name: string; gd_id: number | null
  from_position: number; to_position: number
  from_placement: number | null; to_placement: number | null
}
type RestoreResult = {
  read?: 'json' | 'csv'
  generated_at?: string | null
  backup?: string | null
  matched: number; unmatched: number; untouched_extra: number
  moved: number; retiered?: number; sample: RestoreMove[]; applied: boolean
}

const snapshotBusy = ref<'json' | 'csv' | null>(null)
const snapshotError = ref<string | null>(null)

async function downloadPlacements(format: 'json' | 'csv') {
  if (snapshotBusy.value) return
  snapshotBusy.value = format
  snapshotError.value = null
  try {
    const blob = await $fetch<Blob>('/api/admin/placements/export', {
      query: { format }, responseType: 'blob',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `all-placements-${new Date().toISOString().slice(0, 10)}.${format}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    snapshotError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Could not build the file.'
  } finally {
    snapshotBusy.value = null
  }
}

const restoreFileInput = ref<HTMLInputElement | null>(null)
const restoreFileName = ref<string | null>(null)
const restoreText = ref<string | null>(null)
const restorePreview = ref<RestoreResult | null>(null)
const restoreBusy = ref(false)
const restoreError = ref<string | null>(null)
const restoreDone = ref<string | null>(null)

function pickRestoreFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  restorePreview.value = null
  restoreError.value = null
  restoreDone.value = null
  restoreText.value = null
  restoreFileName.value = file?.name ?? null
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    restoreText.value = String(reader.result ?? '')
    previewRestore()
  }
  reader.onerror = () => { restoreError.value = 'Could not read that file.' }
  reader.readAsText(file)
}

/** Send the file as-is; `apply` decides whether the server writes. */
async function sendRestore(apply: boolean) {
  if (!restoreText.value || restoreBusy.value) return
  restoreBusy.value = true
  restoreError.value = null
  try {
    const res = await $fetch<RestoreResult>('/api/admin/placements/restore', {
      method: 'POST',
      query: apply ? { apply: '1' } : {},
      body: restoreText.value,
      headers: { 'Content-Type': 'text/plain' },
    })
    restorePreview.value = res
    if (apply) {
      restoreDone.value = res.moved === 0
        ? 'The list already matched that file — nothing moved.'
        : `Restored — ${res.moved.toLocaleString()} level${res.moved === 1 ? '' : 's'} moved.`
        + (res.backup ? ` Previous placements saved as ${res.backup}.` : '')
      restoreText.value = null
      restoreFileName.value = null
      if (restoreFileInput.value) restoreFileInput.value.value = ''
    }
  } catch (e: any) {
    restoreError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.'
  } finally {
    restoreBusy.value = false
  }
}
const previewRestore = () => sendRestore(false)

function applyRestore() {
  const p = restorePreview.value
  if (!p) return
  const warning = p.unmatched > 0
    ? `\n\n${p.unmatched.toLocaleString()} row(s) in the file match no level here and will be ignored.`
    : ''
  if (!confirm(`Move ${p.moved.toLocaleString()} level(s) to match this file?${warning}`)) return
  sendRestore(true)
}

// --- Reset to the sheet's order ---
const sheetResetPreview = ref<RestoreResult | null>(null)
const sheetResetBusy = ref(false)
const sheetResetError = ref<string | null>(null)
const sheetResetDone = ref<string | null>(null)

async function sheetReset(apply: boolean) {
  if (sheetResetBusy.value) return
  sheetResetBusy.value = true
  sheetResetError.value = null
  if (!apply) sheetResetDone.value = null
  try {
    const res = await $fetch<RestoreResult>('/api/admin/placements/reset-to-sheet', {
      method: 'POST', query: apply ? { apply: '1' } : {},
    })
    sheetResetPreview.value = res
    if (apply) {
      sheetResetDone.value = res.moved === 0
        ? 'Already in sheet order — nothing moved.'
        : `${res.moved.toLocaleString()} level${res.moved === 1 ? '' : 's'} moved back to the sheet's order.`
        + (res.backup ? ` Previous placements saved as ${res.backup}.` : '')
      sheetResetPreview.value = null
    }
  } catch (e: any) {
    sheetResetError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.'
  } finally {
    sheetResetBusy.value = false
  }
}

function applySheetReset() {
  const p = sheetResetPreview.value
  if (!p) return
  if (!confirm(`Move ${p.moved.toLocaleString()} level(s) back to the order the sheet gives them?`)) return
  sheetReset(true)
}

/**
 * Levels the site owns rather than the sheet, and handing them back.
 *
 * `sheet_exclusive_levels` has been reporting the mismatch after every import —
 * "the sheet describes this level and nothing here represents it" — without
 * anywhere to act on it. This is that place.
 */
type HandoverItem = {
  level_id: number
  position: number
  name: string
  gd_id: number | null
  reason: 'permanent' | 'site_only' | 'both'
  sheet: { name: string; sheet_placement: number | null; gddl_tier: string | null } | null
}
const handover = ref<{ items: HandoverItem[]; total: number; matched: number } | null>(null)
const handoverBusy = ref<number | 'all' | null>(null)
const handoverNote = ref<string | null>(null)
const handoverError = ref<string | null>(null)

async function loadHandover() {
  if (!isAdmin.value) return
  try {
    handover.value = await $fetch('/api/admin/sheet-handover')
  } catch { /* non-fatal */ }
}

async function handOver(target: number | 'all') {
  if (handoverBusy.value != null) return
  const matched = handover.value?.matched ?? 0
  if (target === 'all' && !confirm(`Hand ${matched} level(s) over to the sheet? Their data is replaced with the sheet's.`)) return
  handoverBusy.value = target
  handoverError.value = null
  handoverNote.value = null
  try {
    const res = await $fetch<{ handed_over: number; skipped: number }>(
      '/api/admin/sheet-handover/apply',
      { method: 'POST', body: target === 'all' ? { matched: true } : { level_id: target } },
    )
    handoverNote.value = res.handed_over === 0
      ? 'Nothing changed.'
      : `${res.handed_over} level${res.handed_over === 1 ? '' : 's'} handed to the sheet.`
        + (res.skipped ? ` ${res.skipped} skipped.` : '')
    await loadHandover()
  } catch (e: any) {
    handoverError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.'
  } finally {
    handoverBusy.value = null
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
    // 1.5s rather than 5s: this now drives a progress bar, and a bar that
    // steps five times a minute reads as a stall.
    importsTimer = setInterval(loadImportsStatus, 1_500)
  }
}, { immediate: true })
onBeforeUnmount(() => { if (importsTimer) clearInterval(importsTimer) })
onMounted(() => { nowTimer = setInterval(() => { nowTick.value = Date.now() }, 1_000) })
onBeforeUnmount(() => { if (nowTimer) clearInterval(nowTimer) })

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
  if (t === 'imports')  { loadImportsStatus(); loadHandover() }
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

/**
 * Role hierarchy — owner and developer outrank admin.
 *
 * Must match `ROLE_RANK` in `server/api/admin/role.post.ts`, which is the one
 * that enforces it. This copy only decides which buttons are greyed out; the
 * server refuses the request either way.
 */
const ROLE_RANK: Record<string, number> = {
  user: 0,
  list_helper: 1,
  moderator: 2,
  admin: 3,
  owner: 4,
  developer: 4,
}
/** Offered in the accounts table, in rank order. Mirrors `ROLES` on the server. */
const ASSIGNABLE_ROLES: Role[] = ['user', 'list_helper', 'moderator', 'admin', 'owner', 'developer']

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

/** The external claims a user holds, with what releasing each would cost them. */
const CLAIM_LABELS: Record<ClaimKind, string> = {
  player: 'ALL list', aredl: 'AREDL', gdl: 'GDL', pointercrate: 'Pointercrate',
}
function externalClaims(u: AdminUser): { kind: ClaimKind; name: string; records: number }[] {
  const out: { kind: ClaimKind; name: string; records: number }[] = []
  if (u.claimed_aredl_uuid) {
    out.push({ kind: 'aredl', name: u.claimed_aredl_name ?? 'AREDL player', records: u.claimed_records?.aredl ?? 0 })
  }
  if (u.claimed_pointercrate_id) {
    out.push({ kind: 'pointercrate', name: u.claimed_pointercrate_name ?? 'Pointercrate player', records: u.claimed_records?.pointercrate ?? 0 })
  }
  if (u.claimed_gdl_id) {
    out.push({ kind: 'gdl', name: u.claimed_gdl_name ?? 'GDL player', records: u.claimed_records?.gdl ?? 0 })
  }
  return out
}

async function unclaimFor(u: AdminUser, kind: ClaimKind, name: string, records: number) {
  const cost = records
    ? `\n\n${records} record(s) come off their ALL profile. The ${CLAIM_LABELS[kind]} records themselves are untouched.`
    : ''
  if (!confirm(`Release ${u.username}'s ${CLAIM_LABELS[kind]} claim on ${name}?${cost}`)) return
  try {
    const res = await $fetch<{ records_removed: number }>('/api/admin/set-claim', {
      method: 'POST', body: { username: u.username, unclaim: kind },
    })
    flash('ok', res.records_removed
      ? `Released. ${res.records_removed} record(s) removed from ${u.username}'s profile.`
      : `Released ${u.username}'s ${CLAIM_LABELS[kind]} claim.`)
    await Promise.all([loadClaims(), loadUsers()])
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Four menus, grouped by what you came here to do. This was one dropdown
         and ten loose buttons in a row that scrolled sideways — see
         `TAB_GROUPS`. -->
    <nav class="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-sm shrink-0">
      <!-- Still scrollable, for a narrow phone where four menus plus the label
           don't fit. The panels are teleported to <body>, so this clips
           nothing that matters. -->
      <div class="container-wide flex gap-1 py-2 items-center overflow-x-auto">
        <AdminTabMenu
          v-for="g in visibleGroups"
          :key="g.key"
          :label="g.label"
          :tabs="g.tabs"
          :active-tab="tab"
          :badges="tabBadges"
          @select="tab = $event as TabId"
        />

        <!-- What you are looking at, spelled out. With the tabs collapsed into
             menus the bar no longer shows the current page as a pressed
             button, and "Moderation" alone does not say which of the three. -->
        <span class="ml-auto shrink-0 text-[11px] text-zinc-600 truncate pl-3">
          {{ allTabs.find((t) => t.id === tab)?.label }}
        </span>
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

    <!-- Imported movements — where an imported list orders shared levels
         differently to the ALL -->
    <AdminImportedMovements v-else-if="tab === 'imported-movements'" class="flex-1 min-h-0" />

    <!-- Open verifications tab — pending unverified-level submissions -->
    <AdminOpenVerificationsReview v-else-if="tab === 'open-verifications'" class="flex-1 min-h-0" />

    <!-- Statistics — traffic, and what the site gained, side by side -->
    <AdminStatistics v-else-if="tab === 'statistics'" class="flex-1 min-h-0" />

    <!-- What list helpers have asked an admin to do. Scrolls on its own like
         the queues above rather than inside the page. -->
    <div v-else-if="tab === 'helper-requests'" class="flex-1 overflow-y-auto">
      <div class="p-4 max-w-4xl">
        <AdminHelperRequests @changed="fetchCounts" />
      </div>
    </div>

    <!-- Reports. Moderators and admins; a list helper never sees this tab. -->
    <div v-else-if="tab === 'reports'" class="flex-1 overflow-y-auto">
      <div class="p-4 max-w-4xl">
        <AdminReports @changed="fetchCounts" />
      </div>
    </div>

    <!-- The activity log manages its own scrolling: it has a sticky filter bar
         and a pager, so it needs the full height rather than a scrolling page. -->
    <AdminActivityLog v-else-if="tab === 'log'" class="flex-1 min-h-0" />

    <!-- Imports tab — manually re-run any of the data importers and clear
         out unaccepted pending rows from each source. -->
    <div v-else-if="tab === 'imports'" class="flex-1 overflow-y-auto">
      <div class="container-tight py-8 max-w-3xl space-y-6">

        <!-- Placement repair -->
        <section class="card p-4">
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
              class="btn btn-sm btn-ghost shrink-0 hover:border-accent/60 hover:text-accent"
              @click="repairPlacements"
            >{{ repairingPlacements ? 'Repairing…' : 'Repair now' }}</button>
          </div>
          <p v-if="repairResult" class="mt-2 text-xs" :class="repairResult.startsWith('Failed') ? 'text-red-400' : 'text-emerald-400'">
            {{ repairResult }}
          </p>
        </section>

        <!-- Site-owned levels -->
        <section v-if="handover && handover.total > 0" class="card p-4">
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 class="text-sm font-semibold text-zinc-100">Levels stored here, not on the sheet</h2>
              <p class="text-xs text-zinc-500 mt-0.5 max-w-lg">
                Promoted submissions and hand-placed additions. The site owns their data and the
                importer leaves them alone — right until the curators add them to the sheet, after
                which the copy here is a stale duplicate. Handing one over takes the sheet's data
                and gives the importer the row from then on.
              </p>
            </div>
            <button
              type="button"
              :disabled="handoverBusy != null || handover.matched === 0"
              class="btn btn-sm btn-primary shrink-0"
              @click="handOver('all')"
            >{{ handoverBusy === 'all' ? 'Handing over…' : `Hand over ${handover.matched} matched` }}</button>
          </div>

          <p class="mt-2 text-[11px] text-zinc-600 tabular-nums">
            {{ handover.total }} site-owned · {{ handover.matched }} the sheet already has
          </p>

          <ul class="mt-3 divide-y divide-zinc-900/60 max-h-64 overflow-y-auto rounded border border-zinc-900">
            <li v-for="h in handover.items" :key="h.level_id" class="flex items-center gap-3 px-3 py-2">
              <NuxtLink :to="`/levels/${h.position}`" class="text-xs text-zinc-200 hover:text-accent truncate flex-1">
                {{ h.name }}
                <span class="text-zinc-600">#{{ h.position.toLocaleString() }}</span>
              </NuxtLink>
              <span
                class="shrink-0 text-[9px] uppercase tracking-widest px-1.5 py-px rounded border"
                :class="h.reason === 'site_only'
                  ? 'border-amber-900/60 bg-amber-950/40 text-amber-300/90'
                  : 'border-violet-900/60 bg-violet-950/40 text-violet-300/90'"
              >{{ h.reason === 'site_only' ? 'site only' : h.reason === 'both' ? 'both' : 'permanent' }}</span>
              <span v-if="h.sheet" class="shrink-0 text-[11px] text-emerald-400/90 tabular-nums">
                sheet #{{ h.sheet.sheet_placement ?? '—' }}
              </span>
              <span v-else class="shrink-0 text-[11px] text-zinc-700">not on the sheet</span>
              <button
                type="button"
                :disabled="handoverBusy != null || !h.sheet"
                class="btn btn-sm btn-ghost shrink-0 hover:border-accent/60 hover:text-accent"
                @click="handOver(h.level_id)"
              >{{ handoverBusy === h.level_id ? '…' : 'Hand over' }}</button>
            </li>
          </ul>
          <p v-if="handoverNote" class="mt-2 text-xs text-emerald-400">{{ handoverNote }}</p>
          <p v-if="handoverError" class="mt-2 text-xs text-red-400">{{ handoverError }}</p>
        </section>

        <!-- Placement snapshots -->
        <section class="card p-4">
          <h2 class="text-sm font-semibold text-zinc-100">Placement backups</h2>
          <p class="text-xs text-zinc-500 mt-0.5 max-w-lg">
            The list's order as a file. Download one before anything risky; upload it back to
            undo. The CSV is the one to edit — retype a few numbers in a spreadsheet and feed it
            back in to move those levels.
          </p>

          <div class="mt-3 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              :disabled="!!snapshotBusy"
              class="btn btn-sm btn-primary"
              @click="downloadPlacements('json')"
            >{{ snapshotBusy === 'json' ? 'Building…' : 'Download placements (JSON)' }}</button>
            <button
              type="button"
              :disabled="!!snapshotBusy"
              class="btn btn-sm btn-ghost hover:border-accent/60 hover:text-accent"
              title="Editable in a spreadsheet"
              @click="downloadPlacements('csv')"
            >{{ snapshotBusy === 'csv' ? 'Building…' : 'Download (CSV)' }}</button>
          </div>
          <p v-if="snapshotError" class="mt-2 text-xs text-red-400">{{ snapshotError }}</p>

          <!-- Restore -->
          <div class="mt-4 pt-4 border-t border-zinc-900">
            <div class="flex items-center gap-3 flex-wrap">
              <label class="btn btn-sm btn-ghost cursor-pointer hover:border-accent/60 hover:text-accent">
                Choose a placement file…
                <input
                  ref="restoreFileInput"
                  type="file"
                  accept=".json,.csv,application/json,text/csv,text/plain"
                  class="hidden"
                  @change="pickRestoreFile"
                />
              </label>
              <span v-if="restoreFileName" class="text-xs text-zinc-500 truncate max-w-[16rem]">{{ restoreFileName }}</span>
              <span v-if="restoreBusy" class="text-xs text-zinc-500">Reading…</span>
            </div>

            <div v-if="restorePreview && !restorePreview.applied" class="mt-3 rounded border border-zinc-800 bg-zinc-900/40 p-3">
              <p class="text-xs text-zinc-300">
                Read as <span class="text-zinc-100">{{ restorePreview.read?.toUpperCase() }}</span>.
                <span class="tabular-nums text-zinc-100">{{ restorePreview.matched.toLocaleString() }}</span> matched,
                <span class="tabular-nums" :class="restorePreview.unmatched ? 'text-amber-300' : 'text-zinc-500'">{{ restorePreview.unmatched.toLocaleString() }}</span> unmatched,
                <span class="tabular-nums text-zinc-100">{{ restorePreview.moved.toLocaleString() }}</span> would move.
              </p>
              <p v-if="restorePreview.untouched_extra > 0" class="text-[11px] text-zinc-600 mt-1">
                {{ restorePreview.untouched_extra.toLocaleString() }} level(s) here aren't in the file — each keeps the neighbour it currently follows.
              </p>
              <p v-if="restorePreview.retiered" class="text-[11px] text-zinc-500 mt-1">
                {{ restorePreview.retiered.toLocaleString() }} level(s) also get their tier back — moving a level
                rewrites its tier, so the file carries the ones those moves replaced.
              </p>
              <ul v-if="restorePreview.sample.length" class="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
                <li v-for="m in restorePreview.sample" :key="m.level_id" class="text-[11px] text-zinc-500 flex gap-2">
                  <span class="tabular-nums text-zinc-400 shrink-0">#{{ m.from_position.toLocaleString() }} → #{{ m.to_position.toLocaleString() }}</span>
                  <span class="truncate text-zinc-300">{{ m.name }}</span>
                </li>
              </ul>
              <button
                type="button"
                :disabled="restoreBusy || (restorePreview.moved === 0 && !restorePreview.retiered)"
                class="mt-3 rounded bg-amber-500 text-zinc-950 font-medium text-xs px-3 py-1.5 hover:bg-amber-400 disabled:opacity-40 transition-colors"
                @click="applyRestore"
              >
                <template v-if="restorePreview.moved === 0 && !restorePreview.retiered">Nothing to restore</template>
                <template v-else-if="restorePreview.moved === 0">Restore {{ restorePreview.retiered!.toLocaleString() }} tier(s)</template>
                <template v-else>Restore {{ restorePreview.moved.toLocaleString() }} placement(s)</template>
              </button>
            </div>

            <p v-if="restoreDone" class="mt-2 text-xs text-emerald-400">{{ restoreDone }}</p>
            <p v-if="restoreError" class="mt-2 text-xs text-red-400">{{ restoreError }}</p>
          </div>

          <!-- Back to the sheet's order -->
          <div class="mt-4 pt-4 border-t border-zinc-900">
            <div class="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 class="text-xs font-semibold text-zinc-200">Reset to the sheet's order</h3>
                <p class="text-[11px] text-zinc-500 mt-0.5 max-w-lg">
                  Undo every move made here and put the sheet-backed levels back in the sheet's own
                  order. Site-only levels — the ones the sheet doesn't carry — hold their positions
                  and the rest flow around them, exactly as a full sheet import leaves things.
                </p>
              </div>
              <button
                type="button"
                :disabled="sheetResetBusy"
                class="btn btn-sm btn-ghost shrink-0 hover:border-accent/60 hover:text-accent"
                @click="sheetReset(false)"
              >{{ sheetResetBusy ? 'Checking…' : 'Preview' }}</button>
            </div>

            <div v-if="sheetResetPreview" class="mt-3 rounded border border-zinc-800 bg-zinc-900/40 p-3">
              <p class="text-xs text-zinc-300">
                <span class="tabular-nums text-zinc-100">{{ sheetResetPreview.moved.toLocaleString() }}</span>
                of {{ sheetResetPreview.matched.toLocaleString() }} sheet-backed level(s) would move.
                <span class="text-zinc-600">{{ sheetResetPreview.untouched_extra.toLocaleString() }} anchored.</span>
              </p>
              <ul v-if="sheetResetPreview.sample.length" class="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
                <li v-for="m in sheetResetPreview.sample" :key="m.level_id" class="text-[11px] text-zinc-500 flex gap-2">
                  <span class="tabular-nums text-zinc-400 shrink-0">#{{ m.from_position.toLocaleString() }} → #{{ m.to_position.toLocaleString() }}</span>
                  <span class="truncate text-zinc-300">{{ m.name }}</span>
                </li>
              </ul>
              <button
                type="button"
                :disabled="sheetResetBusy || sheetResetPreview.moved === 0"
                class="mt-3 rounded bg-amber-500 text-zinc-950 font-medium text-xs px-3 py-1.5 hover:bg-amber-400 disabled:opacity-40 transition-colors"
                @click="applySheetReset"
              >{{ sheetResetPreview.moved === 0 ? 'Already in sheet order' : `Reset ${sheetResetPreview.moved.toLocaleString()} placement(s)` }}</button>
            </div>
            <p v-if="sheetResetDone" class="mt-2 text-xs text-emerald-400">{{ sheetResetDone }}</p>
            <p v-if="sheetResetError" class="mt-2 text-xs text-red-400">{{ sheetResetError }}</p>
          </div>
        </section>

        <!-- Sheet vs. site reconciliation -->
        <section class="card p-4">
          <h2 class="text-sm font-semibold text-zinc-100">Sheet vs. site report</h2>
          <p class="text-xs text-zinc-500 mt-0.5 max-w-lg">
            Everywhere the ALL sheet and this site disagree, as a downloadable file.
          </p>
          <ul class="mt-3 space-y-1.5 text-xs text-zinc-400">
            <li class="flex gap-2">
              <span class="text-zinc-600 shrink-0">1.</span>
              <span><span class="text-zinc-200">Drift points</span> — the levels where the sheet's numbering and this site's row order move apart, and by how much.</span>
            </li>
            <li class="flex gap-2">
              <span class="text-zinc-600 shrink-0">2.</span>
              <span><span class="text-zinc-200">Site-only levels</span> — nothing on the sheet carries this level's ID.</span>
            </li>
            <li class="flex gap-2">
              <span class="text-zinc-600 shrink-0">3.</span>
              <span><span class="text-zinc-200">Sheet-exclusive rows</span> — the last import read the row and no level here represents it, with the sheet's own data. Recorded during the ALL sheet import.</span>
            </li>
          </ul>
          <p class="mt-2 text-[11px] text-zinc-600 max-w-lg">
            An offset introduced near the top makes every level below it differ by the same amount, so the
            per-level list is tens of thousands of rows all saying one thing. The drift points are that list,
            compressed to the places it actually changes.
          </p>
          <div class="mt-3 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              :disabled="!!reportBusy"
              class="btn btn-sm btn-primary"
              @click="downloadSheetReport('json')"
            >{{ reportBusy === 'json' ? 'Building…' : 'Download report (JSON)' }}</button>
            <button
              type="button"
              :disabled="!!reportBusy"
              class="btn btn-sm btn-ghost hover:border-accent/60 hover:text-accent"
              title="Drift points as a spreadsheet"
              @click="downloadSheetReport('csv')"
            >{{ reportBusy === 'csv' ? 'Building…' : 'Drift points (CSV)' }}</button>
            <button
              type="button"
              :disabled="!!reportBusy"
              class="rounded border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700 text-xs px-3 py-1.5 disabled:opacity-40 transition-colors"
              title="Every level whose sheet number differs — large file"
              @click="downloadSheetReport('full')"
            >{{ reportBusy === 'full' ? 'Building…' : 'Every level (large)' }}</button>
          </div>
          <p v-if="reportSummary" class="mt-2 text-xs text-emerald-400">{{ reportSummary }}</p>
          <p v-if="reportError" class="mt-2 text-xs text-red-400">{{ reportError }}</p>
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
          class="card overflow-hidden"
        >
          <!-- Group heading / toggle -->
          <button
            type="button"
            class="w-full flex items-center justify-between gap-2 px-4 py-2.5 bg-zinc-900/40 hover:bg-zinc-900/70 transition-colors text-left"
            @click="groupsOpen[group.heading] = !groupsOpen[group.heading]"
          >
            <span class="min-w-0">
              <span class="flex items-center gap-2">
                <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">{{ group.heading }}</span>
                <span class="text-[10px] text-zinc-600 tabular-nums">{{ group.sources.length }}</span>
                <!-- Pending work in a collapsed section still needs to be visible. -->
                <span
                  v-if="groupUnaccepted(group) > 0"
                  class="text-[9px] uppercase tracking-widest px-1.5 py-px rounded bg-sky-900/40 text-sky-300 border border-sky-800/60 tabular-nums"
                >{{ groupUnaccepted(group) }} unaccepted</span>
              </span>
              <span v-if="group.note" class="block text-[11px] text-zinc-600 mt-0.5 truncate">{{ group.note }}</span>
            </span>
            <span
              class="text-zinc-600 transition-transform text-[11px] shrink-0"
              :class="groupsOpen[group.heading] ? 'rotate-180' : ''"
            >▾</span>
          </button>

          <!-- Rows (collapsed when group toggled) -->
          <ul v-if="groupsOpen[group.heading]" class="divide-y divide-zinc-900/60 border-t border-zinc-800">
            <li v-for="src in group.sources" :key="src.key" class="px-4 py-2.5">
              <div class="flex items-center gap-3">
                <!-- Name + running/queued badge -->
                <div class="flex items-center gap-2 w-56 shrink-0">
                  <span class="min-w-0">
                    <a
                      v-if="src.href"
                      :href="src.href"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="block text-sm text-zinc-100 font-medium truncate hover:text-accent transition-colors"
                      :title="`Open ${src.label} — ${src.href}`"
                    >{{ src.label }} <span class="text-[10px] text-zinc-600">↗</span></a>
                    <span v-else class="block text-sm text-zinc-100 font-medium truncate">{{ src.label }}</span>
                    <span v-if="src.blurb" class="block text-[11px] text-zinc-600 truncate">{{ src.blurb }}</span>
                  </span>
                  <span
                    v-if="importsStatus.running.includes(src.key)"
                    class="text-[9px] uppercase tracking-widest px-1.5 py-px rounded bg-amber-900/40 text-amber-300 border border-amber-800/60"
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
                    class="btn btn-sm btn-primary"
                    @click="runImport(src.key)"
                  >{{ importsStatus.queued.includes(src.key) ? 'Queued' : importsStatus.running.includes(src.key) ? 'Queue' : 'Reimport' }}</button>
                  <button
                    v-if="src.pendingKey != null"
                    type="button"
                    :disabled="(importsStatus.pendingCounts[src.pendingKey] ?? 0) === 0"
                    class="btn btn-sm btn-ghost hover:border-red-600 hover:text-red-400"
                    @click="clearPending(src.pendingKey)"
                  >Clear</button>
                </div>
              </div>

              <!-- Progress. Only while running, and only for this source: an
                   importer that hasn't reported yet gets an indeterminate bar,
                   which still separates "working" from "wedged" — the thing the
                   pulsing chip could never say. -->
              <div v-if="importsStatus.running.includes(src.key)" class="mt-2">
                <div class="flex items-baseline justify-between gap-3 text-[11px] mb-1">
                  <span class="text-zinc-400 truncate">
                    {{ importsStatus.progress[src.key]?.phase || 'Working…' }}
                  </span>
                  <span class="text-zinc-600 tabular-nums shrink-0">
                    <template v-if="progressPct(importsStatus.progress[src.key]) != null">
                      {{ importsStatus.progress[src.key]!.done.toLocaleString() }} /
                      {{ importsStatus.progress[src.key]!.total!.toLocaleString() }}
                      ({{ progressPct(importsStatus.progress[src.key]) }}%)
                    </template>
                    <template v-if="importsStatus.progress[src.key]">
                      · {{ elapsed(importsStatus.progress[src.key]!.startedAt) }}
                    </template>
                  </span>
                </div>
                <div class="h-1.5 rounded-full bg-zinc-900 overflow-hidden">
                  <div
                    v-if="progressPct(importsStatus.progress[src.key]) != null"
                    class="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                    :style="{ width: `${progressPct(importsStatus.progress[src.key])}%` }"
                  />
                  <div v-else class="h-full w-1/3 rounded-full bg-accent/70 animate-[indeterminate_1.4s_ease-in-out_infinite]" />
                </div>
              </div>
            </li>
          </ul>
        </section>

      </div>
    </div>

    <!-- Claims tab -->
    <div v-else-if="tab === 'claims'" class="flex-1 overflow-y-auto">
      <div class="container-tight py-8 max-w-4xl">
        <section class="card">
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
                  class="btn btn-sm btn-ghost hover:border-red-600 hover:text-red-400"
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
        <section class="card">
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
                  <!-- The admin table is the one place a plain `user` is worth
                       printing: it is a column of roles, and a blank cell there
                       reads as missing data rather than as "no role". -->
                  <RoleBadge :role="u.role" size="sm" always />
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
                <!-- External claims. Each carries records onto the ALL profile,
                     so releasing one says up front what it takes back. -->
                <div v-if="externalClaims(u).length" class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span
                    v-for="c in externalClaims(u)"
                    :key="c.kind"
                    class="text-[11px] text-zinc-500 inline-flex items-center gap-1.5"
                  >
                    <span class="text-zinc-600">{{ CLAIM_LABELS[c.kind] }}</span>
                    <span class="text-zinc-300">{{ c.name }}</span>
                    <span v-if="c.records" class="tabular-nums text-zinc-600">· {{ c.records }} rec</span>
                    <button
                      type="button"
                      class="text-zinc-600 hover:text-red-400 transition-colors"
                      @click="unclaimFor(u, c.kind, c.name, c.records)"
                    >unclaim</button>
                  </span>
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
                  class="btn btn-sm btn-ghost hover:border-accent hover:text-accent"
                  @click="setClaim(u)"
                >Set</button>
              </div>
              <div class="flex items-center gap-1 text-xs flex-wrap">
                <!-- In rank order, and labelled from the same table the badges
                     use. The list was `user, moderator, owner, developer,
                     admin` — admin last, after the two roles that outrank it —
                     and it printed the raw id, which for the new role would
                     have read "list_helper". -->
                <button
                  v-for="r in ASSIGNABLE_ROLES"
                  :key="r"
                  type="button"
                  :disabled="roleAboveMe(r)"
                  class="px-2 py-1 rounded border transition-colors"
                  :class="roleAboveMe(r)
                    ? 'border-zinc-800 text-zinc-700 cursor-not-allowed'
                    : u.role === r
                      ? 'border-accent bg-accent/15 text-accent'
                      : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'"
                  :title="roleMeta(r).title"
                  @click="!roleAboveMe(r) && setRole(u, r)"
                >{{ roleMeta(r).label }}</button>
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

    <!-- Discord: one section per kind of post, each listing the channels that
         receive it. The old single flat list made every row restate its own
         type twice — once as a badge, once as a full dropdown — and explained
         the four kinds in a paragraph nowhere near them. -->
    <div v-else-if="tab === 'discord'" class="flex-1 overflow-y-auto">
      <div class="container-tight py-8 max-w-3xl space-y-5">
        <header class="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 class="text-sm font-semibold text-zinc-100">Discord webhooks</h2>
            <p class="text-[11px] text-zinc-500 mt-1 leading-relaxed max-w-lg">
              Channels the site posts to. Each webhook belongs to one kind of post.
              Level links inside the embeds need the
              <code class="text-zinc-400">SITE_URL</code> env var set.
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              type="button"
              class="btn btn-sm btn-ghost hover:border-accent/60 hover:text-accent"
              title="Post yesterday's completed changes — the same message the nightly scheduler sends"
              @click="postYesterday"
            >Post yesterday</button>
            <button
              type="button"
              class="rounded-lg border border-zinc-800 text-zinc-400 text-xs px-2.5 py-1.5 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
              title="Post today's changes so far — a partial day"
              @click="postNow"
            >Post today</button>
          </div>
        </header>

        <!-- Add a webhook -->
        <form class="card p-3 space-y-2.5" @submit.prevent="addWebhook">
          <div class="grid gap-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <label class="block">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Webhook URL</span>
              <input
                v-model="newWebhookUrl"
                type="url"
                placeholder="https://discord.com/api/webhooks/…/…"
                class="field field-sm mt-1 text-xs"
              />
            </label>
            <label class="block">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Label</span>
              <input
                v-model="newWebhookLabel"
                placeholder="#changes in the ALL server"
                class="field field-sm mt-1 text-xs"
              />
            </label>
          </div>
          <div class="flex items-end gap-2.5 flex-wrap">
            <label class="block min-w-[12rem]">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Posts</span>
              <select
                v-model="newWebhookKind"
                class="field field-sm mt-1 text-xs text-zinc-300"
              >
                <option v-for="k in WEBHOOK_KINDS" :key="k.id" :value="k.id">{{ k.label }}</option>
              </select>
            </label>
            <button
              type="submit"
              :disabled="webhookBusy || !newWebhookUrl.trim()"
              class="btn btn-sm btn-primary"
            >{{ webhookBusy ? 'Adding…' : 'Add webhook' }}</button>
            <p class="text-[10px] text-zinc-600 ml-auto max-w-xs leading-snug">
              The URL is a write credential for that channel. It's stored, then only
              ever shown back with its token removed.
            </p>
          </div>
        </form>

        <!-- One block per kind -->
        <section
          v-for="k in webhooksByKind"
          :key="k.id"
          class="card overflow-hidden"
        >
          <div class="px-3.5 py-2.5 flex items-center gap-2.5 border-b border-zinc-900">
            <span class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border shrink-0" :class="k.tone">
              {{ k.label }}
            </span>
            <span class="text-[11px] text-zinc-500 min-w-0 truncate">{{ k.blurb }}</span>
            <span class="ml-auto shrink-0 text-[11px] tabular-nums text-zinc-600">
              {{ k.hooks.length || '—' }}
            </span>
          </div>

          <ul v-if="k.hooks.length" class="divide-y divide-zinc-900">
            <li
              v-for="w in k.hooks"
              :key="w.id"
              class="px-3.5 py-3 flex flex-wrap items-center gap-x-3 gap-y-2"
              :class="{ 'opacity-55': !w.active }"
            >
              <span
                class="shrink-0 w-1.5 h-1.5 rounded-full"
                :class="w.active ? 'bg-emerald-400' : 'bg-zinc-600'"
                :title="w.active ? 'Active' : 'Paused'"
                aria-hidden="true"
              />
              <div class="flex-1 min-w-0">
                <div class="text-sm text-zinc-100 truncate">{{ w.label || 'Unnamed webhook' }}</div>
                <div class="text-[10px] text-zinc-600 truncate font-mono">{{ w.url }}</div>
                <div class="text-[10px] text-zinc-600 mt-0.5">
                  Added {{ w.created_at }}<span v-if="w.created_by"> by {{ w.created_by }}</span>
                  <template v-if="w.last_posted_date || w.last_post_status">
                    · last posted
                    <span class="text-zinc-400">{{ w.last_posted_date ?? '—' }}</span>
                    <span
                      v-if="w.last_post_status"
                      :class="w.last_post_status === 'ok' ? 'text-emerald-400/80' : 'text-red-400/80'"
                    > ({{ w.last_post_status }})</span>
                  </template>
                </div>
              </div>

              <div
                v-if="k.id === 'changes' || k.id === 'challenge_changes'"
                class="flex items-center gap-3 shrink-0"
              >
                <label
                  class="flex items-center gap-1.5 cursor-pointer select-none text-[11px] transition-colors"
                  :class="w.tier_emoji ? 'text-accent' : 'text-zinc-500 hover:text-zinc-300'"
                  :title="w.tier_emoji ? 'Tier emojis enabled — click to disable' : 'Enable tier emojis in the embeds'"
                >
                  <input type="checkbox" :checked="!!w.tier_emoji" class="accent-accent" @change="toggleTierEmoji(w)" />
                  Tier emoji
                </label>
                <!-- A busy day passes Discord's 4,096-character embed limit,
                     and what happened then was "…(truncated)" with the rest of
                     the day never posted. Off by default: it changes how much
                     a channel receives. -->
                <label
                  class="flex items-center gap-1.5 cursor-pointer select-none text-[11px] transition-colors"
                  :class="w.split_long ? 'text-accent' : 'text-zinc-500 hover:text-zinc-300'"
                  :title="w.split_long
                    ? 'A day too long for one embed is sent as several messages — click to go back to cutting it off'
                    : 'Send the whole day across several messages when it is too long for one embed'"
                >
                  <input type="checkbox" :checked="!!w.split_long" class="accent-accent" @change="toggleSplitLong(w)" />
                  Split long changelogs
                </label>
              </div>

              <div class="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  class="rounded-lg border border-zinc-800 text-zinc-300 text-[11px] px-2 py-1 hover:border-accent/60 hover:text-accent transition-colors"
                  @click="testWebhook(w)"
                >Test</button>
                <button
                  type="button"
                  class="rounded-lg border border-zinc-800 text-[11px] px-2 py-1 transition-colors"
                  :class="w.active ? 'text-zinc-400 hover:border-amber-700 hover:text-amber-300' : 'text-emerald-400 hover:border-emerald-700'"
                  @click="toggleWebhook(w)"
                >{{ w.active ? 'Pause' : 'Resume' }}</button>
                <!-- Moving a hook between kinds is rare, so it's a small
                     control rather than a full-width dropdown on every row. -->
                <select
                  :value="w.kind"
                  class="rounded-lg border border-zinc-800 bg-zinc-900 text-[11px] px-1.5 py-1 text-zinc-500 hover:text-zinc-300 focus:border-accent focus:outline-none"
                  title="Move to another kind"
                  @change="changeWebhookKind(w, ($event.target as HTMLSelectElement).value as WebhookKind)"
                >
                  <option v-for="o in WEBHOOK_KINDS" :key="o.id" :value="o.id">{{ o.label }}</option>
                </select>
                <button
                  type="button"
                  class="rounded-lg border border-zinc-800 text-zinc-600 text-[11px] px-2 py-1 hover:border-red-900 hover:text-red-400 transition-colors"
                  @click="removeWebhook(w)"
                >Remove</button>
              </div>
            </li>
          </ul>
          <p v-else class="px-3.5 py-3 text-[11px] text-zinc-600">
            Nothing receives this yet.
          </p>
        </section>

        <!-- Rows stored under a kind this build doesn't know about. Shown
             rather than silently dropped: invisible rows still fire. -->
        <section v-if="strayWebhooks.length" class="rounded-xl border border-red-900/50 bg-red-950/10 overflow-hidden">
          <div class="px-3.5 py-2.5 border-b border-red-900/40">
            <h3 class="text-[10px] uppercase tracking-widest text-red-400 font-semibold">Unknown kind</h3>
            <p class="text-[11px] text-zinc-500 mt-0.5">
              Stored under a type this version doesn't recognise. Move them to one of the above, or remove them.
            </p>
          </div>
          <ul class="divide-y divide-red-950/40">
            <li v-for="w in strayWebhooks" :key="w.id" class="px-3.5 py-2.5 flex items-center gap-3">
              <span class="flex-1 min-w-0">
                <span class="block text-sm text-zinc-200 truncate">{{ w.label || 'Unnamed webhook' }}</span>
                <span class="block text-[10px] text-zinc-600 font-mono truncate">{{ w.kind }} · {{ w.url }}</span>
              </span>
              <select
                :value="w.kind"
                class="rounded-lg border border-zinc-800 bg-zinc-900 text-[11px] px-1.5 py-1 text-zinc-400 focus:border-accent focus:outline-none"
                @change="changeWebhookKind(w, ($event.target as HTMLSelectElement).value as WebhookKind)"
              >
                <option :value="w.kind" disabled>{{ w.kind }}</option>
                <option v-for="o in WEBHOOK_KINDS" :key="o.id" :value="o.id">{{ o.label }}</option>
              </select>
              <button
                type="button"
                class="rounded-lg border border-zinc-800 text-zinc-600 text-[11px] px-2 py-1 hover:border-red-900 hover:text-red-400 transition-colors"
                @click="removeWebhook(w)"
              >Remove</button>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>
