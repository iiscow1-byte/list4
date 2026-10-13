<script setup lang="ts">
import { gdLevelUrl } from '~/utils/gd-links'
import { splitSources, isChallengeSource } from '~/utils/challenge-sources'
import { sourceUrlByName } from '~/utils/list-source-catalog'
import { compactCount } from '~/utils/format-count'
import { relativeTime } from '~/utils/relative-time'
import { youtubeIdFrom } from '~/utils/level-thumbs'
import { isEmbeddableVideo } from '~/utils/video-embed'
import { tierColor, textOn } from '~/utils/tier-colors'
import { TIER_MAX_ORD } from '~/utils/tier-ordinal'

type Community = {
  count: number
  community_tier: string | null
  community_enjoyment: number | null
  distribution: Record<string, number> | null
}
type OtherListEntry = { key?: string; list: string; badge?: string; position: number; url?: string | null; home?: string | null }
type HistoryEntry = {
  id: number
  from_position: number | null
  to_position: number
  changed_at: string
  changed_by: string | null
}
type AredlHistoryEntry = { event?: string | null; aredl_position: number | null; cause_name?: string | null; action_at: string }
type Level = {
  id?: number
  position: number
  name: string
  gd_id: number | null
  gddl_tier: string | null
  gddl_tier_frac?: number | null
  rated: string | null
  difficulty: string | null
  placement_source: string | null
  points: number | null
  main_skillset: string | null
  verify_date: string | null
  verification: string | null
  verification_url: string | null
  pov_placement: number | null
  year_verified: number | null
  creator?: string | null
  verifier?: string | null
  publisher?: string | null
  enjoyment?: number | null
  edel_enjoyment?: number | null
  aredl_tags?: string[] | null
  other_lists?: OtherListEntry[]
  description_override?: string | null
  same_as_above?: number | null
  duplicate_of?: { position: number; name: string } | null
  is_alternate?: number | null
  alternate_of?: { position: number; name: string } | null
  tentative_placement?: number | null
  submitter?: string | null
  community?: Community | null
  position_history?: HistoryEntry[]
  aredl_history?: AredlHistoryEntry[]
  challenge_rank?: number | null
  views?: number | null
  [key: string]: any
}
type NavLevel = { id?: number; position: number; name: string; gddl_tier: string | null; difficulty: string | null }

const props = defineProps<{
  level: Level
  readonly?: boolean
  moveBelowPick?: NavLevel | null
  groupMovePicks?: NavLevel[]
  groupMoveTargetPick?: NavLevel | null
  groupMovePhase?: 'select' | 'target'
}>()
const emit = defineEmits<{
  (e: 'refresh'): void
  (e: 'start-move-below'): void
  (e: 'end-move-below'): void
  (e: 'start-group-move'): void
  (e: 'continue-group-move'): void
  (e: 'back-group-move'): void
  (e: 'end-group-move'): void
}>()

const route = useRoute()
const { data: meRes } = useCurrentUser()
const role = computed(() => meRes.value?.account?.role ?? null)
const signedIn = computed(() => !!meRes.value?.account)
const isStaff = computed(() => !props.readonly && !!role.value && role.value !== 'user')
const canEdit = computed(() => !props.readonly && ['moderator', 'admin', 'owner', 'developer'].includes(role.value ?? ''))
const showViews = useShowViews()
const showTierDecimal = useTierDecimal()

// ---------------------------------------------------------------- numbers & labels

const tierLabel = computed(() => {
  const tier = props.level.gddl_tier
  if (!tier || !showTierDecimal.value) return tier
  const m = tier.match(/^(Subtier|Tier) (\d+)$/)
  const frac = props.level.gddl_tier_frac
  if (!m || frac == null) return tier
  const ord = m[1] === 'Subtier' ? Number(m[2]) : 5 + Number(m[2])
  if (ord >= TIER_MAX_ORD) return tier
  return `${m[1]} ${(Number(m[2]) + frac).toFixed(2)}`
})

// On the challenge list (?list=challenge) the challenge rank is the headline.
const readingChallenges = computed(() => String(route.query.list ?? '').toLowerCase() === 'challenge')
const swapRanks = computed(() => readingChallenges.value && props.level.challenge_rank != null)
const headlineRank = computed(() => (swapRanks.value ? props.level.challenge_rank! : props.level.position))

function fmtPoints(n: number | null | undefined) {
  if (n == null) return '—'
  return n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2)
}

