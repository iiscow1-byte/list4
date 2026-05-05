<script setup lang="ts">
import { roleBadgeClass } from '~/utils/role-styles'

type AllRow = {
  rank: number
  source?: undefined
  player: string
  country: string | null
  points: number
  skill_points: number
  hardest: string | null
  tier: string | null
  badge: string | null
}
type GlobalRow = {
  rank: number
  source: 'aredl' | 'pointercrate' | 'alllist'
  id: string | number
  player: string
  country: string | null
  points: number
  extras: { extremes?: number; pack_points?: number }
  hardest: string | null
  claimed_account: { username: string } | null
}
type Row = AllRow | GlobalRow

type FeedItem = {
  kind: 'record' | 'verify' | 'level' | 'progress'
  at: string
  actor: string
  level_position: number | null
  level_name: string
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
// "Global" hits /api/leaderboard/global which merges AREDL, PC, and ALL.
const url = computed(() => tab.value === 'global' ? '/api/leaderboard/global' : '/api/leaderboard')
// Sub-filter on the global tab: 'all' merges all sources, or pick one.
const globalSource = ref<'all' | 'aredl' | 'pointercrate' | 'alllist'>('all')
const query = computed(() => {
  if (tab.value === 'global') {
    return { limit: 200, q: debounced.value || undefined, source: globalSource.value }
  }
  return {
    limit: 200,
    q: debounced.value || undefined,
    followed: tab.value === 'followed' ? '1' : undefined,
  }
})

const { data, pending, refresh } = await useFetch<{ total: number; items: Row[] }>(
  url,
  { query, watch: [url, query] },
)

watch(me, () => { if (tab.value === 'followed') refresh() })
watch(tab, () => { if (tab.value !== 'global') globalSource.value = 'all' })

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

function rankClass(rank: number) {
  if (rank === 1) return 'bg-amber-400 text-amber-950'
  if (rank === 2) return 'bg-zinc-300 text-zinc-900'
  if (rank === 3) return 'bg-orange-400/80 text-orange-950'
  if (rank <= 10) return 'bg-zinc-300/15 text-zinc-200'
  return 'bg-zinc-800 text-zinc-400'
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

// Polymorphic row link: AREDL rows go to the Aredl player profile page (keyed
// by UUID), everything else goes to the existing by-player route.
function rowLink(p: Row): string {
  if (p.source === 'aredl') return `/aredl-players/${p.id}`
  if (p.source === 'pointercrate') return `/pointercrate-players/${p.id}`
  return `/users/by-player/${encodeURIComponent(p.player)}`
}
function rowKey(p: Row, i: number): string {
  if (p.source === 'aredl' || p.source === 'pointercrate') return `${p.source}-${p.id}`
  return `all-${p.player}-${i}`
}
function sourceLabel(p: Row): string | null {
  if (p.source === 'aredl') return 'AREDL'
  if (p.source === 'pointercrate') return 'PC'
  if (p.source === 'alllist') return 'ALL'
  return null
}
</script>

<template>
  <div class="container-tight py-8">
    <div class="mb-6">
      <h1 class="text-3xl font-semibold tracking-tight">Leaderboard</h1>
      <p class="text-zinc-400 mt-1 text-sm">
        <template v-if="tab === 'global'">
          <template v-if="globalSource === 'all'">Rankings from AREDL, Pointercrate, and the ALL list — each shown with their source-native rank.</template>
          <template v-else-if="globalSource === 'aredl'">AREDL players ranked by their AREDL standing.</template>
          <template v-else-if="globalSource === 'pointercrate'">Pointercrate players ranked by their Pointercrate standing.</template>
          <template v-else>ALL list members ranked by their ALL list points.</template>
        </template>
        <template v-else-if="tab === 'members'">
          ALL list members ranked by total points.
        </template>
        <template v-else>
          Players ranked by total points across the All Levels List.
        </template>
      </p>
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div class="inline-flex rounded-md border border-zinc-800 bg-zinc-950 overflow-hidden">
        <button
          type="button"
          class="px-3 py-1.5 text-sm font-medium transition-colors"
          :class="tab === 'global' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'"
          @click="tab = 'global'"
        >Global</button>
        <button
          type="button"
          class="px-3 py-1.5 text-sm font-medium transition-colors border-l border-zinc-800"
          :class="tab === 'members' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'"
          @click="tab = 'members'"
        >Members</button>
        <button
          type="button"
          class="px-3 py-1.5 text-sm font-medium transition-colors border-l border-zinc-800"
          :class="tab === 'followed' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'"
          @click="tab = 'followed'"
        >Followed</button>
      </div>
      <div
        v-if="tab === 'global'"
        class="inline-flex rounded-md border border-zinc-800 bg-zinc-950 overflow-hidden"
      >
        <button
          v-for="opt in (['all','aredl','pointercrate','alllist'] as const)"
          :key="opt"
          type="button"
          class="px-3 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors border-l first:border-l-0 border-zinc-800"
          :class="globalSource === opt ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
          @click="globalSource = opt"
        >{{ opt === 'all' ? 'All Lists' : opt === 'aredl' ? 'AREDL' : opt === 'pointercrate' ? 'PC' : 'ALL' }}</button>
      </div>
      <div class="relative flex-1 min-w-[200px] max-w-md">
        <input
          v-model="search"
          type="search"
          placeholder="Search players or accounts…"
          class="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
        />
      </div>
    </div>

    <div v-if="tab === 'followed' && !me" class="text-sm text-zinc-500 rounded-md border border-zinc-900 bg-zinc-950 px-4 py-8 text-center">
      <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink> to follow other profiles and see them here.
    </div>

    <div v-else class="grid gap-6" :class="tab === 'followed' ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : ''">
      <div>
        <div v-if="pending" class="text-sm text-zinc-500">loading…</div>
        <ol v-else class="divide-y divide-zinc-900 rounded-md border border-zinc-900 bg-zinc-950 overflow-hidden">
          <li v-for="(p, i) in data?.items ?? []" :key="rowKey(p, i)">
            <NuxtLink
              :to="rowLink(p)"
              class="flex items-center gap-4 px-4 py-3 hover:bg-zinc-900/60 transition-colors group"
            >
              <span class="rank-badge" :class="rankClass(p.rank)">#{{ p.rank }}</span>
              <div class="flex-1 min-w-0">
                <div class="font-medium truncate flex items-center gap-2 group-hover:text-accent transition-colors">
                  <span>{{ p.player }}</span>
                  <!-- Role badge intentionally excluded from external-list rows
                       (Aredl, Pointercrate): they are list mirrors, not site
                       identities, so the site-role chip would be misleading. -->
                  <template v-if="!sourceLabel(p)">
                    <span
                      v-if="(p as AllRow).badge"
                      class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0"
                      :class="roleBadgeClass((p as AllRow).badge!)"
                    >{{ (p as AllRow).badge }}</span>
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
                <div class="text-xs text-zinc-500 flex flex-wrap gap-x-3 gap-y-0.5">
                  <template v-if="!sourceLabel(p)">
                    <span v-if="(p as AllRow).skill_points" class="tabular-nums">Skill: {{ fmt((p as AllRow).skill_points) }}</span>
                    <span v-if="p.hardest">Hardest: {{ p.hardest }}</span>
                  </template>
                  <template v-else>
                    <span v-if="p.country" class="uppercase tabular-nums">{{ p.country }}</span>
                    <span v-if="(p as GlobalRow).extras?.extremes" class="tabular-nums">{{ (p as GlobalRow).extras.extremes }} extremes</span>
                    <span v-if="p.hardest">Hardest: {{ p.hardest }}</span>
                  </template>
                </div>
              </div>
              <span
                class="tabular-nums text-sm shrink-0"
                :class="p.points > 0 ? 'text-amber-300' : 'text-zinc-600'"
              >{{ fmt(p.points) }} pts</span>
            </NuxtLink>
          </li>
          <li v-if="!pending && (data?.items?.length ?? 0) === 0" class="px-4 py-12 text-center text-sm text-zinc-500">
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
      </div>

      <aside v-if="tab === 'followed'" class="space-y-3">
        <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium px-1">Recent activity</h2>
        <div v-if="feedLoading" class="text-xs text-zinc-600 px-1">loading…</div>
        <ol v-else-if="feed.length" class="divide-y divide-zinc-900 rounded-md border border-zinc-900 bg-zinc-950 overflow-hidden">
          <li v-for="(item, idx) in feed" :key="`${item.kind}-${idx}-${item.at}`" class="px-3 py-2.5 text-xs">
            <div class="flex items-baseline gap-2">
              <NuxtLink
                :to="`/users/by-player/${encodeURIComponent(item.actor)}`"
                class="font-medium text-zinc-200 hover:text-accent transition-colors truncate"
              >{{ item.actor }}</NuxtLink>
              <span class="text-zinc-600 tabular-nums shrink-0">{{ relative(item.at) }}</span>
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
                <span class="text-zinc-500"> {{ item.start_percent }}% → {{ item.end_percent }}%</span>
                <a v-if="item.video_url" :href="item.video_url" target="_blank" rel="noopener" class="ml-1 text-accent hover:underline">[video]</a>
              </template>
            </div>
          </li>
        </ol>
        <div v-else class="text-xs text-zinc-600 px-1 py-3 rounded-md border border-zinc-900 bg-zinc-950 text-center">
          No recent activity from people you follow.
        </div>
      </aside>
    </div>
  </div>
</template>
