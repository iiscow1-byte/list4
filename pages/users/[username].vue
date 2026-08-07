<script setup lang="ts">
import { roleBadgeClass } from '~/utils/role-styles'
import { gdUserUrl } from '~/utils/gd-links'
import { tierColor, textOn } from '~/utils/tier-colors'

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
    gd_username: string | null
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
  }
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

const avatarUrl = computed(() =>
  data.value?.account.has_avatar
    ? `/api/users/${encodeURIComponent(data.value.account.username)}/avatar`
    : null,
)

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
/**
 * The custom badge's colour. Re-validated rather than trusted: the write path
 * already refuses anything that isn't a hex literal, and this value ends up in
 * a style attribute, so it gets a second gate on the way out.
 */
const nameBadgeStyle = computed(() => {
  const hex = data.value?.account?.name_badge_color
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return undefined
  return { backgroundColor: `${hex}22`, borderColor: `${hex}66`, color: hex }
})

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

const youtubeHandle = computed(() => {
  const url = data.value?.account.youtube_url
  if (!url) return null
  const m = url.match(/youtube\.com\/@([^/?&#]+)/i)
  return m ? '@' + m[1] : null
})

/** The in-game name, as a link to that player's gdbrowser profile. */
const gdProfileUrl = computed(() => gdUserUrl(data.value?.account.gd_username))

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
  return [
    { label: 'Points', value: d.player ? fmt(d.player.total_points) : '—', tone: 'text-amber-300' },
    { label: 'Completions', value: d.completedLevels.length.toLocaleString(), tone: 'text-zinc-100' },
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
    <!-- Header: the profile's cover, painted with whichever level they pinned -->
    <header class="relative">
      <div class="relative h-44 sm:h-56 overflow-hidden bg-zinc-900">
        <template v-if="bannerImage">
          <img
            :src="bannerImage"
            alt=""
            referrerpolicy="no-referrer"
            class="absolute inset-0 w-full h-full object-cover opacity-70"
          />
          <div class="absolute inset-0 bg-gradient-to-b from-zinc-950/40 via-zinc-950/60 to-zinc-950" aria-hidden="true" />
        </template>
        <LevelThumbBg
          v-else-if="bannerLevel"
          :key="bannerLevel.gd_id ?? bannerLevel.name"
          :gd-id="bannerLevel.gd_id"
          :video-url="bannerLevel.video ?? bannerLevel.verification_url"
          res="high"
          sizes="100vw"
          priority
          img-class="opacity-60 scale-105"
          overlay-class="bg-gradient-to-b from-zinc-950/40 via-zinc-950/70 to-zinc-950"
        />
        <div
          v-else
          class="absolute inset-0 bg-[radial-gradient(80%_140%_at_50%_0%,theme(colors.zinc.800),theme(colors.zinc.950))]"
          aria-hidden="true"
        />
        <!-- Even with a thumbnail the bottom has to fade to the page colour so
             the avatar and name never sit on a busy patch. -->
        <div class="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-zinc-950 to-transparent" aria-hidden="true" />

        <NuxtLink
          v-if="bannerLevel?.position"
          :to="`/levels/${bannerLevel.position}`"
          class="absolute top-3 right-3 sm:top-4 sm:right-4 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/50 backdrop-blur px-2.5 py-1 text-[11px] text-zinc-200 hover:border-accent/50 hover:text-accent transition-colors"
        >
          <span class="tabular-nums text-zinc-400">#{{ bannerLevel.sheet_placement ?? bannerLevel.position }}</span>
          <span class="truncate max-w-[10rem]">{{ bannerLevel.name }}</span>
        </NuxtLink>
      </div>

      <div class="container-tight max-w-5xl">
        <div class="relative -mt-14 sm:-mt-16 flex items-end gap-4 flex-wrap">
          <!-- Circular like every other avatar on the site. Also the only
               shape that hides the black corners baked into avatars cropped
               before the cropper stopped clipping to a circle and saving as
               JPEG — those are real pixels in the stored image. -->
          <div class="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-zinc-900 ring-4 ring-zinc-950 overflow-hidden shrink-0 shadow-xl shadow-black/50">
            <img v-if="avatarUrl" :src="avatarUrl" alt="" class="w-full h-full object-cover" />
            <div v-else class="w-full h-full flex items-center justify-center text-3xl text-zinc-600 font-black">
              {{ data.account.username.charAt(0).toUpperCase() }}
            </div>
          </div>

          <div class="flex-1 min-w-0 pb-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-50 drop-shadow">{{ data.account.username }}</h1>
              <span v-if="data.account.name_emoji" class="text-2xl leading-none" aria-hidden="true">
                {{ data.account.name_emoji }}
              </span>
              <span
                v-if="data.account.name_badge"
                class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border font-semibold"
                :class="nameBadgeStyle ? '' : 'border-zinc-700 bg-zinc-800 text-zinc-300'"
                :style="nameBadgeStyle"
              >{{ data.account.name_badge }}</span>
              <span
                v-if="data.account.role !== 'user'"
                class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded"
                :class="roleBadgeClass(data.account.role)"
              >{{ data.account.role }}</span>
              <span v-if="data.account.pronouns" class="text-xs text-zinc-500">{{ data.account.pronouns }}</span>
            </div>
            <p class="text-[11px] text-zinc-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span v-if="data.account.claimed_player">
                playing as <span class="text-zinc-300">{{ data.account.claimed_player }}</span>
              </span>
              <span v-if="data.account.subdivision || data.account.country">
                <span v-if="data.account.subdivision">{{ data.account.subdivision }}, </span>{{ data.account.country }}
              </span>
              <span v-if="joined">joined {{ joined }}</span>
            </p>
          </div>

          <div class="pb-1 flex items-center gap-2 shrink-0">
            <span v-if="data.account.discord_handle" class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2 py-1 text-[11px] text-zinc-400">
              <svg viewBox="0 0 127.14 96.36" fill="currentColor" class="w-3.5 h-3.5 shrink-0 text-[#5865F2]" aria-hidden="true">
                <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"/>
              </svg>
              {{ data.account.discord_handle }}
            </span>
            <a
              v-if="data.account.youtube_url"
              :href="data.account.youtube_url"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2 py-1 text-[11px] text-zinc-400 hover:text-red-400 hover:border-red-900/60 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" class="w-3.5 h-3.5 shrink-0" aria-hidden="true">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              {{ youtubeHandle ?? 'YouTube' }}
            </a>
            <a
              v-if="gdProfileUrl"
              :href="gdProfileUrl"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2 py-1 text-[11px] text-zinc-400 hover:text-accent hover:border-accent/50 transition-colors"
              :title="`${data.account.gd_username} on gdbrowser`"
            >
              <GdCubeIcon class="w-3.5 h-3.5 shrink-0" />
              {{ data.account.gd_username }}
            </a>
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
          </div>
        </div>

        <!-- Headline numbers -->
        <dl class="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden bg-zinc-800/70 border border-zinc-800">
          <component
            :is="s.opens ? 'button' : 'div'"
            v-for="s in stats"
            :key="s.label"
            :type="s.opens ? 'button' : undefined"
            class="bg-zinc-950 px-3 py-2.5 text-left"
            :class="s.opens ? 'hover:bg-zinc-900 transition-colors cursor-pointer group' : ''"
            @click="s.opens && openFollowList(s.opens)"
          >
            <dt class="text-[10px] uppercase tracking-widest text-zinc-500" :class="s.opens ? 'group-hover:text-accent transition-colors' : ''">{{ s.label }}</dt>
            <dd class="tabular-nums text-lg font-semibold" :class="s.tone">{{ s.value }}</dd>
          </component>
        </dl>
      </div>
    </header>

    <div class="container-tight max-w-5xl py-6">
      <p v-if="data.account.bio" class="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed mb-6 max-w-2xl">{{ data.account.bio }}</p>

      <!-- Showcase: the two levels a player chooses to be known for -->
      <section v-if="data.hardest_completion || data.favorite_level" class="grid gap-3 sm:grid-cols-2 mb-6">
        <article
          v-if="data.hardest_completion"
          class="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 group"
        >
          <LevelThumbBg
            :gd-id="data.hardest_completion.gd_id"
            :video-url="data.hardest_completion.video ?? data.hardest_completion.verification_url"
            res="medium"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 460px"
            img-class="opacity-25 group-hover:opacity-40"
            overlay-class="bg-gradient-to-r from-zinc-950/95 via-zinc-950/80 to-zinc-950/40"
          />
          <div class="relative p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Hardest completion</h2>
            <NuxtLink :to="`/levels/${data.hardest_completion.position}`" class="mt-1.5 block group/link">
              <span class="text-lg font-bold text-zinc-50 group-hover/link:text-accent transition-colors">{{ data.hardest_completion.name }}</span>
              <span v-if="data.hardest_completion.creator" class="block text-[11px] text-zinc-500 truncate">by {{ data.hardest_completion.creator }}</span>
            </NuxtLink>
            <div class="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span class="tabular-nums rounded px-1.5 py-0.5 bg-zinc-900 text-zinc-300 border border-zinc-800">
                #{{ data.hardest_completion.sheet_placement ?? data.hardest_completion.position }}
              </span>
              <span
                v-if="data.hardest_completion.gddl_tier"
                class="tabular-nums rounded px-1.5 py-0.5 font-semibold"
                :style="{ backgroundColor: tierColor(data.hardest_completion.gddl_tier), color: textOn(tierColor(data.hardest_completion.gddl_tier)) }"
              >{{ data.hardest_completion.gddl_tier }}</span>
              <span v-if="data.hardest_completion.points" class="tabular-nums text-amber-300">{{ fmt(data.hardest_completion.points) }} pts</span>
              <span v-if="data.hardest_completion.percent != null && data.hardest_completion.percent < 100" class="tabular-nums text-zinc-400">{{ data.hardest_completion.percent }}%</span>
              <a
                v-if="data.hardest_completion.video"
                :href="data.hardest_completion.video"
                target="_blank"
                rel="noopener"
                class="text-zinc-500 hover:text-accent transition-colors"
              >watch ↗</a>
            </div>
          </div>
        </article>

        <article
          v-if="data.favorite_level"
          class="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 group"
        >
          <LevelThumbBg
            :gd-id="data.favorite_level.gd_id"
            :video-url="data.favorite_level.verification_url"
            res="medium"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 460px"
            img-class="opacity-25 group-hover:opacity-40"
            overlay-class="bg-gradient-to-r from-zinc-950/95 via-zinc-950/80 to-zinc-950/40"
          />
          <div class="relative p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-pink-400 font-semibold">Favourite level</h2>
            <NuxtLink :to="`/levels/${data.favorite_level.position}`" class="mt-1.5 block group/link">
              <span class="text-lg font-bold text-zinc-50 group-hover/link:text-accent transition-colors">{{ data.favorite_level.name }}</span>
              <span v-if="data.favorite_level.creator" class="block text-[11px] text-zinc-500 truncate">by {{ data.favorite_level.creator }}</span>
            </NuxtLink>
            <div class="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span class="tabular-nums rounded px-1.5 py-0.5 bg-zinc-900 text-zinc-300 border border-zinc-800">
                #{{ data.favorite_level.sheet_placement ?? data.favorite_level.position }}
              </span>
              <span
                v-if="data.favorite_level.gddl_tier"
                class="tabular-nums rounded px-1.5 py-0.5 font-semibold"
                :style="{ backgroundColor: tierColor(data.favorite_level.gddl_tier), color: textOn(tierColor(data.favorite_level.gddl_tier)) }"
              >{{ data.favorite_level.gddl_tier }}</span>
            </div>
            <p v-if="data.favorite_level_note" class="mt-2 text-xs text-zinc-400 whitespace-pre-wrap">{{ data.favorite_level_note }}</p>
          </div>
        </article>
      </section>

      <p
        v-else-if="isOwnProfile"
        class="mb-6 rounded-xl border border-dashed border-zinc-800 px-4 py-5 text-center text-xs text-zinc-500"
      >
        Pick a hardest completion and a favourite level in
        <NuxtLink to="/account" class="text-accent hover:underline">your settings</NuxtLink>
        — they show up here with the level art behind them.
      </p>

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
