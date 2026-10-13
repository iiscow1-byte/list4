<script setup lang="ts">
import { timeAgo } from '~/utils/relative-time'

/** Enough of a clan to print its tag — attached per page by the endpoint. */
type ClanTagInfo = { tag: string; name: string; color: string | null }

type AllRow = {
  rank: number
  source?: undefined
  player: string
  country: string | null
  points: number
  skill_points: number
  extremes?: number
  hardest: string | null
  tier: string | null
  badge: string | null
  account_username?: string | null
  has_avatar?: boolean
  clan?: ClanTagInfo | null
  /** Discord avatar via AREDL — only ever set when there is no site avatar. */
  aredl_avatar_url?: string | null
}
type GlobalSource = 'aredl' | 'pointercrate' | 'gdl' | 'alllist'
type GlobalRow = {
  rank: number
  source: GlobalSource
  sources: GlobalSource[]
  id: string | number
  player: string
  country: string | null
  points: number
  extras: { extremes?: number; pack_points?: number }
  hardest: string | null
  claimed_account: { username: string; has_avatar?: boolean } | null
  clan?: ClanTagInfo | null
  aredl_avatar_url?: string | null
}

/**
 * A player's challenge standing.
 *
 * Ranked by challenge points rather than list points, because they measure
 * different things: the main list's points reflect where a level sits among
 * fifty thousand, and by that measure every challenge is worth roughly nothing.
 */
type ChallengeRow = {
  rank: number
  source?: undefined
  player: string
  country: string | null
  points: number
  challenges: number
  hardest: string | null
  hardest_rank: number | null
  hardest_position: number | null
  account_username?: string | null
  has_avatar?: boolean
  aredl_avatar_url?: string | null
  clan?: ClanTagInfo | null
}

/**
 * A player's standing across every record the site knows about, every one
 * scored with the ALL list's points, so the totals are comparable and a player
 * appears once. A clear reported by three sources is still one clear.
 */
type RecordsRow = {
  rank: number
  source?: undefined
  player: string
  country: string | null
  points: number
  records: number
  sources: string[]
  hardest: string | null
  hardest_position: number | null
  account_username?: string | null
  has_avatar?: boolean
  aredl_avatar_url?: string | null
  clan?: ClanTagInfo | null
}
type Row = AllRow | GlobalRow | ChallengeRow | RecordsRow

type FeedItem = {
  kind: 'record' | 'verify' | 'level' | 'progress'
  at: string
  actor: string
  actor_username?: string | null
  actor_has_avatar?: boolean
  level_position: number | null
  level_name: string
  level_gd_id?: number | null
  percent?: number | null
  start_percent?: number | null
  end_percent?: number | null
  video_url?: string | null
  clan?: ClanTagInfo | null
}

const route = useRoute()
const setQuery = useQuerySync()
const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

type Tab = 'members' | 'global' | 'records' | 'followed' | 'challenges'
const TABS: { value: Tab; label: string; lead: string }[] = [
  { value: 'global', label: 'Global', lead: 'Everyone from AREDL, Pointercrate, GDL and this list, ranked by points here.' },
  { value: 'records', label: 'Records', lead: 'Every record from every source, scored with this list’s points. A clear on three lists counts once.' },
  { value: 'members', label: 'Members', lead: 'Players with an account here.' },
  { value: 'challenges', label: 'Challenges', lead: 'Players ranked by the challenges they’ve beaten, on the challenge scale.' },
  { value: 'followed', label: 'Followed', lead: 'The players you follow, and what they’ve been doing.' },
]

/**
 * The tab, the search and the page live in the address, so a leaderboard
 * position can be linked to and survives a reload.
 */
const q0 = route.query
const tab = ref<Tab>(TABS.some((t) => t.value === q0.tab) ? (q0.tab as Tab) : 'global')
/**
 * Which records the Records tab counts. Points and ranking are identical either
 * way: this narrows the set to challenge levels, it does not switch to the
 * separate challenge scale the Challenges tab ranks on.
 */
const recordsMode = ref<'all' | 'challenges'>(q0.mode === 'challenges' ? 'challenges' : 'all')
const search = ref(typeof q0.q === 'string' ? q0.q : '')
const debounced = ref(search.value.trim())

