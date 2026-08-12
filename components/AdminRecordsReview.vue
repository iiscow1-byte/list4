<script setup lang="ts">
type PendingRec = {
  id: number
  level_id: number
  position: number
  level_name: string
  level_verifier: string | null
  player_name: string
  video: string
  submitter_note: string | null
  submitted_at: string
  submitter: string | null
  is_verification_claim: number
}

const items = ref<PendingRec[]>([])
const selectedId = ref<number | null>(null)
const banner = ref<{ kind: 'ok' | 'err'; msg: string } | null>(null)
const decideLoading = ref(false)
const bulkLoading = ref(false)
const rejectReason = ref<string>('')

async function load() {
  const res = await $fetch<{ items: PendingRec[] }>('/api/admin/records/pending')
  items.value = res.items
  if (selectedId.value && !items.value.some((r) => r.id === selectedId.value)) {
    selectedId.value = items.value[0]?.id ?? null
  } else if (!selectedId.value && items.value[0]) {
    selectedId.value = items.value[0].id
  }
}
onMounted(load)

const selected = computed(() => items.value.find((r) => r.id === selectedId.value) ?? null)

const { data: levelData } = useFetch<any>(
  () => selected.value ? `/api/levels/${selected.value.position}` : null,
  { watch: [selected], lazy: true, server: false },
)

/** Same level data but with the submitted record's video pasted into the verification slot. */
const reviewLevel = computed(() => {
  if (!selected.value || !levelData.value) return null
  return {
    ...levelData.value,
    verification: `Submission by ${selected.value.player_name}`,
    verification_url: selected.value.video,
  }
})

function flash(kind: 'ok' | 'err', msg: string) {
  banner.value = { kind, msg }
  setTimeout(() => (banner.value = null), 3000)
}

async function bulkApprove() {
  if (!selected.value?.submitter || bulkLoading.value) return
  bulkLoading.value = true
  try {
    const res = await $fetch<{ approved: number }>('/api/admin/records/bulk-approve', {
      method: 'POST',
      body: { submitter: selected.value.submitter },
    })
    flash('ok', `Approved ${res.approved} record(s) from ${selected.value.submitter}.`)
    selectedId.value = null
    await load()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  } finally {
    bulkLoading.value = false
  }
}

async function decide(action: 'approve' | 'reject') {
  if (!selected.value || decideLoading.value) return
  decideLoading.value = true
  try {
    const body: any = { action }
    if (action === 'reject') body.reason = rejectReason.value.trim() || undefined
    await $fetch(`/api/admin/records/${selected.value.id}`, { method: 'POST', body })
    flash('ok', `Record ${action === 'approve' ? 'approved' : 'rejected'}.`)
    selectedId.value = null
    rejectReason.value = ''
    await load()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  } finally {
    decideLoading.value = false
  }
}
</script>

<template>
  <div class="grid grid-cols-[20%_60%_20%] grid-rows-[minmax(0,1fr)] h-full">
    <!-- Left: pending list -->
    <aside class="flex flex-col min-h-0 border-r border-zinc-800 bg-zinc-950">
      <div class="p-3 border-b border-zinc-800 shrink-0">
        <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Pending records</p>
        <p class="text-[11px] text-zinc-600 mt-0.5">{{ items.length }} waiting</p>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <ul v-if="items.length" class="divide-y divide-zinc-900/60">
          <li v-for="r in items" :key="r.id">
            <button
              type="button"
              class="w-full text-left px-3 py-2 text-sm transition-colors"
              :class="selectedId === r.id ? 'bg-accent/15 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900/70'"
              @click="selectedId = r.id"
            >
              <div class="font-medium truncate">{{ r.level_name }} | {{ r.player_name }}</div>
              <div class="text-[11px] text-zinc-500 truncate">#{{ r.position }} · {{ r.submitted_at }}</div>
            </button>
          </li>
        </ul>
        <div v-else class="px-3 py-6 text-xs text-zinc-500 text-center">No pending records.</div>
      </div>
    </aside>

    <!-- Center: level detail with the submitted record's video -->
    <section class="overflow-y-auto min-h-0">
      <LevelDetail v-if="reviewLevel" :level="reviewLevel" :readonly="true" />
      <div v-else class="p-12 text-center text-sm text-zinc-500">
        {{ items.length === 0 ? 'No records to review.' : 'Pick a record on the left.' }}
      </div>
    </section>

    <!-- Right: submitter info + actions -->
    <aside class="flex flex-col min-h-0 border-l border-zinc-800 bg-zinc-950">
      <div v-if="selected" class="p-4 flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">
        <div>
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1">Submitter</p>
          <p class="text-sm text-zinc-100">
            <NuxtLink v-if="selected.submitter" :to="`/users/${selected.submitter}`" class="hover:text-accent">{{ selected.submitter }}</NuxtLink>
            <span v-else class="text-zinc-500">unknown</span>
          </p>
          <p class="text-[11px] text-zinc-500 mt-0.5">{{ selected.submitted_at }}</p>
        </div>

        <div>
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1">For player</p>
          <p class="text-sm text-zinc-100">{{ selected.player_name }}</p>
        </div>

        <div v-if="selected.is_verification_claim && !selected.level_verifier"
             class="rounded border border-sky-800/60 bg-sky-950/30 px-3 py-2 text-xs text-sky-200">
          <p class="font-medium">Verifier claim</p>
          <p class="mt-0.5 text-sky-300/80">
            Approving will set <span class="text-sky-100">{{ selected.player_name }}</span> as the verifier of this level.
          </p>
        </div>
        <div v-else-if="selected.is_verification_claim && selected.level_verifier"
             class="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
          Submitter checked "is verification" but the level already lists
          <span class="text-zinc-200">{{ selected.level_verifier }}</span> — claim will be ignored.
        </div>

        <div v-if="selected.submitter_note">
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1">Note</p>
          <p class="text-sm text-zinc-200 whitespace-pre-wrap">{{ selected.submitter_note }}</p>
        </div>

        <div class="mt-auto flex flex-col gap-2 pt-2">
          <label class="block">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Reason for denial <span class="text-zinc-600 normal-case">sent to submitter</span></span>
            <textarea
              v-model="rejectReason"
              rows="2"
              maxlength="4000"
              placeholder="Why this record can't be accepted."
              class="field field-sm mt-1 text-xs"
            />
          </label>
          <button
            type="button"
            :disabled="decideLoading || bulkLoading"
            class="w-full rounded bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-medium text-sm py-2 transition-colors disabled:opacity-60"
            @click="decide('approve')"
          >Approve</button>
          <button
            v-if="selected?.submitter"
            type="button"
            :disabled="decideLoading || bulkLoading"
            class="w-full rounded border border-sky-800 text-sky-300 hover:bg-sky-900/30 text-sm py-2 transition-colors disabled:opacity-60"
            @click="bulkApprove"
          >{{ bulkLoading ? 'Approving…' : `Approve all from ${selected.submitter}` }}</button>
          <button
            type="button"
            :disabled="decideLoading || bulkLoading"
            class="w-full rounded border border-zinc-700 hover:border-red-600 hover:text-red-400 text-sm py-2 transition-colors disabled:opacity-60"
            @click="decide('reject')"
          >Reject</button>
        </div>

        <div
          v-if="banner"
          class="rounded border px-3 py-2 text-xs"
          :class="banner.kind === 'ok' ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-300' : 'border-red-900/50 bg-red-950/30 text-red-300'"
        >{{ banner.msg }}</div>
      </div>
      <div v-else class="p-4">
        <p class="text-xs text-zinc-500">Select a record to review.</p>
      </div>
    </aside>
  </div>
</template>
