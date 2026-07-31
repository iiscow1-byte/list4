<script setup lang="ts">
definePageMeta({ layout: 'level' })

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const { list, canEdit, pendingCount, refreshPending, liked, toggleLike, refresh } = useCustomList(publicId)

type PendingRecord = {
  id: number; player_name: string; percent: number; hz: number | null; video: string | null
  mobile: number; note: string | null; level_name: string; submitted_at: string
  submitted_by_username: string | null
}
const pending = ref<PendingRecord[]>([])
const busy = ref(false)
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
  if (busy.value) return
  const reason = action === 'reject' ? (prompt('Reason for rejecting (optional):') ?? '') : ''
  busy.value = true
  try {
    await $fetch(`/api/custom-lists/${publicId.value}/records/${r.id}`, {
      method: 'POST', body: { action, reason },
    })
    notice.value = action === 'approve' ? 'Record accepted.' : 'Record rejected.'
    await Promise.all([load(), refreshPending(), refresh()])
  } catch (e: any) {
    notice.value = e?.data?.statusMessage ?? 'Failed.'
  } finally { busy.value = false }
}

useHead(() => ({ title: list.value ? `Queue — ${list.value.title}` : 'Queue' }))
</script>

<template>
  <div v-if="list" class="h-full flex flex-col min-h-0">
    <CustomListBar :list="list" :can-edit="canEdit" :pending-count="pendingCount" :liked="liked" @like="toggleLike" />
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-3">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Pending records</h2>
          <span v-if="notice" class="text-[11px] text-emerald-400">{{ notice }}</span>
        </div>

        <p v-if="!canEdit" class="text-sm text-zinc-500 py-16 text-center">
          Only this list's owner and editors can review records.
        </p>
        <p v-else-if="!pending.length" class="text-sm text-zinc-500 py-16 text-center">
          Nothing waiting for review.
        </p>
        <ul v-else class="card divide-y divide-zinc-900/60 overflow-hidden">
          <li v-for="r in pending" :key="r.id" class="px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
            <div class="min-w-0 flex-1">
              <p class="text-zinc-100 truncate">
                <span class="font-medium">{{ r.player_name }}</span>
                <span class="text-zinc-500"> on </span>{{ r.level_name }}
                <span class="tabular-nums text-amber-300"> {{ r.percent }}%</span>
              </p>
              <p class="text-[11px] text-zinc-600 truncate">
                <span v-if="r.submitted_by_username">submitted by {{ r.submitted_by_username }}</span>
                <span v-if="r.hz"> · {{ r.hz }}hz</span>
                <span v-if="r.mobile"> · mobile</span>
                <span v-if="r.note"> · {{ r.note }}</span>
              </p>
            </div>
            <a v-if="r.video" :href="r.video" target="_blank" rel="noopener" class="text-xs text-zinc-500 hover:text-accent shrink-0">video ↗</a>
            <div class="flex items-center gap-1.5 shrink-0">
              <button
                type="button" :disabled="busy"
                class="rounded-lg bg-emerald-600/90 text-white text-xs px-3 py-1 hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                @click="decide(r, 'approve')"
              >Accept</button>
              <button
                type="button" :disabled="busy"
                class="rounded-lg border border-red-900/60 text-red-400 text-xs px-3 py-1 hover:bg-red-950/40 disabled:opacity-50 transition-colors"
                @click="decide(r, 'reject')"
              >Reject</button>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