// `SegmentedControl` speaks plain strings; the page's own types are narrower.
const tabModel = computed({ get: () => tab.value as string, set: (v: string) => { tab.value = v as Tab } })
const recordsModeModel = computed({ get: () => recordsMode.value as string, set: (v: string) => { recordsMode.value = v as 'all' | 'challenges' } })
const lead = computed(() => TABS.find((t) => t.value === tab.value)?.lead ?? '')

let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { debounced.value = v.trim() }, 200)
})

// "Members" and "Followed" use /api/leaderboard (ALL list players); "Global"
// merges AREDL, PC, GDL and ALL; "Records" scores raw records from all of them;
// "Challenges" ranks by challenge points.
const url = computed(() => {
  if (tab.value === 'global') return '/api/leaderboard/global'
  if (tab.value === 'records') return '/api/leaderboard/records'
  if (tab.value === 'challenges') return '/api/leaderboard/challenges'
  return '/api/leaderboard'
})

const PAGE_SIZE = 100
const items = ref<Row[]>([])
const total = ref(0)
const pending = ref(true)
const page = ref(Math.max(1, Number(q0.page) || 1))
const pageInput = ref(String(page.value))
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

function buildParams(offset: number) {
  const params: Record<string, string | number> = { limit: PAGE_SIZE, offset }
  if (debounced.value) params.q = debounced.value
  if (tab.value === 'global') params.source = 'all'
  else if (tab.value === 'records') params.mode = recordsMode.value
  else if (tab.value === 'followed') params.followed = '1'
  return params
}

let loadSeq = 0
async function load(targetPage: number) {
  const seq = ++loadSeq
  pending.value = true
  try {
    let res = await $fetch<{ total: number; items: Row[] }>(url.value, { params: buildParams((targetPage - 1) * PAGE_SIZE) })
    // A narrower search can leave this page past the end: go to the last one.
    const tp = Math.max(1, Math.ceil(res.total / PAGE_SIZE))
    if (targetPage > tp) {
      targetPage = tp
      res = await $fetch<{ total: number; items: Row[] }>(url.value, { params: buildParams((tp - 1) * PAGE_SIZE) })
    }
    if (seq !== loadSeq) return
    items.value = res.items
    total.value = res.total
    page.value = targetPage
    pageInput.value = String(targetPage)
  } catch {
    if (seq !== loadSeq) return
    items.value = []
    total.value = 0
  } finally {
    if (seq === loadSeq) pending.value = false
  }
  setQuery({
    tab: tab.value === 'global' ? null : tab.value,
    mode: tab.value === 'records' && recordsMode.value === 'challenges' ? 'challenges' : null,
    q: debounced.value || null,
    page: page.value > 1 ? String(page.value) : null,
  })
}

function gotoPage(n: number) {
  const clamped = Math.min(totalPages.value, Math.max(1, Math.floor(n) || 1))
  if (clamped === page.value) { pageInput.value = String(page.value); return }
  load(clamped)
  if (import.meta.client) window.scrollTo({ top: 0, behavior: 'smooth' })
}
function onPageInputCommit() {
  const n = Number(pageInput.value)
  if (!Number.isFinite(n)) { pageInput.value = String(page.value); return }
  gotoPage(n)
}

onMounted(() => { load(page.value) })
// Filter and tab changes go back to page 1. `recordsMode` is here because it
// changes which records count, which changes the ranking.
watch([tab, debounced, recordsMode], () => { load(1) })
watch(me, () => { if (tab.value === 'followed') load(1) })

// ---------------------------------------------------------------- you
/** The name to look for: the player this account claims, or its username. */
const myName = computed(() => me.value?.claimed_player || me.value?.username || null)
function isMe(p: Row): boolean {
  if (!me.value) return false
  const u = me.value.username.toLowerCase()
  const acct = ((p as GlobalRow).claimed_account?.username ?? (p as AllRow).account_username ?? '').toLowerCase()
  if (acct) return acct === u
  return !!me.value.claimed_player && p.player.toLowerCase() === me.value.claimed_player.toLowerCase()
}
/** Ranks are kept through a search, so searching for yourself shows where you stand. */
function findMe() {
  if (!myName.value) return
  search.value = myName.value
}

