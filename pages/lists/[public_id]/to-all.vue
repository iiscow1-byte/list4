<script setup lang="ts">
import { anchorsFromItems, estimateAt } from '~/utils/tier-ordinal'
import { youtubeIdFrom } from '~/utils/level-thumbs'

/**
 * Submit this list's levels to the ALL list in bulk.
 *
 * Only levels the ALL doesn't already carry are offered. Each row is prefilled
 * from what the list knows, with the tier and placement estimated from the
 * neighbours that *are* on the ALL — the ordering a curated list encodes is
 * exactly the information a placement estimate wants.
 */
definePageMeta({ layout: 'level' })

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const { list, base, refresh, req } = useCustomList(publicId)
// The drafts are built from the list during setup, so the list has to be here
// by then. Without this the server rendered "every level is already on the ALL"
// and the real rows only appeared after hydration.
await req

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

type Draft = {
  item_id: number
  rank: number
  name: string
  gd_id: string
  verifier: string
  verify_date: string
  verification_url: string
  gddl_tier: string
  placement_estimate: string
  selected: boolean
  basis: string | null
}

const drafts = ref<Draft[]>([])

/** Rebuild the drafts whenever the list loads or changes underneath us. */
function seed() {
  const items = list.value?.items ?? []
  // Read the anchors once for the whole list rather than re-scanning it for
  // every row — a 250-level list would otherwise walk it 250 times.
  const anchors = anchorsFromItems(items as any[])
  drafts.value = items
    // A row already linked to an ALL level is by definition already there.
    .map((it: any, idx: number) => ({ it, idx }))
    .filter(({ it }) => it.level_id == null)
    .map(({ it, idx }) => {
      const est = estimateAt(anchors, idx)
      return {
        item_id: it.id,
        rank: it.rank,
        name: it.name ?? '',
        gd_id: it.gd_id != null ? String(it.gd_id) : '',
        verifier: it.verifier ?? '',
        verify_date: '',
        verification_url: it.verification_url ?? '',
        gddl_tier: it.gddl_tier || est.tier || '',
        placement_estimate: est.placement != null ? String(est.placement) : '',
        // Rows missing something required start unticked, so "Submit" doesn't
        // immediately report a wall of skips.
        selected: !!(it.gd_id && it.verifier && it.verification_url),
        basis: est.basis,
      }
    })
  // Client-only: the date lookup is a third-party round trip, not something a
  // server render should wait on.
  if (import.meta.client && drafts.value.length) fillDatesFromVideos()
}

const selected = computed(() => drafts.value.filter((d) => d.selected))

/** What each row is still missing, so the gaps are visible before submitting. */
function missing(d: Draft): string[] {
  const gaps: string[] = []
  if (!d.gd_id.trim()) gaps.push('level ID')
  if (!d.verifier.trim()) gaps.push('verifier')
  if (!d.verification_url.trim()) gaps.push('video')
  if (!d.verify_date.trim()) gaps.push('verify date')
  return gaps
}
const readyCount = computed(() => selected.value.filter((d) => missing(d).length === 0).length)

function toggleAll(on: boolean) {
  for (const d of drafts.value) d.selected = on
}

/**
 * Fill each row's verification date from its video's upload date.
 *
 * The single submit form has done this for one video for a long time; a list
 * submitted in bulk arrived with every date blank, which made "verify date" the
 * one thing standing between a curated list and a batch submission. Asked in
 * chunks of 50 because that's what one YouTube API request covers.
 */
const CHUNK = 50
const datesBusy = ref(false)
const datesFilled = ref<number | null>(null)
/** Videos already asked about, so re-seeding the drafts doesn't re-query them. */
const dateCache = new Map<string, string | null>()

async function fillDatesFromVideos(rows: Draft[] = drafts.value) {
  if (datesBusy.value) return
  const wanted = new Map<string, Draft[]>()
  for (const d of rows) {
    if (d.verify_date) continue
    const id = youtubeIdFrom(d.verification_url)
    if (!id) continue
    const cached = dateCache.get(id)
    if (cached !== undefined) {
      if (cached) d.verify_date = cached
      continue
    }
    const bucket = wanted.get(id)
    if (bucket) bucket.push(d)
    else wanted.set(id, [d])
  }
  if (!wanted.size) return

  datesBusy.value = true
  let filled = 0
  try {
    const ids = [...wanted.keys()]
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK)
      const res = await $fetch<{ dates: Record<string, string> }>('/api/youtube/upload-date', {
        query: { ids: slice.join(',') },
      })
      for (const id of slice) {
        const date = res?.dates?.[id] ?? null
        dateCache.set(id, date)
        if (!date) continue
        for (const d of wanted.get(id) ?? []) {
          // Never overwrite something typed while the lookup was in flight.
          if (!d.verify_date) { d.verify_date = date; filled++ }
        }
      }
    }
    datesFilled.value = filled
  } catch {
    // Non-fatal: the dates stay blank and can be typed or bulk-applied.
  } finally {
    datesBusy.value = false
  }
}

