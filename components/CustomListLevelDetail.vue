<script setup lang="ts">
// See the note in `UserName.vue`: resolving this by name from inside a template
// expression yields the string, and the credit renders as a literal
// `<NuxtLink>` element that looks right and doesn't navigate.
import { NuxtLink } from '#components'
import { tierColor, textOn } from '~/utils/tier-colors'
import { isEmbeddableVideo } from '~/utils/video-embed'
import { gdLevelUrl } from '~/utils/gd-links'
import { estimateForItem, ALL_TIERS } from '~/utils/tier-ordinal'

/** Centre panel of a custom list: the selected level in full. */
const props = defineProps<{
  item: any
  listTitle: string
  totalItems: number
  /** `/lists/:public_id` — for the prev/next links. */
  listPath: string
  canEdit?: boolean
  /** `/api/custom-lists/:public_id` — enables the inline editor. */
  apiBase?: string
  /** The whole list, so a level's ALL placement can be guessed from neighbours. */
  items?: any[]
  /** The list derives its order from ALL placements — rank isn't editable. */
  followAllOrder?: boolean
  /** The list says which of its levels the ALL carries. Off = it stands alone. */
  markOffAll?: boolean
  /**
   * Facts this list may have no opinion about.
   *
   * A tier and a difficulty are assertions, not decoration — a list of
   * platformers, or one using its own tiering, does not want to tell readers
   * that a level is "Insane Demon" because the ALL says so. `showLevelLinks`
   * covers the pointers off this list: back to the ALL placement, and out to
   * gdbrowser. A list that stands alone is not a view onto the main list and
   * should not keep offering to send its readers there.
   *
   * Each defaults to on, so an untouched list is unchanged. The editor's own
   * controls are never hidden by these — an owner still has to be able to set a
   * tier they have chosen not to display.
   */
  showTier?: boolean
  showDifficulty?: boolean
  showLevelLinks?: boolean
}>()
const emit = defineEmits<{ (e: 'changed'): void }>()

/**
 * Whether the verification link is playable inline — YouTube, a Medal.tv clip
 * or a clip uploaded here. Anything else gets the "watch it there" link below.
 */
const hasVideoEmbed = computed(() => isEmbeddableVideo(props.item?.verification_url))
const { to } = useStandaloneList()

/**
 * "Everything else by this creator", as a link.
 *
 * The nav's search already matches on creator; this hands it the name rather
 * than making someone retype it, and stays on the level being read so the
 * filter is something you can glance at and undo. `q` is the nav's search box —
 * see `CustomListNav`.
 */
const creatorHref = computed(() => {
  const c = props.item?.creator
  if (!c) return null
  return to(`${props.listPath}/${props.item.rank}?q=${encodeURIComponent(String(c))}`)
})

// ---------- inline editor ----------
const open = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const saved = ref(false)

/**
 * A linked row mirrors the ALL list, and can now disagree with it: each of its
 * level fields is editable, and a value that differs from the main list's is
 * stored as this list's own answer. `overrides` is what the row currently
 * disagrees about, which is what the editor labels.
 */
const linked = computed(() => props.item?.level_id != null)
const OVERRIDABLE = ['name', 'creator', 'gddl_tier', 'verification_url'] as const
const overrides = computed(() => {
  const i = props.item
  if (!i || !linked.value) return new Set<string>()
  return new Set(OVERRIDABLE.filter((k) => i[`ov_${k}`] != null))
})
/** What the ALL currently says, for the "revert" hint next to an override. */
function allValue(key: string): string | null {
  return props.item?.[`all_${key}`] ?? null
}

const draft = reactive({
  rank: '',
  name: '',
  creator: '',
  gd_id: '',
  gddl_tier: '',
  verification_url: '',
  verifier: '',
  percent_to_qualify: '',
  fps: '',
  game_version: '',
  notes: '',
  is_challenge: false,
})

