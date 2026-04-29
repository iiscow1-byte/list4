<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Submit a level — All Levels List' })

const TIER_OPTIONS = [
  '', 'Subtier 0', 'Subtier 1', 'Subtier 2', 'Subtier 3', 'Subtier 4', 'Subtier 5',
  ...Array.from({ length: 39 }, (_, i) => `Tier ${i + 1}`),
]
const DIFFICULTY_OPTIONS = [
  '', 'Auto', 'Easy', 'Normal', 'Hard', 'Harder', 'Insane',
  'Easy Demon', 'Medium Demon', 'Hard Demon', 'Insane Demon', 'Extreme Demon',
]
const SKILLSET_OPTIONS = [
  '', 'Wave', 'Memory', 'Timings', 'Ship', 'Solo 2P', 'Controlled Spam', 'Flow',
  'Nerve Control', 'Chokepoints', 'High CPS', 'Overall', 'Learny', 'Duals', 'Fast Paced',
  'Consistency', 'Swingcopter', 'Robot', 'Endurance', 'Cube', 'Straight Fly', 'UFO',
  'Ship Control', 'Ball', 'Spider', 'Spam', 'Framelocked',
]
const ALL_TAGS = ['old', 'uldm', 'buffed', 'nerfed'] as const

const gdId = ref('')
const name = ref('')
const fps = ref('any')
const gameVersion = ref('any')
const verification = ref('')
const verificationUrl = ref('')
const verifier = ref('')
const verifyDate = ref('')
const gddlTier = ref('')
const difficulty = ref('')
const enjoyment = ref('')
const skillset = ref('')
const tagSet = reactive<Record<string, boolean>>({ old: false, uldm: false, buffed: false, nerfed: false })
const notes = ref('')

const submitting = ref(false)
const error = ref<string | null>(null)
const success = ref(false)

// Derive whether the level "looks like" something that needs a verification video.
function tierNumber(label: string): number | null {
  const m = label.match(/^Tier (\d{1,2})$/)
  return m ? Number(m[1]) : null
}
const looksHard = computed(() => {
  if (difficulty.value === 'Extreme Demon') return true
  const n = tierNumber(gddlTier.value)
  return n != null && n >= 20
})
const hasVerificationInfo = computed(() =>
  !!(verification.value.trim() || verificationUrl.value.trim() || verifier.value.trim() || verifyDate.value.trim()),
)
const verificationWarning = computed(() =>
  looksHard.value && !hasVerificationInfo.value
    ? 'Extreme Demons / Tier 20+ levels usually need a verification video.'
    : null,
)
const noOpinion = computed(() => !gddlTier.value && !difficulty.value)

