<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

/** The social home: what your follows are doing, plus site-wide activity. */
type Community = {
  newLevels: { position: number; sheet_placement: number | null; name: string; gd_id: number | null; gddl_tier: string | null; changed_at: string }[]
  recentRecords: { player_name: string; player_username: string | null; percent: number; video: string | null; position: number; sheet_placement: number | null; level_name: string; gd_id: number | null; gddl_tier: string | null }[]
  newLists: { public_id: string; title: string; likes: number; owner_username: string | null; item_count: number; icon_url: string | null; accent_color: string | null }[]
  newMembers: { username: string; created_at: string; claimed_player: string | null; has_avatar: number }[]
  totals: { levels: number; members: number; public_lists: number; records: number }
}
type FeedItem = {
  kind: 'record' | 'verify' | 'level' | 'progress'
  at: string
  actor: string
  actor_username: string | null
  actor_has_avatar: boolean
  level_position: number | null
  level_name: string
  level_gd_id: number | null
  percent?: number | null
  start_percent?: number | null
  end_percent?: number | null
  video_url?: string | null
}

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

const { data: community } = await useFetch<Community>('/api/community')

/**
 * The hub has two halves: what people have done, and what they are saying.
 *
 * The forum was briefly a nav entry of its own, which split the community into
 * two doors and left a visitor to pick one — so neither half was ever busy.
 * They are one page with one switch now, and the switch is in the URL so a
 * link can point at either.
 */
const route = useRoute()
const router = useRouter()
type HubTab = 'feed' | 'forum'
const tab = ref<HubTab>(route.query.tab === 'forum' ? 'forum' : 'feed')
const tabModel = computed({
  get: () => tab.value as string,
  set: (v: string) => { tab.value = v as HubTab },
})
watch(tab, (v) => {
  router.replace({ query: { ...route.query, tab: v === 'feed' ? undefined : v } })
})

/**
 * `?level_id=` arrives from a level's own page and means "the threads about
 * this one". It implies the forum half — landing on the feed after following
 * a link about a specific level would look like the link did nothing.
 */
const levelFilter = computed(() => {
  const n = Number(route.query.level_id)
  return Number.isInteger(n) && n > 0 ? n : null
})
if (levelFilter.value) tab.value = 'forum'

// Personalised half — only meaningful when logged in.
const feed = ref<FeedItem[]>([])
const feedLoaded = ref(false)
async function loadFeed() {
  if (!me.value) { feed.value = []; feedLoaded.value = true; return }
  try {
    const res = await $fetch<{ items: FeedItem[] }>('/api/feed/followed', { query: { limit: 30 } })
    feed.value = res.items
  } catch { feed.value = [] } finally { feedLoaded.value = true }
}
watch(me, loadFeed, { immediate: true })

/** Show everything, or only one kind of activity. */
const kind = ref<'' | 'record' | 'progress' | 'verify' | 'level'>('')
const kindModel = computed({
  get: () => kind.value as string,
  set: (v: string) => { kind.value = v as any },
})
const shownFeed = computed(() =>
  kind.value ? feed.value.filter((i) => i.kind === kind.value) : feed.value,
)

