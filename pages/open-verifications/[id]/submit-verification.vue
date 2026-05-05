<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const id = computed(() => Number(route.params.id))

type OpenVerLevel = {
  id: number
  gd_id: number | null
  name: string
  fps: string | null
  game_version: string | null
  gddl_tier: string | null
  difficulty: string | null
  enjoyment: number | null
  main_skillset: string | null
  tags: string | null
  notes: string | null
  verifier: string | null
  placement_source: string | null
}

const { data: level, error: loadError } = await useFetch<OpenVerLevel>(
  () => `/api/open-verifications/levels/${id.value}`,
  { watch: [id] },
)

useHead(() => ({
  title: level.value
    ? `Submit verification — ${level.value.name}`
    : 'Submit a verification — All Levels List',
}))

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

// Pre-fill from the open verification when it loads.
const verifierName = ref('')
const video = ref('')
const verifyDate = ref('')
const verificationTitle = ref('')
const fpsOverride = ref('')
const gameVersionOverride = ref('')
const mainSkillsetOverride = ref('')
const tagsOverride = ref('')
const placementEstimate = ref('')
const note = ref('')

watchEffect(() => {
  if (!verifierName.value && me.value) {
    verifierName.value = me.value.claimed_player ?? me.value.username
  }
})

watch(level, (lv) => {
  if (!lv) return
  fpsOverride.value = lv.fps ?? ''
  gameVersionOverride.value = lv.game_version ?? ''
  mainSkillsetOverride.value = lv.main_skillset ?? ''
  tagsOverride.value = lv.tags ?? ''
  note.value = lv.notes ?? ''
  opinionTier.value = lv.gddl_tier ?? ''
  opinionDifficulty.value = lv.difficulty ?? ''
  opinionEnjoyment.value = lv.enjoyment != null ? String(lv.enjoyment) : ''
}, { immediate: true })

const TIER_OPTIONS = [
  '', 'Subtier 0', 'Subtier 1', 'Subtier 2', 'Subtier 3', 'Subtier 4', 'Subtier 5',
  ...Array.from({ length: 39 }, (_, i) => `Tier ${i + 1}`),
]
const DIFFICULTY_OPTIONS = [
  '', 'Auto', 'Easy', 'Normal', 'Hard', 'Harder', 'Insane',
  'Easy Demon', 'Medium Demon', 'Hard Demon', 'Insane Demon', 'Extreme Demon',
]
const opinionTier = ref('')
const opinionDifficulty = ref('')
const opinionEnjoyment = ref('')

// Sections toggle
const detailsOpen = ref(false)

function youtubeId(url: string | null): string | null {
  if (!url) return null
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{6,})/,
    /youtu\.be\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/,
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (m) return m[1]!
  }
  return null
}
const videoYtId = computed(() => youtubeId(video.value))

const submitting = ref(false)
const error = ref<string | null>(null)
const success = ref(false)

