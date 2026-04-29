<script setup lang="ts">
type PendingLevel = {
  id: number
  gd_id: number | null
  name: string | null
  fps: string | null
  game_version: string | null
  verification: string | null
  verification_url: string | null
  verifier: string | null
  verify_date: string | null
  gddl_tier: string | null
  difficulty: string | null
  enjoyment: number | null
  main_skillset: string | null
  tags: string | null
  notes: string | null
  submitted_at: string
  submitter: string | null
}

type PreviewRow = { position: number; name: string; rated: string | null; gddl_tier: string | null; difficulty: string | null }
type Preview = {
  placement: number
  above: PreviewRow[]
  below: PreviewRow[]
  featuredAbove: PreviewRow | null
  featuredBelow: PreviewRow | null
}

const items = ref<PendingLevel[]>([])
const selectedId = ref<number | null>(null)
const banner = ref<{ kind: 'ok' | 'err'; msg: string } | null>(null)
const decideLoading = ref(false)
const placement = ref<string>('')
const preview = ref<Preview | null>(null)
const previewLoading = ref(false)

const selected = computed(() => items.value.find((r) => r.id === selectedId.value) ?? null)

const goesToVoid = computed(() => {
  if (!selected.value) return false
  return !selected.value.gddl_tier && !selected.value.difficulty
})

async function load() {
  const res = await $fetch<{ items: PendingLevel[] }>('/api/admin/levels/pending')
  items.value = res.items
  if (selectedId.value && !items.value.some((r) => r.id === selectedId.value)) {
    selectedId.value = items.value[0]?.id ?? null
  } else if (!selectedId.value && items.value[0]) {
    selectedId.value = items.value[0].id
  }
}
onMounted(load)

watch(selected, () => {
  placement.value = ''
  preview.value = null
})

let placementDebounce: ReturnType<typeof setTimeout> | null = null
watch(placement, (v) => {
  if (placementDebounce) clearTimeout(placementDebounce)
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) {
    preview.value = null
    return
  }
  placementDebounce = setTimeout(async () => {
    previewLoading.value = true
    try {
      preview.value = await $fetch<Preview>('/api/admin/levels/placement-preview', { query: { position: n } })
    } catch {
      preview.value = null
    } finally {
      previewLoading.value = false
    }
  }, 200)
})

function flash(kind: 'ok' | 'err', msg: string) {
  banner.value = { kind, msg }
  setTimeout(() => (banner.value = null), 3500)
}

