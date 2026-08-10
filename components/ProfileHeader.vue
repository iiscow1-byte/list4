<script setup lang="ts">
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
 * The differences that are real are props: whose page it is (`isSelf` decides
 * Edit versus Follow) and, on the account page, the live form values so the
 * header updates as you type.
 */
type ShowcaseLevel = {
  position: number
  sheet_placement?: number | null
  name: string
  gd_id: number | null
  video?: string | null
  verification_url?: string | null
}

const props = defineProps<{
  account: Record<string, any>
  /** The level painted behind the header, already chosen by the caller. */
  bannerLevel?: ShowcaseLevel | null
  /** A staff-set cover image, which beats the level art. */
  bannerImage?: string | null
  /** Tiles under the name. */
  stats?: { label: string; value: string; tone?: string; hint?: string; opens?: 'followers' | 'following' }[]
  /** `joined March 2026`, worked out by the caller from `created_at`. */
  joined?: string | null
  isSelf?: boolean
  /** Rendered to the right of the name — Edit profile, or a follow button. */
}>()

const emit = defineEmits<{ (e: 'openList', mode: 'followers' | 'following'): void }>()

const avatarUrl = computed(() =>
  props.account?.has_avatar
    ? `/api/users/${encodeURIComponent(props.account.username)}/avatar`
    : null,
)

/**
 * The badge colour, re-validated on the way out.
 *
 * The write path already refuses anything that isn't a hex literal; this value
 * lands in a style attribute, so it gets a second gate rather than one.
 */
const nameBadgeStyle = computed(() => {
  const hex = props.account?.name_badge_color
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return undefined
  return { backgroundColor: `${hex}22`, borderColor: `${hex}66`, color: hex }
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
        class="absolute top-3 right-3 sm:top-4 sm:right-4 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/50 backdrop-blur px-2.5 py-1 text-[11px] text-zinc-200 hover:border-accent/50 hover:text-accent transition-colors"
      >
        <span class="tabular-nums text-zinc-400">#{{ bannerLevel.sheet_placement ?? bannerLevel.position }}</span>
        <span class="truncate max-w-[10rem]">{{ bannerLevel.name }}</span>
      </NuxtLink>
    </div>

    <div class="container-tight max-w-5xl">
      <div class="relative -mt-14 sm:-mt-16 flex items-end gap-4 flex-wrap">
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

        <div class="flex-1 min-w-0 pb-1">
          <div class="flex items-center gap-2 flex-wrap">
            <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-50 drop-shadow">{{ account.username }}</h1>
            <CountryFlag :country="account.country" class="shrink-0" />
            <span v-if="account.name_emoji" class="text-2xl leading-none" aria-hidden="true">{{ account.name_emoji }}</span>
            <span
              v-if="account.name_badge"
              class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border font-semibold"
              :class="nameBadgeStyle ? '' : 'border-zinc-700 bg-zinc-800 text-zinc-300'"
              :style="nameBadgeStyle"
            >{{ account.name_badge }}</span>
            <RoleBadge :role="account.role" />
            <span v-if="account.pronouns" class="text-xs text-zinc-500">{{ account.pronouns }}</span>
            <slot name="name-suffix" />
          </div>

          <p class="text-[11px] text-zinc-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span v-if="account.claimed_player">
              playing as <span class="text-zinc-300">{{ account.claimed_player }}</span>
            </span>
            <span v-if="account.subdivision || account.country" class="inline-flex items-center gap-1">
              <span v-if="account.subdivision">{{ account.subdivision }}<template v-if="account.country">,</template></span>
              <CountryFlag :country="account.country" size="sm" with-name />
            </span>
            <span v-if="joined">joined {{ joined }}</span>
            <slot name="meta" />
          </p>
        </div>

        <div class="pb-1 flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <ProfileSocialLinks :account="account" />
          <slot name="actions" />
        </div>
      </div>

      <!-- Headline numbers -->
      <!-- Five across once "of the list" joined them: the row splits 2/3 on a
           phone and sits on one line from `sm` up, rather than leaving a
           stray tile on a row of its own. -->
      <dl v-if="stats?.length" class="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px rounded-xl overflow-hidden bg-zinc-800/70 border border-zinc-800">
        <component
          :is="s.opens ? 'button' : 'div'"
          v-for="s in stats"
          :key="s.label"
          :type="s.opens ? 'button' : undefined"
          class="bg-zinc-950 px-3 py-2.5 text-left"
          :class="s.opens ? 'hover:bg-zinc-900 transition-colors cursor-pointer group' : ''"
          :title="s.hint"
          @click="s.opens && emit('openList', s.opens)"
        >
          <dt
            class="text-[10px] uppercase tracking-widest text-zinc-500"
            :class="s.opens ? 'group-hover:text-accent transition-colors' : ''"
          >{{ s.label }}</dt>
          <dd class="tabular-nums text-lg font-semibold" :class="s.tone ?? 'text-zinc-100'">{{ s.value }}</dd>
        </component>
      </dl>
    </div>
  </header>
</template>
