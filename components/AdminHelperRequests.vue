<script setup lang="ts">
import { relativeTime } from '~/utils/relative-time'

/**
 * The helper request queue.
 *
 * A list helper places levels and reviews submissions directly. Two things they
 * cannot do are moving a level that is already placed and changing whether one
 * counts as a challenge — both rewrite a judgement somebody already made — so
 * those arrive here for an admin to apply or refuse.
 *
 * The same component serves the helper who filed them, in which case it is a
 * read-only record of what came of their requests. That is not a courtesy: a
 * request whose outcome is invisible is indistinguishable from one that was
 * lost, and the helper cannot see this tab's admin form.
 */
type Request = {
  id: number
  kind: 'move' | 'challenge' | 'unchallenge' | 'remove'
  level_id: number | null
  level_name: string
  level_position: number | null
  to_position: number | null
  reason: string | null
  requested_by: number | null
  requester_name: string | null
  status: 'pending' | 'applied' | 'rejected'
  decided_at: string | null
  decision_note: string | null
  created_at: string
}

const emit = defineEmits<{ (e: 'changed'): void }>()

const items = ref<Request[]>([])
const mine = ref(false)
const loading = ref(false)
const status = ref<'pending' | 'applied' | 'rejected' | 'all'>('pending')
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    const res = await $fetch<{ items: Request[]; mine: boolean }>(
      '/api/admin/helper-requests',
      { query: { status: status.value } },
    )
    items.value = res.items
    mine.value = res.mine
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not load the queue.'
    items.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(status, load)

/** Which row is being decided, so two clicks can't race each other. */
const busyId = ref<number | null>(null)
const notes = reactive<Record<number, string>>({})

async function decide(r: Request, action: 'apply' | 'reject') {
  if (busyId.value != null) return
  busyId.value = r.id
  error.value = null
  try {
    await $fetch(`/api/admin/helper-requests/${r.id}`, {
      method: 'POST',
      body: { action, note: notes[r.id]?.trim() || null },
    })
    delete notes[r.id]
    await load()
    emit('changed')
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'That didn\'t work.'
  } finally {
    busyId.value = null
  }
}

const KIND_LABEL: Record<Request['kind'], string> = {
  move: 'Move',
  challenge: 'Mark as challenge',
  unchallenge: 'Unmark as challenge',
  remove: 'Remove from the list',
}

const STATUS_TONE: Record<Request['status'], string> = {
  pending: 'border-accent/40 bg-accent/10 text-accent',
  applied: 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300',
  rejected: 'border-red-900/60 bg-red-950/40 text-red-300',
}
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold text-zinc-100">
          {{ mine ? 'Your requests' : 'Helper requests' }}
        </h2>
        <p class="text-[11px] text-zinc-500 mt-0.5 max-w-2xl">
          <template v-if="mine">
            Your move and challenge requests, and what happened to them.
          </template>
          <template v-else>
            Move and challenge requests from list helpers. Applied moves update the changelog
            and tiers like any other move.
          </template>
        </p>
      </div>
      <SegmentedControl
        v-if="!mine"
        v-model="status"
        size="sm"
        aria-label="Filter requests"
        :options="[
          { value: 'pending', label: 'Waiting' },
          { value: 'applied', label: 'Applied' },
          { value: 'rejected', label: 'Refused' },
          { value: 'all', label: 'All' },
        ]"
      />
    </header>

    <p v-if="error" class="text-xs text-red-400">{{ error }}</p>

    <p v-if="loading && !items.length" class="text-sm text-zinc-500">Loading…</p>
    <p v-else-if="!items.length" class="card px-6 py-12 text-center text-sm text-zinc-500">
      <template v-if="mine">No requests yet.</template>
      <template v-else-if="status === 'pending'">Nothing waiting.</template>
      <template v-else>Nothing here.</template>
    </p>

    <ul v-else class="space-y-2">
      <li v-for="r in items" :key="r.id" class="card p-3">
        <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
          <span
            class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border"
            :class="STATUS_TONE[r.status]"
          >{{ r.status === 'pending' ? 'Waiting' : r.status === 'applied' ? 'Applied' : 'Refused' }}</span>

          <div class="min-w-0 flex-1">
            <p class="text-sm text-zinc-100">
              <span class="font-medium">{{ KIND_LABEL[r.kind] }}</span>
              <span class="text-zinc-500"> · </span>
              <NuxtLink
                v-if="r.level_position"
                :to="`/levels/${r.level_position}`"
                class="text-zinc-200 hover:text-accent transition-colors"
              >#{{ r.level_position }} {{ r.level_name }}</NuxtLink>
              <span v-else class="text-zinc-300">{{ r.level_name }}</span>
              <span v-if="r.kind === 'move' && r.to_position" class="text-accent tabular-nums">
                {{ ` → #${r.to_position}` }}
              </span>
            </p>
            <p class="text-[11px] text-zinc-600 mt-0.5">
              <template v-if="!mine && r.requester_name">
                asked by <span class="text-zinc-400">{{ r.requester_name }}</span> ·
              </template>
              <span class="tabular-nums">{{ relativeTime(r.created_at) }}</span>
            </p>
            <p v-if="r.reason" class="text-xs text-zinc-400 mt-1.5 whitespace-pre-wrap">“{{ r.reason }}”</p>
            <p v-if="r.decision_note" class="text-[11px] text-zinc-500 mt-1.5">
              Note: {{ r.decision_note }}
            </p>
          </div>

          <!-- Only an admin sees the decision controls, and only while the
               request is still open. -->
          <div v-if="!mine && r.status === 'pending'" class="w-full sm:w-64 shrink-0 space-y-1.5">
            <input
              v-model="notes[r.id]"
              maxlength="500"
              placeholder="Optional note"
              class="field field-sm text-xs"
            />
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                :disabled="busyId != null"
                class="btn btn-sm btn-primary flex-1"
                @click="decide(r, 'apply')"
              >{{ busyId === r.id ? '…' : 'Apply' }}</button>
              <button
                type="button"
                :disabled="busyId != null"
                class="btn btn-sm btn-ghost hover:border-red-800 hover:text-red-300 flex-1"
                @click="decide(r, 'reject')"
              >Refuse</button>
            </div>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