/** A row whose video link is edited by hand gets its own lookup. */
let rowDateTimer: ReturnType<typeof setTimeout> | null = null
function onVideoEdited(d: Draft) {
  if (rowDateTimer) clearTimeout(rowDateTimer)
  rowDateTimer = setTimeout(() => fillDatesFromVideos([d]), 600)
}

// Declared after everything `seed` touches: the watcher fires immediately, and
// a `const` referenced before its own initialiser is a runtime error, not a
// hoisting convenience.
watch(list, seed, { immediate: true })

/** One date for the whole batch — usually they were all verified long ago. */
const bulkDate = ref('')
function applyBulkDate() {
  if (!bulkDate.value) return
  for (const d of selected.value) if (!d.verify_date) d.verify_date = bulkDate.value
}

const busy = ref(false)
const error = ref<string | null>(null)
type Outcome = { item_id: number | null; name: string; status: 'submitted' | 'skipped'; reason?: string }
const outcomes = ref<Outcome[] | null>(null)

async function submitBatch() {
  if (busy.value || !selected.value.length) return
  busy.value = true
  error.value = null
  outcomes.value = null
  try {
    const res = await $fetch<{ submitted: number; skipped: number; results: Outcome[] }>(
      `/api/custom-lists/${publicId.value}/submit-to-all`,
      {
        method: 'POST',
        body: {
          items: selected.value.map((d) => ({
            item_id: d.item_id,
            name: d.name,
            gd_id: d.gd_id,
            verifier: d.verifier,
            verify_date: d.verify_date,
            verification_url: d.verification_url,
            gddl_tier: d.gddl_tier || null,
            placement_estimate: d.placement_estimate || null,
          })),
        },
      },
    )
    outcomes.value = res.results
    // Clear the ones that went through, so a second press can't double-submit.
    const done = new Set(res.results.filter((r) => r.status === 'submitted').map((r) => r.item_id))
    for (const d of drafts.value) if (done.has(d.item_id)) d.selected = false
    await refresh()
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not submit those levels.'
  } finally {
    busy.value = false
  }
}

const field = 'w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs placeholder:text-zinc-700 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'

useHead(() => ({ title: list.value ? `Submit to the ALL — ${list.value.title}` : 'Submit to the ALL' }))
</script>

