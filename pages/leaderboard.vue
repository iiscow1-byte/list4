<script setup lang="ts">
type LeaderRow = {
  rank: number
  player: string
  country: string | null
  points: number
  skill_points: number
  hardest: string | null
  tier: string | null
}

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

const tab = ref<'all' | 'followed'>('all')
const search = ref('')
const debounced = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { debounced.value = v.trim() }, 200)
})

const query = computed(() => ({
  limit: 200,
  q: debounced.value || undefined,
  followed: tab.value === 'followed' ? '1' : undefined,
}))

const { data, pending, refresh } = await useFetch<{ total: number; items: LeaderRow[] }>(
  '/api/leaderboard',
  { query, watch: [query] },
)

// If a user logs in/out while on this page, the followed tab needs new data.
watch(me, () => { if (tab.value === 'followed') refresh() })

// Activity feed only loads on the followed tab.
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
</script>

<template>
  <div class="container-tight py-8">
    <div class="mb-6">
      <h1 class="text-3xl font-semibold tracking-tight">Leaderboard</h1>
      <p class="text-zinc-400 mt-1 text-sm">Players ranked by total points across the All Levels List.</p>
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div class="inline-flex rounded-md border border-zinc-800 bg-zinc-950 overflow-hidden">
        <button
          type="button"
          class="px-3 py-1.5 text-sm font-medium transition-colors"
          :class="tab === 'all' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'"
          @click="tab = 'all'"
        >All</button>
        <button
          type="button"
          class="px-3 py-1.5 text-sm font-medium transition-colors border-l border-zinc-800"
          :class="tab === 'followed' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'"
          @click="tab = 'followed'"
        >Followed</button>
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
          <li v-for="p in data?.items ?? []" :key="p.player">
            <NuxtLink
              :to="`/users/by-player/${encodeURIComponent(p.player)}`"
              class="flex items-center gap-4 px-4 py-3 hover:bg-zinc-900/60 transition-colors group"
            >
              <span class="rank-badge" :class="rankClass(p.rank)">#{{ p.rank }}</span>
              <div class="flex-1 min-w-0">
                <div class="font-medium truncate flex items-center gap-2 group-hover:text-accent transition-colors">
                  <span>{{ p.player }}</span>
                </div>
                <div class="text-xs text-zinc-500 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span v-if="p.skill_points" class="tabular-nums">Skill: {{ fmt(p.skill_points) }}</span>
                  <span v-if="p.hardest">Hardest: {{ p.hardest }}</span>
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
