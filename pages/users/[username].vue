<script setup lang="ts">
import { roleBadgeClass } from '~/utils/role-styles'

const route = useRoute()
const username = computed(() => String(route.params.username))

const { data, error, refresh } = await useFetch<{
  account: {
    id: number; username: string; role: 'user'|'moderator'|'admin'|'owner'|'developer'
    bio: string | null; country: string | null; subdivision: string | null
    claimed_player: string | null; has_avatar: boolean
  }
  player: { name: string; total_points: number; skill_points: number; hardest: string | null; tier: string | null; country: string | null } | null
  completedLevels: any[]
  createdLevels: any[]
  verifiedLevels: any[]
  progressPosts: any[]
  follow: { target: string; followed: boolean; followerCount: number; isSelf: boolean; canFollow: boolean }
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
          </div>
          <p v-if="data.account.claimed_player" class="text-xs text-zinc-500 mt-1">
            Claimed as <span class="text-zinc-300">{{ data.account.claimed_player }}</span>
          </p>
          <p v-if="data.account.country || data.account.subdivision" class="text-xs text-zinc-500 mt-0.5">
            <span v-if="data.account.subdivision">{{ data.account.subdivision }}, </span>
            <span v-if="data.account.country">{{ data.account.country }}</span>
          </p>
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
      />

      <section class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
        <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-3">Comments</h2>
        <CommentSection kind="profile" :target-id="data.account.id" />
      </section>
      </main>
    </div>
  </div>
</template>
