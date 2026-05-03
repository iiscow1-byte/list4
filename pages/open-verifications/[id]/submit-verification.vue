<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const id = computed(() => Number(route.params.id))

type OpenVerLevel = {
  id: number
  gd_id: number | null
  name: string
  gddl_tier: string | null
  difficulty: string | null
  verifier: string | null
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

const verifierName = ref('')
const video = ref('')
const verifyDate = ref('')
const note = ref('')

watchEffect(() => {
  if (!verifierName.value && me.value) {
    verifierName.value = me.value.claimed_player ?? me.value.username
  }
})

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
        verify_date: verifyDate.value || null,
        notes: note.value.trim() || null,
        opinion_gddl_tier: opinionTier.value || null,
        opinion_difficulty: opinionDifficulty.value || null,
        opinion_enjoyment: opinionEnjoyment.value !== '' ? Number(opinionEnjoyment.value) : null,
      },
    })
    success.value = true
    video.value = ''
    note.value = ''
    verifyDate.value = ''
    opinionTier.value = ''
    opinionDifficulty.value = ''
    opinionEnjoyment.value = ''
    ratingOpen.value = false
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Submission failed.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="container-tight py-8 max-w-xl">
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
          A moderator will review your submission before this level moves to the main list.
        </p>
      </div>

      <div class="rounded-md border border-zinc-800 bg-zinc-950/60 px-4 py-3 mb-5">
        <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1">Level</div>
        <div class="flex items-baseline gap-3 flex-wrap">
          <span class="text-base text-zinc-100 font-medium">{{ level.name }}</span>
          <span v-if="level.gd_id" class="text-xs text-zinc-500 tabular-nums">#{{ level.gd_id }}</span>
        </div>
        <div v-if="level.verifier" class="text-[11px] text-amber-300 mt-1">
          Already credits {{ level.verifier }} as verifier — your submission can correct or replace this.
        </div>
      </div>

      <form class="space-y-4" @submit.prevent="submit">
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verifier</span>
          <input
            v-model="verifierName"
            placeholder="Player name"
            autocomplete="off"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <span class="text-[11px] text-zinc-500 mt-1 block">
            Defaults to you. Change it if you're submitting on someone else's behalf.
          </span>
        </label>

        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verification video</span>
          <input
            v-model="video"
            type="url"
            required
            placeholder="https://www.youtube.com/watch?v=…"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verification date <span class="text-zinc-600 normal-case">— optional</span></span>
          <input
            v-model="verifyDate"
            type="date"
            class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <fieldset class="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
          <legend class="px-2 text-[10px] uppercase tracking-widest text-zinc-500 font-medium">
            <button type="button" class="hover:text-zinc-300" @click="ratingOpen = !ratingOpen">
              Rate this level <span class="text-zinc-600 normal-case">— optional, applied if the verification is approved</span>
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
          >{{ submitting ? 'Submitting…' : 'Submit verification' }}</button>
          <NuxtLink
            :to="`/open-verifications/${id}`"
            class="text-xs text-zinc-400 hover:text-zinc-100"
          >Cancel</NuxtLink>
          <span v-if="success" class="text-xs text-emerald-400">Submitted — pending review.</span>
          <span v-if="error" class="text-xs text-red-400">{{ error }}</span>
        </div>
      </form>
    </div>
  </div>
</template>
