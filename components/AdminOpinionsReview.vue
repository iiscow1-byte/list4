<script setup lang="ts">
type PendingOpinion = {
  id: number
  list_kind: 'main' | 'void'
  level_id: number
  level_name: string
  level_position: number
  level_tier: string | null
  level_difficulty: string | null
  proof_url: string
  gddl_tier: string | null
  difficulty: string | null
  enjoyment: number | null
  notes: string | null
  request_relocation: number
  requested_position: number | null
  comparison_level_id: number | null
  comparison_level_name: string | null
  source_record_id: number | null
  submitted_at: string
  submitter: string | null
}

const items = ref<PendingOpinion[]>([])
const selectedId = ref<number | null>(null)
const banner = ref<{ kind: 'ok' | 'err'; msg: string } | null>(null)
const decideLoading = ref(false)
const rejectReason = ref<string>('')

async function load() {
  const res = await $fetch<{ items: PendingOpinion[] }>('/api/admin/opinions/pending')
  items.value = res.items
  if (selectedId.value && !items.value.some((r) => r.id === selectedId.value)) {
    selectedId.value = items.value[0]?.id ?? null
  } else if (!selectedId.value && items.value[0]) {
    selectedId.value = items.value[0].id
  }
}
onMounted(load)

const selected = computed(() => items.value.find((r) => r.id === selectedId.value) ?? null)

const levelEndpoint = computed(() => {
  if (!selected.value) return null
  return selected.value.list_kind === 'void'
    ? `/api/void/levels/${selected.value.level_position}`
    : `/api/levels/${selected.value.level_position}`
})

const { data: levelData } = useFetch<any>(levelEndpoint, {
  watch: [selected],
  lazy: true,
  server: false,
})

/** Replace the verification slot with the submitter's proof video so the
 * moderator can watch the proof inline next to the level info. */
const reviewLevel = computed(() => {
  if (!selected.value || !levelData.value) return null
  return {
    ...levelData.value,
    verification: `Opinion proof from ${selected.value.submitter ?? 'submitter'}`,
    verification_url: selected.value.proof_url,
  }
})

function flash(kind: 'ok' | 'err', msg: string) {
  banner.value = { kind, msg }
  setTimeout(() => (banner.value = null), 3000)
}

async function decide(action: 'approve' | 'reject') {
  if (!selected.value || decideLoading.value) return
  decideLoading.value = true
  try {
    const body: any = { action }
    if (action === 'reject') body.reason = rejectReason.value.trim() || undefined
    await $fetch(`/api/admin/opinions/${selected.value.id}`, { method: 'POST', body })
    flash('ok', `Opinion ${action === 'approve' ? 'approved' : 'rejected'}.`)
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
        <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Pending opinions</p>
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
              <div class="font-medium truncate">
                {{ r.level_name }}
                <span v-if="r.list_kind === 'void'" class="text-[10px] text-fuchsia-300/80 uppercase tracking-widest">void</span>
              </div>
              <div class="text-[11px] text-zinc-500 truncate">
                #{{ r.level_position }} · {{ r.submitter ?? 'unknown' }} · {{ r.submitted_at }}
              </div>
            </button>
          </li>
        </ul>
        <div v-else class="px-3 py-6 text-xs text-zinc-500 text-center">No pending opinions.</div>
      </div>
    </aside>

    <!-- Center: level detail with the proof video -->
    <section class="overflow-y-auto min-h-0">
      <LevelDetail v-if="reviewLevel" :level="reviewLevel" :readonly="true" />
      <div v-else class="p-12 text-center text-sm text-zinc-500">
        {{ items.length === 0 ? 'No opinions to review.' : 'Pick an opinion on the left.' }}
      </div>
    </section>

    <!-- Right: submitter ratings + actions -->
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

        <div class="rounded border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Submitter's ratings</p>
          <dl class="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs">
            <dt class="text-zinc-500">GDDL Tier</dt>
            <dd class="text-zinc-100">{{ selected.gddl_tier ?? '—' }}</dd>
            <dt class="text-zinc-500">Demon level</dt>
            <dd class="text-zinc-100">{{ selected.difficulty ?? '—' }}</dd>
            <dt class="text-zinc-500">Enjoyment</dt>
            <dd class="text-zinc-100">{{ selected.enjoyment != null ? Number(selected.enjoyment).toFixed(1) : '—' }}</dd>
          </dl>
        </div>

        <div v-if="selected.request_relocation" class="rounded border border-amber-800/60 bg-amber-950/30 p-3 text-xs space-y-1">
          <p class="font-medium text-amber-200">Requests relocation</p>
          <p class="text-amber-200/80">
            Old: <span class="text-amber-100">#{{ selected.level_position }}</span>
            → New: <span class="text-amber-100">#{{ selected.requested_position ?? '?' }}</span>
          </p>
          <p v-if="selected.comparison_level_name" class="text-amber-200/70">
            Compared to #{{ selected.comparison_level_id }} {{ selected.comparison_level_name }}
          </p>
        </div>

        <div v-if="selected.source_record_id" class="rounded border border-sky-800/60 bg-sky-950/30 px-3 py-2 text-xs text-sky-200">
          Attached to record submission #{{ selected.source_record_id }} — will resolve with that record.
        </div>

        <div v-if="selected.notes">
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1">Note</p>
          <p class="text-sm text-zinc-200 whitespace-pre-wrap">{{ selected.notes }}</p>
        </div>

        <div class="mt-auto flex flex-col gap-2 pt-2">
          <label class="block">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Reason for denial <span class="text-zinc-600 normal-case">— optional, sent to submitter</span></span>
            <textarea
              v-model="rejectReason"
              rows="2"
              maxlength="4000"
              placeholder="Why this opinion can't be accepted."
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <button
            type="button"
            :disabled="decideLoading"
            class="w-full rounded bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-medium text-sm py-2 transition-colors disabled:opacity-60"
            @click="decide('approve')"
          >Approve</button>
          <button
            type="button"
            :disabled="decideLoading"
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
        <p class="text-xs text-zinc-500">Select an opinion to review.</p>
      </div>
    </aside>
  </div>
</template>