async function submit() {
  if (submitting.value || !level.value) return
  error.value = null
  if (!verifierName.value.trim()) {
    error.value = 'A verifier name is required.'
    return
  }
  if (!video.value.trim()) {
    error.value = 'A verification video link is required.'
    return
  }
  submitting.value = true
  try {
    await $fetch(`/api/open-verifications/${id.value}/submit-verification`, {
      method: 'POST',
      body: {
        verifier: verifierName.value.trim(),
        verification_url: video.value.trim(),
        verification_title: verificationTitle.value.trim() || null,
        verify_date: verifyDate.value || null,
        fps_override: fpsOverride.value.trim() || null,
        game_version_override: gameVersionOverride.value.trim() || null,
        main_skillset_override: mainSkillsetOverride.value.trim() || null,
        tags_override: tagsOverride.value.trim() || null,
        placement_estimate: placementEstimate.value ? Number(placementEstimate.value) : null,
        notes: note.value.trim() || null,
        opinion_gddl_tier: opinionTier.value || null,
        opinion_difficulty: opinionDifficulty.value || null,
        opinion_enjoyment: opinionEnjoyment.value !== '' ? Number(opinionEnjoyment.value) : null,
      },
    })
    success.value = true
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Submission failed.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="container-tight py-8 max-w-2xl">
    <div v-if="loadError || !level" class="text-center text-zinc-500 py-12">
      <p class="text-sm">Open verification not found.</p>
      <NuxtLink to="/open-verifications" class="text-accent hover:underline text-sm mt-2 inline-block">
        Back to list
      </NuxtLink>
    </div>

    <div v-else>
      <div class="mb-6">
        <h1 class="text-3xl font-semibold tracking-tight mb-1">Submit a verification</h1>
        <p class="text-sm text-zinc-400">
          A moderator will review your submission before this level moves to the pending list.
        </p>
      </div>

      <!-- Level info card -->
      <div class="rounded-md border border-violet-800/50 bg-violet-950/20 px-4 py-3 mb-5">
        <div class="text-[10px] uppercase tracking-widest text-violet-400 font-medium mb-1">Level</div>
        <div class="flex items-baseline gap-3 flex-wrap">
          <span class="text-base text-zinc-100 font-medium">{{ level.name }}</span>
          <span v-if="level.gd_id" class="text-xs text-zinc-500 tabular-nums">#{{ level.gd_id }}</span>
          <span v-if="level.gddl_tier" class="text-xs text-zinc-400">{{ level.gddl_tier }}</span>
          <span v-if="level.difficulty" class="text-xs text-zinc-400">{{ level.difficulty }}</span>
        </div>
        <div v-if="level.verifier" class="text-[11px] text-amber-300 mt-1">
          Already credits {{ level.verifier }} as verifier — your submission can correct or replace this.
        </div>
      </div>

      <div v-if="success" class="rounded-md border border-emerald-800/50 bg-emerald-950/30 px-4 py-3 mb-5 text-sm text-emerald-300">
        Submitted — a moderator will review your verification before the level moves to the pending list.
        <NuxtLink :to="`/open-verifications/${id}`" class="underline ml-2 text-emerald-400 hover:text-emerald-200">Back to level</NuxtLink>
      </div>

      <form v-else class="space-y-5" @submit.prevent="submit">
        <!-- Verification video -->
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verification video <span class="text-red-400">*</span></span>
          <input
            v-model="video"
            type="url"
            required
            placeholder="https://www.youtube.com/watch?v=…"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <!-- Video preview -->
        <div v-if="videoYtId" class="aspect-video rounded-md border border-zinc-800 bg-black overflow-hidden">
          <iframe
            :src="`https://www.youtube.com/embed/${videoYtId}`"
            class="w-full h-full"
            title="Verification preview"
            frameborder="0"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verifier <span class="text-red-400">*</span></span>
            <input
              v-model="verifierName"
              placeholder="Player name"
              autocomplete="off"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <span class="text-[11px] text-zinc-500 mt-0.5 block">Defaults to you.</span>
          </label>

          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verification title</span>
            <input
              v-model="verificationTitle"
              placeholder="Video title"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>

          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verify date</span>
            <input
              v-model="verifyDate"
              type="date"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>

          <label class="block">
            <span class="text-[11px] uppercase tracking-widest text-zinc-500">Placement estimate</span>
            <input
              v-model="placementEstimate"
              type="number"
              inputmode="numeric"
              min="1"
              placeholder="e.g. 5000"
              class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
        </div>

        <!-- Difficulty opinion -->
        <fieldset class="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
          <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">
            Difficulty opinion <span class="text-zinc-600 normal-case tracking-normal">— pre-filled from open verification, editable</span>
          </legend>
          <div class="space-y-3 pt-2">
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

        <!-- Extra metadata (collapsible) -->
        <div class="rounded-md border border-zinc-800 bg-zinc-950/40">
          <button
            type="button"
            class="w-full px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-widest text-zinc-400 hover:text-accent transition-colors"
            :aria-expanded="detailsOpen"
            @click="detailsOpen = !detailsOpen"
          >
            <span>Level details <span class="text-zinc-600 normal-case tracking-normal">— pre-filled, expand to adjust</span></span>
            <svg :class="{ 'rotate-180': detailsOpen }" class="w-3.5 h-3.5 transition-transform" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
            </svg>
          </button>
          <div v-if="detailsOpen" class="px-3 pb-3 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label class="block">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">FPS</span>
              <input
                v-model="fpsOverride"
                placeholder="e.g. 60"
                class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            <label class="block">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Game version</span>
              <input
                v-model="gameVersionOverride"
                placeholder="e.g. 2.2"
                class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            <label class="block">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Main skillset</span>
              <input
                v-model="mainSkillsetOverride"
                placeholder="e.g. Timing"
                class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            <label class="block">
              <span class="text-[11px] uppercase tracking-widest text-zinc-500">Tags <span class="text-zinc-600 normal-case">— comma-separated</span></span>
              <input
                v-model="tagsOverride"
                placeholder="e.g. old,buffed"
                class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
          </div>
        </div>

        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Note for the mods</span>
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
          >{{ submitting ? 'Submitting…' : 'Submit verification' }}</button>
          <NuxtLink
            :to="`/open-verifications/${id}`"
            class="text-xs text-zinc-400 hover:text-zinc-100"
          >Cancel</NuxtLink>
          <span v-if="error" class="text-xs text-red-400">{{ error }}</span>
        </div>
      </form>
    </div>
  </div>
</template>
