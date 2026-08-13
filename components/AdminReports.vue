<script setup lang="ts">
import { relativeTime } from '~/utils/relative-time'

/**
 * The report queue.
 *
 * One list for every kind of report, because a report is the same object
 * whatever it points at: somebody said this is wrong. Five queues would be five
 * places to forget to look.
 *
 * The two outcomes are deliberately both terminal and both recorded. "Actioned"
 * means the reviewer did something about it; "dismissed" means they decided
 * there was nothing to do. Neither deletes the report — the log keeps both, and
 * a pattern of dismissed reports about one account is itself information.
 */
type Report = {
  id: number
  target_kind: 'account' | 'comment' | 'custom_list' | 'level' | 'forum_thread' | 'forum_post'
  target_id: number
  target_label: string | null
  reason: string
  details: string | null
  reporter_id: number | null
  reporter_name: string | null
  status: 'open' | 'actioned' | 'dismissed'
  resolution: string | null
  resolved_at: string | null
  created_at: string
}

const emit = defineEmits<{ (e: 'changed'): void }>()

const status = ref<'open' | 'actioned' | 'dismissed' | 'all'>('open')
const targetFilter = ref('')

const { data, pending, refresh } = await useFetch<{
  items: Report[]
  counts: Record<string, number>
  reasonLabels: Record<string, string>
  isAdmin: boolean
}>('/api/admin/reports', {
  query: computed(() => ({
    status: status.value,
    target: targetFilter.value || undefined,
  })),
})

const items = computed(() => data.value?.items ?? [])
const labels = computed(() => data.value?.reasonLabels ?? {})

const busyId = ref<number | null>(null)
const notes = reactive<Record<number, string>>({})
const error = ref<string | null>(null)

async function decide(r: Report, action: 'action' | 'dismiss') {
  if (busyId.value != null) return
  busyId.value = r.id
  error.value = null
  try {
    await $fetch(`/api/admin/reports/${r.id}`, {
      method: 'POST',
      body: { action, note: notes[r.id]?.trim() || null },
    })
    delete notes[r.id]
    await refresh()
    emit('changed')
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'That did not work.'
  } finally {
    busyId.value = null
  }
}

const TARGET_LABEL: Record<Report['target_kind'], string> = {
  account: 'Account',
  comment: 'Comment',
  custom_list: 'Custom list',
  level: 'Level',
  forum_thread: 'Thread',
  forum_post: 'Post',
}

/**
 * Where to go and look at the thing.
 *
 * Null for the kinds with no page of their own — a comment lives inside
 * whatever it was left on, and a link that guesses is worse than none.
 */
