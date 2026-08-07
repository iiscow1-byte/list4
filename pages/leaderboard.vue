<script setup lang="ts">

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
}
type Row = AllRow | GlobalRow

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
}

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

type Tab = 'members' | 'global' | 'followed'
const tab = ref<Tab>('global')
const search = ref('')
const debounced = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { debounced.value = v.trim() }, 200)
})

// "Members" and "Followed" tabs use /api/leaderboard (ALL list players);
// "Global" hits /api/leaderboard/global which merges AREDL, PC, GDL, and ALL.
const url = computed(() => tab.value === 'global' ? '/api/leaderboard/global' : '/api/leaderboard')

const PAGE_SIZE = 200
const items = ref<Row[]>([])
const total = ref(0)
const pending = ref(true)
const page = ref(1)
const pageInput = ref('1')
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

function buildParams(offset: number) {
  const params: Record<string, string | number> = { limit: PAGE_SIZE, offset }
  if (debounced.value) params.q = debounced.value
  if (tab.value === 'global') {
    params.source = 'all'
  } else if (tab.value === 'followed') {
    params.followed = '1'
  }
  return params
}

async function load(targetPage: number) {
  pending.value = true
  try {
    const offset = (targetPage - 1) * PAGE_SIZE
    const res = await $fetch<{ total: number; items: Row[] }>(url.value, { params: buildParams(offset) })
    items.value = res.items
    total.value = res.total
    // If the server's total dropped below this page (e.g. a search narrowed
    // the result set), snap back to the last valid page and refetch.
    const tp = Math.max(1, Math.ceil(res.total / PAGE_SIZE))
    if (targetPage > tp) {
      page.value = tp
      pageInput.value = String(tp)
      const fixed = await $fetch<{ total: number; items: Row[] }>(url.value, { params: buildParams((tp - 1) * PAGE_SIZE) })
      items.value = fixed.items
      total.value = fixed.total
    } else {
      page.value = targetPage
      pageInput.value = String(targetPage)
    }
  } catch {
    items.value = []
    total.value = 0
  } finally {
    pending.value = false
  }
}

function gotoPage(n: number) {
  const clamped = Math.min(totalPages.value, Math.max(1, Math.floor(n) || 1))
  if (clamped === page.value) return
  load(clamped)
}

function onPageInputCommit() {
  const n = Number(pageInput.value)
  if (!Number.isFinite(n)) { pageInput.value = String(page.value); return }
  gotoPage(n)
}

onMounted(() => { load(1) })
// Filter / tab changes reset to page 1.
watch([tab, debounced], () => { page.value = 1; pageInput.value = '1'; load(1) })
watch(me, () => { if (tab.value === 'followed') { page.value = 1; pageInput.value = '1'; load(1) } })

const feed = ref<FeedItem[]>([])
const feedLoading = ref(false)
async function loadFeed() {
  if (!me.value) { feed.value = []; return }
  feedLoading.value = true
  try {
    const res = await $fetch<{ items: FeedItem[] }>('/api/feed/followed', { query: { limit: 30 } })
    feed.value = res.items
  } catch {
    feed.value = []
  } finally {
    feedLoading.value = false
  }
}
watch([tab, me], () => {
  if (tab.value === 'followed') loadFeed()
})

/**
 * The podium only makes sense on the unfiltered first page — a search result's
 * "#1" is the best match, not the best player.
 */
const podium = computed(() =>
  page.value === 1 && !debounced.value ? items.value.slice(0, 3) : [],
)
const listItems = computed(() =>
  podium.value.length ? items.value.slice(3) : items.value,
)
/** Scale for the points bar — the leader on this page fills the row. */
const topPoints = computed(() => items.value[0]?.points ?? 0)

