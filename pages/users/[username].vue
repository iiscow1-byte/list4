<script setup lang="ts">
import { listPercent } from '~/utils/list-progress'
const route = useRoute()
const username = computed(() => String(route.params.username))

type ShowcaseLevel = {
  id?: number
  level_id?: number
  record_id?: number
  position: number
  sheet_placement: number | null
  name: string
  gd_id: number | null
  gddl_tier: string | null
  creator?: string | null
  points?: number | null
  percent?: number | null
  video?: string | null
  hz?: number | null
  verification_url?: string | null
}

const { data, error, refresh } = await useFetch<{
  account: {
    id: number; username: string; role: 'user'|'moderator'|'admin'|'owner'|'developer'
    bio: string | null; country: string | null; subdivision: string | null
    claimed_player: string | null; has_avatar: boolean; created_at: string
    pronouns: string | null; discord_handle: string | null; youtube_url: string | null
    twitch_url: string | null; twitter_url: string | null; bluesky_url: string | null
    gd_username: string | null
    name_emoji?: string | null; name_badge?: string | null; name_badge_color?: string | null
  }
  player: { name: string; total_points: number; skill_points: number; hardest: string | null; tier: string | null; country: string | null } | null
  completedLevels: any[]
  createdLevels: any[]
  verifiedLevels: any[]
  progressPosts: any[]
  follow: {
    target: string; followed: boolean; followerCount: number; followingCount: number
    isSelf: boolean; canFollow: boolean
    followers: { username: string; has_avatar: number }[]
    following: { name: string; username: string | null }[]
    /** Whether this profile follows the viewer, and who you both follow. */
    followsYou: boolean
    mutuals: number
  }
  profileViews: number
  totalLevels: number
  publicLists: { public_id: string; title: string; likes: number; is_public: number; item_count: number }[]
  favorite_level: ShowcaseLevel | null
  favorite_level_note: string | null
  hardest_completion: ShowcaseLevel | null
  banner_choice: 'hardest' | 'favorite' | 'level' | 'none' | 'custom'
  banner_image_url?: string | null
  name_emoji?: string | null
  name_badge?: string | null
  name_badge_color?: string | null
  banner_level: ShowcaseLevel | null
}>(() => `/api/users/${encodeURIComponent(username.value)}`, { watch: [username] })

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)
const isOwnProfile = computed(() =>
  !!me.value && !!data.value && me.value.username.toLowerCase() === data.value.account.username.toLowerCase(),
)

useHead(() => ({
  title: data.value ? `${data.value.account.username} — All Levels List` : 'User — All Levels List',
}))

/**
 * The level painted behind the profile header.
 *
 * `banner_choice` decides which pick wins. 'none' is honoured exactly — that's
 * someone asking for a plain header — and so is 'level', which is a backdrop
 * chosen for its own sake and shouldn't quietly fall back to a showcase pick.
 * The default 'hardest' does fall back to the favourite, since every account
 * starts on that default and most set a favourite long before they pin a
 * completion.
 */
/**
 * A staff-set cover image, when the account has chosen one. Checked before the
 * level picks below because it is a deliberate override of them, not a
 * fallback: `banner_choice` says which one paints the header.
 */
const bannerImage = computed<string | null>(() => {
  const d = data.value?.account
  if (!d || d.banner_choice !== 'custom') return null
  return d.banner_image_url || null
})

const bannerLevel = computed<ShowcaseLevel | null>(() => {
  const d = data.value
  if (!d) return null
  if (d.banner_choice === 'none') return null
  if (d.banner_choice === 'level') return d.banner_level
  if (d.banner_choice === 'favorite') return d.favorite_level
  return d.hardest_completion ?? d.favorite_level
})

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

const joined = computed(() => {
  const at = data.value?.account.created_at
  if (!at) return null
  const iso = at.includes('T') ? at : at.replace(' ', 'T') + 'Z'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return new Date(t).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
})

