<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

/**
 * Levels an imported list ranks differently to the ALL, and one button to
 * accept its opinion.
 *
 * Importing a list has always surfaced the levels the ALL is *missing*. This is
 * the other half: the levels both lists carry, ordered differently. Rows are
 * the smallest set that would have to move for the two orderings to agree, so
 * the list is short enough to actually work through.
 *
 * Sorted by how firm the answer is, not by how big the move is. A level the
 * source list has rearranged since it was placed here has known new
 * neighbours — that's an `exact` row, it's the case this tab is for, and it
 * belongs at the top whether it moved four places or four thousand.
 */
type Movement = {
  level_id: number
  name: string
  gd_id: number | null
  gddl_tier: string | null
  source_position: number
  from_position: number
  from_placement: number | null
  to_position: number
  to_placement: number | null
  distance: number
  basis: string | null
  confidence: 'exact' | 'bracketed' | 'open'
  dismissed: boolean
}
type SourceSummary = {
  key: string; label: string; shared: number; disagreements: number; dismissed: number
}
type Payload = {
  sources: SourceSummary[]
  source: string | null
  label?: string
  shared: number
  total: number
  items: Movement[]
}

const sources = ref<SourceSummary[]>([])
const source = ref<string>('')
const items = ref<Movement[]>([])
const shared = ref(0)
const total = ref(0)
const showDismissed = ref(false)
const loading = ref(false)
const loadError = ref<string | null>(null)
const banner = ref<{ kind: 'ok' | 'err'; msg: string } | null>(null)
const busyId = ref<number | null>(null)
const applyingAll = ref(false)
const picked = ref<Set<number>>(new Set())