function relative(at: string): string {
  const iso = at.includes('T') ? at : at.replace(' ', 'T') + 'Z'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const secs = Math.max(0, (Date.now() - t) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`
  const days = Math.floor(secs / 86400)
  if (days < 30) return `${days}d`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

/** Verb + tone per activity kind — the bit that makes the feed scannable. */
const KINDS: Record<FeedItem['kind'], { verb: string; chip: string; tone: string }> = {
  record:   { verb: 'completed',    chip: 'Completion', tone: 'bg-emerald-950/60 text-emerald-300 border-emerald-900/60' },
  verify:   { verb: 'verified',     chip: 'Verified',   tone: 'bg-sky-950/60 text-sky-300 border-sky-900/60' },
  level:    { verb: 'added',        chip: 'New level',  tone: 'bg-accent/10 text-accent border-accent/25' },
  progress: { verb: 'progressed on', chip: 'Progress',  tone: 'bg-amber-950/60 text-amber-300 border-amber-900/60' },
}

function profileLink(i: FeedItem): string {
  return i.actor_username
    ? `/users/${encodeURIComponent(i.actor_username)}`
    : `/users/by-player/${encodeURIComponent(i.actor)}`
}

/**
 * Player search.
 *
 * The hub is where you go to find people, and until now the only way to do that
 * was to page through the leaderboard hoping to spot a name. This asks every
 * list at once — site members, ALL record holders, AREDL, Pointercrate, GDL —
 * so a name that exists anywhere is findable here.
 */
type PlayerHit = {
  name: string
  href: string
  sources: ('account' | 'all' | 'aredl' | 'pointercrate' | 'gdl')[]
  username: string | null
  has_avatar: boolean
  country: string | null
  points: number | null
  rank: number | null
  hardest: string | null
  role: string | null
}

const SOURCE_LABELS: Record<PlayerHit['sources'][number], string> = {
  account: 'Member',
  all: 'ALL',
  aredl: 'AREDL',
  pointercrate: 'Pointercrate',
  gdl: 'GDL',
}

const playerQuery = ref('')
const playerHits = ref<PlayerHit[]>([])
const playerSearching = ref(false)
const playerSearched = ref(false)
let playerTimer: ReturnType<typeof setTimeout> | null = null
/** Guards against a slow early request overwriting a later, faster one. */
let playerSeq = 0

async function runPlayerSearch() {
  const q = playerQuery.value.trim()
  if (q.length < 2) {
    playerHits.value = []
    playerSearched.value = false
    playerSearching.value = false
    return
  }
  const seq = ++playerSeq
  playerSearching.value = true
  try {
    const res = await $fetch<{ items: PlayerHit[] }>('/api/community/players', { query: { q } })
    if (seq !== playerSeq) return
    playerHits.value = res.items
    playerSearched.value = true
  } catch {
    if (seq !== playerSeq) return
    playerHits.value = []
    playerSearched.value = true
  } finally {
    if (seq === playerSeq) playerSearching.value = false
  }
}

watch(playerQuery, () => {
  if (playerTimer) clearTimeout(playerTimer)
  playerTimer = setTimeout(runPlayerSearch, 220)
})
onBeforeUnmount(() => { if (playerTimer) clearTimeout(playerTimer) })

function clearPlayerSearch() {
  playerQuery.value = ''
  playerHits.value = []
  playerSearched.value = false
}

useHead({ title: 'Community — All Levels List' })
</script>

<template>
  <div class="container-wide py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">Community</h1>
        <p class="text-sm text-zinc-500 mt-1">What the list and its players have been up to.</p>
        <!-- Clans are part of the community rather than a page of their own to
             stumble on, so they are linked from the top of it. -->
        <nav class="mt-2 flex flex-wrap items-center gap-1.5">
          <NuxtLink
            to="/clans"
            class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-accent/60 hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >Clans →</NuxtLink>
          <NuxtLink
            to="/leaderboard"
            class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-accent/60 hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >Leaderboard →</NuxtLink>
          <!-- Your friends live on your own profile, not on a page of the
               site — this is a shortcut to that half of it. -->
          <NuxtLink
            v-if="me"
            to="/account?panel=friends"
            class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-accent/60 hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          >Your friends →</NuxtLink>
        </nav>
      </div>
      <dl v-if="community" class="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden border border-zinc-800 bg-zinc-800/70">
        <div v-for="s in [
          { l: 'Levels', v: community.totals.levels },
          { l: 'Records', v: community.totals.records },
          { l: 'Members', v: community.totals.members },
          { l: 'Custom lists', v: community.totals.public_lists },
        ]" :key="s.l" class="bg-zinc-950 px-3 py-1.5 min-w-[5.5rem]">
          <dt class="text-[9px] uppercase tracking-widest text-zinc-600">{{ s.l }}</dt>
          <dd class="text-sm font-semibold tabular-nums text-zinc-200">{{ s.v.toLocaleString() }}</dd>
        </div>
      </dl>
    </header>

    <!-- The two halves of the hub. One switch rather than two nav entries:
         reading what people have done and talking about it are the same room. -->
    <SegmentedControl
      v-model="tabModel"
      size="md"
      aria-label="Community section"
      :options="[
        { value: 'feed', label: 'Feed' },
        { value: 'forum', label: 'Forum' },
      ]"
    />

    <!-- ---------------- Forum ---------------- -->
    <CommunityForum v-if="tab === 'forum'" :level-id="levelFilter" />

    <!-- ---------------- Feed ---------------- -->
    <template v-else>
    <!-- Find a player -->
    <section class="card overflow-hidden">
      <div class="px-4 py-3 flex items-center gap-3 flex-wrap">
        <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold shrink-0">Find a player</h2>
        <div class="relative flex-1 min-w-[14rem]">
          <input
            v-model="playerQuery"
            type="search"
            placeholder="Search members, ALL, AREDL, Pointercrate and GDL…"
            class="field field-md pl-8 pr-8"
            @keydown.esc="clearPlayerSearch"
          />
          <svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" aria-hidden="true">
            <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.4 9.83l3.14 3.13a.75.75 0 1 0 1.06-1.06l-3.13-3.13A5.5 5.5 0 0 0 9 3.5zM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0z" clip-rule="evenodd" />
          </svg>
          <span v-if="playerSearching" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-600">…</span>
        </div>
        <NuxtLink to="/leaderboard" class="text-[11px] text-zinc-500 hover:text-accent transition-colors shrink-0">Full leaderboard →</NuxtLink>
      </div>

      <p v-if="playerSearched && !playerHits.length" class="px-4 pb-4 text-xs text-zinc-500">
        No player matches “{{ playerQuery.trim() }}”.
      </p>

      <ul v-else-if="playerHits.length" class="border-t border-zinc-800/80 divide-y divide-zinc-900/60 max-h-[22rem] overflow-y-auto">
        <li v-for="h in playerHits" :key="h.href">
          <NuxtLink :to="h.href" class="px-4 py-2.5 flex items-center gap-3 hover:bg-zinc-900/40 transition-colors">
            <span class="w-8 h-8 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/60 shrink-0 flex items-center justify-center">
              <img
                v-if="h.has_avatar && h.username"
                :src="`/api/users/${encodeURIComponent(h.username)}/avatar`"
                class="w-full h-full object-cover"
                alt=""
              />
              <span v-else class="text-[11px] font-bold uppercase text-zinc-400">{{ h.name.charAt(0) }}</span>
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex items-baseline gap-2 flex-wrap">
                <span class="text-sm font-medium text-zinc-100 truncate">{{ h.name }}</span>
                <span
                  v-for="s in h.sources"
                  :key="s"
                  class="text-[9px] uppercase tracking-widest px-1.5 py-px rounded border"
                  :class="s === 'account'
                    ? 'border-accent/30 bg-accent/10 text-accent'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-500'"
                >{{ SOURCE_LABELS[s] }}</span>
              </span>
              <span v-if="h.hardest" class="block text-[11px] text-zinc-600 truncate">Hardest: {{ h.hardest }}</span>
            </span>
            <span v-if="h.rank != null" class="text-[11px] text-zinc-500 tabular-nums shrink-0">#{{ h.rank.toLocaleString() }}</span>
            <span v-if="h.points != null" class="text-[11px] text-zinc-400 tabular-nums shrink-0 w-16 text-right">{{ h.points.toLocaleString(undefined, { maximumFractionDigits: 1 }) }}</span>
          </NuxtLink>
        </li>
      </ul>
    </section>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] items-start">
      <!-- Following feed -->
      <section class="card overflow-hidden">
        <div class="px-4 py-2.5 border-b border-zinc-800/80 flex items-center justify-between gap-2 flex-wrap">
          <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Following</h2>
          <SegmentedControl
            v-if="me && feed.length"
            v-model="kindModel"
            aria-label="Filter activity"
            :options="[
              { value: '', label: 'All' },
              { value: 'record', label: 'Completions' },
              { value: 'progress', label: 'Progress' },
              { value: 'verify', label: 'Verifications' },
            ]"
          />
          <NuxtLink v-else-if="me" to="/leaderboard" class="text-[11px] text-zinc-500 hover:text-accent transition-colors">Find players →</NuxtLink>
        </div>

        <p v-if="!me" class="px-4 py-16 text-sm text-zinc-500 text-center">
          <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink>
          and follow players to see their completions here.
        </p>
        <p v-else-if="!feedLoaded" class="px-4 py-16 text-sm text-zinc-500 text-center">
          Loading activity…
        </p>
        <p v-else-if="shownFeed.length === 0" class="px-4 py-16 text-sm text-zinc-500 text-center">
          Nothing yet. Follow some players from the
          <NuxtLink to="/leaderboard" class="text-accent hover:underline">leaderboard</NuxtLink>.
        </p>
        <ul v-else class="divide-y divide-zinc-900/60">
          <li
            v-for="(i, idx) in shownFeed"
            :key="`${i.kind}-${idx}-${i.at}`"
            class="relative overflow-hidden group/row"
          >
            <LevelThumbBg
              :gd-id="i.level_gd_id"
              res="small"
              img-class="opacity-[0.12] group-hover/row:opacity-25"
              overlay-class="bg-gradient-to-r from-zinc-950/95 via-zinc-950/85 to-zinc-950/50"
            />
            <div class="relative px-4 py-4 flex items-start gap-3.5">
              <NuxtLink :to="profileLink(i)" class="shrink-0 mt-0.5">
                <span class="w-9 h-9 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/60 flex items-center justify-center">
                  <img
                    v-if="i.actor_has_avatar && i.actor_username"
                    :src="`/api/users/${encodeURIComponent(i.actor_username)}/avatar`"
                    class="w-full h-full object-cover"
                    alt=""
                  />
                  <span v-else class="text-[11px] font-bold uppercase text-zinc-400">{{ i.actor.charAt(0) }}</span>
                </span>
              </NuxtLink>

              <div class="min-w-0 flex-1">
                <p class="text-sm leading-relaxed tracking-[0.01em]">
                  <NuxtLink :to="profileLink(i)" class="font-semibold text-zinc-100 hover:text-accent transition-colors">{{ i.actor }}</NuxtLink>
                  <!-- The spaces are inside the interpolation on purpose. A
                       whitespace-only text node that is an element's first or
                       last child is dropped by the template compiler, which is
                       what glued "GERGcompletedLevel" together. -->
                  <span class="text-zinc-500">{{ ` ${KINDS[i.kind].verb} ` }}</span>
                  <NuxtLink
                    v-if="i.level_position"
                    :to="`/levels/${i.level_position}`"
                    class="font-medium text-zinc-200 hover:text-accent transition-colors"
                  >{{ i.level_name }}</NuxtLink>
                  <span v-else class="font-medium text-zinc-200">{{ i.level_name }}</span>
                  <span v-if="i.kind === 'record' && i.percent != null && i.percent < 100" class="text-zinc-500 tabular-nums"> ({{ i.percent }}%)</span>
                  <span v-if="i.kind === 'progress'" class="text-amber-300/90 tabular-nums">{{ ` ${i.start_percent}% → ${i.end_percent}%` }}</span>
                </p>
                <div class="mt-2 flex items-center gap-2.5 text-[10px]">
                  <span class="rounded px-1.5 py-0.5 border uppercase tracking-[0.14em]" :class="KINDS[i.kind].tone">{{ KINDS[i.kind].chip }}</span>
                  <span class="text-zinc-600 tabular-nums tracking-wide">{{ relative(i.at) }}</span>
                  <a
                    v-if="i.video_url"
                    :href="i.video_url"
                    target="_blank"
                    rel="noopener"
                    class="text-zinc-600 hover:text-accent transition-colors tracking-wide"
                  >watch ↗</a>
                </div>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <div class="space-y-4">
        <!-- Newly ranked -->
        <section v-if="community?.newLevels.length" class="card overflow-hidden">
          <h2 class="px-4 py-2.5 border-b border-zinc-800/80 text-[10px] uppercase tracking-widest text-accent font-semibold">Newly ranked</h2>
          <ul class="divide-y divide-zinc-900/60">
            <li v-for="l in community.newLevels" :key="l.position" class="relative overflow-hidden group">
              <NuxtLink :to="`/levels/${l.position}`" class="relative flex items-center gap-2 px-3 py-2 text-sm">
                <LevelThumbBg :gd-id="l.gd_id" res="small" img-class="opacity-20 group-hover:opacity-40" overlay-class="bg-gradient-to-r from-zinc-950/92 to-zinc-950/50" />
                <span
                  class="relative shrink-0 text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold"
                  :style="{ backgroundColor: tierColor(l.gddl_tier), color: textOn(tierColor(l.gddl_tier)) }"
                >#{{ l.sheet_placement ?? l.position }}</span>
                <span class="relative truncate flex-1 text-zinc-200 group-hover:text-accent transition-colors">{{ l.name }}</span>
                <span class="relative text-[11px] text-zinc-600 shrink-0 tabular-nums">{{ relative(l.changed_at) }}</span>
              </NuxtLink>
            </li>
          </ul>
        </section>

        <!-- Latest records -->
        <section v-if="community?.recentRecords.length" class="card overflow-hidden">
          <h2 class="px-4 py-2.5 border-b border-zinc-800/80 text-[10px] uppercase tracking-widest text-accent font-semibold">Latest records</h2>
          <ul class="divide-y divide-zinc-900/60">
            <li v-for="(r, i) in community.recentRecords" :key="i" class="relative overflow-hidden group">
              <LevelThumbBg :gd-id="r.gd_id" res="small" img-class="opacity-[0.12] group-hover:opacity-25" overlay-class="bg-gradient-to-r from-zinc-950/95 to-zinc-950/60" />
              <div class="relative px-3 py-2 text-sm flex items-center gap-2">
                <NuxtLink
                  :to="r.player_username ? `/users/${encodeURIComponent(r.player_username)}` : `/users/by-player/${encodeURIComponent(r.player_name)}`"
                  class="font-semibold text-zinc-100 hover:text-accent transition-colors truncate max-w-[7.5rem]"
                >{{ r.player_name }}</NuxtLink>
                <NuxtLink :to="`/levels/${r.position}`" class="truncate flex-1 text-zinc-400 hover:text-accent transition-colors">{{ r.level_name }}</NuxtLink>
                <span class="text-[11px] tabular-nums shrink-0" :class="r.percent >= 100 ? 'text-emerald-300' : 'text-amber-300'">{{ r.percent }}%</span>
                <a v-if="r.video" :href="r.video" target="_blank" rel="noopener" class="text-[10px] text-zinc-600 hover:text-accent shrink-0">↗</a>
              </div>
            </li>
          </ul>
        </section>

        <!-- Fresh lists -->
        <section v-if="community?.newLists.length" class="card overflow-hidden">
          <div class="px-4 py-2.5 border-b border-zinc-800/80 flex items-center justify-between gap-2">
            <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Fresh lists</h2>
            <NuxtLink to="/lists" class="text-[11px] text-zinc-500 hover:text-accent transition-colors">All →</NuxtLink>
          </div>
          <ul class="divide-y divide-zinc-900/60">
            <li v-for="l in community.newLists" :key="l.public_id">
              <NuxtLink :to="`/lists/${l.public_id}`" class="px-3 py-2 text-sm flex items-center gap-2.5 hover:bg-zinc-900/40 transition-colors">
                <img
                  v-if="l.icon_url"
                  :src="l.icon_url"
                  alt=""
                  referrerpolicy="no-referrer"
                  class="w-7 h-7 rounded-lg object-cover border border-zinc-800 shrink-0 bg-zinc-900"
                />
                <span
                  v-else
                  class="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[10px] font-black shrink-0"
                  :style="l.accent_color ? { color: l.accent_color } : undefined"
                  :class="l.accent_color ? '' : 'text-accent'"
                  aria-hidden="true"
                >{{ l.title.slice(0, 2).toUpperCase() }}</span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-zinc-200">{{ l.title }}</span>
                  <span class="block truncate text-[10px] text-zinc-600">
                    <template v-if="l.owner_username">by {{ l.owner_username }} · </template>{{ l.item_count }} levels
                  </span>
                </span>
                <span class="text-[11px] text-zinc-600 tabular-nums shrink-0">★ {{ l.likes }}</span>
              </NuxtLink>
            </li>
          </ul>
        </section>

        <!-- New members -->
        <section v-if="community?.newMembers.length" class="card overflow-hidden">
          <h2 class="px-4 py-2.5 border-b border-zinc-800/80 text-[10px] uppercase tracking-widest text-accent font-semibold">New members</h2>
          <ul class="p-3 flex flex-wrap gap-1.5">
            <li v-for="m in community.newMembers" :key="m.username">
              <NuxtLink
                :to="`/users/${encodeURIComponent(m.username)}`"
                class="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full border border-zinc-800 text-[11px] text-zinc-300 hover:text-accent hover:border-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              >
                <span class="w-5 h-5 rounded-full overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center">
                  <img v-if="m.has_avatar" :src="`/api/users/${encodeURIComponent(m.username)}/avatar`" class="w-full h-full object-cover" alt="" />
                  <span v-else class="text-[9px] font-bold uppercase text-zinc-400">{{ m.username.charAt(0) }}</span>
                </span>
                {{ m.username }}
              </NuxtLink>
            </li>
          </ul>
        </section>
      </div>
    </div>
    </template>
  </div>
</template>