function rankClass(rank: number) {
  if (rank === 1) return 'bg-amber-400 text-amber-950'
  if (rank === 2) return 'bg-zinc-300 text-zinc-900'
  if (rank === 3) return 'bg-orange-400/80 text-orange-950'
  if (rank <= 10) return 'bg-zinc-300/15 text-zinc-200'
  return 'bg-zinc-800 text-zinc-400'
}
/** Medal ring around the podium avatars. */
function podiumRing(rank: number) {
  if (rank === 1) return 'ring-amber-400/80'
  if (rank === 2) return 'ring-zinc-300/70'
  return 'ring-orange-400/70'
}
function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
function relative(at: string): string {
  const t = Date.parse(at)
  if (Number.isNaN(t)) return ''
  const diff = (Date.now() - t) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`
  return new Date(t).toLocaleDateString()
}

/**
 * Every row goes to that player's profile on this site.
 *
 * Rows sourced from AREDL, Pointercrate and GDL used to link straight out to
 * those lists' own player pages, so clicking a name on the All Levels List's
 * leaderboard took you to somebody's AREDL profile. It is our leaderboard: the
 * destination is their standing *here*, and their ranks on the other lists are
 * shown on that page as links for anyone who wants them.
 *
 * A claimed player has a real account page; everyone else gets the by-player
 * profile, which now answers for external-only players too rather than 404ing
 * — that gap is why this used to point outward.
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
function sourceLabel(p: Row): string | null {
  if (!p.source) return null
  // External sources (AREDL/PC/GDL) all collapse to a single "(External)" tag.
  // Players whose only source is the ALL list don't get a tag.
  const sources = (p as GlobalRow).sources ?? [p.source]
  const onlyAll = sources.length === 1 && sources[0] === 'alllist'
  return onlyAll ? null : '(External)'
}
/**
 * The picture behind a row, whichever tab it came from.
 *
 * The two endpoints name the account differently — Members flattens it onto the
 * row, Global nests it under `claimed_account` — and this only read the first
 * shape, so the tab the page opens on showed initials for everyone. A global
 * row has a picture exactly when the player has claimed a site account with one.
 */
function avatarFor(p: Row): string | null {
  const all = p as AllRow
  if (all.has_avatar && all.account_username) {
    return `/api/users/${encodeURIComponent(all.account_username)}/avatar`
  }
  const claimed = (p as GlobalRow).claimed_account
  if (claimed?.has_avatar) {
    return `/api/users/${encodeURIComponent(claimed.username)}/avatar`
  }
  return null
}

useHead({ title: 'Leaderboard — All Levels List' })
</script>

<template>
  <div class="container-tight py-8">
    <header class="mb-5">
      <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">Leaderboard</h1>
      <p class="text-zinc-500 mt-1 text-sm">
        <template v-if="tab === 'global'">
          Players from AREDL, Pointercrate, GDL, and the ALL list, ranked by their ALL list points.
        </template>
        <template v-else-if="tab === 'members'">
          ALL list members ranked by total points.
        </template>
        <template v-else>
          The players you follow, ranked by total points.
        </template>
      </p>
    </header>

    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div class="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
        <button
          v-for="t in [
            { v: 'global', l: 'Global' },
            { v: 'members', l: 'Members' },
            { v: 'followed', l: 'Followed' },
          ]"
          :key="t.v"
          type="button"
          class="px-3 py-1.5 text-sm font-medium transition-colors border-l border-zinc-800 first:border-l-0"
          :class="tab === t.v ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'"
          @click="tab = t.v as any"
        >{{ t.l }}</button>
      </div>
      <div class="relative flex-1 min-w-[200px] max-w-md">
        <input
          v-model="search"
          type="search"
          placeholder="Search players or accounts…"
          class="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
        />
      </div>
      <span v-if="total" class="text-[11px] text-zinc-600 tabular-nums ml-auto">
        {{ total.toLocaleString() }} player{{ total === 1 ? '' : 's' }}
      </span>
    </div>

    <div v-if="tab === 'followed' && !me" class="text-sm text-zinc-500 rounded-xl border border-zinc-800/70 bg-zinc-950 px-4 py-12 text-center">
      <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink> to follow other profiles and see them here.
    </div>

    <div v-else class="grid gap-6" :class="tab === 'followed' ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : ''">
      <div>
        <div v-if="pending && items.length === 0" class="text-sm text-zinc-500 py-12 text-center">loading…</div>

        <template v-else>
          <!-- Podium: the top three, given room to breathe -->
          <ol v-if="podium.length === 3" class="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
            <li
              v-for="p in [podium[1], podium[0], podium[2]]"
              :key="rowKey(p!, p!.rank)"
              :class="p!.rank === 1 ? 'sm:-mt-3' : ''"
            >
              <NuxtLink
                :to="rowLink(p!)"
                class="h-full flex flex-col items-center text-center gap-2 rounded-xl border bg-zinc-950 px-2 py-4 transition-colors group"
                :class="p!.rank === 1 ? 'border-amber-500/40 hover:border-amber-400/70' : 'border-zinc-800 hover:border-zinc-600'"
              >
                <span
                  class="w-12 h-12 sm:w-14 sm:h-14 rounded-full overflow-hidden bg-zinc-800 ring-2 flex items-center justify-center shrink-0"
                  :class="podiumRing(p!.rank)"
                >
                  <img v-if="avatarFor(p!)" :src="avatarFor(p!)!" class="w-full h-full object-cover" alt="" />
                  <span v-else class="text-lg font-black uppercase text-zinc-500">{{ p!.player.charAt(0) }}</span>
                </span>
                <span class="rank-badge shrink-0" :class="rankClass(p!.rank)">#{{ p!.rank }}</span>
                <span class="text-sm font-semibold text-zinc-100 truncate w-full group-hover:text-accent transition-colors">{{ p!.player }}</span>
                <span class="text-xs tabular-nums text-amber-300">{{ fmt(p!.points) }} pts</span>
                <span v-if="p!.hardest" class="text-[10px] text-zinc-600 truncate w-full">{{ p!.hardest }}</span>
              </NuxtLink>
            </li>
          </ol>

          <ol
            class="divide-y divide-zinc-900 rounded-xl border border-zinc-800/70 bg-zinc-950 overflow-hidden transition-opacity"
            :class="{ 'opacity-50': pending }"
          >
            <li v-for="(p, i) in listItems" :key="rowKey(p, i)" class="relative">
              <!-- Points bar, scaled against the top of this page -->
              <span
                class="absolute inset-y-0 left-0 bg-accent/[0.06] pointer-events-none"
                :style="{ width: topPoints > 0 ? `${Math.max(0, (p.points / topPoints) * 100)}%` : '0%' }"
                aria-hidden="true"
              />
              <NuxtLink
                :to="rowLink(p)"
                class="relative flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-zinc-900/60 transition-colors group"
              >
                <span class="rank-badge shrink-0" :class="rankClass(p.rank)">#{{ p.rank }}</span>
                <span class="w-8 h-8 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/50 shrink-0 flex items-center justify-center">
                  <img v-if="avatarFor(p)" :src="avatarFor(p)!" class="w-full h-full object-cover" alt="" />
                  <span v-else class="text-[11px] font-bold uppercase text-zinc-500">{{ p.player.charAt(0) }}</span>
                </span>
                <div class="flex-1 min-w-0">
                  <div class="font-medium truncate flex items-center gap-2 group-hover:text-accent transition-colors">
                    <span>{{ p.player }}</span>
                    <!-- Role badge intentionally excluded from external-list rows
                         (Aredl, Pointercrate): they are list mirrors, not site
                         identities, so the site-role chip would be misleading. -->
                    <template v-if="!sourceLabel(p)">
                      <RoleBadge :role="(p as AllRow).badge" size="sm" />
                    </template>
                    <template v-else>
                      <span class="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0">{{ sourceLabel(p) }}</span>
                      <span
                        v-if="(p as GlobalRow).claimed_account"
                        class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 shrink-0"
                        :title="`Claimed by @${(p as GlobalRow).claimed_account!.username}`"
                      >Claimed</span>
                    </template>
                  </div>
                  <div class="text-[11px] text-zinc-500 flex flex-wrap gap-x-3 gap-y-0.5">
                    <template v-if="!sourceLabel(p)">
                      <span v-if="(p as AllRow).skill_points" class="tabular-nums">Skill {{ fmt((p as AllRow).skill_points) }}</span>
                      <span v-if="(p as AllRow).extremes" class="tabular-nums">{{ (p as AllRow).extremes }} extremes</span>
                      <span v-if="p.hardest" class="truncate">Hardest: {{ p.hardest }}</span>
                    </template>
                    <template v-else>
                      <span v-if="p.country" class="uppercase tabular-nums">{{ p.country }}</span>
                      <span v-if="(p as GlobalRow).extras?.extremes" class="tabular-nums">{{ (p as GlobalRow).extras.extremes }} extremes</span>
                      <span v-if="p.hardest" class="truncate">Hardest: {{ p.hardest }}</span>
                    </template>
                  </div>
                </div>
                <span
                  class="tabular-nums text-sm shrink-0 font-semibold"
                  :class="p.points > 0 ? 'text-amber-300' : 'text-zinc-600'"
                >{{ fmt(p.points) }}<span class="text-[10px] font-normal text-zinc-600 ml-1">pts</span></span>
              </NuxtLink>
            </li>
            <li v-if="!pending && items.length === 0" class="px-4 py-16 text-center text-sm text-zinc-500">
              <template v-if="tab === 'followed'">
                You're not following anyone yet. Open a profile and click "Follow".
              </template>
              <template v-else-if="tab === 'global' && debounced">
                No global players match "{{ debounced }}".
              </template>
              <template v-else-if="tab === 'global'">
                No global players imported yet.
              </template>
              <template v-else-if="debounced">
                No players or accounts match "{{ debounced }}".
              </template>
              <template v-else>
                No players imported yet. Run <code class="text-amber-300 tabular-nums">npm run import</code>.
              </template>
            </li>
          </ol>
        </template>

        <div v-if="totalPages > 1" class="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm">
          <button
            type="button"
            :disabled="pending || page <= 1"
            class="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="First page"
            @click="gotoPage(1)"
          >&laquo;</button>
          <button
            type="button"
            :disabled="pending || page <= 1"
            class="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Previous page"
            @click="gotoPage(page - 1)"
          >&lsaquo;</button>
          <div class="flex items-center gap-1 text-zinc-400">
            <span>Page</span>
            <input
              v-model="pageInput"
              type="number"
              min="1"
              :max="totalPages"
              class="w-14 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-center text-zinc-100 tabular-nums focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
              @keydown.enter="onPageInputCommit"
              @blur="onPageInputCommit"
            />
            <span class="tabular-nums">/ {{ totalPages }}</span>
          </div>
          <button
            type="button"
            :disabled="pending || page >= totalPages"
            class="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Next page"
            @click="gotoPage(page + 1)"
          >&rsaquo;</button>
          <button
            type="button"
            :disabled="pending || page >= totalPages"
            class="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Last page"
            @click="gotoPage(totalPages)"
          >&raquo;</button>
        </div>
      </div>

      <aside v-if="tab === 'followed'" class="space-y-3">
        <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold px-1">Recent activity</h2>
        <div v-if="feedLoading" class="text-xs text-zinc-600 px-1">loading…</div>
        <ol v-else-if="feed.length" class="divide-y divide-zinc-900 rounded-xl border border-zinc-800/70 bg-zinc-950 overflow-hidden">
          <li v-for="(item, idx) in feed" :key="`${item.kind}-${idx}-${item.at}`" class="px-3 py-2.5 text-xs">
            <div class="flex items-baseline gap-2">
              <NuxtLink
                :to="item.actor_username ? `/users/${encodeURIComponent(item.actor_username)}` : `/users/by-player/${encodeURIComponent(item.actor)}`"
                class="font-medium text-zinc-200 hover:text-accent transition-colors truncate"
              >{{ item.actor }}</NuxtLink>
              <span class="text-zinc-600 tabular-nums shrink-0 ml-auto">{{ relative(item.at) }}</span>
            </div>
            <div class="mt-0.5 text-zinc-400">
              <template v-if="item.kind === 'record'">
                completed
                <NuxtLink v-if="item.level_position" :to="`/levels/${item.level_position}`" class="text-zinc-200 hover:text-accent">{{ item.level_name }}</NuxtLink>
                <span v-else class="text-zinc-200">{{ item.level_name }}</span>
                <span v-if="item.percent != null && item.percent < 100" class="text-zinc-500"> ({{ item.percent }}%)</span>
              </template>
              <template v-else-if="item.kind === 'verify'">
                verified
                <NuxtLink v-if="item.level_position" :to="`/levels/${item.level_position}`" class="text-zinc-200 hover:text-accent">{{ item.level_name }}</NuxtLink>
                <span v-else class="text-zinc-200">{{ item.level_name }}</span>
              </template>
              <template v-else-if="item.kind === 'level'">
                added
                <NuxtLink v-if="item.level_position" :to="`/levels/${item.level_position}`" class="text-zinc-200 hover:text-accent">{{ item.level_name }}</NuxtLink>
                <span v-else class="text-zinc-200">{{ item.level_name }}</span>
              </template>
              <template v-else-if="item.kind === 'progress'">
                progressed on
                <NuxtLink v-if="item.level_position" :to="`/levels/${item.level_position}`" class="text-zinc-200 hover:text-accent">{{ item.level_name }}</NuxtLink>
                <span v-else class="text-zinc-200">{{ item.level_name }}</span>
                <span class="text-zinc-500">{{ ` ${item.start_percent}% → ${item.end_percent}%` }}</span>
                <a v-if="item.video_url" :href="item.video_url" target="_blank" rel="noopener" class="ml-1 text-accent hover:underline">[video]</a>
              </template>
            </div>
          </li>
        </ol>
        <div v-else class="text-xs text-zinc-600 px-1 py-3 rounded-xl border border-zinc-800/70 bg-zinc-950 text-center">
          No recent activity from people you follow.
        </div>
      </aside>
    </div>
  </div>
</template>
