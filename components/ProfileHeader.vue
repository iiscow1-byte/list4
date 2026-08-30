<script setup lang="ts">
import { profileChipClass } from '~/utils/profile-chips'

/**
 * The top of a profile: cover, avatar, name, and the numbers under it.
 *
 * One component, used by the public profile *and* by your own copy of it on the
 * account page. Those were two hand-written headers that were meant to be
 * identical and weren't: the account page had lost the country flag, the
 * Geometry Dash chip, the banner level link and the follower tiles, and every
 * decoration added since had to be remembered twice. Now the page you edit your
 * profile on shows you the profile you are editing.
 *
 * The name line reads left to right in order of who is speaking: the clan tag
 * (a prefix the account chose), the name, the emoji (part of the name), the
 * staff-set badge, then the role — the site's own statement, last.
 *
 * Everything that is *about* somebody rather than part of their name — where
 * they are, what to call them, when they joined — sits under it as chips, in
 * `ProfileMeta`, sharing a shape with the social links beside them. It used to
 * be one run of 11px grey text with nothing but a gap between the facts, which
 * read as a sentence that had lost its punctuation.
 */
type ShowcaseLevel = {
  position: number
  sheet_placement?: number | null
  name: string
  gd_id: number | null
  video?: string | null
  verification_url?: string | null
}

/** A tile under the name. `progress` draws a bar across the bottom of it. */
type ProfileStat = {
  label: string
  value: string
  tone?: string
  hint?: string
  /** 0–1. Only for a value that genuinely is a share of something. */
  progress?: number | null
  opens?: 'followers' | 'following'
}

const props = defineProps<{
  account: Record<string, any>
  /** The level painted behind the header, already chosen by the caller. */
  bannerLevel?: ShowcaseLevel | null
  /** A staff-set cover image, which beats the level art. */
  bannerImage?: string | null
  /** Tiles under the name. */
  stats?: ProfileStat[]
}>()

const emit = defineEmits<{ (e: 'openList', mode: 'followers' | 'following'): void }>()

const avatarUrl = computed(() =>
  props.account?.has_avatar
    ? `/api/users/${encodeURIComponent(props.account.username)}/avatar`
    : null,
)

/**
 * Up to three emoji, as characters rather than as a string.
 *
 * `Array.from` rather than `split('')`, because every emoji worth setting is
 * outside the basic plane and half of them are multi-code-point sequences —
 * splitting by code unit cuts a flag in half and prints two letters.
 */
const emoji = computed(() => {
  const raw = (props.account?.name_emoji ?? '').trim()
  return raw ? Array.from(raw).slice(0, 8).join('') : null
})
</script>