function flash(kind: 'ok' | 'err', msg: string) {
  banner.value = { kind, msg }
  setTimeout(() => (banner.value = null), 4000)
}

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const res = await $fetch<Payload>('/api/admin/imported-movements', {
      query: {
        source: source.value || undefined,
        dismissed: showDismissed.value ? '1' : undefined,
      },
    })
    sources.value = res.sources
    // First visit: open whichever list has the most to say. Setting `source`
    // trips the watcher, which reloads — so this returns rather than calling
    // `load()` itself, or every first visit costs two requests.
    if (!source.value && res.sources.length) {
      source.value = res.sources[0]!.key
      return
    }
    items.value = res.items
    shared.value = res.shared
    total.value = res.total
    picked.value = new Set()
  } catch (e: any) {
    loadError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Could not read the imported lists.'
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch([source, showDismissed], load)

const current = computed(() => sources.value.find((s) => s.key === source.value) ?? null)
const actionable = computed(() => items.value.filter((i) => !i.dismissed))

function toggle(id: number) {
  const next = new Set(picked.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  picked.value = next
}
function pickAll(on: boolean) {
  picked.value = on ? new Set(actionable.value.map((i) => i.level_id)) : new Set()
}

async function applyOne(m: Movement) {
  if (busyId.value != null) return
  busyId.value = m.level_id
  try {
    const res = await $fetch<{ moved: number; results: Array<{ name: string; from: number; to: number; moved: boolean; reason?: string }> }>(
      '/api/admin/imported-movements/apply',
      { method: 'POST', body: { source: source.value, level_id: m.level_id } },
    )
    const r = res.results[0]
    if (r?.moved) flash('ok', `${r.name} moved to #${r.to.toLocaleString()}.`)
    else flash('err', r?.reason ?? 'Nothing moved.')
    await load()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  } finally {
    busyId.value = null
  }
}

async function applyPicked() {
  const ids = [...picked.value]
  if (!ids.length || applyingAll.value) return
  if (!confirm(`Move ${ids.length} level${ids.length === 1 ? '' : 's'} to where ${current.value?.label ?? 'this list'} puts them?`)) return
  applyingAll.value = true
  try {
    const res = await $fetch<{ moved: number; results: Array<{ moved: boolean; reason?: string }> }>(
      '/api/admin/imported-movements/apply',
      { method: 'POST', body: { source: source.value, level_ids: ids } },
    )
    const skipped = res.results.filter((r) => !r.moved).length
    flash('ok', `Moved ${res.moved}${skipped ? `, skipped ${skipped}` : ''}.`)
    await load()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  } finally {
    applyingAll.value = false
  }
}

async function dismiss(m: Movement, undo = false) {
  if (busyId.value != null) return
  busyId.value = m.level_id
  try {
    await $fetch('/api/admin/imported-movements/dismiss', {
      method: 'POST',
      body: { source: source.value, level_id: m.level_id, source_position: m.source_position, undo },
    })
    await load()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  } finally {
    busyId.value = null
  }
}

const shortTier = (t: string | null) => (t ? t.replace('Subtier ', 'S').replace('Tier ', 'T') : '')
</script>

<template>
  <div class="flex flex-col min-h-0">
    <!-- List picker -->
    <div class="shrink-0 border-b border-zinc-800 bg-zinc-950 px-4 py-3">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold text-zinc-100">Imported movements</h2>
          <p class="text-xs text-zinc-500 mt-0.5 max-w-2xl">
            Levels an imported list and the ALL both carry, ranked differently. Each row is a level
            that would have to move for the two orderings to agree, and where that list's ordering
            puts it relative to the levels the two already agree about.
          </p>
        </div>
        <label class="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none shrink-0">
          <input v-model="showDismissed" type="checkbox" class="accent-accent" />
          Show dismissed
        </label>
      </div>

      <div v-if="sources.length" class="mt-3 flex gap-1.5 flex-wrap">
        <button
          v-for="s in sources"
          :key="s.key"
          type="button"
          class="rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border"
          :class="source === s.key
            ? 'bg-accent/10 text-accent border-accent/30'
            : 'border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700'"
          @click="source = s.key"
        >
          {{ s.label.split(' — ')[0] }}
          <span class="ml-1 tabular-nums" :class="s.disagreements ? 'text-amber-300' : 'text-zinc-600'">{{ s.disagreements }}</span>
        </button>
      </div>
      <p v-else-if="!loading" class="mt-3 text-xs text-zinc-600">
        No imported list shares levels with the ALL yet — run an import first.
      </p>
    </div>

    <div v-if="banner" class="shrink-0 px-4 pt-3">
      <div
        class="rounded border px-3 py-2 text-sm"
        :class="banner.kind === 'ok'
          ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-300'
          : 'border-red-900/50 bg-red-950/30 text-red-300'"
      >{{ banner.msg }}</div>
    </div>

    <!-- Batch bar -->
    <div v-if="actionable.length" class="shrink-0 px-4 py-2 border-b border-zinc-900 flex items-center gap-3 flex-wrap">
      <p class="text-[11px] text-zinc-500 tabular-nums">
        <span class="text-zinc-300">{{ total.toLocaleString() }}</span> disagreement{{ total === 1 ? '' : 's' }}
        of {{ shared.toLocaleString() }} shared level{{ shared === 1 ? '' : 's' }}
        <span v-if="items.length < total"> · showing the {{ items.length }} largest</span>
      </p>
      <div class="ml-auto flex items-center gap-2">
        <button
          type="button"
          class="rounded border border-zinc-700 text-zinc-300 text-[11px] px-2.5 py-1 hover:border-zinc-500 transition-colors"
          @click="pickAll(picked.size !== actionable.length)"
        >{{ picked.size === actionable.length ? 'Select none' : 'Select all' }}</button>
        <button
          type="button"
          :disabled="!picked.size || applyingAll"
          class="rounded bg-accent text-zinc-950 font-medium text-xs px-3 py-1 hover:bg-accent/90 disabled:opacity-40 transition-colors"
          @click="applyPicked"
        >{{ applyingAll ? 'Moving…' : `Move ${picked.size} selected` }}</button>
      </div>
    </div>

    <!-- Rows -->
    <div class="flex-1 min-h-0 overflow-y-auto">
      <p v-if="loading" class="px-4 py-16 text-center text-sm text-zinc-500">Comparing lists…</p>
      <p v-else-if="loadError" class="px-4 py-16 text-center text-sm text-red-400">{{ loadError }}</p>
      <p v-else-if="!items.length && source" class="px-4 py-16 text-center text-sm text-zinc-500">
        The ALL agrees with {{ current?.label ?? 'this list' }} about every level they share.
      </p>

      <ul v-else class="divide-y divide-zinc-900/60">
        <li
          v-for="m in items"
          :key="m.level_id"
          class="relative overflow-hidden group"
          :class="{ 'opacity-50': m.dismissed }"
        >
          <LevelThumbBg
            :gd-id="m.gd_id"
            res="small"
            img-class="opacity-[0.10] group-hover:opacity-20"
            overlay-class="bg-gradient-to-r from-zinc-950/95 via-zinc-950/85 to-zinc-950/60"
          />
          <div class="relative px-4 py-3 flex items-center gap-3">
            <input
              v-if="!m.dismissed"
              type="checkbox"
              class="accent-accent shrink-0"
              :checked="picked.has(m.level_id)"
              :aria-label="`Select ${m.name}`"
              @change="toggle(m.level_id)"
            />
            <span v-else class="w-[13px] shrink-0" />

            <span
              v-if="m.gddl_tier"
              class="shrink-0 text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold leading-none"
              :style="{ backgroundColor: tierColor(m.gddl_tier), color: textOn(tierColor(m.gddl_tier)) }"
              :title="m.gddl_tier"
            >{{ shortTier(m.gddl_tier) }}</span>

            <div class="min-w-0 flex-1">
              <span class="flex items-baseline gap-2">
                <NuxtLink
                  :to="`/levels/${m.from_position}`"
                  class="text-sm font-medium text-zinc-100 hover:text-accent transition-colors truncate"
                >{{ m.name }}</NuxtLink>
                <span
                  v-if="m.confidence !== 'exact'"
                  class="shrink-0 text-[9px] uppercase tracking-widest px-1 py-px rounded border border-zinc-800 bg-zinc-900 text-zinc-500"
                  :title="m.confidence === 'bracketed'
                    ? 'Other levels are moving into the same gap — the order is right, the exact slots settle as each is applied'
                    : 'Only one side is anchored, so this is “after X” rather than a slot between two known levels'"
                >{{ m.confidence }}</span>
              </span>
              <p class="text-[11px] text-zinc-600 truncate">
                #{{ m.source_position.toLocaleString() }} on the list
                <template v-if="m.basis"> · {{ m.basis }}</template>
              </p>
            </div>

            <div class="shrink-0 text-right tabular-nums">
              <p class="text-sm font-semibold">
                <span class="text-zinc-500">#{{ (m.from_placement ?? m.from_position).toLocaleString() }}</span>
                <span class="text-zinc-700 mx-1">→</span>
                <span class="text-accent">#{{ (m.to_placement ?? m.to_position).toLocaleString() }}</span>
              </p>
              <p class="text-[10px]" :class="m.distance < 0 ? 'text-sky-400' : 'text-amber-400'">
                {{ m.distance < 0 ? '▲' : '▼' }} {{ Math.abs(m.distance).toLocaleString() }}
              </p>
            </div>

            <div class="shrink-0 flex items-center gap-1.5">
              <template v-if="!m.dismissed">
                <button
                  type="button"
                  :disabled="busyId != null"
                  class="rounded bg-accent text-zinc-950 font-medium text-xs px-2.5 py-1 hover:bg-accent/90 disabled:opacity-40 transition-colors"
                  :title="`Move ${m.name} to #${(m.to_placement ?? m.to_position).toLocaleString()}`"
                  @click="applyOne(m)"
                >{{ busyId === m.level_id ? '…' : 'Move' }}</button>
                <button
                  type="button"
                  :disabled="busyId != null"
                  class="rounded border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700 text-xs px-2.5 py-1 disabled:opacity-40 transition-colors"
                  title="We disagree with this list here on purpose"
                  @click="dismiss(m)"
                >Keep</button>
              </template>
              <button
                v-else
                type="button"
                :disabled="busyId != null"
                class="rounded border border-zinc-800 text-zinc-500 hover:text-zinc-300 text-xs px-2.5 py-1 disabled:opacity-40 transition-colors"
                @click="dismiss(m, true)"
              >Undismiss</button>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
