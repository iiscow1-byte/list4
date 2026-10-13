<script setup lang="ts">
import { resolveVideo } from '~/utils/video-embed'
import { timeAgo, absoluteTime } from '~/utils/relative-time'

/**
 * The record queue: watch the run, decide, move on.
 *
 * It was a level page with the record's video pasted into the verification
 * slot, between a list that said "Level | Player" and a column of buttons. The
 * run itself (the percent, the refresh rate, the note) was nowhere on screen,
 * and every decision dropped you back at the top of the queue.
 *
 * Now the video leads, the facts sit under it, and the decision is in the bar
 * above it with keys for it: J and K to move, A to approve, R to write a
 * reason. A decision opens the next record, not the first.
 */
const emit = defineEmits<{ (e: 'changed'): void }>()

type PendingRec = {
  id: number
  level_id: number
  position: number
  level_name: string
  level_gd_id: number | null
  level_tier: string | null
  level_points: number | null
  level_verifier: string | null
  level_verification_url: string | null
  player_name: string
  percent: number
  hz: number | null
  video: string
  submitter_note: string | null
  submitted_at: string
  submitter: string | null
  submitter_pending: number
  is_verification_claim: number
}

const toast = useAdminToast()
const { confirm, state: dialogState } = useConfirmDialog()
const thumbs = useShowThumbnails()

const items = ref<PendingRec[]>([])
const loading = ref(true)
const selectedId = ref<number | null>(null)
const busy = ref<'approve' | 'reject' | 'bulk' | null>(null)
const reason = ref('')
const compare = ref(false)

const search = ref('')
const order = ref<'oldest' | 'newest'>('oldest')
const orderModel = computed({ get: () => order.value as string, set: (v: string) => { order.value = v as typeof order.value } })