// ---------------------------------------------------------------- podium
const showPodium = computed(() => page.value === 1 && !debounced.value && tab.value !== 'followed' && items.value.length >= 3)
const podium = computed(() => (showPodium.value ? items.value.slice(0, 3) : []))
const rows = computed(() => (showPodium.value ? items.value.slice(3) : items.value))
/** First in the middle, as on a real podium; on a phone they stack in order. */
const PODIUM_ORDER = ['sm:order-2', 'sm:order-1', 'sm:order-3']
const MEDAL = [
  { ring: 'ring-amber-400', chip: 'bg-amber-400 text-amber-950', glow: 'from-amber-400/15', lift: 'sm:-translate-y-3' },
  { ring: 'ring-zinc-300', chip: 'bg-zinc-300 text-zinc-900', glow: 'from-zinc-300/10', lift: '' },
  { ring: 'ring-orange-400/80', chip: 'bg-orange-400/80 text-orange-950', glow: 'from-orange-400/10', lift: '' },
]

// ---------------------------------------------------------------- feed
const feed = ref<FeedItem[]>([])
const feedLoading = ref(false)
async function loadFeed() {
  if (!me.value) { feed.value = []; return }
  feedLoading.value = true
  try {
    feed.value = (await $fetch<{ items: FeedItem[] }>('/api/feed/followed', { query: { limit: 30 } })).items
  } catch {
    feed.value = []
  } finally {
    feedLoading.value = false
  }
}
watch([tab, me], () => { if (tab.value === 'followed') loadFeed() })
onMounted(() => { if (tab.value === 'followed') loadFeed() })

