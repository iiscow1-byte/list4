<script setup lang="ts">

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
const showThumbs = useShowThumbnails()

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

/** How each kind of activity reads in a sentence. */
const KINDS: Record<FeedItem['kind'], { verb: string }> = {
  record:   { verb: 'completed' },
  verify:   { verb: 'verified' },
  level:    { verb: 'added' },
  progress: { verb: 'made progress on' },
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
  <div class="container-wide py-8">
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="page-title">Community</h1>
        <p class="page-lead">
          What the list and its players have been up to.
          <template v-if="community">
            {{ community.totals.records.toLocaleString() }} records from
            {{ community.totals.members.toLocaleString() }} {{ community.totals.members === 1 ? 'member' : 'members' }} so far.
          </template>
        </p>
      </div>
      <!-- What people have done, and what they are saying. One switch, kept in
           the URL so a link can point at either half. -->
      <SegmentedControl
        v-model="tabModel"
        size="md"
        aria-label="Community section"
        :options="[
          { value: 'feed', label: 'Activity' },
          { value: 'forum', label: 'Forum' },
        ]"
      />
    </header>

    <CommunityForum v-if="tab === 'forum'" :level-id="levelFilter" />

    <div v-else class="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start">
      <div class="space-y-6 min-w-0">
        <!-- Find a player, on every list at once. -->
        <section>
          <label for="player-search" class="section-title block mb-2">Find a player</label>
          <div class="relative">
            <input
              id="player-search"
              v-model="playerQuery"
              type="search"
              placeholder="Members and record holders on the ALL, AREDL, Pointercrate and GDL"
              class="field field-md pl-9"
              @keydown.esc="clearPlayerSearch"
            />
            <svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" aria-hidden="true">
              <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.4 9.83l3.14 3.13a.75.75 0 1 0 1.06-1.06l-3.13-3.13A5.5 5.5 0 0 0 9 3.5zM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0z" clip-rule="evenodd" />
            </svg>
          </div>
          <p v-if="playerSearching && !playerHits.length" class="mt-2 text-sm text-zinc-500">Searching…</p>
          <p v-else-if="playerSearched && !playerHits.length" class="mt-2 text-sm text-zinc-500">
            No player matches “{{ playerQuery.trim() }}”.
          </p>
          <ul v-else-if="playerHits.length" class="mt-2 card divide-y divide-zinc-800/70 max-h-[22rem] overflow-y-auto">
            <li v-for="h in playerHits" :key="h.href">
              <NuxtLink :to="h.href" class="px-4 py-2.5 flex items-center gap-3 hover:bg-zinc-900 transition-colors">
                <span class="w-8 h-8 rounded-full overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center">
                  <img
                    v-if="h.has_avatar && h.username"
                    :src="`/api/users/${encodeURIComponent(h.username)}/avatar`"
                    class="w-full h-full object-cover"
                    alt=""
                  />
                  <span v-else class="text-xs font-semibold uppercase text-zinc-400">{{ h.name.charAt(0) }}</span>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-baseline gap-2 flex-wrap">
                    <span class="text-sm font-medium text-zinc-100 truncate">{{ h.name }}</span>
                    <span class="text-xs text-zinc-500">{{ h.sources.map((s) => SOURCE_LABELS[s]).join(' · ') }}</span>
                  </span>
                  <span v-if="h.hardest" class="block text-xs text-zinc-500 truncate">Hardest: {{ h.hardest }}</span>
                </span>
                <span v-if="h.rank != null" class="text-xs text-zinc-500 tabular-nums shrink-0">#{{ h.rank.toLocaleString() }}</span>
                <span v-if="h.points != null" class="text-xs text-zinc-300 tabular-nums shrink-0 w-16 text-right">{{ h.points.toLocaleString(undefined, { maximumFractionDigits: 1 }) }}</span>
              </NuxtLink>
            </li>
          </ul>
        </section>

        <!-- What the players you follow have done. -->
        <section>
          <div class="mb-2 flex items-center justify-between gap-3 flex-wrap">
            <h2 class="section-title">Following</h2>
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
          </div>

          <div v-if="!me" class="card px-4 py-10 text-sm text-zinc-400 text-center">
            <NuxtLink to="/login" class="link">Log in</NuxtLink>
            and follow players to see their completions here.
          </div>
          <div v-else-if="!feedLoaded" class="card px-4 py-10 text-sm text-zinc-500 text-center">
            Loading…
          </div>
          <div v-else-if="shownFeed.length === 0" class="card px-4 py-10 text-sm text-zinc-400 text-center">
            Nothing yet. Follow players from their profiles or the
            <NuxtLink to="/leaderboard" class="link">leaderboard</NuxtLink>.
          </div>
          <ul v-else class="card divide-y divide-zinc-800/70">
            <li
              v-for="(i, idx) in shownFeed"
              :key="`${i.kind}-${idx}-${i.at}`"
              class="px-4 py-3 flex items-start gap-3"
            >
              <NuxtLink :to="profileLink(i)" class="shrink-0" tabindex="-1" aria-hidden="true">
                <span class="w-8 h-8 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center">
                  <img
                    v-if="i.actor_has_avatar && i.actor_username"
                    :src="`/api/users/${encodeURIComponent(i.actor_username)}/avatar`"
                    class="w-full h-full object-cover"
                    alt=""
                  />
                  <span v-else class="text-xs font-semibold uppercase text-zinc-400">{{ i.actor.charAt(0) }}</span>
                </span>
              </NuxtLink>
              <div class="min-w-0 flex-1">
                <p class="text-sm leading-relaxed">
                  <NuxtLink :to="profileLink(i)" class="font-semibold text-zinc-100 hover:text-accent transition-colors">{{ i.actor }}</NuxtLink>
                  <!-- The spaces are inside the interpolation on purpose: a
                       whitespace-only text node at the edge of an element is
                       dropped by the template compiler. -->
                  <span class="text-zinc-400">{{ ` ${KINDS[i.kind].verb} ` }}</span>
                  <NuxtLink
                    v-if="i.level_position"
                    :to="`/levels/${i.level_position}`"
                    class="font-medium text-zinc-100 hover:text-accent transition-colors"
                  >{{ i.level_name }}</NuxtLink>
                  <span v-else class="font-medium text-zinc-100">{{ i.level_name }}</span>
                  <span v-if="i.kind === 'record' && i.percent != null && i.percent < 100" class="text-zinc-400 tabular-nums">{{ ` (${i.percent}%)` }}</span>
                  <span v-if="i.kind === 'progress'" class="text-amber-300 tabular-nums">{{ ` ${i.start_percent}% to ${i.end_percent}%` }}</span>
                </p>
                <p class="mt-0.5 text-xs text-zinc-500 tabular-nums">
                  {{ relative(i.at) }}
                  <template v-if="i.video_url">
                    ·
                    <a :href="i.video_url" target="_blank" rel="noopener" class="hover:text-accent transition-colors">Video</a>
                  </template>
                </p>
              </div>
            </li>
          </ul>
        </section>
      </div>

      <aside class="space-y-6 min-w-0">
        <section v-if="community?.newLevels.length">
          <div class="mb-2 flex items-baseline justify-between gap-2">
            <h2 class="section-title">Newly added</h2>
            <NuxtLink to="/changelog" class="text-xs text-zinc-500 hover:text-accent transition-colors">Changelog</NuxtLink>
          </div>
          <ul class="card p-1.5 space-y-1">
            <li v-for="l in community.newLevels" :key="l.position">
              <LevelRow
                :to="`/levels/${l.position}`"
                :rank="`#${l.position}`"
                :name="l.name"
                :tier="l.gddl_tier"
                :gd-id="l.gd_id"
                :thumbs="showThumbs"
              >
                <template #trailing>
                  <span class="text-xs text-zinc-400 tabular-nums">{{ relative(l.changed_at) }}</span>
                </template>
              </LevelRow>
            </li>
          </ul>
        </section>

        <section v-if="community?.recentRecords.length">
          <h2 class="section-title mb-2">Latest records</h2>
          <ul class="card divide-y divide-zinc-800/70">
            <li v-for="(r, i) in community.recentRecords" :key="i" class="px-4 py-2 text-sm flex items-center gap-2">
              <NuxtLink
                :to="r.player_username ? `/users/${encodeURIComponent(r.player_username)}` : `/users/by-player/${encodeURIComponent(r.player_name)}`"
                class="font-medium text-zinc-100 hover:text-accent transition-colors truncate max-w-[8rem]"
              >{{ r.player_name }}</NuxtLink>
              <NuxtLink :to="`/levels/${r.position}`" class="truncate flex-1 text-zinc-400 hover:text-accent transition-colors">{{ r.level_name }}</NuxtLink>
              <a
                v-if="r.video"
                :href="r.video"
                target="_blank"
                rel="noopener"
                class="text-xs tabular-nums shrink-0 hover:underline"
                :class="r.percent >= 100 ? 'text-emerald-300' : 'text-amber-300'"
                :title="`Watch the ${r.percent}% video`"
              >{{ r.percent }}%</a>
              <span v-else class="text-xs tabular-nums shrink-0" :class="r.percent >= 100 ? 'text-emerald-300' : 'text-amber-300'">{{ r.percent }}%</span>
            </li>
          </ul>
        </section>

        <section v-if="community?.newLists.length">
          <div class="mb-2 flex items-baseline justify-between gap-2">
            <h2 class="section-title">New custom lists</h2>
            <NuxtLink to="/lists" class="text-xs text-zinc-500 hover:text-accent transition-colors">All lists</NuxtLink>
          </div>
          <ul class="card divide-y divide-zinc-800/70">
            <li v-for="l in community.newLists" :key="l.public_id">
              <NuxtLink :to="`/lists/${l.public_id}`" class="px-4 py-2 text-sm flex items-center gap-3 hover:bg-zinc-900 transition-colors">
                <img
                  v-if="l.icon_url"
                  :src="l.icon_url"
                  alt=""
                  referrerpolicy="no-referrer"
                  class="w-7 h-7 rounded-md object-cover shrink-0 bg-zinc-900"
                />
                <span
                  v-else
                  class="w-7 h-7 rounded-md bg-zinc-800 flex items-center justify-center text-[11px] font-bold shrink-0"
                  :style="l.accent_color ? { color: l.accent_color } : undefined"
                  :class="l.accent_color ? '' : 'text-accent'"
                  aria-hidden="true"
                >{{ l.title.slice(0, 2).toUpperCase() }}</span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-zinc-100">{{ l.title }}</span>
                  <span class="block truncate text-xs text-zinc-500">
                    <template v-if="l.owner_username">{{ l.owner_username }} · </template>{{ l.item_count }} {{ l.item_count === 1 ? 'level' : 'levels' }}
                  </span>
                </span>
                <span class="text-xs text-zinc-500 tabular-nums shrink-0" :title="`${l.likes} likes`">★ {{ l.likes }}</span>
              </NuxtLink>
            </li>
          </ul>
        </section>

        <section v-if="community?.newMembers.length">
          <h2 class="section-title mb-2">New members</h2>
          <ul class="flex flex-wrap gap-1.5">
            <li v-for="m in community.newMembers" :key="m.username">
              <NuxtLink
                :to="`/users/${encodeURIComponent(m.username)}`"
                class="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-zinc-900 text-xs text-zinc-300 hover:text-zinc-50 hover:bg-zinc-800 transition-colors"
              >
                <span class="w-5 h-5 rounded-full overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center">
                  <img v-if="m.has_avatar" :src="`/api/users/${encodeURIComponent(m.username)}/avatar`" class="w-full h-full object-cover" alt="" />
                  <span v-else class="text-[10px] font-semibold uppercase text-zinc-400">{{ m.username.charAt(0) }}</span>
                </span>
                {{ m.username }}
              </NuxtLink>
            </li>
          </ul>
        </section>
      </aside>
    </div>
  </div>
</template>
