<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'
import { youtubeIdFrom } from '~/utils/level-thumbs'

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
}>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const videoId = computed(() => youtubeIdFrom(props.item?.verification_url))

// ---------- inline editor ----------
const open = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const saved = ref(false)

/** Linked rows take their level fields from the ALL list on every full save. */
const linked = computed(() => props.item?.level_id != null)

const draft = reactive({
  rank: '',
  name: '',
  creator: '',
  gd_id: '',
  verification_url: '',
  verifier: '',
  percent_to_qualify: '',
  fps: '',
  game_version: '',
  notes: '',
})

function seed() {
  const i = props.item
  if (!i) return
  draft.rank = String(i.rank ?? '')
  draft.name = i.name ?? ''
  draft.creator = i.creator ?? ''
  draft.gd_id = i.gd_id != null ? String(i.gd_id) : ''
  draft.verification_url = i.verification_url ?? ''
  draft.verifier = i.verifier ?? ''
  draft.percent_to_qualify = String(i.percent_to_qualify ?? 100)
  draft.fps = i.fps ?? ''
  draft.game_version = i.game_version ?? ''
  draft.notes = i.notes ?? ''
  error.value = null
  saved.value = false
}
watch(() => props.item?.id, seed, { immediate: true })
watch(open, (v) => { if (v) seed() })

async function save() {
  if (!props.apiBase || !props.item || busy.value) return
  busy.value = true
  error.value = null
  saved.value = false
  try {
    const body: Record<string, unknown> = {
      verifier: draft.verifier,
      percent_to_qualify: Number(draft.percent_to_qualify),
      fps: draft.fps,
      game_version: draft.game_version,
      notes: draft.notes,
    }
    if (!linked.value) {
      body.name = draft.name
      body.creator = draft.creator
      body.gd_id = draft.gd_id
      body.verification_url = draft.verification_url
    }
    await $fetch(`${props.apiBase}/items/${props.item.id}`, { method: 'PATCH', body })

    // Rank travels through the move endpoint, which renumbers the whole list.
    const wanted = Math.round(Number(draft.rank))
    if (Number.isFinite(wanted) && wanted !== props.item.rank) {
      await $fetch(`${props.apiBase}/move`, {
        method: 'POST',
        body: { item_id: props.item.id, to_rank: wanted },
      })
      emit('changed')
      await navigateTo(`${props.listPath}/${Math.max(1, Math.min(props.totalItems, wanted))}`)
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
    await navigateTo(props.listPath)
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
    linkNote.value = res.linked ? 'Linked to the ALL list.' : 'Unlinked — this row is hand-entered again.'
    emit('changed')
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not change the link.'
  } finally {
    busy.value = false
  }
}

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
  if (i.gddl_tier) params.set('gddl_tier', String(i.gddl_tier))
  if (i.difficulty) params.set('difficulty', String(i.difficulty))
  if (props.listTitle) params.set('placement_source', props.listTitle.slice(0, 60))
  return `/levels/submit?${params.toString()}`
})

const field = 'mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50'
const label = 'text-[10px] uppercase tracking-widest text-zinc-500 font-medium'
</script>