function seed() {
  const i = props.item
  if (!i) return
  draft.rank = String(i.rank ?? '')
  draft.name = i.name ?? ''
  draft.creator = i.creator ?? ''
  draft.gd_id = i.gd_id != null ? String(i.gd_id) : ''
  draft.gddl_tier = i.gddl_tier ?? ''
  draft.verification_url = i.verification_url ?? ''
  draft.verifier = i.verifier ?? ''
  draft.percent_to_qualify = String(i.percent_to_qualify ?? 100)
  draft.fps = i.fps ?? ''
  draft.game_version = i.game_version ?? ''
  draft.notes = i.notes ?? ''
  draft.is_challenge = !!i.is_challenge
  error.value = null
  saved.value = false
}

/** Put a field back to whatever the main list says. */
function followAll(key: 'name' | 'creator' | 'gddl_tier' | 'verification_url') {
  draft[key] = allValue(key) ?? ''
}
watch(() => props.item?.id, seed, { immediate: true })
watch(open, (v) => { if (v) seed() })

async function save() {
  if (!props.apiBase || !props.item || busy.value) return
  busy.value = true
  error.value = null
  saved.value = false
  try {
    // The level fields go up on every row now. On a linked row the server
    // stores anything that differs from the ALL as this list's own answer, and
    // treats a value equal to the ALL's as "no opinion" — so leaving the form
    // untouched and pressing Save doesn't quietly pin the row.
    const body: Record<string, unknown> = {
      verifier: draft.verifier,
      percent_to_qualify: Number(draft.percent_to_qualify),
      fps: draft.fps,
      game_version: draft.game_version,
      notes: draft.notes,
      is_challenge: draft.is_challenge,
      name: draft.name,
      creator: draft.creator,
      gddl_tier: draft.gddl_tier,
      verification_url: draft.verification_url,
    }
    if (!linked.value) body.gd_id = draft.gd_id
    await $fetch(`${props.apiBase}/items/${props.item.id}`, { method: 'PATCH', body })

    // Rank travels through the move endpoint, which renumbers the whole list.
    // Skipped entirely when the list takes its order from the ALL — the server
    // would refuse, and the field is disabled anyway.
    const wanted = Math.round(Number(draft.rank))
    if (!props.followAllOrder && Number.isFinite(wanted) && wanted !== props.item.rank) {
      await $fetch(`${props.apiBase}/move`, {
        method: 'POST',
        body: { item_id: props.item.id, to_rank: wanted },
      })
      emit('changed')
      await navigateTo(to(`${props.listPath}/${Math.max(1, Math.min(props.totalItems, wanted))}`))
      return
    }
    saved.value = true
    emit('changed')
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not save.'
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!props.apiBase || !props.item || busy.value) return
  if (!confirm(`Remove "${props.item.name}" from this list?`)) return
  busy.value = true
  error.value = null
  try {
    await $fetch(`${props.apiBase}/items/${props.item.id}`, { method: 'DELETE' })
    emit('changed')
    await navigateTo(to(props.listPath))
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not remove that level.'
  } finally {
    busy.value = false
  }
}

/**
 * Adopt the matching ALL level, so this row follows the main list instead of
 * drifting. Linking happens automatically on save when the match is
 * unambiguous; this is the manual path for rows the resolver wouldn't guess at
 * (a gd_id shared by Solo/2P variants, say).
 */
const linkNote = ref<string | null>(null)
async function linkToAll(unlink = false) {
  if (!props.apiBase || !props.item || busy.value) return
  busy.value = true
  error.value = null
  linkNote.value = null
  try {
    const res = await $fetch<{ linked: boolean }>(
      `${props.apiBase}/items/${props.item.id}/link`,
      { method: 'POST', body: { unlink } },
    )
    linkNote.value = res.linked ? 'Linked to the ALL list.' : 'Unlinked. This row is hand-entered again.'
    emit('changed')
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not change the link.'
  } finally {
    busy.value = false
  }
}

/**
 * Where this level would sit on the ALL, guessed from its neighbours on *this*
 * list that the ALL already has. A custom list is an opinion about ordering, so
 * "it's between these two" is real information — far better than making the
 * submitter guess a placement out of 54,000 from scratch.
 *
 * The curve is the ALL's measured tier-to-placement shape; without it a level
 * guessed at from a wide gap gets an evenly-spaced tier, which is wrong by more
 * the wider the gap gets.
 */
