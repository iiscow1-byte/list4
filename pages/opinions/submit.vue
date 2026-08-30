<script setup lang="ts">
import { TIER_MAX_NUMBER } from '~/utils/tier-ordinal'
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Submit an opinion — All Levels List' })

const route = useRoute()

const TIER_OPTIONS = [
  '', 'Subtier 0', 'Subtier 1', 'Subtier 2', 'Subtier 3', 'Subtier 4', 'Subtier 5',
  ...Array.from({ length: TIER_MAX_NUMBER }, (_, i) => `Tier ${i + 1}`),
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
/** The picker, reused to choose the level the opinion is *about*. */
const subjectOpen = ref(false)

const submitting = ref(false)
const error = ref<string | null>(null)
const success = ref(false)

async function loadLevel() {
  loadError.value = null
  const pos = Number(route.query.position)
  if (!Number.isFinite(pos) || pos <= 0) {
    // Arriving without a level is now the ordinary way in — the page opens on
    // the picker instead of dead-ending on "open this from a level page".
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

/** Pick (or change) the level this opinion is about. */
function onConfirmSubject(lvl: LevelInfo) {
  position.value = lvl.position
  levelInfo.value = lvl
  loadError.value = null
  // A tier or difficulty typed for the previous level must not follow the
  // opinion onto a different one.
  gddlTier.value = ''
  difficulty.value = ''
  comparisonLevel.value = null
  requestedPosition.value = ''
}

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
    <p class="text-sm text-zinc-400 mb-5">
      Opinions are only accepted from people who completed the level in at most two runs. Your proof
      will be reviewed by a moderator before the opinion counts toward the community tier.
    </p>

    <!-- Which level this is about. Chosen here rather than only inherited from
         the page you came from, so the form is reachable on its own. -->
    <div class="mb-5">
      <span class="text-[11px] uppercase tracking-widest text-zinc-500">Level <span class="text-red-400">*</span></span>
      <button
        v-if="levelInfo"
        type="button"
        class="mt-1 w-full flex items-center gap-3 rounded border border-zinc-800 bg-zinc-950/40 hover:border-zinc-700 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
        @click="subjectOpen = true"
      >
        <span class="min-w-0 flex-1">
          <span class="block text-sm text-zinc-100 font-medium truncate">
            #{{ levelInfo.position }} {{ levelInfo.name }}
          </span>
          <span class="block text-[11px] text-zinc-500 truncate">
            <template v-if="levelInfo.gddl_tier">{{ levelInfo.gddl_tier }}</template>
            <template v-if="levelInfo.gddl_tier && levelInfo.difficulty"> · </template>
            <template v-if="levelInfo.difficulty">{{ levelInfo.difficulty }}</template>
            <span v-if="kind === 'void'" class="text-fuchsia-300/80"> · void list</span>
          </span>
        </span>
        <span class="text-[11px] text-zinc-500 shrink-0">Change</span>
      </button>
      <button
        v-else
        type="button"
        class="mt-1 w-full rounded border border-dashed border-zinc-700 hover:border-accent hover:text-accent px-3 py-4 text-sm text-zinc-400 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
        @click="subjectOpen = true"
      >
        Choose a level →
      </button>
      <p v-if="loadError" class="mt-1.5 text-xs text-red-400">{{ loadError }}</p>
    </div>

    <form v-if="levelInfo" class="space-y-4" @submit.prevent="submit">
      <label class="block">
        <span class="text-[11px] uppercase tracking-widest text-zinc-500">Proof of progress URL <span class="text-red-400">*</span></span>
        <input
          v-model="proofUrl"
          type="url"
          required
          placeholder="https://www.youtube.com/watch?v=…"
          class="field field-md mt-1"
        />
        <span class="block text-[11px] text-zinc-500 mt-1">
          Opinions are only accepted if you completed the level in at most two runs.
        </span>
      </label>

      <fieldset class="card p-4 space-y-3">
        <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Your ratings</legend>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">GDDL Tier</span>
            <select
              v-model="gddlTier"
              class="field field-md mt-1"
            >
              <option v-for="t in TIER_OPTIONS" :key="t" :value="t">{{ t || '— none —' }}</option>
            </select>
          </label>
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Difficulty</span>
            <select
              v-model="difficulty"
              class="field field-md mt-1"
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
            class="field field-md mt-1"
          />
        </label>
      </fieldset>

      <fieldset v-if="kind === 'main'" class="card p-4 space-y-3">
        <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Placement</legend>
        <label class="flex items-start gap-2 cursor-pointer select-none">
          <input v-model="requestRelocation" type="checkbox" class="mt-0.5 accent-accent" />
          <span class="text-sm text-zinc-200">
            Request that this level be moved on the list
            <span class="block text-[11px] text-zinc-500 mt-0.5">
              Pick a comparison level to suggest a new placement.
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
              class="btn btn-sm border border-accent/60 text-accent hover:bg-accent/10 shrink-0"
              @click="compareOpen = true"
            >Level comparison</button>
          </div>

          <div
            v-if="comparisonLevel"
            class="rounded border border-accent/40 bg-accent/5 px-3 py-2 text-xs flex items-center gap-2"
          >
            <span class="text-zinc-400">Compared to</span>
            <span class="text-zinc-100 font-medium truncate min-w-0">#{{ comparisonLevel.position }} {{ comparisonLevel.name }}</span>
            <button type="button" class="ml-auto shrink-0 text-zinc-500 hover:text-red-400 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60" @click="clearComparison">clear</button>
          </div>

          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Suggested new placement</span>
            <input
              v-model="requestedPosition"
              type="number" inputmode="numeric" min="1"
              placeholder="e.g. 42"
              class="field field-md mt-1"
            />
          </label>
        </div>
      </fieldset>

      <label class="block">
        <span class="text-[11px] uppercase tracking-widest text-zinc-500">Note for the mods</span>
        <textarea
          v-model="notes"
          rows="3"
          maxlength="4000"
          class="field field-md mt-1"
        />
      </label>

      <div class="flex items-center gap-3 pt-2">
        <button
          type="submit"
          :disabled="submitting"
          class="btn btn-md btn-primary"
        >{{ submitting ? 'Submitting…' : 'Submit opinion' }}</button>
        <span v-if="success" class="text-xs text-emerald-400">Submitted, pending review.</span>
        <span v-if="error" class="text-xs text-red-400">{{ error }}</span>
      </div>
    </form>

    <LevelComparisonDrawer
      v-model:open="compareOpen"
      :initial="comparisonLevel"
      @confirm="onConfirmCompare"
    />
    <LevelComparisonDrawer
      v-model:open="subjectOpen"
      :initial="levelInfo"
      title="Choose a level"
      @confirm="onConfirmSubject"
    />
  </div>
</template>
