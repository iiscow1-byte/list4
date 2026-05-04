<script setup lang="ts">
const route = useRoute()
const uuid = computed(() => String(route.params.uuid))

type AredlLevelLink = { id: string; level_id: number; name: string; position: number; legacy: boolean }
type Profile = {
  uuid: string
  username: string
  global_name: string
  description: string | null
  country: number | null
  total_points: number
  pack_points: number
  extremes: number
  rank: number | null
  hardest: { uuid: string; name: string } | null
  claimed_account: { username: string; role: string | null } | null
  records: Array<{
    video_url: string | null
    is_verification: number | null
    mobile: number | null
    achieved_at: string | null
    level_gd_id: number | null
    list_position: number | null
    level_name: string | null
    aredl_only_position: number | null
    aredl_only_name: string | null
  }>
  created: AredlLevelLink[]
  published: AredlLevelLink[]
}

const { data: profile, pending, error } = await useFetch<Profile>(
  () => `/api/aredl-players/${uuid.value}`,
  { watch: [uuid] },
)

useHead(() => ({
  title: profile.value ? `${profile.value.global_name} — Global Leaderboard` : 'Player — Global Leaderboard',
}))

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}
</script>

<template>
  <div class="container-tight py-8">
    <div v-if="error" class="text-center text-zinc-500 py-12">
      <p>Player not found.</p>
      <NuxtLink to="/global" class="text-accent hover:underline text-sm">Back to global leaderboard</NuxtLink>
    </div>
    <div v-else-if="pending" class="text-sm text-zinc-500">loading…</div>
    <div v-else-if="profile" class="space-y-8">
      <header>
        <div class="flex items-baseline gap-3 flex-wrap">
          <h1 class="text-3xl font-semibold tracking-tight">{{ profile.global_name }}</h1>
          <span class="text-xs uppercase tracking-widest px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">AREDL</span>
          <span
            v-if="profile.claimed_account"
            class="text-xs uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300"
            :title="`Claimed by @${profile.claimed_account.username}`"
          >Claimed by @{{ profile.claimed_account.username }}</span>
        </div>
        <p v-if="profile.description" class="mt-3 text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed max-w-prose">
          {{ profile.description }}
        </p>
        <div class="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-400">
          <span v-if="profile.rank">Global rank: <span class="text-zinc-200 tabular-nums">#{{ profile.rank }}</span></span>
          <span>Points: <span class="text-amber-300 tabular-nums">{{ fmt(profile.total_points) }}</span></span>
          <span v-if="profile.extremes">Extremes: <span class="text-zinc-200 tabular-nums">{{ profile.extremes }}</span></span>
          <span v-if="profile.hardest">Hardest: <span class="text-zinc-200">{{ profile.hardest.name }}</span></span>
          <span v-if="profile.country">Country: <span class="text-zinc-200 tabular-nums">{{ profile.country }}</span></span>
        </div>
      </header>

      <section v-if="profile.records.length">
        <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-2">Records ({{ profile.records.length }})</h2>
        <ul class="divide-y divide-zinc-900 rounded-md border border-zinc-900 bg-zinc-950 overflow-hidden">
          <li v-for="(r, idx) in profile.records.slice(0, 50)" :key="idx" class="px-3 py-2 text-sm">
            <NuxtLink
              v-if="r.list_position"
              :to="`/levels/${r.list_position}`"
              class="text-zinc-200 hover:text-accent"
            >#{{ r.list_position }} {{ r.level_name }}</NuxtLink>
            <span v-else-if="r.aredl_only_name" class="text-zinc-300">
              {{ r.aredl_only_name }} <span class="text-zinc-500 text-[11px]">(Aredl-only)</span>
            </span>
            <span v-else class="text-zinc-500">Level #{{ r.level_gd_id }}</span>
            <span v-if="r.is_verification" class="ml-2 text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300">Verifier</span>
            <a v-if="r.video_url" :href="r.video_url" target="_blank" rel="noopener" class="ml-2 text-accent hover:underline text-xs">video ↗</a>
          </li>
          <li v-if="profile.records.length > 50" class="px-3 py-2 text-xs text-zinc-600">
            … {{ profile.records.length - 50 }} more
          </li>
        </ul>
      </section>

      <section v-if="profile.created.length">
        <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-2">Created ({{ profile.created.length }})</h2>
        <ul class="divide-y divide-zinc-900 rounded-md border border-zinc-900 bg-zinc-950 overflow-hidden text-sm">
          <li v-for="lvl in profile.created" :key="lvl.id" class="px-3 py-2 text-zinc-300">
            <span class="tabular-nums text-zinc-500 mr-2">#{{ lvl.position }}</span>{{ lvl.name }}
          </li>
        </ul>
      </section>

      <section v-if="profile.published.length">
        <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-2">Published ({{ profile.published.length }})</h2>
        <ul class="divide-y divide-zinc-900 rounded-md border border-zinc-900 bg-zinc-950 overflow-hidden text-sm">
          <li v-for="lvl in profile.published" :key="lvl.id" class="px-3 py-2 text-zinc-300">
            <span class="tabular-nums text-zinc-500 mr-2">#{{ lvl.position }}</span>{{ lvl.name }}
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