const tierCurve = useTierCurve()
const estimate = computed(() => {
  const items = props.items ?? []
  const idx = items.findIndex((x: any) => x.id === props.item?.id)
  if (idx === -1) return { placement: null, tier: null, basis: null }
  return estimateForItem(items as any[], idx, tierCurve.value)
})

/**
 * Hand this level to the ALL list's submit form with everything already known
 * about it filled in. Only fields that form actually has are passed.
 */
const submitToAllHref = computed(() => {
  const i = props.item
  if (!i) return '/levels/submit'
  const params = new URLSearchParams()
  if (i.name) params.set('name', String(i.name))
  if (i.gd_id) params.set('gd_id', String(i.gd_id))
  if (i.verifier) params.set('verifier', String(i.verifier))
  if (i.verification_url) params.set('verification_url', String(i.verification_url))
  // The level's own tier wins when it has one; otherwise use the neighbours'.
  const tier = i.gddl_tier || estimate.value.tier
  if (tier) params.set('gddl_tier', String(tier))
  if (i.difficulty) params.set('difficulty', String(i.difficulty))
  if (estimate.value.placement) params.set('placement_estimate', String(estimate.value.placement))
  if (props.listTitle) params.set('placement_source', props.listTitle.slice(0, 60))
  return `/levels/submit?${params.toString()}`
})

const field = 'field field-sm mt-1 disabled:opacity-50'
const label = 'text-[10px] uppercase tracking-widest text-zinc-500 font-medium'
</script>

