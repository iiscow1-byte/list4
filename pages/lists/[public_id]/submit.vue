<script setup lang="ts">
definePageMeta({ layout: 'level' })

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const { list, refresh } = useCustomList(publicId)
const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

// `?item=` lets the records panel deep-link straight to the right level.
const itemId = ref<number | null>(
  Number.isInteger(Number(route.query.item)) ? Number(route.query.item) : null,
)
const percent = ref('100')
const video = ref('')
const hz = ref('')
const player = ref('')
const note = ref('')
const mobile = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const done = ref<string | null>(null)

watch(me, (v) => { if (v && !player.value) player.value = v.claimed_player ?? v.username }, { immediate: true })

const picked = computed(() => list.value?.items.find((i: any) => i.id === itemId.value) ?? null)

/**
 * Lists can waive the video requirement (settings → "Records don't need a video
 * link"). Defaults to required when the list hasn't loaded yet, so the form
 * never invites someone to submit something the server will reject.
 */
const videoRequired = computed(() => list.value?.require_record_video !== 0)

/** What this submission would be worth, so the stakes are visible up front. */
const previewPoints = computed(() => {
  if (!picked.value) return null
  const pct = Math.max(0, Math.min(100, Number(percent.value) || 0))
  return Math.round(picked.value.points * (pct / 100) * 100) / 100
})

const belowQualifying = computed(
  () => !!picked.value && (Number(percent.value) || 0) < picked.value.percent_to_qualify,
)

async function submit() {
  error.value = null
  done.value = null
  if (!itemId.value) { error.value = 'Pick a level.'; return }
  if (videoRequired.value && !video.value.trim()) { error.value = 'A video link is required.'; return }
  busy.value = true
  try {
    const res = await $fetch<{ status: string }>(`/api/custom-lists/${publicId.value}/records`, {
      method: 'POST',
      body: {
        item_id: itemId.value,
        player_name: player.value.trim() || undefined,
        percent: Number(percent.value) || 100,
        hz: hz.value ? Number(hz.value) : undefined,
        video: video.value.trim(),
        mobile: mobile.value,
        note: note.value.trim() || undefined,
      },
    })
    done.value = res.status === 'approved'
      ? 'Record added to the list.'
      : 'Submitted — an editor will review it.'
    video.value = ''; note.value = ''
    await refresh()
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Submission failed.'
  } finally {
    busy.value = false
  }
}

const field = 'mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'
const label = 'text-[10px] uppercase tracking-widest text-zinc-500 font-medium'

useHead(() => ({ title: list.value ? `Submit a record — ${list.value.title}` : 'Submit' }))
</script>

<template>
  <CustomListShell :public-id="publicId" title="Submit a record">
    <template #default="{ list: l }">
      <div v-if="!l.accepts_records" class="card px-6 py-16 text-center">
        <p class="text-sm text-zinc-400">This list isn't accepting record submissions.</p>
      </div>
      <div v-else-if="!me" class="card px-6 py-16 text-center">
        <p class="text-sm text-zinc-400">
          <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink> to submit a record.
        </p>
      </div>

      <form v-else class="card p-4 sm:p-5 grid gap-3 sm:grid-cols-2" @submit.prevent="submit">
        <label class="block sm:col-span-2">
          <span :class="label">Level *</span>
          <select v-model.number="itemId" :class="field">
            <option :value="null">Pick a level…</option>
            <option v-for="i in l.items" :key="i.id" :value="i.id">
              #{{ i.rank }} — {{ i.name }} ({{ i.percent_to_qualify }}%+, {{ i.points }} pts)
            </option>
          </select>
        </label>

        <!-- Selected-level summary -->
        <div v-if="picked" class="sm:col-span-2 relative overflow-hidden rounded-xl border border-zinc-800/70">
          <LevelThumbBg
            :gd-id="picked.gd_id"
            :video-url="picked.verification_url"
            res="medium"
            img-class="opacity-25"
            overlay-class="bg-gradient-to-r from-zinc-950/94 via-zinc-950/80 to-zinc-950/50"
          />
          <div class="relative px-3 py-2.5 flex items-center gap-3">
            <span class="tabular-nums text-accent font-bold shrink-0">#{{ picked.rank }}</span>
            <span class="truncate flex-1 text-sm text-zinc-100 font-medium">{{ picked.name }}</span>
            <span class="shrink-0 text-right">
              <span class="block text-[10px] text-zinc-500 uppercase tracking-wider">Worth</span>
              <span class="block tabular-nums text-sm font-semibold text-amber-300">{{ previewPoints }}</span>
            </span>
          </div>
        </div>

        <label class="block">
          <span :class="label">Player name</span>
          <input v-model="player" type="text" :class="field" />
        </label>
        <label class="block">
          <span :class="label">Percent *</span>
          <input v-model="percent" inputmode="numeric" :class="field" />
          <span v-if="belowQualifying" class="block text-[10px] text-amber-400 mt-1">
            {{ picked!.name }} needs at least {{ picked!.percent_to_qualify }}%.
          </span>
        </label>
        <label class="block sm:col-span-2">
          <span :class="label">Video link<template v-if="videoRequired"> *</template></span>
          <input v-model="video" type="url" placeholder="https://youtube.com/watch?v=…" :class="field" />
          <span v-if="!videoRequired" class="block text-[10px] text-zinc-600 mt-1">
            Optional on this list.
          </span>
        </label>
        <label class="block">
          <span :class="label">Refresh rate</span>
          <input v-model="hz" inputmode="numeric" placeholder="60" :class="field" />
        </label>
        <label class="flex items-end gap-2 pb-1.5 cursor-pointer select-none">
          <input v-model="mobile" type="checkbox" class="accent-accent" />
          <span class="text-xs text-zinc-400">Played on mobile</span>
        </label>
        <label class="block sm:col-span-2">
          <span :class="label">Note</span>
          <input v-model="note" type="text" maxlength="500" :class="field" />
        </label>

        <div class="sm:col-span-2 flex items-center gap-3 pt-1">
          <button
            type="submit"
            :disabled="busy || belowQualifying"
            class="btn btn-md btn-primary"
          >{{ busy ? 'Submitting…' : 'Submit record' }}</button>
          <span v-if="error" class="text-xs text-red-400">{{ error }}</span>
          <span v-else-if="done" class="text-xs text-emerald-400">{{ done }}</span>
        </div>
      </form>
    </template>
  </CustomListShell>
</template>