// ---------------------------------------------------------------- rows
function rankClass(rank: number) {
  if (rank === 1) return 'bg-amber-400 text-amber-950'
  if (rank === 2) return 'bg-zinc-300 text-zinc-900'
  if (rank === 3) return 'bg-orange-400/80 text-orange-950'
  if (rank <= 10) return 'bg-zinc-300/15 text-zinc-200'
  return 'bg-zinc-800/80 text-zinc-400'
}
function fmt(n: number | null | undefined) {
  return (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/**
 * Every row goes to that player's profile on this site, never out to AREDL or
 * Pointercrate: it is our leaderboard, and their ranks elsewhere are linked from
 * that page. A claimed player has a real account page; everyone else gets the
 * by-player profile.
 */
function rowLink(p: Row): string {
  const claimed = (p as GlobalRow).claimed_account?.username ?? (p as AllRow).account_username
  if (claimed) return `/users/${encodeURIComponent(claimed)}`
  return `/users/by-player/${encodeURIComponent(p.player)}`
}
function rowKey(p: Row, i: number): string {
  if (p.source === 'aredl' || p.source === 'pointercrate' || p.source === 'gdl') return `${p.source}-${p.id}`
  return `all-${p.player}-${i}`
}
const SOURCE_NAMES: Record<string, string> = { aredl: 'AREDL', pointercrate: 'Pointercrate', gdl: 'GDL', site: 'ALL' }
/** Which other lists a player comes from; null for players only on this one. */
function sourceLabel(p: Row): string | null {
  if (!p.source) return null
  const sources = ((p as GlobalRow).sources ?? [p.source]).filter((x) => x !== 'alllist')
  return sources.length ? sources.map((x) => SOURCE_NAMES[x] ?? x).join(' · ') : null
}

/**
 * The picture beside a row: an account here first (it is the picture they
 * chose here), then their AREDL picture (their Discord avatar), then initials.
 */
function avatarFor(p: Row): string | null {
  const all = p as AllRow
  if (all.has_avatar && all.account_username) return `/api/users/${encodeURIComponent(all.account_username)}/avatar`
  const claimed = (p as GlobalRow).claimed_account
  if (claimed?.has_avatar) return `/api/users/${encodeURIComponent(claimed.username)}/avatar`
  return p.aredl_avatar_url ?? null
}

/** The one number each tab adds beside points, as a phrase: "1 extreme", "4 records". */
function statText(p: Row): string | null {
  const n = stat(p)
  if (n == null) return null
  const word = tab.value === 'records' ? 'record' : tab.value === 'challenges' ? 'challenge' : 'extreme'
  return `${fmt(n)} ${word}${n === 1 ? '' : 's'}`
}

/**
 * The line under a player's name. On phones the stat and hardest columns are
 * hidden, so they fold into it.
 */
function subline(p: Row): { lead: string[]; folded: string[] } {
  const lead: string[] = []
  const src = sourceLabel(p)
  if (src) lead.push(src)
  else if (tab.value === 'records' && (p as RecordsRow).sources?.length) lead.push(`From ${(p as RecordsRow).sources.map((s) => SOURCE_NAMES[s] ?? s).join(', ')}`)
  else if ((p as AllRow).skill_points) lead.push(`Skill ${fmt((p as AllRow).skill_points)}`)
  const folded: string[] = []
  const st = statText(p)
  if (st) folded.push(st)
  const hd = hardest(p)
  if (hd) folded.push(hd.name)
  return { lead, folded }
}

const statLabel = computed(() => {
  if (tab.value === 'records') return 'Records'
  if (tab.value === 'challenges') return 'Challenges'
  return 'Extremes'
})
function stat(p: Row): number | null {
  if (tab.value === 'records') return (p as RecordsRow).records ?? null
  if (tab.value === 'challenges') return (p as ChallengeRow).challenges ?? null
  if (p.source) return (p as GlobalRow).extras?.extremes ?? null
  return (p as AllRow).extremes ?? null
}

/** The hardest level, with a link when the endpoint says where it is. */
function hardest(p: Row): { name: string; to: string | null; label: string | null } | null {
  if (!p.hardest) return null
  if (tab.value === 'challenges') {
    const c = p as ChallengeRow
    return { name: c.hardest!, to: c.hardest_position ? `/levels/${c.hardest_position}?list=challenge` : null, label: c.hardest_rank ? `Ch. #${c.hardest_rank}` : null }
  }
  const pos = (p as RecordsRow).hardest_position
  return { name: p.hardest, to: pos ? `/levels/${pos}` : null, label: pos ? `#${pos.toLocaleString()}` : null }
}
const firstShown = computed(() => (page.value - 1) * PAGE_SIZE + 1)
const lastShown = computed(() => Math.min(total.value, page.value * PAGE_SIZE))

useHead({ title: 'Leaderboard — All Levels List' })
</script>

<template>
  <div class="container-tight py-8">
    <header class="mb-5">
      <h1 class="page-title">Leaderboard</h1>
      <p class="page-lead">{{ lead }}</p>
    </header>

    <div class="mb-5 flex flex-wrap items-center gap-2.5">
      <SegmentedControl v-model="tabModel" size="md" aria-label="Leaderboard" :options="TABS.map((t) => ({ value: t.value, label: t.label }))" />
      <!-- Narrows Records to challenge levels. Same players, same points,
           smaller set: not the separate scale the Challenges tab uses. -->
      <SegmentedControl
        v-if="tab === 'records'"
        v-model="recordsModeModel"
        aria-label="Which records to count"
        :options="[{ value: 'all', label: 'All levels' }, { value: 'challenges', label: 'Challenges only' }]"
      />
    </div>

    <div v-if="tab !== 'followed' || me" class="mb-4 flex flex-wrap items-center gap-2">
      <div class="relative flex-1 min-w-[12rem] max-w-md">
        <NavIcon name="search" class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
        <input v-model="search" type="search" placeholder="Find a player" class="field field-sm pl-8" />
      </div>
      <button
        v-if="myName && tab !== 'followed'"
        type="button"
        class="btn btn-sm btn-ghost"
        :title="`Search for ${myName}`"
        @click="findMe"
      >Find me</button>
      <span v-if="total" class="text-xs text-zinc-500 tabular-nums ml-auto">
        {{ total.toLocaleString() }} {{ total === 1 ? 'player' : 'players' }}
      </span>
    </div>

    <div v-if="tab === 'followed' && !me" class="card px-4 py-12 text-center text-sm text-zinc-400">
      <NuxtLink to="/login" class="link">Log in</NuxtLink> to follow players and see them here.
    </div>

    <div v-else class="grid grid-cols-1 gap-6" :class="tab === 'followed' ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : ''">
      <div class="min-w-0">
        <!-- Podium -->
        <ol v-if="podium.length" class="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end mb-4 sm:pt-3" aria-label="Top three">
          <li v-for="(p, i) in podium" :key="rowKey(p, i)" :class="[PODIUM_ORDER[i], MEDAL[i]!.lift]">
            <NuxtLink
              :to="rowLink(p)"
              class="card group relative overflow-hidden flex sm:flex-col items-center gap-3 sm:gap-2 p-4 sm:pt-6 sm:pb-5 sm:text-center hover:border-zinc-600 transition-colors"
              :class="isMe(p) ? 'ring-1 ring-accent/70' : ''"
            >
              <span class="absolute inset-0 bg-gradient-to-b to-transparent pointer-events-none" :class="MEDAL[i]!.glow" aria-hidden="true" />
              <span class="relative shrink-0">
                <span
                  class="block rounded-full overflow-hidden bg-zinc-800 ring-2 flex items-center justify-center"
                  :class="[MEDAL[i]!.ring, i === 0 ? 'w-14 h-14 sm:w-20 sm:h-20' : 'w-12 h-12 sm:w-16 sm:h-16']"
                >
                  <img v-if="avatarFor(p)" :src="avatarFor(p)!" class="w-full h-full object-cover" alt="" loading="lazy" referrerpolicy="no-referrer" />
                  <span v-else class="text-xl font-black uppercase text-zinc-500">{{ p.player.charAt(0) }}</span>
                </span>
                <span class="absolute -bottom-1 -right-1 sm:left-1/2 sm:-translate-x-1/2 sm:right-auto sm:-bottom-2 min-w-[1.75rem] h-6 px-1.5 rounded-full text-xs font-bold flex items-center justify-center ring-2 ring-zinc-950" :class="MEDAL[i]!.chip">{{ p.rank }}</span>
              </span>
              <span class="relative min-w-0 flex-1 sm:flex-none sm:w-full sm:mt-2">
                <span class="flex items-center gap-1.5 sm:justify-center min-w-0">
                  <ClanTag v-if="p.clan" :tag="p.clan.tag" :name="p.clan.name" :color="p.clan.color" size="sm" :link="false" />
                  <span class="font-semibold text-zinc-50 truncate group-hover:text-accent transition-colors">{{ p.player }}</span>
                  <CountryFlag v-if="p.country" :country="p.country" size="sm" />
                </span>
                <span class="block text-xs text-zinc-500 mt-0.5 truncate">
                  <template v-if="p.points > 0 && statText(p)">{{ statText(p) }}<template v-if="hardest(p)"> · </template></template>
                  <template v-if="hardest(p)">{{ hardest(p)!.name }}</template>
                </span>
              </span>
              <!-- Points when there are any. Until this list has records nobody
                   does, and the tab's own number is what the order means. -->
              <span class="relative font-display text-lg sm:text-xl font-semibold tabular-nums shrink-0" :class="p.points > 0 ? 'text-amber-300' : 'text-zinc-100'">
                <template v-if="p.points > 0">{{ fmt(p.points) }}<span class="text-xs font-normal text-zinc-500 ml-1">pts</span></template>
                <template v-else-if="stat(p) != null">{{ fmt(stat(p)) }}<span class="text-xs font-normal text-zinc-500 ml-1">{{ statText(p)!.split(' ').pop() }}</span></template>
              </span>
            </NuxtLink>
          </li>
        </ol>

        <!-- Table -->
        <div class="card overflow-hidden">
          <div class="hidden md:grid grid-cols-[4rem_minmax(0,1fr)_6rem_minmax(0,13rem)_6.5rem] gap-3 px-4 py-2 border-b border-zinc-800 text-xs font-medium text-zinc-500">
            <span>Rank</span>
            <span>Player</span>
            <span class="text-right">{{ statLabel }}</span>
            <span>Hardest</span>
            <span class="text-right">Points</span>
          </div>

          <ol v-if="pending && !items.length" aria-busy="true">
            <li v-for="n in 10" :key="n" class="flex items-center gap-3 px-4 py-3 border-b border-zinc-900 last:border-0">
              <span class="w-10 h-7 rounded-md bg-zinc-800/80 animate-pulse" />
              <span class="w-8 h-8 rounded-full bg-zinc-800/80 animate-pulse" />
              <span class="h-3.5 rounded bg-zinc-800/80 animate-pulse" :style="{ width: `${30 + ((n * 37) % 40)}%` }" />
            </li>
          </ol>

          <ol v-else class="divide-y divide-zinc-900 transition-opacity" :class="{ 'opacity-50': pending }">
            <li
              v-for="(p, i) in rows"
              :key="rowKey(p, i)"
              class="relative group flex md:grid md:grid-cols-[4rem_minmax(0,1fr)_6rem_minmax(0,13rem)_6.5rem] items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-zinc-900/60 transition-colors"
              :class="isMe(p) ? 'bg-accent/[0.06] shadow-[inset_3px_0_0_rgb(var(--c-accent))]' : ''"
            >
              <span class="rank-badge shrink-0 text-xs h-7 min-w-[2.75rem]" :class="rankClass(p.rank)">{{ p.rank.toLocaleString() }}</span>

              <span class="flex items-center gap-3 min-w-0 flex-1">
                <span class="w-8 h-8 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/50 shrink-0 flex items-center justify-center">
                  <img v-if="avatarFor(p)" :src="avatarFor(p)!" class="w-full h-full object-cover" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
                  <span v-else class="text-[11px] font-bold uppercase text-zinc-500">{{ p.player.charAt(0) }}</span>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-2 min-w-0">
                    <ClanTag v-if="p.clan" :tag="p.clan.tag" :name="p.clan.name" :color="p.clan.color" size="sm" :link="false" />
                    <!-- The whole row is this link: its ::after covers the row,
                         and the hardest-level link sits above it. -->
                    <NuxtLink
                      :to="rowLink(p)"
                      class="font-medium text-zinc-100 truncate group-hover:text-accent transition-colors after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent/60"
                    >{{ p.player }}</NuxtLink>
                    <CountryFlag v-if="p.country" :country="p.country" size="sm" class="shrink-0" />
                    <span v-if="isMe(p)" class="shrink-0 text-[11px] font-semibold text-accent">You</span>
                    <!-- Site roles only on rows that are site identities: an
                         AREDL or Pointercrate row is a mirror, not an account. -->
                    <RoleBadge v-if="!sourceLabel(p)" :role="(p as AllRow).badge" size="sm" />
                  </span>
                  <span class="block text-xs text-zinc-500 truncate">
                    {{ subline(p).lead.join(' · ') }}<span v-if="(p as GlobalRow).claimed_account" class="text-emerald-400">{{ subline(p).lead.length ? ' · ' : '' }}has an account</span>
                    <!-- On phones the stat and hardest columns fold into this line. -->
                    <span v-if="subline(p).folded.length" class="md:hidden">{{ subline(p).lead.length || (p as GlobalRow).claimed_account ? ' · ' : '' }}{{ subline(p).folded.join(' · ') }}</span>
                  </span>
                </span>
              </span>

              <span class="hidden md:block text-right text-sm tabular-nums text-zinc-300">{{ stat(p) != null ? fmt(stat(p)) : '—' }}</span>

              <span class="hidden md:block min-w-0 text-sm">
                <template v-if="hardest(p)">
                  <NuxtLink
                    v-if="hardest(p)!.to"
                    :to="hardest(p)!.to!"
                    class="relative z-10 block truncate text-zinc-300 hover:text-accent"
                    :title="hardest(p)!.name"
                  >{{ hardest(p)!.name }} <span v-if="hardest(p)!.label" class="text-xs text-zinc-600 tabular-nums">{{ hardest(p)!.label }}</span></NuxtLink>
                  <span v-else class="block truncate text-zinc-400" :title="hardest(p)!.name">{{ hardest(p)!.name }}</span>
                </template>
                <span v-else class="text-zinc-700">—</span>
              </span>

              <span class="shrink-0 text-right tabular-nums">
                <template v-if="p.points > 0">
                  <span class="text-sm font-semibold text-amber-300">{{ fmt(p.points) }}</span>
                  <span class="text-xs text-zinc-500 ml-1">pts</span>
                </template>
                <span v-else class="text-sm text-zinc-600" title="No points on this list yet">—</span>
              </span>
            </li>

            <li v-if="!pending && !items.length" class="px-4 py-16 text-center">
              <p class="text-sm text-zinc-300">
                <template v-if="debounced">Nobody here matches “{{ debounced }}”.</template>
                <template v-else-if="tab === 'followed'">You’re not following anyone yet.</template>
                <template v-else-if="tab === 'records' && recordsMode === 'challenges'">No records on challenge levels yet.</template>
                <template v-else-if="tab === 'challenges'">Nobody has an approved record on a challenge yet.</template>
                <template v-else>No players yet.</template>
              </p>
              <p v-if="tab === 'followed' && !debounced" class="text-xs text-zinc-500 mt-1">Open someone’s profile and press Follow.</p>
              <button v-if="debounced" type="button" class="mt-2 text-xs link" @click="search = ''">Clear the search</button>
            </li>
          </ol>
        </div>

        <!-- Pages -->
        <div v-if="totalPages > 1" class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span class="text-xs text-zinc-500 tabular-nums">
            {{ firstShown.toLocaleString() }}–{{ lastShown.toLocaleString() }} of {{ total.toLocaleString() }}
          </span>
          <div class="flex items-center gap-1.5">
            <button type="button" :disabled="pending || page <= 1" class="btn btn-sm btn-ghost" title="First page" @click="gotoPage(1)">&laquo;</button>
            <button type="button" :disabled="pending || page <= 1" class="btn btn-sm btn-ghost" @click="gotoPage(page - 1)">&lsaquo; Previous</button>
            <span class="flex items-center gap-1 text-zinc-400 px-1">
              <input
                v-model="pageInput"
                type="number"
                min="1"
                :max="totalPages"
                aria-label="Page"
                class="field field-sm w-14 text-center tabular-nums"
                @keydown.enter="onPageInputCommit"
                @blur="onPageInputCommit"
              />
              <span class="tabular-nums text-xs">of {{ totalPages.toLocaleString() }}</span>
            </span>
            <button type="button" :disabled="pending || page >= totalPages" class="btn btn-sm btn-ghost" @click="gotoPage(page + 1)">Next &rsaquo;</button>
            <button type="button" :disabled="pending || page >= totalPages" class="btn btn-sm btn-ghost" title="Last page" @click="gotoPage(totalPages)">&raquo;</button>
          </div>
        </div>
      </div>

      <aside v-if="tab === 'followed'" class="space-y-3">
        <h2 class="section-title text-sm px-1">Recent activity</h2>
        <div v-if="feedLoading" class="card h-40 animate-pulse" />
        <ol v-else-if="feed.length" class="divide-y divide-zinc-900 card overflow-hidden">
          <li v-for="(item, idx) in feed" :key="`${item.kind}-${idx}-${item.at}`" class="px-3 py-2.5 text-xs">
            <div class="flex items-baseline gap-2">
              <ClanTag v-if="item.clan" :tag="item.clan.tag" :name="item.clan.name" :color="item.clan.color" size="sm" />
              <NuxtLink
                :to="item.actor_username ? `/users/${encodeURIComponent(item.actor_username)}` : `/users/by-player/${encodeURIComponent(item.actor)}`"
                class="font-medium text-zinc-200 hover:text-accent transition-colors truncate"
              >{{ item.actor }}</NuxtLink>
              <span class="text-zinc-600 tabular-nums shrink-0 ml-auto">{{ timeAgo(item.at) }}</span>
            </div>
            <div class="mt-0.5 text-zinc-400">
              <template v-if="item.kind === 'record'">completed</template>
              <template v-else-if="item.kind === 'verify'">verified</template>
              <template v-else-if="item.kind === 'level'">added</template>
              <template v-else>progressed on</template>
              {{ ' ' }}
              <NuxtLink v-if="item.level_position" :to="`/levels/${item.level_position}`" class="text-zinc-200 hover:text-accent">{{ item.level_name }}</NuxtLink>
              <span v-else class="text-zinc-200">{{ item.level_name }}</span>
              <span v-if="item.kind === 'record' && item.percent != null && item.percent < 100" class="text-zinc-500"> ({{ item.percent }}%)</span>
              <span v-if="item.kind === 'progress'" class="text-zinc-500"> {{ item.start_percent }}% → {{ item.end_percent }}%</span>
              <a v-if="item.kind === 'progress' && item.video_url" :href="item.video_url" target="_blank" rel="noopener" class="ml-1 link">video</a>
            </div>
          </li>
        </ol>
        <div v-else class="text-xs text-zinc-500 px-3 py-6 card text-center">
          Nothing new from the people you follow.
        </div>
      </aside>
    </div>
  </div>
</template>