const sources = computed(() => {
  const seen = new Set<string>()
  return splitSources(props.level.placement_source)
    .filter((name) => {
      const k = name.toLowerCase()
      if (seen.has(k) || k === 'all levels list') return false
      seen.add(k)
      return true
    })
    .map((name) => ({ name, url: sourceUrlByName(name), challenge: isChallengeSource(name) }))
})

// ---------------------------------------------------------------- Geometry Dash info

type GdInfo = {
  author: string | null
  description: string | null
  downloads: number
  likes: number
  length: string | null
  objects: number
  objectsApprox: boolean
  coins: number
  verifiedCoins: boolean
  score: 0 | 1 | 2 | 3 | 4 | 5
  song: { name: string | null; id: number | null; custom: boolean }
  password: string | null
}
const SCORE_LABELS = ['Unrated', 'Rated', 'Featured', 'Epic', 'Legendary', 'Mythic'] as const
const gd = ref<GdInfo | null>(null)
async function loadGd() {
  const id = props.level.gd_id
  if (!id) return
  try {
    const data = await $fetch<GdInfo>(`/api/gd/level/${id}`)
    if (props.level.gd_id === id) gd.value = data
  } catch { /* GD's servers are often down; the page doesn't need them */ }
}
onMounted(loadGd)

const rating = computed(() => {
  if (props.level.challenge_rank != null) return 'Challenge'
  if (props.level.rated && props.level.rated !== 'Challenge') return props.level.rated
  return gd.value ? SCORE_LABELS[gd.value.score] : null
})
const publisher = computed(() => props.level.publisher ?? gd.value?.author ?? null)
const description = computed(() => props.level.description_override || gd.value?.description || null)

const showThumbs = useShowThumbnails()

/**
 * Who made the level, as labelled groups of names, each a link to that
 * player. A megacollab can list dozens of creators, so the first few show and
 * the rest open on request.
 */
const CREDIT_PREVIEW = 3
const creditsOpen = ref(false)
const splitNames = (s: string | null | undefined) =>
  (s ?? '').split(/\s*(?:,|&|\+|\band\b)\s*/i).map((n) => n.trim()).filter(Boolean)

type Credit = { label: string; names: string[] }
const credits = computed<Credit[]>(() => {
  const out: Credit[] = []
  const creators = splitNames(props.level.creator)
  if (creators.length) out.push({ label: creators.length > 1 ? 'Creators' : 'Creator', names: creators })
  else if (publisher.value) out.push({ label: 'Publisher', names: [publisher.value] })
  const verifiers = splitNames(props.level.verifier)
  if (verifiers.length) out.push({ label: verifiers.length > 1 ? 'Verifiers' : 'Verifier', names: verifiers })
  if (creators.length && publisher.value && publisher.value.toLowerCase() !== (props.level.creator ?? '').toLowerCase()) {
    out.push({ label: 'Publisher', names: [publisher.value] })
  }
  return out
})
const shownNames = (c: Credit) => (creditsOpen.value ? c.names : c.names.slice(0, CREDIT_PREVIEW))
/** A player's page, without a trailing note like "(host)". */
const playerLink = (name: string) => `/users/by-player/${encodeURIComponent(name.replace(/\s*\([^)]*\)\s*$/, ''))}`

// ---------------------------------------------------------------- stats & details

const community = computed(() => props.level.community ?? null)
const levelUrl = computed(() => gdLevelUrl(props.level.gd_id))
const hasVideo = computed(() => isEmbeddableVideo(props.level.verification_url))