async function load() {
  try {
    items.value = (await $fetch<{ items: PendingRec[] }>('/api/admin/records/pending')).items
    if (!items.value.some((r) => r.id === selectedId.value)) selectedId.value = visible.value[0]?.id ?? null
  } catch (e) {
    toast.fail(e, 'Could not load records.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  const rows = q
    ? items.value.filter((r) =>
        r.player_name.toLowerCase().includes(q)
        || r.level_name.toLowerCase().includes(q)
        || (r.submitter ?? '').toLowerCase().includes(q))
    : items.value
  return order.value === 'oldest' ? rows : [...rows].reverse()
})
const selected = computed(() => items.value.find((r) => r.id === selectedId.value) ?? null)
const selectedIndex = computed(() => visible.value.findIndex((r) => r.id === selectedId.value))

// A new record starts at the top, with an empty reason.
const reviewEl = ref<HTMLElement | null>(null)
watch(selectedId, () => {
  reason.value = ''
  compare.value = false
  reviewEl.value?.scrollTo({ top: 0 })
})

// The selected row stays in view when J/K walks past the edge of the list.
const listEl = ref<HTMLElement | null>(null)
function select(id: number | null) {
  selectedId.value = id
  nextTick(() => listEl.value?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
}
function step(by: 1 | -1) {
  const list = visible.value
  if (!list.length) return
  const i = selectedIndex.value
  const next = i < 0 ? 0 : Math.min(list.length - 1, Math.max(0, i + by))
  select(list[next]!.id)
}

/** Take decided records out locally and open the one after, instead of the top of the queue. */
function removeAndAdvance(ids: number[]) {
  const list = visible.value
  const i = selectedIndex.value
  const after = list.slice(i + 1).find((r) => !ids.includes(r.id)) ?? list.slice(0, Math.max(0, i)).reverse().find((r) => !ids.includes(r.id))
  // What the decided records leave behind in each submitter's own count.
  const gone = new Map<string, number>()
  for (const r of items.value) if (ids.includes(r.id) && r.submitter) gone.set(r.submitter, (gone.get(r.submitter) ?? 0) + 1)
  items.value = items.value
    .filter((r) => !ids.includes(r.id))
    .map((r) => (r.submitter && gone.has(r.submitter) ? { ...r, submitter_pending: Math.max(1, r.submitter_pending - gone.get(r.submitter)!) } : r))
  select(after?.id ?? null)
  emit('changed')
}

async function decide(action: 'approve' | 'reject') {
  const rec = selected.value
  if (!rec || busy.value) return
  busy.value = action
  try {
    await $fetch(`/api/admin/records/${rec.id}`, {
      method: 'POST',
      body: action === 'reject' ? { action, reason: reason.value.trim() || undefined } : { action },
    })
    toast.ok(action === 'approve'
      ? `Approved ${rec.player_name} on ${rec.level_name}.`
      : `Rejected${rec.submitter ? `, and told ${rec.submitter}` : ''}.`)
    removeAndAdvance([rec.id])
  } catch (e) {
    toast.fail(e)
  } finally {
    busy.value = null
  }
}

async function approveAllFromSubmitter() {
  const rec = selected.value
  if (!rec?.submitter || busy.value) return
  const n = rec.submitter_pending
  if (!(await confirm({
    title: `Approve all ${n} from ${rec.submitter}?`,
    message: `Every record ${rec.submitter} has waiting, including ones you haven’t opened. Each is announced on Discord.`,
    confirmLabel: `Approve ${n}`,
  }))) return
  busy.value = 'bulk'
  try {
    const res = await $fetch<{ approved: number }>('/api/admin/records/bulk-approve', { method: 'POST', body: { submitter: rec.submitter } })
    toast.ok(`Approved ${res.approved} ${res.approved === 1 ? 'record' : 'records'} from ${rec.submitter}.`)
    removeAndAdvance(items.value.filter((r) => r.submitter === rec.submitter).map((r) => r.id))
  } catch (e) {
    toast.fail(e)
  } finally {
    busy.value = null
  }
}

/** The usual reasons, one click each. Sent to the submitter as written. */
const REASONS = [
  'The video doesn’t show the whole run.',
  'No clicks or game audio, so the run can’t be checked.',
  'This is a different level, or a different version of it.',
  'The video is private, removed or won’t play.',
  'The run looks modified (speedhack, noclip or similar).',
  'This record is already on the list.',
]
const reasonBox = ref<HTMLTextAreaElement | null>(null)

// ---- Keys
function onKey(e: KeyboardEvent) {
  if (dialogState.value.open || e.metaKey || e.ctrlKey || e.altKey) return
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  const k = e.key.toLowerCase()
  if (k === 'j' || e.key === 'ArrowDown') { e.preventDefault(); step(1) }
  else if (k === 'k' || e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
  else if (k === 'a') { e.preventDefault(); decide('approve') }
  else if (k === 'r') { e.preventDefault(); reasonBox.value?.focus() }
}
function onReasonKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); decide('reject') }
  if (e.key === 'Escape') (e.target as HTMLElement).blur()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const playable = computed(() => resolveVideo(selected.value?.video).kind !== 'none')
function host(url: string | null | undefined): string {
  try { return new URL(url ?? '').hostname.replace(/^www\./, '') } catch { return 'the link' }
}
const fmtPoints = (n: number | null) => (n == null ? null : n.toLocaleString(undefined, { maximumFractionDigits: 2 }))
</script>

<template>
  <div class="h-full grid grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[20rem_minmax(0,1fr)]">
    <!-- ======================================================== Queue -->
    <aside
      class="flex-col min-h-0 border-r border-zinc-800 bg-zinc-950"
      :class="selected ? 'hidden lg:flex' : 'flex'"
    >
      <div class="p-3 border-b border-zinc-800 space-y-2 shrink-0">
        <div class="flex items-baseline justify-between gap-2">
          <h1 class="font-display font-semibold text-zinc-50">Records</h1>
          <span class="text-xs text-zinc-500 tabular-nums">
            {{ visible.length === items.length ? `${items.length.toLocaleString()} waiting` : `${visible.length} of ${items.length}` }}
          </span>
        </div>
        <input v-model="search" type="search" placeholder="Player, level or submitter" class="field field-sm" />
        <SegmentedControl
          v-model="orderModel"
          aria-label="Order"
          :options="[{ value: 'oldest', label: 'Oldest first' }, { value: 'newest', label: 'Newest first' }]"
        />
      </div>
      <div ref="listEl" class="flex-1 min-h-0 overflow-y-auto p-1.5">
        <div v-if="loading" class="space-y-1">
          <div v-for="n in 8" :key="n" class="h-12 rounded-lg bg-zinc-900/60 animate-pulse" />
        </div>
        <div v-else-if="!items.length" class="px-3 py-10 text-center">
          <p class="text-sm text-zinc-300">No records waiting.</p>
          <p class="text-xs text-zinc-500 mt-1">New submissions show up here.</p>
        </div>
        <p v-else-if="!visible.length" class="px-3 py-8 text-center text-xs text-zinc-500">Nothing matches “{{ search }}”.</p>
        <ul v-else class="space-y-0.5">
          <li v-for="r in visible" :key="r.id" :data-selected="r.id === selectedId">
            <LevelRow
              button
              :rank="`#${r.position.toLocaleString()}`"
              :name="r.level_name"
              :tier="r.level_tier"
              :gd-id="r.level_gd_id"
              :thumbs="thumbs"
              :selected="r.id === selectedId"
              @select="select(r.id)"
            >
              <span class="flex items-center gap-1.5 min-w-0">
                <span class="font-medium text-zinc-100 truncate">{{ r.player_name }}</span>
                <span v-if="r.percent < 100" class="shrink-0 text-[11px] font-semibold text-amber-300 tabular-nums">{{ r.percent }}%</span>
                <span v-if="r.is_verification_claim" class="shrink-0 text-[11px] font-semibold text-sky-300">verifier</span>
              </span>
              <template #sub>{{ r.level_name }} · {{ timeAgo(r.submitted_at) }}</template>
            </LevelRow>
          </li>
        </ul>
      </div>
      <p class="hidden lg:flex shrink-0 items-center gap-1.5 px-3 py-2 border-t border-zinc-800 text-[11px] text-zinc-500">
        <NavIcon name="keyboard" class="w-3.5 h-3.5" />
        <kbd class="kbd">J</kbd><kbd class="kbd">K</kbd> move · <kbd class="kbd">A</kbd> approve · <kbd class="kbd">R</kbd> reason
      </p>
    </aside>

    <!-- ======================================================== Review -->
    <section ref="reviewEl" class="min-h-0 overflow-y-auto" :class="selected ? '' : 'hidden lg:block'">
      <div v-if="!selected" class="h-full flex items-center justify-center p-12 text-center text-sm text-zinc-500">
        {{ loading ? 'Loading…' : items.length ? 'Pick a record on the left.' : 'Nothing to review.' }}
      </div>

      <template v-else>
        <!-- The record and the decision, always in view. -->
        <header class="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
          <div class="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
            <button type="button" class="lg:hidden btn btn-sm btn-ghost" @click="selectedId = null">← Queue</button>
            <div class="flex-1 min-w-[12rem]">
              <p class="font-display text-lg font-semibold text-zinc-50 leading-tight truncate">
                {{ selected.player_name }}
                <span class="text-zinc-500 font-normal">on</span>
                {{ selected.level_name }}
              </p>
              <p class="text-xs text-zinc-500 mt-0.5">
                <span :title="absoluteTime(selected.submitted_at)">Sent {{ timeAgo(selected.submitted_at) }}</span>
                <template v-if="selected.submitter">
                  by <NuxtLink :to="`/users/${selected.submitter}`" class="text-zinc-300 hover:text-accent">{{ selected.submitter }}</NuxtLink>
                </template>
                <span class="text-zinc-600"> · {{ selectedIndex + 1 }} of {{ visible.length }}</span>
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button"
                class="btn btn-md btn-ghost hover:border-red-700 hover:text-red-300"
                :disabled="!!busy"
                title="Reject (write a reason first with R)"
                @click="decide('reject')"
              >{{ busy === 'reject' ? 'Rejecting…' : 'Reject' }}</button>
              <button
                type="button"
                class="btn btn-md bg-emerald-600 text-white hover:bg-emerald-500"
                :disabled="!!busy"
                title="Approve (A)"
                @click="decide('approve')"
              >{{ busy === 'approve' ? 'Approving…' : 'Approve' }}<span class="hidden sm:inline-flex"><kbd class="kbd kbd-light">A</kbd></span></button>
            </div>
          </div>
        </header>

        <div class="max-w-4xl mx-auto px-4 sm:px-6 py-5 space-y-5">
          <!-- The run -->
          <VideoEmbed v-if="playable" :url="selected.video" :title="`${selected.player_name} on ${selected.level_name}`" />
          <a
            v-else
            :href="selected.video"
            target="_blank"
            rel="noopener noreferrer"
            class="card flex items-center gap-3 p-5 hover:border-zinc-600 transition-colors"
          >
            <NavIcon name="external" class="w-5 h-5 text-zinc-400 shrink-0" />
            <span class="min-w-0">
              <span class="block text-sm font-medium text-zinc-100">This video can’t play here. Open it on {{ host(selected.video) }}</span>
              <span class="block text-xs text-zinc-500 truncate">{{ selected.video }}</span>
            </span>
          </a>

          <dl class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div class="card px-3 py-2.5">
              <dt class="text-xs text-zinc-500">Progress</dt>
              <dd class="font-display text-lg font-semibold tabular-nums" :class="selected.percent >= 100 ? 'text-emerald-400' : 'text-amber-300'">{{ selected.percent }}%</dd>
            </div>
            <div class="card px-3 py-2.5">
              <dt class="text-xs text-zinc-500">Refresh rate</dt>
              <dd class="font-display text-lg font-semibold tabular-nums text-zinc-100">{{ selected.hz ? `${selected.hz} Hz` : '—' }}</dd>
            </div>
            <div class="card px-3 py-2.5">
              <dt class="text-xs text-zinc-500">Worth</dt>
              <dd class="font-display text-lg font-semibold tabular-nums text-zinc-100">
                <template v-if="selected.percent >= 100 && fmtPoints(selected.level_points)">{{ fmtPoints(selected.level_points) }} <span class="text-xs font-normal text-zinc-500">pts</span></template>
                <template v-else>—</template>
              </dd>
            </div>
            <div class="card px-3 py-2.5">
              <dt class="text-xs text-zinc-500">Their queue</dt>
              <dd class="font-display text-lg font-semibold tabular-nums text-zinc-100">{{ selected.submitter_pending || 1 }} <span class="text-xs font-normal text-zinc-500">waiting</span></dd>
            </div>
          </dl>

          <div
            v-if="selected.is_verification_claim"
            class="rounded-md border px-3.5 py-2.5 text-sm"
            :class="selected.level_verifier ? 'border-zinc-800 bg-zinc-900/40 text-zinc-400' : 'border-sky-800/60 bg-sky-950/30 text-sky-200'"
          >
            <template v-if="!selected.level_verifier">
              <span class="font-medium">Verifier claim.</span> Approving makes {{ selected.player_name }} this level’s verifier.
            </template>
            <template v-else>
              Sent as the verification, but the level already lists {{ selected.level_verifier }} as verifier, so that part is ignored.
            </template>
          </div>

          <div v-if="selected.submitter_note" class="card px-4 py-3">
            <p class="text-xs text-zinc-500 mb-1">Note from {{ selected.submitter ?? 'the submitter' }}</p>
            <p class="text-sm text-zinc-200 whitespace-pre-wrap">{{ selected.submitter_note }}</p>
          </div>

          <!-- The level, to check the run is the right one. -->
          <div>
            <p class="text-xs text-zinc-500 mb-1.5">Level</p>
            <a :href="`/levels/${selected.position}`" target="_blank" rel="noopener" class="block card p-1">
              <LevelRow
                :rank="`#${selected.position.toLocaleString()}`"
                :name="selected.level_name"
                :tier="selected.level_tier"
                :gd-id="selected.level_gd_id"
                :thumbs="thumbs"
              >
                <template #sub>{{ selected.level_tier ?? 'No tier' }}<template v-if="selected.level_verifier"> · verified by {{ selected.level_verifier }}</template></template>
                <template #trailing><NavIcon name="external" class="w-4 h-4 text-zinc-500" /></template>
              </LevelRow>
            </a>
            <button
              v-if="selected.level_verification_url"
              type="button"
              class="mt-2 text-xs link"
              @click="compare = !compare"
            >{{ compare ? 'Hide the level’s verification' : 'Compare with the level’s verification' }}</button>
            <VideoEmbed v-if="compare" :url="selected.level_verification_url" :title="`${selected.level_name} verification`" class="mt-2" />
          </div>

          <!-- Reject with a reason -->
          <div class="card p-4">
            <label for="reject-reason" class="text-sm font-medium text-zinc-100">Reason, if you reject it</label>
            <p class="text-xs text-zinc-500 mt-0.5">Sent to {{ selected.submitter ?? 'the submitter' }} in their inbox. Pick one or write your own.</p>
            <div class="mt-2.5 flex flex-wrap gap-1.5">
              <button
                v-for="r in REASONS"
                :key="r"
                type="button"
                class="chip hover:border-zinc-600 hover:text-zinc-100 transition-colors"
                :class="reason === r ? 'border-red-700/70 text-red-200 bg-red-950/30' : ''"
                @click="reason = reason === r ? '' : r"
              >{{ r }}</button>
            </div>
            <textarea
              id="reject-reason"
              ref="reasonBox"
              v-model="reason"
              rows="2"
              maxlength="4000"
              placeholder="Optional"
              class="field field-sm mt-2.5"
              @keydown="onReasonKey"
            />
            <div class="mt-2.5 flex items-center justify-between gap-3 flex-wrap">
              <span class="text-[11px] text-zinc-500 hidden sm:inline"><kbd class="kbd">Ctrl</kbd> + <kbd class="kbd">Enter</kbd> rejects</span>
              <button type="button" class="btn btn-sm btn-danger ml-auto" :disabled="!!busy" @click="decide('reject')">
                {{ reason.trim() ? 'Reject with this reason' : 'Reject without a reason' }}
              </button>
            </div>
          </div>

          <div v-if="selected.submitter && selected.submitter_pending > 1" class="flex items-center justify-between gap-3 flex-wrap rounded-md border border-zinc-800 px-4 py-3">
            <p class="text-sm text-zinc-400">
              {{ selected.submitter }} has <span class="text-zinc-100 tabular-nums">{{ selected.submitter_pending }}</span> records waiting.
            </p>
            <button type="button" class="btn btn-sm btn-ghost" :disabled="!!busy" @click="approveAllFromSubmitter">
              {{ busy === 'bulk' ? 'Approving…' : `Approve all ${selected.submitter_pending}` }}
            </button>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.kbd {
  @apply inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded border border-zinc-700 bg-zinc-900 font-sans text-[10px] font-semibold text-zinc-300;
}
.kbd-light {
  @apply border-white/40 bg-transparent text-white;
}
</style>