<template>
  <CustomListShell :public-id="publicId" width="wide">
    <template #default>
      <header class="mb-4">
        <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Submit to the ALL</h2>
        <p class="text-sm text-zinc-400 mt-1 max-w-2xl">
          Levels on this list that the ALL doesn't carry yet. Tiers and placements are estimated
          from the neighbours on this list that <em>are</em> on the ALL — check them before
          submitting. Everything goes to the moderators for review, same as a normal submission.
        </p>
      </header>

      <div v-if="!me" class="card px-6 py-16 text-center">
        <p class="text-sm text-zinc-400">
          <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink>
          to submit levels to the ALL.
        </p>
      </div>

      <div v-else-if="!drafts.length" class="card px-6 py-16 text-center">
        <p class="text-sm text-zinc-400">Every level on this list is already on the ALL.</p>
        <NuxtLink :to="base" class="text-accent hover:underline text-xs mt-2 inline-block">Back to the list →</NuxtLink>
      </div>

      <template v-else>
        <!-- Batch controls -->
        <div class="card p-3 mb-3 flex flex-wrap items-end gap-3">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded-lg border border-zinc-700 text-zinc-300 text-[11px] px-2.5 py-1 hover:border-zinc-500 transition-colors"
              @click="toggleAll(true)"
            >Select all</button>
            <button
              type="button"
              class="rounded-lg border border-zinc-700 text-zinc-300 text-[11px] px-2.5 py-1 hover:border-zinc-500 transition-colors"
              @click="toggleAll(false)"
            >Select none</button>
          </div>

          <label class="block">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500">Verify date for all selected</span>
            <div class="mt-1 flex items-center gap-1.5">
              <input v-model="bulkDate" type="date" :class="field" class="!w-auto" />
              <button
                type="button"
                :disabled="!bulkDate"
                class="rounded-lg border border-zinc-700 text-zinc-300 text-[11px] px-2.5 py-1 hover:border-zinc-500 disabled:opacity-40 transition-colors"
                @click="applyBulkDate"
              >Apply</button>
              <button
                type="button"
                :disabled="datesBusy"
                class="rounded-lg border border-zinc-700 text-zinc-300 text-[11px] px-2.5 py-1 hover:border-zinc-500 disabled:opacity-40 transition-colors"
                title="Read each blank date from its verification video's upload date"
                @click="fillDatesFromVideos()"
              >{{ datesBusy ? 'Reading videos…' : 'From videos' }}</button>
            </div>
            <span v-if="datesFilled != null && !datesBusy" class="text-[10px] text-zinc-600">
              {{ datesFilled === 0 ? 'No dates found from the videos.' : `Filled ${datesFilled} from video upload dates.` }}
            </span>
          </label>

          <div class="ml-auto text-right">
            <p class="text-[11px] text-zinc-500 tabular-nums">
              {{ selected.length }} selected · <span class="text-zinc-300">{{ readyCount }}</span> ready
            </p>
            <button
              type="button"
              :disabled="busy || readyCount === 0"
              class="mt-1 rounded-lg bg-accent text-zinc-950 font-semibold text-xs px-3 py-1.5 hover:bg-accent/90 disabled:opacity-50 transition-colors"
              @click="submitBatch"
            >{{ busy ? 'Submitting…' : `Submit ${readyCount} level${readyCount === 1 ? '' : 's'}` }}</button>
          </div>
        </div>

        <p v-if="error" class="text-xs text-red-400 mb-3">{{ error }}</p>

        <!-- Outcome report -->
        <div v-if="outcomes" class="card p-3 mb-3 space-y-1">
          <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Result</h3>
          <p
            v-for="(o, i) in outcomes"
            :key="i"
            class="text-[11px] flex items-baseline gap-2"
            :class="o.status === 'submitted' ? 'text-emerald-400' : 'text-amber-400'"
          >
            <span class="shrink-0">{{ o.status === 'submitted' ? '✓' : '—' }}</span>
            <span class="text-zinc-300 truncate">{{ o.name }}</span>
            <span v-if="o.reason" class="text-zinc-500">{{ o.reason }}</span>
            <span v-else class="text-zinc-600">sent for review</span>
          </p>
        </div>

        <!-- Rows -->
        <ul class="card divide-y divide-zinc-900/60 overflow-hidden">
          <li v-for="d in drafts" :key="d.item_id" class="p-3">
            <div class="flex items-start gap-3">
              <input
                v-model="d.selected"
                type="checkbox"
                class="mt-1 accent-accent shrink-0"
                :aria-label="`Submit ${d.name}`"
              />
              <div class="min-w-0 flex-1 space-y-2">
                <div class="flex items-baseline gap-2 flex-wrap">
                  <span class="text-[11px] tabular-nums text-zinc-600">#{{ d.rank }}</span>
                  <span class="text-sm font-medium text-zinc-100 truncate">{{ d.name }}</span>
                  <span
                    v-if="missing(d).length"
                    class="text-[10px] text-amber-400/90"
                  >needs {{ missing(d).join(', ') }}</span>
                  <span v-if="d.basis" class="text-[10px] text-zinc-600 ml-auto">{{ d.basis }}</span>
                </div>

                <div class="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <label class="block">
                    <span class="text-[9px] uppercase tracking-widest text-zinc-600">Level ID</span>
                    <input v-model="d.gd_id" inputmode="numeric" :class="field" />
                  </label>
                  <label class="block">
                    <span class="text-[9px] uppercase tracking-widest text-zinc-600">Verifier</span>
                    <input v-model="d.verifier" :class="field" />
                  </label>
                  <label class="block">
                    <span class="text-[9px] uppercase tracking-widest text-zinc-600">Verified on</span>
                    <input v-model="d.verify_date" type="date" :class="field" />
                  </label>
                  <label class="block lg:col-span-2">
                    <span class="text-[9px] uppercase tracking-widest text-zinc-600">Verification video</span>
                    <input
                      v-model="d.verification_url"
                      placeholder="https://youtube.com/…"
                      :class="field"
                      @input="onVideoEdited(d)"
                    />
                  </label>
                  <div class="grid grid-cols-2 gap-2">
                    <label class="block">
                      <span class="text-[9px] uppercase tracking-widest text-zinc-600">Tier</span>
                      <input v-model="d.gddl_tier" placeholder="Tier 12" :class="field" />
                    </label>
                    <label class="block">
                      <span class="text-[9px] uppercase tracking-widest text-zinc-600">At #</span>
                      <input v-model="d.placement_estimate" inputmode="numeric" :class="field" />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </li>
        </ul>
      </template>
    </template>
  </CustomListShell>
</template>
