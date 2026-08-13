<script setup lang="ts">
import { relativeTime, absoluteTime } from '~/utils/relative-time'

/**
 * Everything that has happened to the list, in one place.
 *
 * The rest of the admin panel answers "what is waiting for me?" — there is a
 * queue per kind of submission. None of it answers "what happened?", which is
 * the question you ask when something is wrong: who moved that level, who
 * approved that record, when did this account's role change.
 *
 * ## Why it is sectioned rather than one stream
 *
 * One stream sorted by time is technically complete and practically unusable:
 * the ordinary run of work buries the handful of entries anybody is ever
 * looking for. So it is cut three ways at once, and all three narrow at the
 * same time —
 *
 *   - **Area** is what kind of thing happened (levels, records, accounts…).
 *   - **Severity** is how much it matters, and defaults to hiding the routine.
 *   - **Range** is how far back, because "recently" is what the page is for.
 *
 * Every row also carries the two things you act on: who did it, and what they
 * did it to. Both are links, so the log is a way *into* the thing that went
 * wrong rather than a description of it.
 */
type Row = {
  id: number
  kind: string
  area: string
  actor_id: number | null
  actor_name: string | null
  actor_role: string | null
  subject_kind: string | null
  subject_id: number | null
  subject_label: string | null
  summary: string
  detail: string | null
  severity: 'info' | 'notable' | 'warning'
  created_at: string
  /**
   * The label for this row's Undo button, or null when there isn't one.
   *
   * Decided by the server — see `activity-undo.ts` — rather than by a list of
   * kinds kept here, so a button can never appear for something the endpoint
   * would refuse, or fail to appear for something it would accept.
   */
  undo: string | null
  undone_at: string | null
  undone_by_name: string | null
}
type Section = { id: string; label: string; blurb: string }

const area = ref('all')
const severity = ref<'info' | 'notable'>('notable')
const days = ref(30)
const search = ref('')
const debounced = ref('')
let timer: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { debounced.value = v.trim() }, 250)
})
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })

const PAGE = 60
const offset = ref(0)
// Any change to what is being asked for starts again at the top.
watch([area, severity, days, debounced], () => { offset.value = 0 })

const { data, pending, refresh } = await useFetch<{
  total: number
  items: Row[]
  counts: Record<string, number>
  sections: Section[]
}>('/api/admin/log', {
  query: computed(() => ({
    area: area.value,
    severity: severity.value,
    days: days.value,
    q: debounced.value || undefined,
    limit: PAGE,
    offset: offset.value,
  })),
})

const rows = computed(() => data.value?.items ?? [])

/**
 * Undo one entry.
 *
 * Confirmed first, because this is a write dressed as a link in a list of
 * links, and the row above the one you meant is somebody else's role change.
 *
 * The error is kept per row rather than in one banner: the useful failures here
 * are all about *this* entry — already undone, or superseded by a later change
 * — and a message at the top of the page would leave you guessing which of
 * sixty rows it referred to.
 */
const undoing = ref<number | null>(null)
const undoError = reactive<Record<number, string>>({})

async function undo(r: Row) {
  if (undoing.value) return
  if (!confirm(`${r.undo}?\n\n${r.summary}\n\nThis performs the opposite action and records it in the log.`)) return
  undoing.value = r.id
  delete undoError[r.id]
  try {
    await $fetch(`/api/admin/log/${r.id}/undo`, { method: 'POST' })
    await refresh()
  } catch (e: any) {
    undoError[r.id] = e?.data?.statusMessage ?? 'Could not undo that.'
  } finally {
    undoing.value = null
  }
}
const sections = computed(() => data.value?.sections ?? [])
const total = computed(() => data.value?.total ?? 0)
const shownTo = computed(() => Math.min(offset.value + PAGE, total.value))

/** Expanded rows, by id — `detail` is JSON and only worth reading on demand. */
const open = reactive<Record<number, boolean>>({})
function prettyDetail(row: Row): string {
  if (!row.detail) return ''
  try { return JSON.stringify(JSON.parse(row.detail), null, 2) } catch { return row.detail }
}

const SEVERITY_STYLE: Record<Row['severity'], { dot: string; label: string }> = {
  info: { dot: 'bg-zinc-600', label: 'Routine' },
  notable: { dot: 'bg-sky-400', label: 'Notable' },
  warning: { dot: 'bg-amber-400', label: 'Needs attention' },
}

/**
 * Where a row's subject lives, when the site can say.
 *
 * Returns null rather than a guess for the kinds that have no page of their own
 * — a dead link in a log is worse than plain text, because it reads as though
 * the thing is still there.
 */