function targetLink(r: Report): string | null {
  switch (r.target_kind) {
    case 'account': return r.target_label ? `/users/${encodeURIComponent(r.target_label)}` : null
    case 'custom_list': return null
    case 'level': {
      const m = r.target_label?.match(/^#(\d+)/)
      return m ? `/levels/${m[1]}` : null
    }
    case 'forum_thread': return `/community/thread/${r.target_id}`
    default: return null
  }
}

/** The reasons that need saying loudly. */
function isSevere(r: Report): boolean {
  return r.reason === 'staff_abuse' || r.reason === 'abuse'
}
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold text-zinc-100">Reports</h2>
        <p class="text-[11px] text-zinc-500 mt-0.5 max-w-2xl">
          Accounts, comments, custom lists, levels and forum posts people have flagged.
          Nothing is deleted by resolving one — both outcomes are kept, and a run of dismissed
          reports about the same account is worth seeing.
          <span v-if="data?.isAdmin" class="text-amber-400/80">
            Reports about staff are admin-only and are never shown to the person they name.
          </span>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <select v-model="targetFilter" class="field field-sm w-auto text-xs" aria-label="Kind of thing">
          <option value="">Everything</option>
          <option v-for="(l, k) in TARGET_LABEL" :key="k" :value="k">{{ l }}</option>
        </select>
        <SegmentedControl
          v-model="status"
          size="sm"
          aria-label="Filter reports"
          :options="[
            { value: 'open', label: `Open${data?.counts?.open ? ` (${data.counts.open})` : ''}` },
            { value: 'actioned', label: 'Actioned' },
            { value: 'dismissed', label: 'Dismissed' },
            { value: 'all', label: 'All' },
          ]"
        />
      </div>
    </header>

    <p v-if="error" class="text-xs text-red-400">{{ error }}</p>

    <p v-if="pending && !items.length" class="text-sm text-zinc-500">Loading…</p>
    <p v-else-if="!items.length" class="card px-6 py-12 text-center text-sm text-zinc-500">
      <template v-if="status === 'open'">Nothing reported. </template>
      <template v-else>Nothing here.</template>
    </p>

    <ul v-else class="space-y-2">
      <li
        v-for="r in items"
        :key="r.id"
        class="card p-3"
        :class="r.status === 'open' && isSevere(r) ? 'ring-1 ring-inset ring-amber-900/50' : ''"
      >
        <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
          <span
            class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border"
            :class="r.status === 'open'
              ? (isSevere(r)
                ? 'border-amber-900/60 bg-amber-950/40 text-amber-300'
                : 'border-accent/40 bg-accent/10 text-accent')
              : r.status === 'actioned'
                ? 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300'
                : 'border-zinc-800 bg-zinc-900 text-zinc-500'"
          >{{ r.status === 'open' ? 'Open' : r.status === 'actioned' ? 'Actioned' : 'Dismissed' }}</span>

          <div class="min-w-0 flex-1">
            <p class="text-sm text-zinc-100">
              <span class="text-zinc-500">{{ TARGET_LABEL[r.target_kind] }}</span>
              <span class="text-zinc-700"> · </span>
              <NuxtLink
                v-if="targetLink(r)"
                :to="targetLink(r)!"
                class="text-zinc-100 hover:text-accent transition-colors"
              >{{ r.target_label ?? `#${r.target_id}` }}</NuxtLink>
              <span v-else class="text-zinc-200">{{ r.target_label ?? `#${r.target_id}` }}</span>
            </p>

            <p class="mt-1 text-xs">
              <span
                class="font-medium"
                :class="isSevere(r) ? 'text-amber-300' : 'text-zinc-300'"
              >{{ labels[r.reason] ?? r.reason }}</span>
              <span class="text-zinc-600">
                {{ ' — reported by ' }}
                <NuxtLink
                  v-if="r.reporter_name"
                  :to="`/users/${encodeURIComponent(r.reporter_name)}`"
                  class="text-zinc-500 hover:text-accent transition-colors"
                >{{ r.reporter_name }}</NuxtLink>
                <span v-else>a deleted account</span>
                {{ ` · ${relativeTime(r.created_at)}` }}
              </span>
            </p>

            <p v-if="r.details" class="text-xs text-zinc-400 mt-1.5 whitespace-pre-wrap">“{{ r.details }}”</p>
            <p v-if="r.resolution" class="text-[11px] text-zinc-500 mt-1.5">
              Outcome: {{ r.resolution }}
            </p>
          </div>

          <div v-if="r.status === 'open'" class="w-full sm:w-64 shrink-0 space-y-1.5">
            <input
              v-model="notes[r.id]"
              maxlength="500"
              placeholder="What you did, optional"
              class="field field-sm text-xs"
            />
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                :disabled="busyId != null"
                class="btn btn-sm btn-primary flex-1"
                title="You dealt with it"
                @click="decide(r, 'action')"
              >{{ busyId === r.id ? '…' : 'Actioned' }}</button>
              <button
                type="button"
                :disabled="busyId != null"
                class="btn btn-sm btn-ghost flex-1"
                title="Nothing to do here"
                @click="decide(r, 'dismiss')"
              >Dismiss</button>
            </div>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
