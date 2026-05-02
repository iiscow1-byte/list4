<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Submit an opinion — All Levels List' })

const route = useRoute()

const TIER_OPTIONS = [
  '', 'Subtier 0', 'Subtier 1', 'Subtier 2', 'Subtier 3', 'Subtier 4', 'Subtier 5',
  ...Array.from({ length: 39 }, (_, i) => `Tier ${i + 1}`),
]
const DIFFICULTY_OPTIONS = [
  '', 'Auto', 'Easy', 'Normal', 'Hard', 'Harder', 'Insane',
  'Easy Demon', 'Medium Demon', 'Hard Demon', 'Insane Demon', 'Extreme Demon',
]

type ListKind = 'main' | 'void'
type LevelInfo = { position: number; name: string; gddl_tier: string | null; difficulty: string | null }

const kind = ref<ListKind>(route.query.kind === 'void' ? 'void' : 'main')
const position = ref<number | null>(null)
const levelInfo = ref<LevelInfo | null>(null)
const loadError = ref<string | null>(null)

const proofUrl = ref('')
const gddlTier = ref('')
const difficulty = ref('')
const enjoyment = ref('')
const notes = ref('')

const requestRelocation = ref(false)
const comparisonLevel = ref<LevelInfo | null>(null)
const requestedPosition = ref<string>('')
const compareOpen = ref(false)

const submitting = ref(false)
const error = ref<string | null>(null)
const success = ref(false)

async function loadLevel() {
  loadError.value = null
  const pos = Number(route.query.position)
  if (!Number.isFinite(pos) || pos <= 0) {
    loadError.value = 'No level selected. Open this page from a level page.'
    return
  }
  position.value = pos
  try {
    if (kind.value === 'void') {
      const lvl = await $fetch<{ position: number; name: string }>(`/api/void/levels/${pos}`)
      levelInfo.value = { position: lvl.position, name: lvl.name, gddl_tier: null, difficulty: null }
    } else {
      const lvl = await $fetch<LevelInfo>(`/api/levels/${pos}`)
      levelInfo.value = { position: lvl.position, name: lvl.name, gddl_tier: lvl.gddl_tier, difficulty: lvl.difficulty }
    }
  } catch (e: any) {
    loadError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed to load level.'
  }
}
loadLevel()

function onConfirmCompare(lvl: LevelInfo) {
  comparisonLevel.value = lvl
  if (!requestedPosition.value) requestedPosition.value = String(lvl.position)
  if (!gddlTier.value && lvl.gddl_tier) gddlTier.value = lvl.gddl_tier
  if (!difficulty.value && lvl.difficulty) difficulty.value = lvl.difficulty
}
function clearComparison() {
  comparisonLevel.value = null
}

