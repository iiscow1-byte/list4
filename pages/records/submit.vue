<script setup lang="ts">
import { useLevelPicker } from '~/composables/useLevelPicker'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Submit a record — All Levels List' })

const route = useRoute()
const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

type LevelMatch = { position: number; name: string }
type Row = { uid: number; search: string; video: string; selected: LevelMatch | null; isVerificationClaim: boolean }

const levelSearch = ref('')
const selectedLevel = ref<LevelMatch | null>(null)
const selectedVerifier = ref<string | null>(null)
const isVerificationClaim = ref(false)

const levelPicker = useLevelPicker(levelSearch, selectedLevel, (s) => { selectedLevel.value = s })

// Pre-fill from ?position=N if provided.
async function preselectFromQuery() {
  const pos = Number(route.query.position)
  if (!Number.isFinite(pos)) return
  try {
    const lvl = await $fetch<{ position: number; name: string; verifier: string | null }>(`/api/levels/${pos}`)
    selectedLevel.value = { position: lvl.position, name: lvl.name }
    selectedVerifier.value = lvl.verifier ?? null
    levelSearch.value = `#${lvl.position} ${lvl.name}`
  } catch {
    // ignore — user will pick manually
  }
}
preselectFromQuery()

watch(selectedLevel, async (l) => {
  if (!l) {
    selectedVerifier.value = null
    isVerificationClaim.value = false
    return
  }
  try {
    const full = await $fetch<{ verifier: string | null }>(`/api/levels/${l.position}`)
    selectedVerifier.value = full.verifier ?? null
  } catch {
    selectedVerifier.value = null
  }
  if (selectedVerifier.value) isVerificationClaim.value = false
})

const canClaimVerification = computed(() => selectedLevel.value != null && !selectedVerifier.value)

const holderName = ref('')
const video = ref('')
const note = ref('')

// Optional ratings — promoted to a real opinion if the record is approved.
const TIER_OPTIONS = [
  '', 'Subtier 0', 'Subtier 1', 'Subtier 2', 'Subtier 3', 'Subtier 4', 'Subtier 5',
  ...Array.from({ length: 39 }, (_, i) => `Tier ${i + 1}`),
]
const DIFFICULTY_OPTIONS = [
  '', 'Auto', 'Easy', 'Normal', 'Hard', 'Harder', 'Insane',
  'Easy Demon', 'Medium Demon', 'Hard Demon', 'Insane Demon', 'Extreme Demon',
]
const ratingOpen = ref(false)
const opinionTier = ref('')
const opinionDifficulty = ref('')
const opinionEnjoyment = ref('')

const multi = ref(false)
let nextUid = 1
const makeEmptyRow = (): Row => ({ uid: nextUid++, search: '', video: '', selected: null, isVerificationClaim: false })
const rows = ref<Row[]>([makeEmptyRow()])

// Auto-grow / auto-shrink the row list based on content. The last row gets a
// new empty sibling once it has any text; non-last rows that are completely
// empty are removed. Keeps the grid feeling like a free-form spreadsheet.
function syncRows() {
  const isFilled = (r: Row) => !!r.search.trim() || !!r.video.trim()
  const last = rows.value[rows.value.length - 1]
  if (last && isFilled(last)) rows.value.push(makeEmptyRow())
  for (let i = rows.value.length - 2; i >= 0; i--) {
    const r = rows.value[i]!
    if (!r.search.trim() && !r.video.trim()) rows.value.splice(i, 1)
  }
}
watch(rows, syncRows, { deep: true })

// Keep single-mode and the first multi row in sync so toggling doesn't lose
// what the user has already typed.
function toggleMulti() {
  if (!multi.value) {
    rows.value = [{
      uid: nextUid++,
      search: levelSearch.value,
      video: video.value,
      selected: selectedLevel.value,
      isVerificationClaim: false,
    }, makeEmptyRow()]
    multi.value = true
  } else {
    const first = rows.value[0]
    if (first) {
      levelSearch.value = first.search
      video.value = first.video
      selectedLevel.value = first.selected
    }
    multi.value = false
  }
}

watchEffect(() => {
  if (!holderName.value && me.value) {
    holderName.value = me.value.claimed_player ?? me.value.username
  }
})

