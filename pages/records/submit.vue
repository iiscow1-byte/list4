<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Submit a record — All Levels List' })

const route = useRoute()
const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

type LevelMatch = { position: number; name: string }

const levelSearch = ref('')
const levelMatches = ref<LevelMatch[]>([])
const selectedLevel = ref<LevelMatch | null>(null)
const matchesOpen = ref(false)

// Pre-fill from ?position=N if provided.
async function preselectFromQuery() {
  const pos = Number(route.query.position)
  if (!Number.isFinite(pos)) return
  try {
    const lvl = await $fetch<{ position: number; name: string }>(`/api/levels/${pos}`)
    selectedLevel.value = { position: lvl.position, name: lvl.name }
    levelSearch.value = `#${lvl.position} ${lvl.name}`
  } catch {
    // ignore — user will pick manually
  }
}
preselectFromQuery()

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

async function submit() {
  if (submitting.value) return
  if (!selectedLevel.value) {
    error.value = 'Pick a level from the suggestions.'
    return
  }
  if (!video.value.trim()) {
    error.value = 'A video link is required.'
    return
  }
  error.value = null
  submitting.value = true
  try {
    await $fetch('/api/records', {
      method: 'POST',
      body: {
        position: selectedLevel.value.position,
        player_name: holderName.value.trim(),
        video: video.value.trim(),
        note: note.value.trim() || null,
      },
    })
    success.value = true
    video.value = ''
    note.value = ''
    setTimeout(() => (success.value = false), 5000)
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Submission failed.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="container-tight py-8 max-w-xl">
    <h1 class="text-3xl font-semibold tracking-tight mb-1">Submit a record</h1>
    <p class="text-sm text-zinc-400 mb-6">
      A moderator will review your submission before it appears on the level page.
    </p>

    <form class="space-y-4" @submit.prevent="submit">
      <div class="relative">
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

      <label class="block">
        <span class="text-[11px] uppercase tracking-widest text-zinc-500">Video URL</span>
        <input
          v-model="video"
          type="url"
          required
          placeholder="https://www.youtube.com/watch?v=…"
          class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
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
        <span v-if="error" class="text-xs text-red-400">{{ error }}</span>
      </div>
    </form>
  </div>
</template>