async function submit() {
  if (submitting.value) return
  error.value = null
  if (!gdId.value.trim() || !/^\d+$/.test(gdId.value.trim())) {
    error.value = 'A numeric level ID is required.'
    return
  }
  submitting.value = true
  try {
    await $fetch('/api/levels/submit', {
      method: 'POST',
      body: {
        gd_id: gdId.value.trim(),
        name: name.value.trim() || null,
        fps: fps.value.trim() || 'any',
        game_version: gameVersion.value.trim() || 'any',
        verification: verification.value.trim() || null,
        verification_url: verificationUrl.value.trim() || null,
        verifier: verifier.value.trim() || null,
        verify_date: verifyDate.value || null,
        gddl_tier: gddlTier.value || null,
        difficulty: difficulty.value || null,
        enjoyment: enjoyment.value !== '' ? Number(enjoyment.value) : null,
        main_skillset: skillset.value || null,
        tags: ALL_TAGS.filter((t) => tagSet[t]),
        notes: notes.value.trim() || null,
      },
    })
    success.value = true
    // Reset form (but keep fps/version defaults)
    gdId.value = ''; name.value = ''; verification.value = ''; verificationUrl.value = ''
    verifier.value = ''; verifyDate.value = ''; gddlTier.value = ''; difficulty.value = ''
    enjoyment.value = ''; skillset.value = ''; notes.value = ''
    for (const t of ALL_TAGS) tagSet[t] = false
    setTimeout(() => (success.value = false), 6000)
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Submission failed.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="container-tight py-8 max-w-2xl">
    <h1 class="text-3xl font-semibold tracking-tight mb-1">Submit a level</h1>
    <p class="text-sm text-zinc-400 mb-6">
      Suggest a new level for the list. A moderator reviews each submission and picks its placement.
    </p>

    <form class="space-y-5" @submit.prevent="submit">
      <!-- Level ID + name -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label class="block sm:col-span-1">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Level ID <span class="text-red-400">*</span></span>
          <input
            v-model="gdId"
            inputmode="numeric"
            placeholder="e.g. 12345678"
            required
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <label class="block sm:col-span-2">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Name <span class="text-zinc-600 normal-case">— optional, mods will fill from GD</span></span>
          <input
            v-model="name"
            placeholder="Level name"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
      </div>

      <!-- FPS + Version -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Made for FPS</span>
          <input
            v-model="fps"
            placeholder="any"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Game version</span>
          <input
            v-model="gameVersion"
            placeholder="any"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
      </div>

      <!-- Verification -->
      <fieldset class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
        <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Verification</legend>

        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verification link</span>
          <input
            v-model="verificationUrl"
            type="url"
            placeholder="https://www.youtube.com/watch?v=…"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verifier</span>
            <input
              v-model="verifier"
              placeholder="Player name"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verification date</span>
            <input
              v-model="verifyDate"
              type="date"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
        </div>

        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verification title <span class="text-zinc-600 normal-case">— optional</span></span>
          <input
            v-model="verification"
            placeholder='e.g. "Level Name 100% Verified"'
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <p
          v-if="verificationWarning"
          class="text-xs text-amber-300 bg-amber-950/30 border border-amber-900/50 rounded px-3 py-2"
        >⚠ {{ verificationWarning }}</p>
      </fieldset>

      <!-- Difficulty opinion -->
      <fieldset class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
        <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Difficulty opinion <span class="text-zinc-600 normal-case">— optional</span></legend>

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

        <p
          v-if="noOpinion"
          class="text-xs text-fuchsia-300 bg-fuchsia-950/30 border border-fuchsia-900/50 rounded px-3 py-2"
        >⚠ Levels submitted without a difficulty opinion will be added to the void list.</p>
      </fieldset>

      <!-- Optional metadata -->
      <fieldset class="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
        <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Extra info <span class="text-zinc-600 normal-case">— optional</span></legend>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Enjoyment <span class="text-zinc-600 normal-case">0–10</span></span>
            <input
              v-model="enjoyment"
              type="number"
              min="0"
              max="10"
              step="0.1"
              inputmode="decimal"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Main skillset</span>
            <select
              v-model="skillset"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option v-for="s in SKILLSET_OPTIONS" :key="s" :value="s">{{ s || '— none —' }}</option>
            </select>
          </label>
        </div>

        <div>
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Tags</span>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <label
              v-for="t in ALL_TAGS" :key="t"
              class="cursor-pointer select-none px-2 py-0.5 rounded border text-[11px] transition-colors capitalize"
              :class="tagSet[t]
                ? 'border-accent/60 text-accent bg-accent/10'
                : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
            >
              <input v-model="tagSet[t]" type="checkbox" class="sr-only" />
              {{ t === 'uldm' ? 'ULDM' : t }}
            </label>
          </div>
        </div>
      </fieldset>

      <!-- Notes -->
      <label class="block">
        <span class="text-[11px] uppercase tracking-widest text-zinc-500">Notes for the mods <span class="text-zinc-600 normal-case">— optional</span></span>
        <textarea
          v-model="notes"
          rows="4"
          maxlength="4000"
          placeholder="Anything the moderator should know — context, comparisons, sources…"
          class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>

      <div class="flex items-center gap-3 pt-2">
        <button
          type="submit"
          :disabled="submitting"
          class="rounded bg-accent text-zinc-950 font-medium text-sm px-4 py-2 hover:bg-accent/90 disabled:opacity-60 transition-colors"
        >{{ submitting ? 'Submitting…' : 'Submit for review' }}</button>
        <span v-if="success" class="text-xs text-emerald-400">Submitted — pending review.</span>
        <span v-if="error" class="text-xs text-red-400">{{ error }}</span>
      </div>
    </form>
  </div>
</template>