function subjectLink(r: Row): string | null {
  if (!r.subject_id) return null
  switch (r.subject_kind) {
    case 'level': return `/levels/${r.subject_id}`
    case 'account': return r.subject_label ? `/users/${encodeURIComponent(r.subject_label)}` : null
    case 'forum_thread': return `/community/thread/${r.subject_id}`
    default: return null
  }
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- Controls. One row, because all three narrow the same list and reading
         them together is how you know what you are looking at. -->
    <div class="shrink-0 border-b border-zinc-800/80 p-3 space-y-2.5">
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="search"
          type="search"
          placeholder="Search what happened, who did it, or what to…"
          class="field field-sm flex-1 min-w-[14rem] text-xs"
        />
        <SegmentedControl
          v-model="severity"
          size="sm"
          aria-label="How much detail"
          :options="[
            { value: 'notable', label: 'Notable' },
            { value: 'info', label: 'Everything' },
          ]"
        />
        <select v-model.number="days" class="field field-sm w-auto text-xs" aria-label="How far back">
          <option :value="1">Last 24 hours</option>
          <option :value="7">Last 7 days</option>
          <option :value="30">Last 30 days</option>
          <option :value="90">Last 90 days</option>
          <option :value="365">Last year</option>
        </select>
        <button
          type="button"
          class="btn btn-sm btn-ghost shrink-0"
          :disabled="pending"
          @click="refresh()"
        >{{ pending ? '…' : 'Refresh' }}</button>
      </div>

      <!-- Sections. Each carries its own count for the current filters, so
           picking one is an informed choice rather than a guess. -->
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="s in sections"
          :key="s.id"
          type="button"
          class="px-2 py-0.5 rounded-lg border text-[11px] transition-colors"
          :class="area === s.id
            ? 'border-accent/60 text-accent bg-accent/10'
            : 'border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'"
          :title="s.blurb"
          @click="area = s.id"
        >
          {{ s.label }}
          <span v-if="data?.counts?.[s.id]" class="tabular-nums text-zinc-600 ml-0.5">
            {{ data.counts[s.id] }}
          </span>
        </button>
      </div>
      <p class="text-[11px] text-zinc-600">
        {{ sections.find((s) => s.id === area)?.blurb }}
      </p>
    </div>

    <!-- Rows -->
    <div class="flex-1 min-h-0 overflow-y-auto">
      <p v-if="!rows.length" class="px-6 py-16 text-center text-sm text-zinc-500">
        <template v-if="debounced">Nothing matches “{{ debounced }}”.</template>
        <template v-else>Nothing logged in this range.</template>
      </p>

      <ul v-else class="divide-y divide-zinc-900/70">
        <li
          v-for="r in rows"
          :key="r.id"
          class="px-3 py-2.5 hover:bg-zinc-900/40 transition-colors"
          :class="r.severity === 'warning' ? 'bg-amber-950/10' : ''"
        >
          <div class="flex items-start gap-2.5">
            <span
              class="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
              :class="SEVERITY_STYLE[r.severity].dot"
              :title="SEVERITY_STYLE[r.severity].label"
              aria-hidden="true"
            />

            <div class="min-w-0 flex-1">
              <p class="text-sm text-zinc-200">
                <NuxtLink
                  v-if="r.actor_name"
                  :to="`/users/${encodeURIComponent(r.actor_name)}`"
                  class="font-medium text-zinc-100 hover:text-accent transition-colors"
                >{{ r.actor_name }}</NuxtLink>
                <span v-else class="text-zinc-500">The site</span>
                <RoleBadge v-if="r.actor_role" :role="r.actor_role" size="sm" class="ml-1 align-[0.1em]" />
                <span class="text-zinc-400">{{ ` ${r.summary}` }}</span>
              </p>

              <p class="text-[11px] text-zinc-600 mt-0.5 flex flex-wrap items-center gap-x-2">
                <span :title="absoluteTime(r.created_at)" class="tabular-nums">{{ relativeTime(r.created_at) }}</span>
                <span class="text-zinc-800">·</span>
                <code class="text-zinc-600">{{ r.kind }}</code>
                <template v-if="r.subject_label">
                  <span class="text-zinc-800">·</span>
                  <NuxtLink
                    v-if="subjectLink(r)"
                    :to="subjectLink(r)!"
                    class="text-zinc-500 hover:text-accent transition-colors truncate max-w-[16rem]"
                  >{{ r.subject_label }}</NuxtLink>
                  <span v-else class="text-zinc-500 truncate max-w-[16rem]">{{ r.subject_label }}</span>
                </template>
                <button
                  v-if="r.detail"
                  type="button"
                  class="text-zinc-600 hover:text-zinc-300 transition-colors"
                  @click="open[r.id] = !open[r.id]"
                >{{ open[r.id] ? 'less' : 'details' }}</button>

                <!-- Undo is offered only where the inverse is exact, and the
                     entry stays in the log either way — see the note in
                     `server/utils/activity-undo.ts`. -->
                <template v-if="r.undo">
                  <span class="text-zinc-800">·</span>
                  <button
                    type="button"
                    :disabled="undoing === r.id"
                    class="text-amber-500/80 hover:text-amber-300 disabled:opacity-50 transition-colors"
                    :title="r.undo"
                    @click="undo(r)"
                  >{{ undoing === r.id ? 'undoing…' : 'undo' }}</button>
                </template>
                <template v-else-if="r.undone_at">
                  <span class="text-zinc-800">·</span>
                  <span
                    class="text-zinc-600 italic"
                    :title="`Undone by ${r.undone_by_name ?? 'someone'} at ${absoluteTime(r.undone_at)}`"
                  >undone{{ r.undone_by_name ? ` by ${r.undone_by_name}` : '' }}</span>
                </template>
              </p>

              <p v-if="undoError[r.id]" class="text-[11px] text-red-400 mt-1">{{ undoError[r.id] }}</p>

              <pre
                v-if="open[r.id] && r.detail"
                class="mt-1.5 rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-[10px] text-zinc-400 overflow-x-auto"
              >{{ prettyDetail(r) }}</pre>
            </div>
          </div>
        </li>
      </ul>
    </div>

    <!-- Paging -->
    <div
      v-if="total > PAGE"
      class="shrink-0 border-t border-zinc-800/80 px-3 py-2 flex items-center justify-between gap-3 text-[11px] text-zinc-500"
    >
      <span class="tabular-nums">{{ offset + 1 }}–{{ shownTo }} of {{ total.toLocaleString() }}</span>
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          :disabled="offset === 0"
          @click="offset = Math.max(0, offset - PAGE)"
        >← Newer</button>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          :disabled="offset + PAGE >= total"
          @click="offset = offset + PAGE"
        >Older →</button>
      </div>
    </div>
  </div>
</template>