/** Headline numbers under the name — the bit that reads like a social profile. */
const stats = computed(() => {
  const d = data.value
  if (!d) return []
  const done = d.completedLevels.length
  return [
    { label: 'Points', value: d.player ? fmt(d.player.total_points) : '—', tone: 'text-amber-300' },
    { label: 'Completions', value: done.toLocaleString(), tone: 'text-zinc-100' },
    {
      label: 'Of the list',
      value: listPercent(done, d.totalLevels),
      tone: 'text-zinc-100',
      hint: `${done.toLocaleString()} of ${d.totalLevels.toLocaleString()} levels`,
    },
    { label: 'Followers', value: d.follow.followerCount.toLocaleString(), tone: 'text-zinc-100', opens: 'followers' as const },
    { label: 'Following', value: d.follow.followingCount.toLocaleString(), tone: 'text-zinc-100', opens: 'following' as const },
  ]
})

/**
 * The two follow numbers open the list behind them. Kept here rather than in
 * each tile so the header stat and the panel further down share one dialog.
 */
const followListOpen = ref(false)
const followListMode = ref<'followers' | 'following'>('followers')
function openFollowList(mode: 'followers' | 'following') {
  followListMode.value = mode
  followListOpen.value = true
}
</script>

<template>
  <div v-if="error" class="container-tight py-16 text-center">
    <p class="text-sm text-zinc-500">No such user.</p>
    <NuxtLink to="/leaderboard" class="text-accent hover:underline text-sm mt-2 inline-block">Browse players →</NuxtLink>
  </div>

  <div v-else-if="data">
    <!-- Header, showcase and social chips are shared with the account page —
         see `components/ProfileHeader.vue`. The two were hand-written copies
         of each other and had already drifted apart. -->
    <ProfileHeader
      :account="data.account"
      :banner-level="bannerLevel"
      :banner-image="bannerImage"
      :stats="stats"
      :joined="joined"
      :is-self="isOwnProfile"
      @open-list="openFollowList"
    >
      <template #name-suffix>
        <!-- The one thing a follower count can't say. -->
        <span
          v-if="data.follow.followsYou"
          class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border border-zinc-700 bg-zinc-900 text-zinc-400"
          title="This profile follows you"
        >Follows you</span>
      </template>
      <template #meta>
        <span v-if="data.follow.mutuals" class="text-zinc-500">
          {{ data.follow.mutuals }} mutual{{ data.follow.mutuals === 1 ? '' : 's' }}
        </span>
        <span v-if="data.profileViews > 1" class="text-zinc-600">
          {{ data.profileViews.toLocaleString() }} profile views
        </span>
      </template>
      <template #actions>
        <NuxtLink
          v-if="isOwnProfile"
          to="/account"
          class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-accent/60 hover:text-accent transition-colors"
        >Edit profile</NuxtLink>
        <FollowButton
          v-else
          :target="data.follow.target"
          :initial-followed="data.follow.followed"
          :can-follow="data.follow.canFollow"
          :is-self="data.follow.isSelf"
          :follower-count="data.follow.followerCount"
        />
      </template>
    </ProfileHeader>

    <div class="container-tight max-w-5xl py-6">
      <p v-if="data.account.bio" class="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed mb-6 max-w-2xl">{{ data.account.bio }}</p>

      <ProfileShowcase
        class="mb-6"
        :hardest="data.hardest_completion"
        :favorite="data.favorite_level"
        :favorite-note="data.favorite_level_note"
        :is-self="isOwnProfile"
      />

      <div class="grid lg:grid-cols-[minmax(0,1fr)_260px] gap-6 items-start">
        <main class="space-y-6 min-w-0">
          <section v-if="data.player" class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-3">Player stats</h2>
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

          <section class="rounded-xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
            <CommentSection
              kind="profile"
              :target-id="data.account.id"
              variant="open"
              :title="`Comments on ${data.account.username}'s profile`"
            />
          </section>
        </main>

        <aside class="space-y-4 lg:sticky lg:top-20">
          <RecordCharts :completed="data.completedLevels" />

          <section v-if="data.publicLists?.length" class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2.5">Lists</h2>
            <ul class="space-y-1">
              <li v-for="l in data.publicLists" :key="l.public_id">
                <NuxtLink
                  :to="`/lists/${l.public_id}`"
                  class="flex items-center gap-2 rounded-lg border border-zinc-800/70 px-2.5 py-1.5 text-xs hover:border-zinc-700 hover:bg-zinc-900/40 transition-colors"
                >
                  <span class="truncate flex-1 text-zinc-200">{{ l.title }}</span>
                  <span v-if="!l.is_public" class="text-[9px] uppercase tracking-wider text-zinc-600 shrink-0">private</span>
                  <span class="text-[10px] text-zinc-600 tabular-nums shrink-0">{{ l.item_count }}</span>
                  <span class="text-[10px] text-zinc-600 tabular-nums shrink-0">★{{ l.likes }}</span>
                </NuxtLink>
              </li>
            </ul>
          </section>

          <section class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2.5">
              <button
                type="button"
                class="uppercase tracking-widest hover:text-accent transition-colors"
                @click="openFollowList('followers')"
              >Followers</button>
              <span class="text-zinc-600 tabular-nums">{{ data.follow.followerCount }}</span>
            </h2>
            <p v-if="!data.follow.followers?.length" class="text-xs text-zinc-600">No followers yet.</p>
            <ul v-else class="flex flex-wrap gap-1.5">
              <li v-for="f in data.follow.followers" :key="f.username">
                <NuxtLink
                  :to="`/users/${encodeURIComponent(f.username)}`"
                  class="inline-flex items-center gap-1.5 px-1.5 py-1 rounded-lg border border-zinc-800 text-[11px] text-zinc-300 hover:text-accent hover:border-accent/40 transition-colors"
                >
                  <span class="w-4 h-4 rounded-full overflow-hidden bg-zinc-700 shrink-0 flex items-center justify-center">
                    <img v-if="f.has_avatar" :src="`/api/users/${encodeURIComponent(f.username)}/avatar`" class="w-full h-full object-cover" alt="" />
                    <span v-else class="text-[8px] font-semibold uppercase">{{ f.username.charAt(0) }}</span>
                  </span>
                  {{ f.username }}
                </NuxtLink>
              </li>
            </ul>
            <button
              v-if="data.follow.followerCount > (data.follow.followers?.length ?? 0)"
              type="button"
              class="mt-2 text-[11px] text-zinc-500 hover:text-accent transition-colors"
              @click="openFollowList('followers')"
            >See all {{ data.follow.followerCount.toLocaleString() }} →</button>
          </section>

          <section class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2.5">
              <button
                type="button"
                class="uppercase tracking-widest hover:text-accent transition-colors"
                @click="openFollowList('following')"
              >Following</button>
              <span class="text-zinc-600 tabular-nums">{{ data.follow.followingCount }}</span>
            </h2>
            <p v-if="!data.follow.following?.length" class="text-xs text-zinc-600">Not following anyone yet.</p>
            <ul v-else class="flex flex-wrap gap-1.5">
              <li v-for="f in data.follow.following" :key="f.name">
                <NuxtLink
                  :to="f.username ? `/users/${encodeURIComponent(f.username)}` : `/users/by-player/${encodeURIComponent(f.name)}`"
                  class="inline-block px-2 py-1 rounded-lg border border-zinc-800 text-[11px] text-zinc-300 hover:text-accent hover:border-accent/40 transition-colors"
                >{{ f.name }}</NuxtLink>
              </li>
            </ul>
            <button
              v-if="data.follow.followingCount > (data.follow.following?.length ?? 0)"
              type="button"
              class="mt-2 text-[11px] text-zinc-500 hover:text-accent transition-colors"
              @click="openFollowList('following')"
            >See all {{ data.follow.followingCount.toLocaleString() }} →</button>
          </section>
        </aside>
      </div>
    </div>

    <FollowListModal
      v-model:open="followListOpen"
      :target="data.follow.target"
      :mode="followListMode"
      :count="followListMode === 'followers' ? data.follow.followerCount : data.follow.followingCount"
      :who="data.account.username"
    />
  </div>
</template>