type Detail = { label: string; value: string; mono?: boolean }
const details = computed<Detail[]>(() => {
  const d: Detail[] = []
  if (props.level.main_skillset) d.push({ label: 'Skillset', value: props.level.main_skillset })
  if (rating.value) d.push({ label: 'Rating', value: rating.value })
  if (gd.value?.length) d.push({ label: 'Length', value: gd.value.length })
  if (gd.value?.song?.name) d.push({ label: 'Song', value: gd.value.song.name })
  if (gd.value) {
    d.push({ label: 'Password', value: gd.value.password === null ? 'Free to copy' : gd.value.password || 'None', mono: !!gd.value.password })
    if (gd.value.objects) d.push({ label: 'Objects', value: `${gd.value.objectsApprox ? '~' : ''}${gd.value.objects.toLocaleString()}` })
    d.push({ label: 'Downloads', value: gd.value.downloads.toLocaleString() })
    d.push({ label: 'Likes', value: gd.value.likes.toLocaleString() })
    if (gd.value.coins) d.push({ label: 'Coins', value: `${gd.value.coins}${gd.value.verifiedCoins ? '' : ' (unverified)'}` })
  }
  if (props.level.pov_placement) d.push({ label: 'Placed at on verification', value: `#${props.level.pov_placement}` })
  if (props.level.enjoyment != null) d.push({ label: 'Enjoyment', value: Number(props.level.enjoyment).toFixed(1) })
  if (props.level.edel_enjoyment != null) d.push({ label: 'EDEL enjoyment', value: Number(props.level.edel_enjoyment).toFixed(1) })
  if (props.level.submitter) d.push({ label: 'Submitted by', value: props.level.submitter })
  if (showViews.value && (props.level.views ?? 0) > 0) d.push({ label: 'Views', value: compactCount(props.level.views!) })
  return d
})

const extraTags = computed(() => {
  const seen = new Set([props.level.gddl_tier, props.level.difficulty, props.level.main_skillset, rating.value]
    .filter(Boolean).map((s) => String(s).toLowerCase()))
  return (props.level.aredl_tags ?? []).filter((t) => t && !seen.has(t.toLowerCase()))
})

// ---------------------------------------------------------------- copying

const copied = ref<'id' | 'link' | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | null = null
async function copy(what: 'id' | 'link') {
  const text = what === 'id' ? String(props.level.gd_id) : `${window.location.origin}/${props.level.gd_id}`
  try {
    await navigator.clipboard.writeText(text)
    copied.value = what
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = null }, 1500)
  } catch { /* clipboard blocked */ }
}

// Fill in a missing verify date from the video's upload date (staff only).
watch(() => props.level.position, async () => {
  if (!canEdit.value || props.level.verify_date) return
  const id = youtubeIdFrom(props.level.verification_url)
  if (!id) return
  try {
    const res = await $fetch<{ date: string | null }>(`/api/youtube/upload-date?id=${id}`)
    if (!res?.date) return
    await $fetch(`/api/admin/levels/${props.level.position}`, { method: 'PATCH', body: { verify_date: res.date } })
    emit('refresh')
  } catch { /* can be filled in by hand */ }
}, { immediate: true })

// ---------------------------------------------------------------- other lists

const isExtreme = computed(() => !!props.level.difficulty?.toLowerCase().includes('extreme'))
const otherLists = computed(() => (props.level.other_lists ?? []).filter((e) =>
  (e.list === 'GDL' || e.list === 'AREDL') ? isExtreme.value : true))

type Estimate = { list: string; value: number | null; nlw: boolean }
const estimates = ref<Estimate[]>([])
async function loadEstimates() {
  const have = new Set((props.level.other_lists ?? []).map((e) => e.key))
  const jobs: Promise<Estimate | null>[] = []
  const pos = props.level.position
  if (isExtreme.value && !have.has('aredl')) {
    jobs.push($fetch<any>(`/api/levels/${pos}/estimated-placement`).then((d) => ({
      list: 'AREDL', value: d?.estimated_aredl ?? null, nlw: !!(d?.bracket?.above && !d?.bracket?.below),
    })).catch(() => null))
  }
  if (isExtreme.value && !have.has('gdl')) {
    jobs.push($fetch<any>(`/api/levels/${pos}/estimated-gdl-placement`).then((d) => ({
      list: 'GDL', value: d?.estimated_gdl ?? null, nlw: !!(d?.bracket?.above && !d?.bracket?.below),
    })).catch(() => null))
  }
  if (props.level.challenge_rank != null && !have.has('gdtpl:cl')) {
    jobs.push($fetch<any>(`/api/levels/${pos}/estimated-cl-placement`).then((d) => ({
      list: 'Challenge List', value: d?.estimated_cl ?? null, nlw: (d?.estimated_cl ?? 0) >= 101,
    })).catch(() => null))
  }
  estimates.value = (await Promise.all(jobs)).filter((e): e is Estimate => !!e && (e.nlw || e.value != null))
}
onMounted(loadEstimates)

// ---------------------------------------------------------------- history

const history = computed(() => props.level.position_history ?? [])

// ---------------------------------------------------------------- forum

