<script setup lang="ts">
import { roleBadgeClass } from '~/utils/role-styles'

const route = useRoute()
const username = computed(() => String(route.params.username))

const { data, error, refresh } = await useFetch<{
  account: {
    id: number; username: string; role: 'user'|'moderator'|'admin'|'owner'|'developer'
    bio: string | null; country: string | null; subdivision: string | null
    claimed_player: string | null; has_avatar: boolean
    pronouns: string | null; discord_handle: string | null; youtube_url: string | null
  }
  player: { name: string; total_points: number; skill_points: number; hardest: string | null; tier: string | null; country: string | null } | null
  completedLevels: any[]
  createdLevels: any[]
  verifiedLevels: any[]
  progressPosts: any[]
  follow: { target: string; followed: boolean; followerCount: number; isSelf: boolean; canFollow: boolean }
  favorite_level: { id: number; position: number; name: string; gddl_tier: string | null } | null
  favorite_level_note: string | null
}>(() => `/api/users/${encodeURIComponent(username.value)}`, { watch: [username] })

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)
const isOwnProfile = computed(() =>
  !!me.value && !!data.value && me.value.username.toLowerCase() === data.value.account.username.toLowerCase(),
)

useHead(() => ({
  title: data.value ? `${data.value.account.username} — All Levels List` : 'User — All Levels List',
}))

const avatarUrl = computed(() =>
  data.value?.account.has_avatar
    ? `/api/users/${encodeURIComponent(data.value.account.username)}/avatar`
    : null,
)

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

const youtubeHandle = computed(() => {
  const url = data.value?.account.youtube_url
  if (!url) return null
  const m = url.match(/youtube\.com\/@([^/?&#]+)/i)
  return m ? '@' + m[1] : null
})
</script>

<template>
  <div class="container-tight py-8 max-w-5xl">
    <div v-if="error" class="text-sm text-zinc-500">No such user.</div>
    <div v-else-if="data" class="grid lg:grid-cols-[240px_minmax(0,1fr)] gap-6">
      <aside class="lg:sticky lg:top-20 lg:self-start">
        <RecordCharts :completed="data.completedLevels" />
      </aside>
      <main class="space-y-6 min-w-0">
      <header class="flex items-start gap-4 flex-wrap">
        <div class="w-20 h-20 rounded-full bg-zinc-900 border border-zinc-800 overflow-hidden shrink-0">
          <img v-if="avatarUrl" :src="avatarUrl" alt="avatar" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full flex items-center justify-center text-2xl text-zinc-600 font-bold">
            {{ data.account.username.charAt(0).toUpperCase() }}
          </div>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline gap-2 flex-wrap">
            <h1 class="text-3xl font-semibold tracking-tight">{{ data.account.username }}</h1>
            <span v-if="data.account.role !== 'user'" class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded" :class="roleBadgeClass(data.account.role)">{{ data.account.role }}</span>
            <span v-if="data.account.pronouns" class="text-xs text-zinc-500">({{ data.account.pronouns }})</span>
          </div>
          <p v-if="data.account.claimed_player" class="text-xs text-zinc-500 mt-1">
            Claimed as <span class="text-zinc-300">{{ data.account.claimed_player }}</span>
          </p>
          <p v-if="data.account.country || data.account.subdivision" class="text-xs text-zinc-500 mt-0.5">
            <span v-if="data.account.subdivision">{{ data.account.subdivision }}, </span>
            <span v-if="data.account.country">{{ data.account.country }}</span>
          </p>
          <div v-if="data.account.discord_handle || data.account.youtube_url" class="flex items-center gap-3 mt-1.5">
            <span v-if="data.account.discord_handle" class="inline-flex items-center gap-1.5 text-xs text-zinc-400">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 127.14 96.36" fill="currentColor" class="w-3.5 h-3.5 shrink-0" aria-hidden="true">
                <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"/>
              </svg>
              {{ data.account.discord_handle }}
            </span>
            <a
              v-if="data.account.youtube_url"
              :href="data.account.youtube_url"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-red-400 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-3.5 h-3.5 shrink-0" aria-hidden="true">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              {{ youtubeHandle ?? 'YouTube' }}
            </a>
          </div>
          <div class="mt-2">
            <FollowButton
              :target="data.follow.target"
              :initial-followed="data.follow.followed"
              :can-follow="data.follow.canFollow"
              :is-self="data.follow.isSelf"
              :follower-count="data.follow.followerCount"
            />
          </div>
        </div>
      </header>

      <section v-if="data.account.bio" class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
        <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-2">Bio</h2>
        <p class="text-sm text-zinc-200 whitespace-pre-wrap">{{ data.account.bio }}</p>
      </section>

      <section v-if="data.favorite_level" class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
        <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-2">Favorite Level</h2>
        <NuxtLink
          :to="`/levels/${data.favorite_level.position}`"
          class="inline-flex items-baseline gap-2 group"
        >
          <span class="tabular-nums text-xs text-zinc-500">#{{ data.favorite_level.position }}</span>
          <span class="text-sm font-medium text-zinc-100 group-hover:text-accent transition-colors">{{ data.favorite_level.name }}</span>
          <span v-if="data.favorite_level.gddl_tier" class="text-xs text-zinc-500">{{ data.favorite_level.gddl_tier }}</span>
        </NuxtLink>
        <p v-if="data.favorite_level_note" class="text-sm text-zinc-300 mt-2 whitespace-pre-wrap">{{ data.favorite_level_note }}</p>
      </section>

      <section v-if="data.player" class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
        <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-3">Player stats</h2>
        <dl class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Total points</dt>
            <dd class="tabular-nums text-amber-300 text-base">{{ fmt(data.player.total_points) }}</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Skill points</dt>
            <dd class="tabular-nums text-zinc-100 text-base">{{ fmt(data.player.skill_points) }}</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Hardest</dt>
            <dd class="text-zinc-100 text-base truncate">{{ data.player.hardest ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Tier of hardest</dt>
            <dd class="text-zinc-100 text-base">{{ data.player.tier ?? '—' }}</dd>
          </div>
        </dl>
      </section>

      <ProgressPosts
        :posts="data.progressPosts"
        :can-post="isOwnProfile"
        @changed="refresh()"
      />

      <ProfileLevelLists
        :completed="data.completedLevels"
        :created="data.createdLevels"
        :verified="data.verifiedLevels"
        @refresh="refresh()"
      />

      <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
        <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-3">Comments</h2>
        <CommentSection kind="profile" :target-id="data.account.id" />
      </section>
      </main>
    </div>
  </div>
</template>