// Holder autocomplete — leaderboard players + accounts
type HolderMatch = { name: string; source: 'player' | 'account' }
const holderMatches = ref<HolderMatch[]>([])
const holderOpen = ref(false)
let holderDebounce: ReturnType<typeof setTimeout> | null = null

watch(holderName, (v) => {
  if (holderDebounce) clearTimeout(holderDebounce)
  const q = v.trim()
  if (!q) {
    holderMatches.value = []
    holderOpen.value = false
    return
  }
  holderDebounce = setTimeout(async () => {
    try {
      const res = await $fetch<{ items: HolderMatch[] }>('/api/users/search', {
        query: { q, limit: 10 },
      })
      // Don't suggest the value already typed exactly.
      const matches = res.items.filter((m) => m.name.toLowerCase() !== q.toLowerCase())
      holderMatches.value = matches
      holderOpen.value = matches.length > 0
    } catch {
      holderMatches.value = []
      holderOpen.value = false
    }
  }, 150)
})

function pickHolder(m: HolderMatch) {
  holderName.value = m.name
  holderMatches.value = []
  holderOpen.value = false
}

const submitting = ref(false)
const error = ref<string | null>(null)
const success = ref(false)

const successMulti = ref<{ submitted: number; failed: number } | null>(null)

async function submit() {
  if (submitting.value) return
  error.value = null

  if (multi.value) {
    const filled = rows.value.filter((r) => r.selected || r.search.trim() || r.video.trim())
    if (filled.length === 0) {
      error.value = 'Add at least one level + video.'
      return
    }
    for (const r of filled) {
      if (!r.selected) {
        error.value = 'Pick every level from the suggestions before submitting.'
        return
      }
      if (!/^https?:\/\/\S+$/i.test(r.video.trim())) {
        error.value = `Video URL is missing or invalid for "${r.selected.name}".`
        return
      }
    }
    submitting.value = true
    let submitted = 0
    let failed = 0
    let firstError: string | null = null
    try {
      for (const r of filled) {
        try {
          await $fetch('/api/records', {
            method: 'POST',
            body: {
              position: r.selected!.position,
              player_name: holderName.value.trim(),
              video: r.video.trim(),
              note: note.value.trim() || null,
              is_verification_claim: r.isVerificationClaim || false,
            },
          })
          submitted++
        } catch (e: any) {
          failed++
          if (!firstError) firstError = e?.data?.statusMessage ?? e?.statusMessage ?? 'Submission failed.'
        }
      }
    } finally {
      submitting.value = false
    }
    if (submitted > 0) {
      successMulti.value = { submitted, failed }
      rows.value = [makeEmptyRow()]
      note.value = ''
      setTimeout(() => (successMulti.value = null), 6000)
    }
    if (failed > 0 && firstError) error.value = firstError
    return
  }

  if (!selectedLevel.value) {
    error.value = 'Pick a level from the suggestions.'
    return
  }
  if (!video.value.trim()) {
    error.value = 'A video link is required.'
    return
  }
  submitting.value = true
  try {
    await $fetch('/api/records', {
      method: 'POST',
      body: {
        position: selectedLevel.value.position,
        player_name: holderName.value.trim(),
        video: video.value.trim(),
        note: note.value.trim() || null,
        is_verification_claim: canClaimVerification.value && isVerificationClaim.value,
        opinion_gddl_tier: opinionTier.value || null,
        opinion_difficulty: opinionDifficulty.value || null,
        opinion_enjoyment: opinionEnjoyment.value !== '' ? Number(opinionEnjoyment.value) : null,
      },
    })
    success.value = true
    video.value = ''
    note.value = ''
    isVerificationClaim.value = false
    opinionTier.value = ''
    opinionDifficulty.value = ''
    opinionEnjoyment.value = ''
    ratingOpen.value = false
    setTimeout(() => (success.value = false), 5000)
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Submission failed.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="container-tight py-8" :class="multi ? 'max-w-3xl' : 'max-w-xl'">
    <header class="mb-6">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div class="min-w-0">
          <h1 class="text-3xl font-bold tracking-tight">Submit a record</h1>
          <p class="text-sm text-zinc-400 mt-1">
            A moderator reviews every submission before it appears on the level page.
          </p>
        </div>
        <div class="shrink-0 flex flex-col items-end gap-1">
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Multiple records</span>
            <button
              type="button"
              role="switch"
              :aria-checked="multi"
              class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
              :class="multi ? 'bg-accent' : 'bg-zinc-800'"
              @click="toggleMulti"
            >
              <span
                class="inline-block h-4 w-4 rounded-full bg-zinc-50 transition-transform"
                :class="multi ? 'translate-x-4' : 'translate-x-0.5'"
              />
            </button>
          </label>
          <span class="text-[10px] text-zinc-600">{{ multi ? 'One row per level' : 'One record at a time' }}</span>
        </div>
      </div>

      <!-- What actually happens after you press Submit — this used to be a
           single line above the form that read as decoration. -->
      <ol class="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-600">
        <li class="inline-flex items-center gap-1.5">
          <span class="w-4 h-4 rounded-full bg-accent/15 text-accent text-[9px] font-bold flex items-center justify-center">1</span>
          Pick the level and link your proof
        </li>
        <li aria-hidden="true" class="text-zinc-800">→</li>
        <li class="inline-flex items-center gap-1.5">
          <span class="w-4 h-4 rounded-full bg-zinc-800 text-zinc-400 text-[9px] font-bold flex items-center justify-center">2</span>
          A moderator reviews it
        </li>
        <li aria-hidden="true" class="text-zinc-800">→</li>
        <li class="inline-flex items-center gap-1.5">
          <span class="w-4 h-4 rounded-full bg-zinc-800 text-zinc-400 text-[9px] font-bold flex items-center justify-center">3</span>
          It counts toward your points
        </li>
      </ol>
    </header>

    <form class="space-y-4" @submit.prevent="submit">
      <!-- Multi-row grid: level on the left, video URL on the right -->
      <div v-if="multi" class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div class="grid grid-cols-[1fr_1fr] gap-x-3 gap-y-2 text-[11px] uppercase tracking-widest text-zinc-500 mb-1.5">
          <span>Level <span class="text-red-400">*</span></span>
          <span>Video URL <span class="text-red-400">*</span></span>
        </div>
        <div class="grid grid-cols-[1fr_1fr] gap-x-3 gap-y-1.5">
          <RecordSubmitRow
            v-for="row in rows"
            :key="row.uid"
            :model-value="row"
            @update:model-value="(v) => Object.assign(row, v)"
          />
        </div>
        <p class="text-[11px] text-zinc-500 mt-2.5">A new row appears as soon as you start filling the last one.</p>
      </div>

      <!-- Single mode: the level and the proof belong together, so they share
           one card. The picker needs its own relative wrapper — anchoring it to
           the card would make the dropdown wider than the input it belongs to. -->
      <div v-else class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
        <div class="relative">
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Level <span class="text-red-400">*</span></span>
          <input
            v-model="levelSearch"
            placeholder="Search by name or position…"
            autocomplete="off"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            @focus="levelPicker.openIfHasMatches()"
            @blur="levelPicker.scheduleClose()"
          />
        </label>
        <ul
          v-if="levelPicker.open.value && levelPicker.matches.value.length"
          :ref="levelPicker.setScrollEl"
          class="absolute z-10 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900 shadow-lg"
          @scroll="levelPicker.onScroll"
        >
          <li v-for="l in levelPicker.matches.value" :key="l.position">
            <button
              type="button"
              class="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-900 flex items-center gap-3"
              :class="{ 'bg-accent/10': levelPicker.isExactMatch(l) }"
              @mousedown.prevent="levelPicker.pick(l)"
            >
              <span class="tabular-nums text-accent text-xs w-12 shrink-0">#{{ l.position }}</span>
              <span class="truncate">{{ l.name }}</span>
              <span v-if="levelPicker.isExactMatch(l)" class="ml-auto text-[10px] uppercase tracking-widest text-accent shrink-0">Exact</span>
            </button>
          </li>
          <li v-if="levelPicker.loading.value" class="px-3 py-2 text-[11px] text-zinc-500 text-center">loading…</li>
        </ul>
        </div>

        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Video URL <span class="text-red-400">*</span></span>
          <input
            v-model="video"
            type="url"
            required
            placeholder="https://www.youtube.com/watch?v=…"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <label v-if="canClaimVerification" class="flex items-start gap-2 cursor-pointer select-none rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
          <input
            v-model="isVerificationClaim"
            type="checkbox"
            class="mt-0.5 accent-accent"
          />
          <span class="text-sm text-zinc-200">
            This is the level's verification
            <span class="block text-[11px] text-zinc-500 mt-0.5">
              If approved, {{ holderName.trim() || 'the record holder' }} will be credited as the verifier of this level.
            </span>
          </span>
        </label>
      </div>

      <div class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div class="relative">
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Record holder</span>
            <input
              v-model="holderName"
              placeholder="Player name"
              autocomplete="off"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              @focus="holderOpen = holderMatches.length > 0"
              @blur="setTimeout(() => holderOpen = false, 150)"
            />
            <span class="text-[11px] text-zinc-500 mt-1 block">Defaults to you. Change it if you're submitting on someone else's behalf.</span>
          </label>
          <ul
            v-if="holderOpen && holderMatches.length"
            class="absolute z-10 left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900 shadow-lg"
          >
            <li v-for="m in holderMatches" :key="`${m.source}:${m.name}`">
              <button
                type="button"
                class="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-900 flex items-center gap-3"
                @mousedown.prevent="pickHolder(m)"
              >
                <span class="truncate flex-1">{{ m.name }}</span>
                <span class="text-[10px] uppercase tracking-widest text-zinc-500">{{ m.source }}</span>
              </button>
            </li>
          </ul>
        </div>
      </div>

      <fieldset v-if="!multi" class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
        <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">
          <button type="button" class="hover:text-zinc-300" @click="ratingOpen = !ratingOpen">
            Rate this level <span class="text-zinc-600 normal-case">applied if the record is approved</span>
            <span class="ml-1 text-[11px]">{{ ratingOpen ? '▾' : '▸' }}</span>
          </button>
        </legend>
        <div v-if="ratingOpen" class="space-y-3 pt-2">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">GDDL Tier</span>
              <select
                v-model="opinionTier"
                class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option v-for="t in TIER_OPTIONS" :key="t" :value="t">{{ t || '— none —' }}</option>
              </select>
            </label>
            <label class="block">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Demon level</span>
              <select
                v-model="opinionDifficulty"
                class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option v-for="d in DIFFICULTY_OPTIONS" :key="d" :value="d">{{ d || '— none —' }}</option>
              </select>
            </label>
          </div>
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Enjoyment <span class="text-zinc-600 normal-case">— 0–10</span></span>
            <input
              v-model="opinionEnjoyment"
              type="number" min="0" max="10" step="0.1" inputmode="decimal"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
        </div>
      </fieldset>

      <div class="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Note for the mods <span class="text-zinc-600 normal-case">optional</span></span>
          <textarea
            v-model="note"
            rows="3"
            maxlength="2000"
            placeholder="Anything the reviewer should know — device, framerate, a timestamp…"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
      </div>

      <!-- Outcomes as panels rather than a line of small text next to the
           button — a submission that half-failed deserves more than 11px. -->
      <p v-if="success" class="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2.5 text-sm text-emerald-300">
        Submitted — pending review. You'll get an inbox message when a moderator decides.
      </p>
      <p
        v-if="successMulti"
        class="rounded-lg border px-3 py-2.5 text-sm"
        :class="successMulti.failed
          ? 'border-amber-900/60 bg-amber-950/30 text-amber-300'
          : 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'"
      >
        Submitted {{ successMulti.submitted }} record{{ successMulti.submitted === 1 ? '' : 's' }} — pending review.
        <template v-if="successMulti.failed">{{ successMulti.failed }} could not be submitted; see the error below.</template>
      </p>
      <p v-if="error" class="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2.5 text-sm text-red-300">{{ error }}</p>

      <div class="sticky bottom-0 -mx-4 px-4 py-3 bg-zinc-950/90 backdrop-blur border-t border-zinc-800/80 flex items-center gap-3">
        <button
          type="submit"
          :disabled="submitting"
          class="rounded-lg bg-accent text-zinc-950 font-semibold text-sm px-5 py-2 hover:bg-accent/90 disabled:opacity-60 transition-colors"
        >{{ submitting ? 'Submitting…' : multi ? 'Submit records' : 'Submit record' }}</button>
        <span class="text-[11px] text-zinc-600">
          <span class="text-red-400">*</span> required
        </span>
      </div>
    </form>
  </div>
</template>