type Thread = { id: number; title: string; reply_count: number; created_at: string; author: { username: string } | null }
const threads = ref<Thread[]>([])
onMounted(async () => {
  if (!props.level.id) return
  try {
    threads.value = (await $fetch<{ items: Thread[] }>('/api/forum', { query: { level_id: props.level.id, limit: 5, sort: 'active' } })).items
  } catch { threads.value = [] }
})
</script>

<template>
  <div class="relative">
    <!-- The level's thumbnail, fading into the page. -->
    <div v-if="showThumbs" class="absolute inset-x-0 top-0 h-[24rem] overflow-hidden pointer-events-none" aria-hidden="true">
      <LevelThumbBg
        :gd-id="level.gd_id"
        :video-url="level.verification_url"
        res="high"
        priority
        img-class="opacity-45 scale-105"
        overlay-class="bg-gradient-to-b from-zinc-950/20 via-zinc-950/70 to-zinc-950"
      />
    </div>

    <article class="relative px-4 sm:px-8 pt-6 sm:pt-10 pb-12 max-w-4xl mx-auto">
      <header class="mb-6">
        <div class="flex items-start gap-4">
          <DifficultyFace
            v-if="level.difficulty"
            :difficulty="level.difficulty"
            :rated="rating ?? level.rated"
            :position="level.position"
            class="shrink-0 hidden sm:block"
          />
          <div class="min-w-0 flex-1">
            <p class="rank text-accent text-xl leading-none">
              #{{ headlineRank }}
              <span v-if="swapRanks" class="ml-1 text-sm font-medium text-zinc-400">on the challenge list</span>
            </p>
            <h1 class="mt-1 font-display text-3xl sm:text-[2.6rem] sm:leading-[1.1] font-bold tracking-tight text-zinc-50 break-words">{{ level.name }}</h1>
            <!-- Labels in a column on a phone, one row of groups from `sm`. -->
            <dl v-if="credits.length" class="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-sm sm:flex sm:flex-wrap sm:gap-x-6 sm:gap-y-1.5">
              <div v-for="c in credits" :key="c.label" class="contents sm:flex sm:min-w-0 sm:max-w-full sm:items-baseline sm:gap-2">
                <dt class="shrink-0 text-xs font-medium text-zinc-500">{{ c.label }}</dt>
                <dd class="min-w-0 text-zinc-100">
                  <template v-for="(name, i) in shownNames(c)" :key="`${c.label}-${i}`"><span v-if="i" class="text-zinc-500">, </span><NuxtLink :to="playerLink(name)" class="hover:text-accent transition-colors">{{ name }}</NuxtLink></template>
                  <button
                    v-if="c.names.length > CREDIT_PREVIEW"
                    type="button"
                    class="ml-1.5 rounded-full bg-zinc-800/80 px-2 py-px text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-zinc-50 transition-colors"
                    :aria-expanded="creditsOpen"
                    @click="creditsOpen = !creditsOpen"
                  >{{ creditsOpen ? 'Show fewer' : `+${c.names.length - CREDIT_PREVIEW} more` }}</button>
                </dd>
              </div>
            </dl>

            <!-- What kind of level it is: the tier, the difficulty, and where it
                 stands among challenges. Tags follow as plain text, quieter. -->
            <div class="mt-3 flex flex-wrap items-center gap-1.5">
              <span
                v-if="tierLabel"
                class="badge font-semibold border-transparent"
                :style="{ backgroundColor: tierColor(level.gddl_tier), color: textOn(tierColor(level.gddl_tier)) }"
              >{{ tierLabel }}</span>
              <span v-if="level.difficulty" class="badge">{{ level.challenge_rank != null ? level.difficulty.replace(/Demon/i, 'Challenge') : level.difficulty }}</span>
              <NuxtLink
                v-if="level.challenge_rank != null"
                :to="{ path: `/levels/${level.position}`, query: { ...route.query, list: swapRanks ? undefined : 'challenge' } }"
                class="badge border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                :title="swapRanks ? 'Read it on the main list' : 'Open the challenge list'"
              >{{ swapRanks ? `#${level.position} overall` : `Challenge #${level.challenge_rank}` }}</NuxtLink>
              <span v-if="level.tentative_placement" class="badge border-yellow-500/40 bg-yellow-500/10 text-yellow-300" title="No firm estimate yet, so this placement may change.">Tentative</span>
              <NuxtLink v-if="level.same_as_above && level.duplicate_of" :to="`/levels/${level.duplicate_of.position}`" class="badge hover:text-zinc-50">Duplicate of {{ level.duplicate_of.name }}</NuxtLink>
              <span v-else-if="level.same_as_above" class="badge">Duplicate</span>
              <NuxtLink v-if="level.is_alternate && level.alternate_of" :to="`/levels/${level.alternate_of.position}`" class="badge hover:text-zinc-50">Version of {{ level.alternate_of.name }}</NuxtLink>
              <span v-else-if="level.is_alternate" class="badge">Alternate version</span>
              <span v-if="extraTags.length" class="ml-1.5 text-xs text-zinc-400">{{ extraTags.join(' · ') }}</span>
            </div>
          </div>
          <div v-if="!readonly" class="shrink-0 flex items-center gap-1.5">
            <NuxtLink
              v-if="signedIn"
              :to="`/records/submit?position=${level.position}`"
              class="btn btn-sm btn-primary"
            >Submit record</NuxtLink>
            <ReportButton target="level" :target-id="level.id" :label="`#${level.position} ${level.name}`" />
          </div>
        </div>
      </header>

      <!-- Lazy: only staff get the editing code. -->
      <LazyLevelStaffTools
        v-if="isStaff"
        :level="level"
        :picked-level="moveBelowPick"
        :group-picks="groupMovePicks"
        :group-target="groupMoveTargetPick"
        :group-phase="groupMovePhase"
        @refresh="emit('refresh')"
        @start-pick="emit('start-move-below')"
        @end-pick="emit('end-move-below')"
        @start-group="emit('start-group-move')"
        @continue-group="emit('continue-group-move')"
        @back-group="emit('back-group-move')"
        @end-group="emit('end-group-move')"
      />

      <VideoEmbed
        v-if="hasVideo"
        :url="level.verification_url"
        :title="level.verification ?? `${level.name} verification`"
        frame-class="aspect-video rounded-lg bg-black overflow-hidden mb-6 ring-1 ring-white/5"
      />
      <a
        v-else-if="level.verification_url"
        :href="level.verification_url"
        target="_blank"
        rel="noopener"
        class="mb-6 flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 hover:border-zinc-700 transition-colors"
      >
        <span class="w-9 h-9 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4 translate-x-px" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        </span>
        <span class="min-w-0">
          <span class="block text-sm font-medium text-zinc-100 truncate">{{ level.verification ?? 'Verification video' }}</span>
          <span class="block text-xs text-zinc-500 truncate">{{ level.verification_url }}</span>
        </span>
      </a>

      <dl class="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-px overflow-hidden rounded-lg bg-zinc-800/80 ring-1 ring-zinc-800">
        <div class="stat">
          <dt>List points</dt>
          <dd class="text-amber-300">{{ fmtPoints(level.points) }}</dd>
        </div>
        <div class="stat">
          <dt>Tier</dt>
          <dd>{{ tierLabel ?? '—' }}</dd>
          <p v-if="community?.community_tier" class="mt-0.5 text-xs text-zinc-500" :title="`${community.count} community rating${community.count === 1 ? '' : 's'}`">
            Players say {{ community.community_tier }}
          </p>
        </div>
        <div class="stat">
          <dt>Level ID</dt>
          <dd v-if="level.gd_id" class="flex items-center gap-1.5">
            <a :href="levelUrl ?? undefined" target="_blank" rel="noopener" class="hover:text-accent tabular-nums">{{ level.gd_id }}</a>
            <button type="button" class="text-zinc-500 hover:text-zinc-200" :title="copied === 'id' ? 'Copied' : 'Copy ID'" :aria-label="copied === 'id' ? 'Copied' : 'Copy ID'" @click="copy('id')">
              <svg v-if="copied !== 'id'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-3.5 h-3.5 text-emerald-400" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
            </button>
            <button type="button" class="text-zinc-500 hover:text-zinc-200" :title="copied === 'link' ? 'Copied' : 'Copy a link that follows this level'" aria-label="Copy permanent link" @click="copy('link')">
              <svg v-if="copied !== 'link'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-3.5 h-3.5 text-emerald-400" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
            </button>
          </dd>
          <dd v-else>—</dd>
        </div>
        <div class="stat">
          <dt>Verified</dt>
          <dd class="tabular-nums">{{ level.verify_date ?? level.year_verified ?? '—' }}</dd>
        </div>
      </dl>

      <p v-if="description" class="mb-6 text-sm leading-relaxed text-zinc-300 whitespace-pre-wrap">{{ description }}</p>

      <div class="grid gap-6 md:grid-cols-2 mb-8">
        <section v-if="details.length">
          <h2 class="section-title mb-2">Details</h2>
          <dl class="text-sm divide-y divide-zinc-800/80">
            <div v-for="d in details" :key="d.label" class="flex justify-between gap-4 py-1.5">
              <dt class="text-zinc-400">{{ d.label }}</dt>
              <dd class="text-zinc-100 text-right truncate" :class="d.mono ? 'font-mono' : ''" :title="d.value">{{ d.value }}</dd>
            </div>
            <div v-if="sources.length" class="flex justify-between gap-4 py-1.5">
              <dt class="text-zinc-400">Placed from</dt>
              <dd class="text-right">
                <template v-for="(s, i) in sources" :key="s.name">
                  <span v-if="i" class="text-zinc-600">, </span>
                  <a v-if="s.url" :href="s.url" target="_blank" rel="noopener" class="hover:text-accent" :class="s.challenge ? 'text-amber-300' : 'text-zinc-100'">{{ s.name }}</a>
                  <span v-else :class="s.challenge ? 'text-amber-300' : 'text-zinc-100'">{{ s.name }}</span>
                </template>
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <h2 class="section-title mb-2">On other lists</h2>
          <ul v-if="otherLists.length || estimates.length" class="text-sm divide-y divide-zinc-800/80">
            <li v-for="e in otherLists" :key="e.key ?? e.list">
              <component
                :is="e.url ? 'a' : 'div'"
                :href="e.url ?? undefined"
                :target="e.url ? '_blank' : undefined"
                :rel="e.url ? 'noopener' : undefined"
                class="flex justify-between gap-4 py-1.5"
                :class="e.url ? 'group' : ''"
              >
                <span class="text-zinc-400 group-hover:text-zinc-200 truncate">{{ e.list }}</span>
                <span class="rank text-zinc-100 group-hover:text-accent">#{{ e.position }}</span>
              </component>
            </li>
            <li v-for="e in estimates" :key="`est-${e.list}`" class="flex justify-between gap-4 py-1.5">
              <span class="text-zinc-500">{{ e.list }} <span class="text-xs">(estimate)</span></span>
              <span class="text-zinc-400 tabular-nums">{{ e.nlw ? 'Not list worthy' : `~#${e.value}` }}</span>
            </li>
          </ul>
          <p v-else class="text-sm text-zinc-500">Not ranked anywhere else.</p>
        </section>
      </div>

      <PlacementHistory
        class="mb-8"
        :all="history"
        :aredl="level.aredl_history ?? []"
        :current="level.position"
        :can-edit="canEdit"
        @refresh="emit('refresh')"
      />

      <section v-if="level.id && !readonly" class="mb-8">
        <div class="flex items-baseline justify-between gap-3 mb-2">
          <h2 class="section-title">Forum</h2>
          <NuxtLink :to="`/community?tab=forum&level_id=${level.id}`" class="text-sm text-zinc-400 hover:text-accent">
            {{ threads.length ? 'All threads' : 'Start a thread' }}
          </NuxtLink>
        </div>
        <ul v-if="threads.length" class="divide-y divide-zinc-800/80">
          <li v-for="t in threads" :key="t.id">
            <NuxtLink :to="`/community/thread/${t.id}`" class="flex items-center gap-3 py-2 group">
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm text-zinc-200 group-hover:text-accent">{{ t.title }}</span>
                <span class="block truncate text-xs text-zinc-500">{{ t.author?.username ?? 'deleted account' }} · {{ relativeTime(t.created_at) }}</span>
              </span>
              <span class="shrink-0 text-xs text-zinc-500 tabular-nums">{{ t.reply_count }} {{ t.reply_count === 1 ? 'reply' : 'replies' }}</span>
            </NuxtLink>
          </li>
        </ul>
        <p v-else class="text-sm text-zinc-500">No threads about this level yet.</p>
      </section>

      <section v-if="level.id && !readonly">
        <CommentSection kind="level" :target-id="level.id" />
      </section>
    </article>
  </div>
</template>

<style scoped>
.stat {
  @apply bg-zinc-950 px-4 py-3;
}
.stat dt {
  @apply text-xs text-zinc-500;
}
.stat dd {
  @apply mt-0.5 font-display text-lg font-semibold text-zinc-100;
}
</style>