<template>
  <header class="relative">
    <div class="relative h-44 sm:h-56 overflow-hidden bg-zinc-900">
      <template v-if="bannerImage">
        <img
          :src="bannerImage"
          alt=""
          referrerpolicy="no-referrer"
          fetchpriority="high"
          decoding="async"
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
      <!-- Even over a thumbnail the bottom has to fade to the page colour, so
           the avatar and name never sit on a busy patch. -->
      <div class="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-zinc-950 to-transparent" aria-hidden="true" />

      <NuxtLink
        v-if="bannerLevel?.position"
        :to="`/levels/${bannerLevel.position}`"
        class="absolute top-3 right-3 sm:top-4 sm:right-4 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/50 backdrop-blur px-2.5 py-1 text-[11px] text-zinc-200 hover:border-accent/50 hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        <span class="tabular-nums text-zinc-400">#{{ bannerLevel.sheet_placement ?? bannerLevel.position }}</span>
        <span class="truncate max-w-[10rem]">{{ bannerLevel.name }}</span>
      </NuxtLink>
    </div>

    <div class="container-tight max-w-5xl">
      <!--
        A column on a phone, a row from `sm`.

        The negative margin lifts this whole block up over the banner, and as a
        bottom-aligned row that meant the taller it got, the further *all* of it
        rode up into the picture. On a phone it gets very tall: the name block
        holds the meta chips — place, pronouns, joined, and whatever the page
        adds, which on a profile is mutual friends, friend count and views — and
        at 246px of usable width those wrap to three or four lines. So the name
        and the chips were sitting on top of the banner image, and the actions
        beside them were squeezed into whatever was left.

        Stacked, only the avatar overlaps the banner and everything after it
        flows below in the normal way, however many lines the chips take.
      -->
      <div class="relative -mt-14 sm:-mt-16 flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-4">
        <!-- Circular like every other avatar on the site, and the only shape
             that hides the black corners baked into avatars cropped before the
             cropper stopped clipping to a circle. -->
        <div class="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-zinc-900 ring-4 ring-zinc-950 overflow-hidden shrink-0 shadow-xl shadow-black/50">
          <slot name="avatar">
            <img v-if="avatarUrl" :src="avatarUrl" alt="" decoding="async" class="w-full h-full object-cover" />
            <div v-else class="w-full h-full flex items-center justify-center text-3xl text-zinc-600 font-black">
              {{ account.username.charAt(0).toUpperCase() }}
            </div>
          </slot>
        </div>

        <div class="w-full min-w-0 sm:w-auto sm:flex-1 sm:pb-1">
          <div class="flex items-center gap-x-2 gap-y-1.5 flex-wrap">
            <ClanTag
              v-if="account.clan"
              :tag="account.clan.tag"
              :name="account.clan.name"
              :color="account.clan.color"
            />
            <h1 class="min-w-0 max-w-full break-words text-2xl sm:text-3xl font-bold tracking-tight text-zinc-50 drop-shadow">{{ account.username }}</h1>
            <!-- No flag here. The country chip below carries the flag *and* the
                 country's name, so a second flag beside the name was the same
                 fact twice — which is the thing the meta row was rebuilt to
                 stop. -->
            <!-- Sized to the meta line rather than to the heading: three emoji
                 at 24px next to a 30px name is a second heading. -->
            <span v-if="emoji" class="text-lg leading-none tracking-tight shrink-0" aria-hidden="true">{{ emoji }}</span>
            <NameBadge :label="account.name_badge" :color="account.name_badge_color" />
            <RoleBadge :role="account.role" />
            <slot name="name-suffix" />
          </div>

          <ProfileMeta :account="account" :created-at="account.created_at" class="mt-2">
            <!-- "Playing as" is the one fact here that is about the *list*
                 rather than about the person, so it keeps the accent. -->
            <span
              v-if="account.claimed_player"
              :class="profileChipClass()"
              title="The name this account's records are filed under"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="w-3.5 h-3.5 shrink-0 text-zinc-600" aria-hidden="true">
                <path d="M4 20v-1a6 6 0 0 1 12 0v1M20 8v6M17 11h6" />
                <circle cx="10" cy="7" r="4" />
              </svg>
              <span class="truncate">Playing as <span class="text-zinc-200">{{ account.claimed_player }}</span></span>
            </span>
            <slot name="meta" />
          </ProfileMeta>
        </div>

        <div class="w-full sm:w-auto sm:pb-1 flex items-center gap-2 shrink-0 flex-wrap justify-start sm:justify-end">
          <ProfileSocialLinks :account="account" />
          <slot name="actions" />
        </div>
      </div>

      <!-- Headline numbers -->
      <!-- Five across once "of the list" joined them: the row splits 2/3 on a
           phone and sits on one line from `lg` up, rather than leaving a
           stray tile on a row of its own. -->
      <dl v-if="stats?.length" class="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px rounded-xl overflow-hidden bg-zinc-800/70 border border-zinc-800">
        <component
          :is="s.opens ? 'button' : 'div'"
          v-for="s in stats"
          :key="s.label"
          :type="s.opens ? 'button' : undefined"
          class="relative bg-zinc-950 px-3 py-2.5 text-left"
          :class="s.opens
            ? 'hover:bg-zinc-900 focus-visible:bg-zinc-900 focus-visible:outline-none transition-colors cursor-pointer group'
            : ''"
          :title="s.hint"
          @click="s.opens && emit('openList', s.opens)"
        >
          <dt
            class="text-[10px] uppercase tracking-widest text-zinc-500 flex items-center gap-1"
            :class="s.opens ? 'group-hover:text-accent transition-colors' : ''"
          >
            {{ s.label }}
            <!-- The two tiles that open something say so, rather than relying on
                 somebody discovering it by hovering. -->
            <span v-if="s.opens" class="text-zinc-700 group-hover:text-accent transition-colors" aria-hidden="true">›</span>
          </dt>
          <dd class="tabular-nums text-lg font-semibold" :class="s.tone ?? 'text-zinc-100'">{{ s.value }}</dd>
          <!-- A share of the list is the one number here that has a ceiling, so
               it is the one that can honestly be drawn as a bar. -->
          <span
            v-if="s.progress != null"
            class="absolute inset-x-0 bottom-0 h-[3px] bg-zinc-900"
            aria-hidden="true"
          >
            <span
              class="block h-full bg-accent/70"
              :style="{ width: `${Math.min(100, Math.max(0, s.progress * 100))}%` }"
            />
          </span>
        </component>
      </dl>
    </div>
  </header>
</template>
