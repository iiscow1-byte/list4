<script setup lang="ts">
definePageMeta({ layout: 'level' })

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const { list, canEdit, refreshPending, refresh } = useCustomList(publicId)

type PendingRecord = {
  id: number; player_name: string; percent: number; hz: number | null; video: string | null
  mobile: number; note: string | null; level_name: string; submitted_at: string
  submitted_by_username: string | null
}
const pending = ref<PendingRecord[]>([])
const busy = ref<number | null>(null)
const notice = ref<string | null>(null)

async function load() {
  if (!canEdit.value) { pending.value = []; return }
  try {
    const res = await $fetch<{ records: PendingRecord[] }>(
      `/api/custom-lists/${publicId.value}/records`, { query: { status: 'pending' } },
    )
    pending.value = res.records
  } catch { pending.value = [] }
}
watch(canEdit, (v) => { if (v) load() }, { immediate: true })

async function decide(r: PendingRecord, action: 'approve' | 'reject') {
  if (busy.value != null) return
  const reason = action === 'reject' ? (prompt('Reason for rejecting (optional):') ?? '') : ''
  busy.value = r.id
  try {
    await $fetch(`/api/custom-lists/${publicId.value}/records/${r.id}`, {
      method: 'POST', body: { action, reason },
    })
    notice.value = action === 'approve'
      ? `Accepted ${r.player_name} on ${r.level_name}.`
      : `Rejected ${r.player_name} on ${r.level_name}.`
    await Promise.all([load(), refreshPending(), refresh()])
  } catch (e: any) {
    notice.value = e?.data?.statusMessage ?? 'Failed.'
  } finally { busy.value = null }
}

function when(ts: string): string {
  const d = new Date(ts.replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

useHead(() => ({ title: list.value ? `Queue — ${list.value.title}` : 'Queue' }))
</script>

<template>
  <CustomListShell :public-id="publicId">
    <template #default>
      <div class="flex items-baseline justify-between gap-3 mb-3">
        <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Pending records</h2>
        <span v-if="notice" class="text-[11px] text-emerald-400">{{ notice }}</span>
      </div>

      <div v-if="!canEdit" class="card px-6 py-16 text-center">
        <p class="text-sm text-zinc-400">Only this list's owner and editors can review records.</p>
      </div>
      <div v-else-if="!pending.length" class="card px-6 py-16 text-center">
        <p class="text-sm text-zinc-400">Nothing waiting for review.</p>
        <p class="text-xs text-zinc-600 mt-1">Submitted records land here for you to accept or reject.</p>
      </div>

      <ul v-else class="card divide-y divide-zinc-900/60 overflow-hidden">
        <li
          v-for="r in pending"
          :key="r.id"
          class="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm transition-opacity"
          :class="busy === r.id ? 'opacity-50' : ''"
        >
          <div class="min-w-0 flex-1">
            <p class="text-zinc-100 truncate">
              <span class="font-semibold">{{ r.player_name }}</span>
              <span class="text-zinc-600"> — </span>{{ r.level_name }}
              <span class="tabular-nums text-amber-300 font-semibold ml-1">{{ r.percent }}%</span>
            </p>
            <p class="text-[11px] text-zinc-600 truncate mt-0.5">
              <span>{{ when(r.submitted_at) }}</span>
              <span v-if="r.submitted_by_username"> · by {{ r.submitted_by_username }}</span>
              <span v-if="r.hz"> · {{ r.hz }}hz</span>
              <span v-if="r.mobile"> · mobile</span>
              <span v-if="r.note"> · “{{ r.note }}”</span>
            </p>
          </div>
          <a
            v-if="r.video"
            :href="r.video"
            target="_blank"
            rel="noopener"
            class="shrink-0 rounded-lg border border-zinc-800 text-zinc-400 text-[11px] px-2.5 py-1 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
          >Watch ↗</a>
          <div class="flex items-center gap-1.5 shrink-0">
            <button
              type="button" :disabled="busy != null"
              class="rounded-lg bg-emerald-600/90 text-white text-xs font-medium px-3 py-1.5 hover:bg-emerald-600 disabled:opacity-50 transition-colors"
              @click="decide(r, 'approve')"
            >Accept</button>
            <button
              type="button" :disabled="busy != null"
              class="rounded-lg border border-red-900/60 text-red-400 text-xs px-3 py-1.5 hover:bg-red-950/40 disabled:opacity-50 transition-colors"
              @click="decide(r, 'reject')"
            >Reject</button>
          </div>
        </li>
      </ul>
    </template>
  </CustomListShell>
</template>
