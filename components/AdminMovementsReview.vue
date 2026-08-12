<script setup lang="ts">
import { gdLevelUrl } from '~/utils/gd-links'
type Movement = {
  id: number
  level_name: string
  level_gd_id: number | null
  from_position: number
  to_position: number
  notes: string | null
  submitted_at: string
  submitter: string | null
}

const items = ref<Movement[]>([])
const selectedId = ref<number | null>(null)
const selected = computed(() => items.value.find((m) => m.id === selectedId.value) ?? null)
const banner = ref<{ kind: 'ok' | 'err'; msg: string } | null>(null)
const decideLoading = ref(false)
const rejectReason = ref('')
const loadError = ref<string | null>(null)

async function load() {
  try {
    const res = await $fetch<{ items: Movement[] }>('/api/admin/movements')
    items.value = res.items
    loadError.value = null
    if (selectedId.value && !items.value.some((m) => m.id === selectedId.value)) {
      selectedId.value = items.value[0]?.id ?? null
    } else if (!selectedId.value && items.value[0]) {
      selectedId.value = items.value[0].id
    }
  } catch (e: any) {
    loadError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed to load movements.'
  }
}
onMounted(load)

watch(selectedId, () => { rejectReason.value = '' })

function flash(kind: 'ok' | 'err', msg: string) {
  banner.value = { kind, msg }
  setTimeout(() => (banner.value = null), 3500)
}

async function decide(action: 'approve' | 'reject') {
  if (!selected.value || decideLoading.value) return
  decideLoading.value = true
  try {
    const body: any = { action }
    if (action === 'reject') body.reason = rejectReason.value.trim() || undefined
    await $fetch(`/api/admin/movements/${selected.value.id}`, { method: 'POST', body })
    flash('ok', action === 'approve' ? `Moved to #${selected.value.to_position}.` : 'Rejected.')
    selectedId.value = null
    await load()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  } finally {
    decideLoading.value = false
  }
}

async function quickReject(id: number) {
  if (!confirm('Reject this movement request?')) return
  try {
    await $fetch(`/api/admin/movements/${id}`, { method: 'POST', body: { action: 'reject' } })
    if (selectedId.value === id) selectedId.value = null
    await load()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  }
}

</script>

<template>
  <div class="grid grid-cols-[22%_53%_25%] grid-rows-[minmax(0,1fr)] h-full">
    <!-- Left: movements list -->
    <aside class="flex flex-col min-h-0 border-r border-zinc-800 bg-zinc-950">
      <div class="p-3 border-b border-zinc-800 shrink-0">
        <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Pending movements</p>
        <p class="text-[11px] text-zinc-600 mt-0.5">{{ items.length }} pending</p>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <ul v-if="items.length" class="divide-y divide-zinc-900/60">
          <li v-for="m in items" :key="m.id" class="relative group/li">
            <button
              type="button"
              class="w-full text-left px-3 py-2 pr-8 text-sm transition-colors"
              :class="selectedId === m.id ? 'bg-sky-900/30 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900/70'"
              @click="selectedId = m.id"
            >
              <div class="font-medium truncate">{{ m.level_name }}</div>
              <div class="text-[11px] text-zinc-500 tabular-nums">
                #{{ m.from_position }} → #{{ m.to_position }}
              </div>
              <div class="text-[10px] text-zinc-600 truncate">{{ m.submitted_at }}</div>
            </button>
            <button
              type="button"
              class="absolute top-2 right-2 p-0.5 text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover/li:opacity-100"
              title="Reject"
              @click.stop="quickReject(m.id)"
            >✕</button>
          </li>
        </ul>
        <div v-else-if="loadError" class="px-3 py-6 text-xs text-red-400 text-center">{{ loadError }}</div>
        <div v-else class="px-3 py-6 text-xs text-zinc-500 text-center">No pending movements.</div>
      </div>
    </aside>

    <!-- Center: details -->
    <section class="overflow-y-auto min-h-0 px-6 py-6">
      <div v-if="!selected" class="text-center text-sm text-zinc-500 py-12">
        {{ items.length === 0 ? 'No pending movements.' : 'Pick a movement on the left.' }}
      </div>
      <div v-else class="max-w-2xl mx-auto space-y-5">
        <header>
          <h2 class="text-2xl font-semibold tracking-tight">{{ selected.level_name }}</h2>
          <p class="text-xs text-zinc-500 mt-1">
            <template v-if="selected.submitter">
              Submitted by
              <NuxtLink :to="`/users/${selected.submitter}`" class="hover:text-accent">{{ selected.submitter }}</NuxtLink> ·
            </template>
            {{ selected.submitted_at }}
          </p>
        </header>

        <div class="grid grid-cols-3 gap-px bg-zinc-800 rounded-md overflow-hidden">
          <div class="bg-zinc-950 p-4">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Level ID</div>
            <a v-if="gdLevelUrl(selected.level_gd_id)" :href="gdLevelUrl(selected.level_gd_id)!" target="_blank" rel="noopener" class="tabular-nums text-sm text-zinc-100 hover:text-accent">{{ selected.level_gd_id }}</a>
            <div v-else class="text-zinc-600 text-sm">—</div>
          </div>
          <div class="bg-zinc-950 p-4">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">From</div>
            <div class="tabular-nums text-xl font-semibold text-zinc-100">#{{ selected.from_position }}</div>
          </div>
          <div class="bg-zinc-950 p-4">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">To</div>
            <div class="tabular-nums text-xl font-semibold text-accent">#{{ selected.to_position }}</div>
          </div>
        </div>

        <section v-if="selected.notes" class="card px-4 py-3">
          <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Notes from submitter</h3>
          <p class="text-sm text-zinc-200 whitespace-pre-wrap">{{ selected.notes }}</p>
        </section>

        <section class="rounded-md border border-zinc-800/60 bg-zinc-950/40 px-4 py-3">
          <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">What this does</h3>
          <p class="text-sm text-zinc-400">
            Approving will move
            <span class="text-zinc-200 font-medium">{{ selected.level_name }}</span>
            from position
            <span class="tabular-nums text-zinc-200">#{{ selected.from_position }}</span>
            to
            <span class="tabular-nums text-zinc-200">#{{ selected.to_position }}</span>.
            All levels in between will shift by one position.
            <span v-if="selected.level_gd_id" class="text-zinc-500"> The level will be looked up by its GD ID at approval time, so if it was already moved by an admin it will still be found correctly.</span>
          </p>
        </section>
      </div>
    </section>

    <!-- Right: actions -->
    <aside class="flex flex-col min-h-0 border-l border-zinc-800 bg-zinc-950">
      <div v-if="selected" class="p-4 flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">
        <div>
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1">Move</p>
          <p class="text-sm text-zinc-300 tabular-nums">
            #{{ selected.from_position }} → #{{ selected.to_position }}
          </p>
          <p class="text-[10px] text-zinc-600 mt-1">
            {{ selected.to_position < selected.from_position ? 'Moving up' : 'Moving down' }}
            by {{ Math.abs(selected.to_position - selected.from_position) }} position{{ Math.abs(selected.to_position - selected.from_position) === 1 ? '' : 's' }}.
          </p>
        </div>

        <div class="mt-auto flex flex-col gap-2 pt-2">
          <label class="block">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Reason for rejection <span class="text-zinc-600 normal-case">optional</span></span>
            <textarea
              v-model="rejectReason"
              rows="2"
              maxlength="2000"
              placeholder="Why this is being rejected."
              class="field field-sm mt-1 text-xs"
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
        <p class="text-xs text-zinc-500">Select a movement to review.</p>
      </div>
    </aside>
  </div>
</template>
