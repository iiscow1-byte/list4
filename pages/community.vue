<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

/** The social home: what your follows are doing, plus site-wide activity. */
type Community = {
  newLevels: { position: number; sheet_placement: number | null; name: string; gd_id: number | null; gddl_tier: string | null; changed_at: string }[]
  recentRecords: { player_name: string; percent: number; video: string | null; position: number; sheet_placement: number | null; level_name: string; gd_id: number | null }[]
  newLists: { public_id: string; title: string; likes: number; owner_username: string | null; item_count: number }[]
  newMembers: { username: string; created_at: string; claimed_player: string | null }[]
  totals: { levels: number; members: number; public_lists: number; records: number }
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

const { data: community } = await useFetch<Community>('/api/community')

// Personalised half — only meaningful when logged in.
const feed = ref<FeedItem[]>([])
const feedLoaded = ref(false)
async function loadFeed() {
  if (!me.value) { feed.value = []; feedLoaded.value = true; return }
  try {
    const res = await $fetch<{ items: FeedItem[] }>('/api/feed/followed', { query: { limit: 25 } })
    feed.value = res.items
  } catch { feed.value = [] } finally { feedLoaded.value = true }
}
watch(me, loadFeed, { immediate: true })

function relative(at: string): string {
  const iso = at.includes('T') ? at : at.replace(' ', 'T') + 'Z'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const secs = Math.max(0, (Date.now() - t) / 1000)
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  const days = Math.floor(secs / 86400)
  if (days < 30) return `${days}d ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function feedLine(i: FeedItem): string {
  if (i.kind === 'record') return `completed ${i.level_name}${i.percent != null && i.percent < 100 ? ` (${i.percent}%)` : ''}`
  if (i.kind === 'verify') return `verified ${i.level_name}`
  if (i.kind === 'level') return `had ${i.level_name} added to the list`
  return `progressed on ${i.level_name} — ${i.start_percent}% → ${i.end_percent}%`
}

useHead({ title: 'Community — All Levels List' })
</script>

<template>
  <div class="container-wide py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">Community</h1>
        <p class="text-sm text-zinc-500 mt-1">What the list and its players have been up to.</p>
      </div>
      <div v-if="community" class="flex flex-wrap gap-4 text-[11px] text-zinc-500 tabular-nums">
        <span><span class="text-zinc-200 font-semibold">{{ community.totals.levels.toLocaleString() }}</span> levels</span>
        <span><span class="text-zinc-200 font-semibold">{{ community.totals.records.toLocaleString() }}</span> records</span>
        <span><span class="text-zinc-200 font-semibold">{{ community.totals.members.toLocaleString() }}</span> members</span>
        <span><span class="text-zinc-200 font-semibold">{{ community.totals.public_lists.toLocaleString() }}</span> public lists</span>
      </div>
    </header>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start">
      <!-- Following feed -->
      <section class="card overflow-hidden">
        <div class="px-4 py-3 border-b border-zinc-800/80 flex items-center justify-between gap-2">
          <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Following</h2>
          <NuxtLink v-if="me" to="/leaderboard" class="text-[11px] text-zinc-500 hover:text-accent transition-colors">Find players →</NuxtLink>
        </div>

        <p v-if="!me" class="px-4 py-10 text-sm text-zinc-500 text-center">
          <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink>
          and follow players to see their completions here.
        </p>
        <p v-else-if="feedLoaded && feed.length === 0" class="px-4 py-10 text-sm text-zinc-500 text-center">
          Nothing yet — follow some players from the
          <NuxtLink to="/leaderboard" class="text-accent hover:underline">leaderboard</NuxtLink>.
        </p>
        <ul v-else class="divide-y divide-zinc-900/60">
          <li v-for="(i, idx) in feed" :key="idx" class="px-4 py-2.5 text-sm flex items-baseline gap-2 hover:bg-zinc-900/40 transition-colors">
            <NuxtLink :to="`/users/by-player/${encodeURIComponent(i.actor)}`" class="font-medium text-zinc-200 hover:text-accent transition-colors shrink-0">
              {{ i.actor }}
            </NuxtLink>
            <span class="text-zinc-400 truncate flex-1">
              <template v-if="i.level_position">
                {{ feedLine(i).split(i.level_name)[0] }}<NuxtLink :to="`/levels/${i.level_position}`" class="text-zinc-300 hover:text-accent transition-colors">{{ i.level_name }}</NuxtLink>{{ feedLine(i).split(i.level_name)[1] }}
              </template>
              <template v-else>{{ feedLine(i) }}</template>
            </span>
            <a v-if="i.video_url" :href="i.video_url" target="_blank" rel="noopener" class="text-[11px] text-zinc-600 hover:text-accent shrink-0">video ↗</a>
            <span class="text-[11px] text-zinc-600 shrink-0">{{ relative(i.at) }}</span>
          </li>
        </ul>
      </section>

      <div class="space-y-4">
        <!-- Newly ranked -->
        <section v-if="community?.newLevels.length" class="card overflow-hidden">
          <h2 class="px-4 py-3 border-b border-zinc-800/80 text-[10px] uppercase tracking-widest text-accent font-semibold">Newly ranked</h2>
          <ul class="divide-y divide-zinc-900/60">
            <li v-for="l in community.newLevels" :key="l.position" class="relative overflow-hidden group">
              <NuxtLink :to="`/levels/${l.position}`" class="relative flex items-center gap-2 px-3 py-2 text-sm">
                <LevelThumbBg :gd-id="l.gd_id" res="small" img-class="opacity-20 group-hover:opacity-40" overlay-class="bg-gradient-to-r from-zinc-950/92 to-zinc-950/50" />
                <span
                  class="relative shrink-0 text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold"
                  :style="{ backgroundColor: tierColor(l.gddl_tier), color: textOn(tierColor(l.gddl_tier)) }"
                >#{{ l.sheet_placement ?? l.position }}</span>
                <span class="relative truncate flex-1 text-zinc-200">{{ l.name }}</span>
                <span class="relative text-[11px] text-zinc-600 shrink-0">{{ relative(l.changed_at) }}</span>
              </NuxtLink>
            </li>
          </ul>
        </section>

        <!-- Latest records -->
        <section v-if="community?.recentRecords.length" class="card overflow-hidden">
          <h2 class="px-4 py-3 border-b border-zinc-800/80 text-[10px] uppercase tracking-widest text-accent font-semibold">Latest records</h2>
          <ul class="divide-y divide-zinc-900/60">
            <li v-for="(r, i) in community.recentRecords" :key="i" class="px-3 py-2 text-sm flex items-center gap-2">
              <NuxtLink :to="`/users/by-player/${encodeURIComponent(r.player_name)}`" class="font-medium text-zinc-200 hover:text-accent transition-colors truncate max-w-[8rem]">
                {{ r.player_name }}
              </NuxtLink>
              <NuxtLink :to="`/levels/${r.position}`" class="truncate flex-1 text-zinc-400 hover:text-accent transition-colors">{{ r.level_name }}</NuxtLink>
              <span class="text-[11px] tabular-nums text-amber-300 shrink-0">{{ r.percent }}%</span>
            </li>
          </ul>
        </section>

        <!-- Fresh lists -->
        <section v-if="community?.newLists.length" class="card overflow-hidden">
          <div class="px-4 py-3 border-b border-zinc-800/80 flex items-center justify-between gap-2">
            <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Fresh lists</h2>
            <NuxtLink to="/lists" class="text-[11px] text-zinc-500 hover:text-accent transition-colors">All →</NuxtLink>
          </div>
          <ul class="divide-y divide-zinc-900/60">
            <li v-for="l in community.newLists" :key="l.public_id" class="px-3 py-2 text-sm flex items-center gap-2">
              <NuxtLink :to="`/lists/${l.public_id}`" class="truncate flex-1 text-zinc-200 hover:text-accent transition-colors">{{ l.title }}</NuxtLink>
              <span v-if="l.owner_username" class="text-[11px] text-zinc-600 shrink-0 truncate max-w-[6rem]">{{ l.owner_username }}</span>
              <span class="text-[11px] text-zinc-600 tabular-nums shrink-0">★ {{ l.likes }}</span>
            </li>
          </ul>
        </section>

        <!-- New members -->
        <section v-if="community?.newMembers.length" class="card overflow-hidden">
          <h2 class="px-4 py-3 border-b border-zinc-800/80 text-[10px] uppercase tracking-widest text-accent font-semibold">New members</h2>
          <ul class="p-3 flex flex-wrap gap-1.5">
            <li v-for="m in community.newMembers" :key="m.username">
              <NuxtLink
                :to="`/users/${encodeURIComponent(m.username)}`"
                class="inline-block px-2 py-1 rounded-lg border border-zinc-800 text-[11px] text-zinc-300 hover:text-accent hover:border-accent/40 transition-colors"
              >{{ m.username }}</NuxtLink>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>
