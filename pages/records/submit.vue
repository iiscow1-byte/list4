<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Submit a record — All Levels List' })

const route = useRoute()
const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

type LevelMatch = { position: number; name: string }
type Row = { uid: number; search: string; video: string; selected: LevelMatch | null }

const levelSearch = ref('')
const levelMatches = ref<LevelMatch[]>([])
const selectedLevel = ref<LevelMatch | null>(null)
const selectedVerifier = ref<string | null>(null)
const matchesOpen = ref(false)
const isVerificationClaim = ref(false)

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

let searchDebounce: ReturnType<typeof setTimeout> | null = null
watch(levelSearch, (v) => {
  // If user keeps typing past the picked label, treat as a new search.
  if (selectedLevel.value && v !== `#${selectedLevel.value.position} ${selectedLevel.value.name}`) {
    selectedLevel.value = null
  }
  if (selectedLevel.value) {
    levelMatches.value = []
    matchesOpen.value = false
    return
  }
  if (searchDebounce) clearTimeout(searchDebounce)
  if (!v.trim()) {
    levelMatches.value = []
    matchesOpen.value = false
    return
  }
  searchDebounce = setTimeout(async () => {
    const res = await $fetch<{ items: LevelMatch[] }>('/api/levels', {
      query: { search: v.trim(), pageSize: 20 },
    })
    levelMatches.value = res.items
    matchesOpen.value = res.items.length > 0
  }, 200)
})

function pickLevel(l: LevelMatch) {
  selectedLevel.value = l
  levelSearch.value = `#${l.position} ${l.name}`
  levelMatches.value = []
  matchesOpen.value = false
}

const holderName = ref('')
const video = ref('')
const note = ref('')

const multi = ref(false)
let nextUid = 1
const makeEmptyRow = (): Row => ({ uid: nextUid++, search: '', video: '', selected: null })
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
      },
    })
    success.value = true
    video.value = ''
    note.value = ''
    isVerificationClaim.value = false
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
    <div class="flex items-start justify-between gap-3 mb-6">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight mb-1">Submit a record</h1>
        <p class="text-sm text-zinc-400">
          A moderator will review your submission before it appears on the level page.
        </p>
      </div>
      <label class="shrink-0 flex items-center gap-2 cursor-pointer select-none mt-1">
        <span class="text-[11px] uppercase tracking-widest text-zinc-500">Multiple</span>
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
    </div>

    <form class="space-y-4" @submit.prevent="submit">
      <!-- Multi-row grid: level on the left, video URL on the right -->
      <div v-if="multi">
        <div class="grid grid-cols-[1fr_1fr] gap-x-3 gap-y-2 text-[11px] uppercase tracking-widest text-zinc-500 mb-1">
          <span>Level</span>
          <span>Video URL</span>
        </div>
        <div class="grid grid-cols-[1fr_1fr] gap-x-3 gap-y-2">
          <RecordSubmitRow
            v-for="row in rows"
            :key="row.uid"
            :model-value="row"
            @update:model-value="(v) => Object.assign(row, v)"
          />
        </div>
        <p class="text-[11px] text-zinc-500 mt-2">A new row appears as soon as you start filling the last one.</p>
      </div>

      <div v-else class="relative">
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Level</span>
          <input
            v-model="levelSearch"
            placeholder="Search by name or position…"
            autocomplete="off"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            @focus="matchesOpen = levelMatches.length > 0"
          />
        </label>
        <ul
          v-if="matchesOpen && levelMatches.length"
          class="absolute z-10 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900 shadow-lg"
        >
          <li v-for="l in levelMatches" :key="l.position">
            <button
              type="button"
              class="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-900 flex items-center gap-3"
              @click="pickLevel(l)"
            >
              <span class="tabular-nums text-accent text-xs w-12 shrink-0">#{{ l.position }}</span>
              <span class="truncate">{{ l.name }}</span>
            </button>
          </li>
        </ul>
      </div>

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
          class="absolute z-10 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900 shadow-lg"
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

      <label v-if="!multi" class="block">
        <span class="text-[11px] uppercase tracking-widest text-zinc-500">Video URL</span>
        <input
          v-model="video"
          type="url"
          required
          placeholder="https://www.youtube.com/watch?v=…"
          class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>

      <label v-if="!multi && canClaimVerification" class="flex items-start gap-2 cursor-pointer select-none">
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

      <label class="block">
        <span class="text-[11px] uppercase tracking-widest text-zinc-500">Note for the mods <span class="text-zinc-600 normal-case">— optional</span></span>
        <textarea
          v-model="note"
          rows="3"
          maxlength="2000"
          class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>

      <div class="flex items-center gap-3 pt-2">
        <button
          type="submit"
          :disabled="submitting"
          class="rounded bg-accent text-zinc-950 font-medium text-sm px-4 py-1.5 hover:bg-accent/90 disabled:opacity-60 transition-colors"
        >{{ submitting ? 'Submitting…' : 'Submit' }}</button>
        <span v-if="success" class="text-xs text-emerald-400">Submitted — pending review.</span>
        <span v-if="successMulti" class="text-xs text-emerald-400">
          Submitted {{ successMulti.submitted }} record{{ successMulti.submitted === 1 ? '' : 's' }} — pending review.<span v-if="successMulti.failed">
            {{ successMulti.failed }} failed.</span>
        </span>
        <span v-if="error" class="text-xs text-red-400">{{ error }}</span>
      </div>
    </form>
  </div>
</template>