async function submit() {
  if (submitting.value) return
  error.value = null
  if (!position.value) { error.value = 'No level selected.'; return }
  if (!proofUrl.value.trim() || !/^https?:\/\/\S+$/i.test(proofUrl.value.trim())) {
    error.value = 'A valid proof of progress URL is required.'
    return
  }
  if (!gddlTier.value && !difficulty.value && !enjoyment.value) {
    error.value = 'Provide at least a difficulty/tier or an enjoyment rating.'
    return
  }
  submitting.value = true
  try {
    await $fetch('/api/opinions', {
      method: 'POST',
      body: {
        list_kind: kind.value,
        position: position.value,
        proof_url: proofUrl.value.trim(),
        gddl_tier: gddlTier.value || null,
        difficulty: difficulty.value || null,
        enjoyment: enjoyment.value !== '' ? Number(enjoyment.value) : null,
        notes: notes.value.trim() || null,
        request_relocation: requestRelocation.value,
        requested_position: requestRelocation.value && requestedPosition.value !== ''
          ? Number(requestedPosition.value)
          : null,
        comparison_level_id: comparisonLevel.value?.position ?? null,
        comparison_level_name: comparisonLevel.value?.name ?? null,
      },
    })
    success.value = true
    proofUrl.value = ''; gddlTier.value = ''; difficulty.value = ''; enjoyment.value = ''
    notes.value = ''; requestRelocation.value = false; requestedPosition.value = ''
    comparisonLevel.value = null
    setTimeout(() => (success.value = false), 6000)
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Submission failed.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="container-tight py-8 max-w-xl">
    <h1 class="text-3xl font-semibold tracking-tight mb-1">Submit an opinion</h1>
    <p v-if="levelInfo" class="text-sm text-zinc-400 mb-1">
      For <span class="text-zinc-200 font-medium">#{{ levelInfo.position }} {{ levelInfo.name }}</span>
      <span v-if="kind === 'void'" class="text-fuchsia-300/80"> · void list</span>
    </p>
    <p class="text-sm text-zinc-400 mb-6">
      Opinions are only accepted from people who completed the level in at most two runs. Your proof
      will be reviewed by a moderator before the opinion counts toward the community tier.
    </p>

    <div v-if="loadError" class="rounded border border-red-900/50 bg-red-950/30 text-red-300 px-3 py-2 text-sm">
      {{ loadError }}
    </div>

    <form v-else class="space-y-4" @submit.prevent="submit">
      <label class="block">
        <span class="text-[11px] uppercase tracking-widest text-zinc-500">Proof of progress URL <span class="text-red-400">*</span></span>
        <input
          v-model="proofUrl"
          type="url"
          required
          placeholder="https://www.youtube.com/watch?v=…"
          class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <span class="block text-[11px] text-zinc-500 mt-1">
          Opinions are only accepted if you completed the level in at most two runs.
        </span>
      </label>

      <fieldset class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
        <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Your ratings</legend>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">GDDL Tier</span>
            <select
              v-model="gddlTier"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option v-for="t in TIER_OPTIONS" :key="t" :value="t">{{ t || '— none —' }}</option>
            </select>
          </label>
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Demon level</span>
            <select
              v-model="difficulty"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option v-for="d in DIFFICULTY_OPTIONS" :key="d" :value="d">{{ d || '— none —' }}</option>
            </select>
          </label>
        </div>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Enjoyment <span class="text-zinc-600 normal-case">— 0–10</span></span>
          <input
            v-model="enjoyment"
            type="number" min="0" max="10" step="0.1" inputmode="decimal"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
      </fieldset>

      <fieldset v-if="kind === 'main'" class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
        <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Placement</legend>
        <label class="flex items-start gap-2 cursor-pointer select-none">
          <input v-model="requestRelocation" type="checkbox" class="mt-0.5 accent-accent" />
          <span class="text-sm text-zinc-200">
            Request that this level be moved on the list
            <span class="block text-[11px] text-zinc-500 mt-0.5">
              Pick a comparison level to suggest a new placement; mods see the old vs. new placement in the opinions tab.
            </span>
          </span>
        </label>

        <div v-if="requestRelocation" class="space-y-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] text-zinc-500">
              Compare against an existing level to autofill a target placement.
            </span>
            <button
              type="button"
              class="shrink-0 rounded border border-accent/60 text-accent hover:bg-accent/10 text-xs px-2.5 py-1 transition-colors"
              @click="compareOpen = true"
            >Level comparison</button>
          </div>

          <div
            v-if="comparisonLevel"
            class="rounded border border-accent/40 bg-accent/5 px-3 py-2 text-xs flex items-center gap-2"
          >
            <span class="text-zinc-400">Compared to</span>
            <span class="text-zinc-100 font-medium truncate">#{{ comparisonLevel.position }} {{ comparisonLevel.name }}</span>
            <button type="button" class="ml-auto text-zinc-500 hover:text-red-400" @click="clearComparison">clear</button>
          </div>

          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Suggested new placement</span>
            <input
              v-model="requestedPosition"
              type="number" inputmode="numeric" min="1"
              placeholder="e.g. 42"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
        </div>
      </fieldset>

      <label class="block">
        <span class="text-[11px] uppercase tracking-widest text-zinc-500">Note for the mods <span class="text-zinc-600 normal-case">— optional</span></span>
        <textarea
          v-model="notes"
          rows="3"
          maxlength="4000"
          class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>

      <div class="flex items-center gap-3 pt-2">
        <button
          type="submit"
          :disabled="submitting"
          class="rounded bg-accent text-zinc-950 font-medium text-sm px-4 py-2 hover:bg-accent/90 disabled:opacity-60 transition-colors"
        >{{ submitting ? 'Submitting…' : 'Submit opinion' }}</button>
        <span v-if="success" class="text-xs text-emerald-400">Submitted — pending review.</span>
        <span v-if="error" class="text-xs text-red-400">{{ error }}</span>
      </div>
    </form>

    <LevelComparisonDrawer
      v-model:open="compareOpen"
      :initial="comparisonLevel"
      @confirm="onConfirmCompare"
    />
  </div>
</template>