async function decide(action: 'approve' | 'reject') {
  if (!selected.value || decideLoading.value) return
  if (action === 'approve') {
    const n = Number(placement.value)
    if (!Number.isInteger(n) || n <= 0) {
      flash('err', 'Enter a placement (1-based) before approving.')
      return
    }
  }
  decideLoading.value = true
  try {
    const body: any = { action }
    if (action === 'approve') body.placement = Number(placement.value)
    const res = await $fetch<{ ok: boolean; voided?: boolean }>(`/api/admin/levels/pending/${selected.value.id}`, {
      method: 'POST', body,
    })
    if (action === 'approve') {
      flash('ok', res.voided ? 'Approved — added to the void list.' : 'Approved — added to the main list.')
    } else {
      flash('ok', 'Submission rejected.')
    }
    selectedId.value = null
    placement.value = ''
    preview.value = null
    await load()
  } catch (e: any) {
    flash('err', e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed.')
  } finally {
    decideLoading.value = false
  }
}

function gdBrowserLink(id: number | null) { return id ? `https://gdbrowser.com/${id}` : null }
</script>

<template>
  <div class="grid grid-cols-[20%_55%_25%] grid-rows-[minmax(0,1fr)] h-full">
    <!-- Left: pending list -->
    <aside class="flex flex-col min-h-0 border-r border-zinc-800 bg-zinc-950">
      <div class="p-3 border-b border-zinc-800 shrink-0">
        <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Pending levels</p>
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
              <div class="font-medium truncate">{{ r.name ?? `Level ${r.gd_id}` }}</div>
              <div class="text-[11px] text-zinc-500 truncate">
                #{{ r.gd_id ?? '?' }} · by {{ r.submitter ?? 'unknown' }}
              </div>
              <div class="text-[10px] text-zinc-600 truncate">{{ r.submitted_at }}</div>
            </button>
          </li>
        </ul>
        <div v-else class="px-3 py-6 text-xs text-zinc-500 text-center">No pending submissions.</div>
      </div>
    </aside>

    <!-- Center: submitted level details -->
    <section class="overflow-y-auto min-h-0 px-6 py-6">
      <div v-if="!selected" class="text-center text-sm text-zinc-500 py-12">
        {{ items.length === 0 ? 'No submissions to review.' : 'Pick a submission on the left.' }}
      </div>
      <div v-else class="max-w-2xl mx-auto space-y-5">
        <header>
          <h2 class="text-2xl font-semibold tracking-tight">{{ selected.name ?? `Level ${selected.gd_id}` }}</h2>
          <p class="text-xs text-zinc-500 mt-1">
            Submitted by
            <NuxtLink v-if="selected.submitter" :to="`/users/${selected.submitter}`" class="hover:text-accent">{{ selected.submitter }}</NuxtLink>
            <span v-else>unknown</span>
            · {{ selected.submitted_at }}
          </p>
        </header>

        <span v-if="goesToVoid" class="inline-block text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-fuchsia-900/40 text-fuchsia-300 border border-fuchsia-800/60">
          No difficulty opinion · will go to void
        </span>

        <!-- Stats grid -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 rounded-md overflow-hidden">
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Level ID</div>
            <a v-if="gdBrowserLink(selected.gd_id)" :href="gdBrowserLink(selected.gd_id)!" target="_blank" rel="noopener" class="tabular-nums text-sm text-zinc-100 hover:text-accent">{{ selected.gd_id }}</a>
            <div v-else class="text-zinc-600">—</div>
          </div>
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">FPS</div>
            <div class="text-sm text-zinc-100">{{ selected.fps ?? 'any' }}</div>
          </div>
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Version</div>
            <div class="text-sm text-zinc-100">{{ selected.game_version ?? 'any' }}</div>
          </div>
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Verify date</div>
            <div class="text-sm text-zinc-100">{{ selected.verify_date ?? '—' }}</div>
          </div>
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">GDDL Tier</div>
            <div class="text-sm text-zinc-100">{{ selected.gddl_tier ?? '—' }}</div>
          </div>
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Difficulty</div>
            <div class="text-sm text-zinc-100">{{ selected.difficulty ?? '—' }}</div>
          </div>
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Skillset</div>
            <div class="text-sm text-zinc-100">{{ selected.main_skillset ?? '—' }}</div>
          </div>
          <div class="bg-zinc-950 p-3">
            <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Enjoyment</div>
            <div class="text-sm text-zinc-100 tabular-nums">{{ selected.enjoyment != null ? Number(selected.enjoyment).toFixed(1) : '—' }}</div>
          </div>
        </div>

        <!-- Verification -->
        <section class="rounded-md border border-zinc-800 bg-zinc-950/60">
          <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 px-4 pt-3 font-medium">Verification</h3>
          <dl class="px-4 py-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt class="text-zinc-500">Verifier</dt><dd class="text-zinc-200">{{ selected.verifier ?? '—' }}</dd>
            <dt class="text-zinc-500">Title</dt><dd class="text-zinc-200">{{ selected.verification ?? '—' }}</dd>
            <dt class="text-zinc-500">Link</dt>
            <dd class="text-zinc-200 truncate">
              <a v-if="selected.verification_url" :href="selected.verification_url" target="_blank" rel="noopener" class="text-accent hover:underline break-all">{{ selected.verification_url }}</a>
              <span v-else class="text-zinc-600">—</span>
            </dd>
          </dl>
        </section>

        <section v-if="selected.tags" class="rounded-md border border-zinc-800 bg-zinc-950/60 px-4 py-3">
          <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Tags</h3>
          <div class="flex flex-wrap gap-1.5">
            <span v-for="t in selected.tags.split(',')" :key="t" class="text-[11px] px-2 py-0.5 rounded border border-zinc-800 bg-zinc-900 text-zinc-300 capitalize">
              {{ t === 'uldm' ? 'ULDM' : t }}
            </span>
          </div>
        </section>

        <section v-if="selected.notes" class="rounded-md border border-zinc-800 bg-zinc-950/60 px-4 py-3">
          <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Notes from submitter</h3>
          <p class="text-sm text-zinc-200 whitespace-pre-wrap">{{ selected.notes }}</p>
        </section>
      </div>
    </section>

    <!-- Right: placement + actions -->
    <aside class="flex flex-col min-h-0 border-l border-zinc-800 bg-zinc-950">
      <div v-if="selected" class="p-4 flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">
        <div>
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1">Placement</p>
          <input
            v-model="placement"
            type="number" inputmode="numeric" min="1"
            placeholder="position #"
            :disabled="goesToVoid && false"
            class="w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <p class="text-[10px] text-zinc-500 mt-1">
            <template v-if="goesToVoid">Position in the void list (no difficulty opinion).</template>
            <template v-else>Position in the main list. Existing levels at and below shift down by one.</template>
          </p>
        </div>

        <!-- Preview rows around the candidate placement -->
        <div v-if="!goesToVoid">
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Around #{{ preview?.placement ?? '—' }}</p>
          <div v-if="previewLoading" class="text-xs text-zinc-500">loading…</div>
          <div v-else-if="!preview" class="text-xs text-zinc-600">Enter a position to see context.</div>
          <ul v-else class="rounded border border-zinc-800 divide-y divide-zinc-900 overflow-hidden">
            <li v-for="row in preview.above" :key="`a-${row.position}`" class="px-2 py-1 flex items-center gap-2 text-xs">
              <span class="tabular-nums w-10 text-zinc-500">#{{ row.position }}</span>
              <span class="truncate flex-1">{{ row.name }}</span>
            </li>
            <li class="px-2 py-1 flex items-center gap-2 text-xs bg-accent/15 text-accent">
              <span class="tabular-nums w-10 font-semibold">#{{ preview.placement }}</span>
              <span class="truncate flex-1 italic">← new submission</span>
            </li>
            <li v-for="row in preview.below" :key="`b-${row.position}`" class="px-2 py-1 flex items-center gap-2 text-xs">
              <span class="tabular-nums w-10 text-zinc-500">#{{ row.position + 1 }}</span>
              <span class="truncate flex-1">{{ row.name }}</span>
              <span class="text-[10px] text-zinc-600">(now #{{ row.position }})</span>
            </li>
          </ul>

          <div v-if="preview" class="mt-3 grid grid-cols-1 gap-1.5 text-[11px]">
            <div class="rounded border border-zinc-800 px-2 py-1 flex items-center gap-2">
              <span class="text-[9px] uppercase tracking-widest text-zinc-500 shrink-0">Featured ↑</span>
              <span v-if="preview.featuredAbove" class="truncate flex-1 text-zinc-300">
                <span class="tabular-nums text-zinc-500">#{{ preview.featuredAbove.position }}</span>
                {{ preview.featuredAbove.name }}
              </span>
              <span v-else class="text-zinc-600">none</span>
            </div>
            <div class="rounded border border-zinc-800 px-2 py-1 flex items-center gap-2">
              <span class="text-[9px] uppercase tracking-widest text-zinc-500 shrink-0">Featured ↓</span>
              <span v-if="preview.featuredBelow" class="truncate flex-1 text-zinc-300">
                <span class="tabular-nums text-zinc-500">#{{ preview.featuredBelow.position }}</span>
                {{ preview.featuredBelow.name }}
              </span>
              <span v-else class="text-zinc-600">none</span>
            </div>
          </div>
        </div>

        <div class="mt-auto flex flex-col gap-2 pt-2">
          <button
            type="button"
            :disabled="decideLoading || !placement"
            class="w-full rounded bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-medium text-sm py-2 transition-colors disabled:opacity-60"
            @click="decide('approve')"
          >Approve at #{{ placement || '—' }}</button>
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
        <p class="text-xs text-zinc-500">Select a submission to review.</p>
      </div>
    </aside>
  </div>
</template>