<template>
  <section v-if="item" class="relative min-h-0 overflow-y-auto">
    <!-- Hero backdrop -->
    <div class="absolute inset-x-0 top-0 h-[22rem] overflow-hidden pointer-events-none" aria-hidden="true">
      <LevelThumbBg
        :gd-id="item.gd_id"
        :video-url="item.verification_url"
        res="high"
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
            v-if="item.gddl_tier"
            class="text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold"
            :style="{ backgroundColor: tierColor(item.gddl_tier), color: textOn(tierColor(item.gddl_tier)) }"
          >{{ item.gddl_tier }}</span>
          <!-- A level the ALL list doesn't have yet is the interesting case:
               offer to submit it, prefilled, rather than making someone retype
               what this list already knows. -->
          <NuxtLink
            v-if="canEdit && !linked"
            :to="submitToAllHref"
            class="ml-auto rounded-lg border border-accent/60 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20 transition-colors"
            title="Open the ALL list's submit form with this level's details filled in"
          >Submit to the ALL →</NuxtLink>
          <button
            v-if="canEdit && apiBase"
            type="button"
            class="rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors"
            :class="[
              open ? 'border-accent/60 text-accent bg-accent/10' : 'border-zinc-700 text-zinc-300 hover:border-accent/60 hover:text-accent',
              linked ? 'ml-auto' : '',
            ]"
            :aria-expanded="open"
            @click="open = !open"
          >{{ open ? 'Close editor' : 'Edit level' }}</button>
        </div>
        <h1 class="text-2xl sm:text-4xl font-bold tracking-tight text-zinc-50 drop-shadow">{{ item.name }}</h1>
        <p class="text-sm text-zinc-300">
          <template v-if="item.creator">by {{ item.creator }}</template>
          <template v-if="item.creator && item.verifier"> · </template>
          <template v-if="item.verifier">verified by {{ item.verifier }}</template>
        </p>
        <!-- Step through the list without going back to the nav -->
        <nav class="flex items-center gap-1.5 pt-1">
          <NuxtLink
            v-if="item.rank > 1"
            :to="`${listPath}/${item.rank - 1}`"
            class="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-100 transition-colors"
          >← Harder</NuxtLink>
          <NuxtLink
            v-if="item.rank < totalItems"
            :to="`${listPath}/${item.rank + 1}`"
            class="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-100 transition-colors"
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
          <input v-model="draft.rank" inputmode="numeric" :class="field" />
        </label>
        <label class="block">
          <span :class="label">% to qualify</span>
          <input v-model="draft.percent_to_qualify" inputmode="numeric" :class="field" />
        </label>

        <label class="block">
          <span :class="label">Name</span>
          <input v-model="draft.name" :class="field" :disabled="linked" />
        </label>
        <label class="block">
          <span :class="label">Creator</span>
          <input v-model="draft.creator" :class="field" :disabled="linked" />
        </label>
        <label class="block">
          <span :class="label">Level ID</span>
          <input v-model="draft.gd_id" inputmode="numeric" :class="field" :disabled="linked" />
        </label>
        <label class="block">
          <span :class="label">Verification video</span>
          <input v-model="draft.verification_url" :class="field" :disabled="linked" />
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

        <!-- Link status: whether this row follows the ALL list or stands alone -->
        <div class="sm:col-span-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
          <template v-if="linked">
            <p class="text-[11px] text-zinc-400">
              Linked to
              <NuxtLink :to="`/levels/${item.position}`" class="text-accent hover:underline tabular-nums">
                #{{ item.sheet_placement ?? item.position }} on the ALL list
              </NuxtLink>
              — its name, creator, ID and video follow the main list, so those fields are read-only here.
            </p>
            <button
              type="button"
              :disabled="busy"
              class="mt-1.5 text-[11px] text-zinc-500 hover:text-red-400 disabled:opacity-50 transition-colors"
              @click="linkToAll(true)"
            >Unlink and edit by hand</button>
          </template>
          <template v-else>
            <p class="text-[11px] text-zinc-400">
              Not linked to the ALL list — this row is hand-entered and won't follow the main list.
            </p>
            <div class="mt-1.5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                :disabled="busy"
                class="text-[11px] text-accent hover:underline disabled:opacity-50"
                @click="linkToAll(false)"
              >Link to the matching ALL level</button>
              <NuxtLink
                :to="submitToAllHref"
                class="text-[11px] text-zinc-400 hover:text-accent transition-colors"
              >Not on the ALL yet? Submit it →</NuxtLink>
            </div>
          </template>
          <p v-if="linkNote" class="mt-1.5 text-[11px] text-emerald-400">{{ linkNote }}</p>
        </div>

        <div class="sm:col-span-2 flex flex-wrap items-center gap-2 pt-0.5">
          <button
            type="submit"
            :disabled="busy"
            class="rounded-lg bg-accent text-zinc-950 font-semibold text-xs px-3 py-1.5 hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >{{ busy ? 'Saving…' : 'Save' }}</button>
          <button
            type="button"
            :disabled="busy"
            class="rounded-lg border border-zinc-700 text-zinc-300 text-xs px-3 py-1.5 hover:border-zinc-500 disabled:opacity-50 transition-colors"
            @click="seed()"
          >Reset</button>
          <button
            type="button"
            :disabled="busy"
            class="ml-auto rounded-lg border border-red-900/60 text-red-400 text-xs px-3 py-1.5 hover:bg-red-950/40 disabled:opacity-50 transition-colors"
            @click="remove"
          >Remove from list</button>
          <span v-if="error" class="sm:col-span-2 text-xs text-red-400">{{ error }}</span>
          <span v-else-if="saved" class="text-xs text-emerald-400">Saved.</span>
        </div>
      </form>

      <!-- Verification video -->
      <div v-if="videoId" class="aspect-video rounded-xl overflow-hidden border border-zinc-800 bg-black shadow-xl shadow-black/40">
        <iframe
          :src="`https://www.youtube.com/embed/${videoId}`"
          class="w-full h-full" frameborder="0" allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin" :title="item.name"
        />
      </div>
      <a
        v-else-if="item.verification_url"
        :href="item.verification_url" target="_blank" rel="noopener"
        class="inline-block rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:border-accent/50 hover:text-accent transition-colors"
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
          <dd class="tabular-nums text-sm text-zinc-300 truncate">{{ item.gd_id ?? '—' }}</dd>
        </div>
      </dl>

      <!-- Metadata -->
      <dl class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div v-if="item.difficulty">
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
        <div v-if="item.position">
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
