<script setup lang="ts">
definePageMeta({ layout: 'level' })

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const { list, canEdit, base, pendingCount, liked, toggleLike, refresh } = useCustomList(publicId)
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

async function submit() {
  error.value = null
  done.value = null
  if (!itemId.value) { error.value = 'Pick a level.'; return }
  if (!video.value.trim()) { error.value = 'A video link is required.'; return }
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

useHead(() => ({ title: list.value ? `Submit a record — ${list.value.title}` : 'Submit' }))
</script>

<template>
  <div v-if="list" class="h-full flex flex-col min-h-0">
    <CustomListBar :list="list" :can-edit="canEdit" :pending-count="pendingCount" :liked="liked" @like="toggleLike" />
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold mb-3">Submit a record</h2>

        <p v-if="!list.accepts_records" class="text-sm text-zinc-500">
          This list isn't accepting record submissions.
        </p>
        <p v-else-if="!me" class="text-sm text-zinc-500">
          <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink> to submit a record.
        </p>

        <form v-else class="card p-4 grid gap-3 sm:grid-cols-2" @submit.prevent="submit">
          <label class="block sm:col-span-2">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Level *</span>
            <select
              v-model.number="itemId"
              class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option :value="null">Pick a level…</option>
              <option v-for="i in list.items" :key="i.id" :value="i.id">
                #{{ i.rank }} — {{ i.name }} ({{ i.percent_to_qualify }}%+)
              </option>
            </select>
            <span v-if="picked" class="block text-[10px] text-zinc-600 mt-1">
              Worth {{ picked.points }} points at 100%.
            </span>
          </label>
          <label class="block">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Player name</span>
            <input v-model="player" type="text" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <label class="block">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Percent *</span>
            <input v-model="percent" inputmode="numeric" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <label class="block sm:col-span-2">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Video link *</span>
            <input v-model="video" type="url" placeholder="https://youtube.com/watch?v=…" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <label class="block">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Refresh rate</span>
            <input v-model="hz" inputmode="numeric" placeholder="60" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <label class="flex items-end gap-2 pb-1.5 cursor-pointer select-none">
            <input v-model="mobile" type="checkbox" class="accent-accent" />
            <span class="text-xs text-zinc-400">Played on mobile</span>
          </label>
          <label class="block sm:col-span-2">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Note</span>
            <input v-model="note" type="text" maxlength="500" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <div class="sm:col-span-2 flex items-center gap-3">
            <button
              type="submit"
              :disabled="busy"
              class="rounded-lg bg-accent text-zinc-950 font-semibold text-sm px-4 py-1.5 hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >{{ busy ? 'Submitting…' : 'Submit record' }}</button>
            <span v-if="error" class="text-xs text-red-400">{{ error }}</span>
            <span v-else-if="done" class="text-xs text-emerald-400">{{ done }}</span>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