<template>
  <!-- Scrolling belongs to `ListPaneLayout`, which owns the detail pane for
       every list on the site. This panel used to be a grid item and had to
       scroll itself; inside the shared layout that would be a second scroller
       nested in the real one. -->
  <section v-if="item" class="relative min-h-0">
    <!-- Hero backdrop -->
    <div class="absolute inset-x-0 top-0 h-[22rem] overflow-hidden pointer-events-none" aria-hidden="true">
      <LevelThumbBg
        :gd-id="item.gd_id"
        :video-url="item.verification_url"
        res="high"
        priority
        img-class="opacity-40 scale-105"
        overlay-class="bg-gradient-to-b from-zinc-950/20 via-zinc-950/70 to-zinc-950"
      />
    </div>

    <div class="relative px-5 sm:px-8 py-6 space-y-6 max-w-4xl mx-auto">
      <header class="space-y-2">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="tabular-nums text-accent text-base font-bold drop-shadow">#{{ item.rank }}</span>
          <span class="text-[11px] text-zinc-400">of {{ totalItems }} on {{ listTitle }}</span>
          <span
            v-if="item.gddl_tier && showTier !== false"
            class="text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold"
            :style="{ backgroundColor: tierColor(item.gddl_tier), color: textOn(tierColor(item.gddl_tier)) }"
          >{{ item.gddl_tier }}</span>
          <span
            v-if="item.is_challenge"
            class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-amber-900/60 bg-amber-950/40 text-amber-400/90"
            :title="`${listTitle} counts this level as a challenge`"
          >Challenge</span>
          <!-- A level the ALL list doesn't have yet is the interesting case:
               offer to submit it, prefilled, rather than making someone retype
               what this list already knows. -->
          <NuxtLink
            v-if="canEdit && !linked"
            :to="submitToAllHref"
            class="ml-auto rounded-lg border border-accent/60 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            title="Open the ALL list's submit form with this level's details filled in"
          >Submit to the ALL →</NuxtLink>
          <button
            v-if="canEdit && apiBase"
            type="button"
            class="rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            :class="[
              open ? 'border-accent/60 text-accent bg-accent/10' : 'border-zinc-700 text-zinc-300 hover:border-accent/60 hover:text-accent',
              linked ? 'ml-auto' : '',
            ]"
            :aria-expanded="open"
            @click="open = !open"
          >{{ open ? 'Close editor' : 'Edit level' }}</button>
        </div>
        <h1 class="text-2xl sm:text-4xl font-bold tracking-tight text-zinc-50 drop-shadow">{{ item.name }}</h1>
        <!-- Credits.
             A sentence, because that is what it is — but one where the two
             names carry the weight and the words joining them get out of the
             way. It read "by X · verified by X" in a single flat grey, so
             neither name looked like a name; boxing each in a labelled chip
             fixed that and cost the line its readability. A level with only a
             verifier still starts at "verified by", with nothing dangling
             before it. -->
        <p v-if="item.creator || item.verifier" class="flex flex-wrap items-baseline gap-x-1.5 text-sm text-zinc-500">
          <template v-if="item.creator">
            <span>by</span>
            <component
              :is="creatorHref ? NuxtLink : 'span'"
              :to="creatorHref ?? undefined"
              class="font-medium text-zinc-100 drop-shadow-sm"
              :class="creatorHref ? 'hover:text-accent transition-colors' : ''"
              :title="creatorHref ? `Show everything by ${item.creator} on this list` : undefined"
            >{{ item.creator }}</component>
          </template>
          <span v-if="item.creator && item.verifier" aria-hidden="true" class="text-zinc-700">·</span>
          <template v-if="item.verifier">
            <span>verified by</span>
            <span class="font-medium text-zinc-100 drop-shadow-sm">{{ item.verifier }}</span>
          </template>
        </p>
        <!-- Step through the list without going back to the nav -->
        <nav class="flex items-center gap-1.5 pt-1">
          <NuxtLink
            v-if="item.rank > 1"
            :to="to(`${listPath}/${item.rank - 1}`)"
            class="card px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-100 transition-colors"
          >← Harder</NuxtLink>
          <NuxtLink
            v-if="item.rank < totalItems"
            :to="to(`${listPath}/${item.rank + 1}`)"
            class="card px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-100 transition-colors"
          >Easier →</NuxtLink>
        </nav>
      </header>

      <!-- Inline editor -->
      <form
        v-if="open && canEdit && apiBase"
        class="rounded-xl border border-accent/30 bg-zinc-950/80 p-4 grid gap-3 sm:grid-cols-2"
        @submit.prevent="save"
      >
        <label class="block">
          <span :class="label">Rank on this list</span>
          <input v-model="draft.rank" inputmode="numeric" :class="field" :disabled="followAllOrder" />
          <span v-if="followAllOrder" class="text-[10px] text-zinc-600">Set by ALL placement</span>
        </label>
        <label class="block">
          <span :class="label">% to qualify</span>
          <input v-model="draft.percent_to_qualify" inputmode="numeric" :class="field" />
        </label>

        <!-- The level's own fields. Editable on a linked row too: what this
             list says about a level is allowed to differ from the ALL, and the
             chip below each one says when it does. -->
        <label class="block">
          <span :class="label">Name</span>
          <input v-model="draft.name" :class="field" />
          <button
            v-if="linked && overrides.has('name')" type="button"
            class="mt-0.5 text-[10px] text-zinc-500 hover:text-accent transition-colors truncate max-w-full block focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            @click="followAll('name')"
          >Reset to ALL: “{{ allValue('name') }}”</button>
        </label>
        <label class="block">
          <span :class="label">Creator</span>
          <input v-model="draft.creator" :class="field" />
          <button
            v-if="linked && overrides.has('creator')" type="button"
            class="mt-0.5 text-[10px] text-zinc-500 hover:text-accent transition-colors truncate max-w-full block focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            @click="followAll('creator')"
          >Reset to ALL: “{{ allValue('creator') ?? '—' }}”</button>
        </label>
        <label class="block">
          <span :class="label">Level ID</span>
          <input v-model="draft.gd_id" inputmode="numeric" :class="field" :disabled="linked" />
          <span v-if="linked" class="text-[10px] text-zinc-600">From the linked ALL level</span>
        </label>
        <label class="block">
          <span :class="label">Tier</span>
          <select v-model="draft.gddl_tier" :class="field">
            <option value="">— none —</option>
            <option v-for="t in ALL_TIERS" :key="t" :value="t">{{ t }}</option>
          </select>
          <button
            v-if="linked && overrides.has('gddl_tier')" type="button"
            class="mt-0.5 text-[10px] text-zinc-500 hover:text-accent transition-colors truncate max-w-full block focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            @click="followAll('gddl_tier')"
          >Reset to ALL: {{ allValue('gddl_tier') ?? 'no tier' }}</button>
        </label>
        <label class="block sm:col-span-2">
          <span :class="label">Verification video</span>
          <input v-model="draft.verification_url" :class="field" placeholder="https://youtube.com/watch?v=…" />
          <button
            v-if="linked && overrides.has('verification_url')" type="button"
            class="mt-0.5 text-[10px] text-zinc-500 hover:text-accent transition-colors truncate max-w-full block focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            @click="followAll('verification_url')"
          >Reset to the ALL's video</button>
        </label>

        <label class="block">
          <span :class="label">Verifier</span>
          <input v-model="draft.verifier" :class="field" />
        </label>
        <label class="block">
          <span :class="label">FPS</span>
          <input v-model="draft.fps" :class="field" />
        </label>
        <label class="block">
          <span :class="label">Game version</span>
          <input v-model="draft.game_version" :class="field" />
        </label>
        <label class="block sm:col-span-2">
          <span :class="label">Notes</span>
          <textarea v-model="draft.notes" rows="2" :class="field" />
        </label>

        <!-- Stays list-owned even on a linked row: the ALL decides what its own
             challenge list contains, and a list built around a different
             definition would have this overwritten every time the row
             re-synced. -->
        <label class="sm:col-span-2 flex items-start gap-2 cursor-pointer select-none rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
          <input v-model="draft.is_challenge" type="checkbox" class="mt-0.5 accent-accent" />
          <span class="min-w-0">
            <span class="block text-xs font-medium text-zinc-200">Mark as a challenge</span>
            <span class="block text-[11px] text-zinc-500 leading-snug">
              Challenges get a badge and can be counted separately on this list's leaderboard.
              Doesn't affect the ALL.
            </span>
          </span>
        </label>

        <!-- Link status: whether this row follows the ALL list or stands alone -->
        <div class="sm:col-span-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
          <template v-if="linked">
            <p class="text-[11px] text-zinc-400">
              Linked to
              <NuxtLink :to="`/levels/${item.position}`" class="text-accent hover:underline tabular-nums">
                #{{ item.sheet_placement ?? item.position }} on the ALL list
              </NuxtLink>
              — its fields follow the main list until you change one here.
              <template v-if="overrides.size">
                This list has its own
                {{ [...overrides].map((k) => k === 'gddl_tier' ? 'tier' : k === 'verification_url' ? 'video' : k).join(', ') }}.
              </template>
            </p>
            <button
              type="button"
              :disabled="busy"
              class="mt-1.5 text-[11px] text-zinc-500 hover:text-red-400 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              @click="linkToAll(true)"
            >Unlink and edit by hand</button>
          </template>
          <template v-else>
            <p class="text-[11px] text-zinc-400">
              Not linked to the ALL list. This row is hand-entered and won't follow it.
            </p>
            <div class="mt-1.5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                :disabled="busy"
                class="text-[11px] text-accent hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                @click="linkToAll(false)"
              >Link to the matching ALL level</button>
              <NuxtLink
                :to="submitToAllHref"
                class="text-[11px] text-zinc-400 hover:text-accent transition-colors"
              >Not on the ALL yet? Submit it →</NuxtLink>
              <NuxtLink
                :to="to(`${listPath}/to-all`)"
                class="text-[11px] text-zinc-500 hover:text-accent transition-colors"
              >Submit several at once →</NuxtLink>
            </div>
            <p v-if="estimate.placement || estimate.tier" class="mt-1.5 text-[11px] text-zinc-500">
              Estimated from its neighbours on this list:
              <span v-if="estimate.placement" class="text-zinc-300 tabular-nums">#{{ estimate.placement }}</span>
              <span v-if="estimate.placement && estimate.tier"> · </span>
              <span v-if="estimate.tier" class="text-zinc-300">{{ estimate.tier }}</span>
              <span v-if="estimate.basis" class="text-zinc-600"> ({{ estimate.basis }})</span>
            </p>
          </template>
          <p v-if="linkNote" class="mt-1.5 text-[11px] text-emerald-400">{{ linkNote }}</p>
        </div>

        <div class="sm:col-span-2 flex flex-wrap items-center gap-2 pt-0.5">
          <button
            type="submit"
            :disabled="busy"
            class="btn btn-sm btn-primary"
          >{{ busy ? 'Saving…' : 'Save' }}</button>
          <button
            type="button"
            :disabled="busy"
            class="btn btn-sm btn-ghost"
            @click="seed()"
          >Reset</button>
          <button
            type="button"
            :disabled="busy"
            class="btn btn-sm btn-danger ml-auto"
            @click="remove"
          >Remove from list</button>
          <span v-if="error" class="sm:col-span-2 text-xs text-red-400">{{ error }}</span>
          <span v-else-if="saved" class="text-xs text-emerald-400">Saved.</span>
        </div>
      </form>

      <!-- Verification video -->
      <VideoEmbed
        v-if="hasVideoEmbed"
        :url="item.verification_url"
        :title="item.name"
        frame-class="aspect-video rounded-xl overflow-hidden border border-zinc-800 bg-black shadow-xl shadow-black/40"
      />
      <a
        v-else-if="item.verification_url"
        :href="item.verification_url" target="_blank" rel="noopener"
        class="btn btn-md btn-ghost hover:border-accent/50 hover:text-accent"
      >Watch the verification ↗</a>

      <!-- Stats -->
      <dl class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 rounded-xl overflow-hidden">
        <div class="bg-zinc-950 px-3 py-2.5">
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Points</dt>
          <dd class="tabular-nums text-lg font-semibold text-amber-300">{{ item.points }}</dd>
        </div>
        <div class="bg-zinc-950 px-3 py-2.5">
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">To qualify</dt>
          <dd class="tabular-nums text-lg font-semibold text-zinc-100">{{ item.percent_to_qualify }}%</dd>
        </div>
        <div class="bg-zinc-950 px-3 py-2.5">
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Records</dt>
          <dd class="tabular-nums text-lg font-semibold text-zinc-100">{{ item.records.length }}</dd>
        </div>
        <div class="bg-zinc-950 px-3 py-2.5">
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Level ID</dt>
          <dd class="tabular-nums text-sm text-zinc-300 truncate">
            <!-- The ID stays whatever happens: it is the level's identity, and
                 the setting is about links off this list, not about facts. -->
            <a
              v-if="gdLevelUrl(item.gd_id) && showLevelLinks !== false"
              :href="gdLevelUrl(item.gd_id)!"
              target="_blank"
              rel="noopener"
              class="hover:text-accent transition-colors"
              title="Open on gdbrowser"
            >{{ item.gd_id }}</a>
            <span v-else>{{ item.gd_id ?? '—' }}</span>
          </dd>
        </div>
      </dl>

      <!-- Metadata -->
      <dl class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div v-if="item.difficulty && showDifficulty !== false">
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Difficulty</dt>
          <dd class="text-zinc-200">{{ item.difficulty }}</dd>
        </div>
        <div v-if="item.fps">
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">FPS</dt>
          <dd class="text-zinc-200">{{ item.fps }}</dd>
        </div>
        <div v-if="item.game_version">
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Game version</dt>
          <dd class="text-zinc-200">{{ item.game_version }}</dd>
        </div>
        <!-- Hidden when the list has turned off marking levels against the ALL,
             or turned level links off outright: a list that stands on its own
             doesn't keep pointing at the main one. Editors still see the link
             inside the editor, where it's about which level this row *is*
             rather than about presenting the list. -->
        <div v-if="item.position && markOffAll !== false && showLevelLinks !== false">
          <dt class="text-[10px] uppercase tracking-wider text-zinc-500">On the ALL list</dt>
          <dd>
            <NuxtLink :to="`/levels/${item.position}`" class="text-accent hover:underline tabular-nums">
              #{{ item.sheet_placement ?? item.position }}
            </NuxtLink>
          </dd>
        </div>
      </dl>

      <p v-if="item.notes" class="text-sm text-zinc-400 border-l-2 border-zinc-800 pl-3">{{ item.notes }}</p>
    </div>
  </section>

  <section v-else class="flex items-center justify-center text-sm text-zinc-500">
    This list has no levels yet.
  </section>
</template>
