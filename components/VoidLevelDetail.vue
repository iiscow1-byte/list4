<script setup lang="ts">
type VoidLevel = {
  position: number
  name: string
  gd_id: number | null
  verify_date: string | null
  days: number | null
  demon_ranking: string | null
  placement_source: string | null
  verification: string | null
  verification_url: string | null
  added_on: string | null
}

const props = defineProps<{ level: VoidLevel }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

const { data: meRes } = useCurrentUser()
const role = computed(() => meRes.value?.account?.role ?? null)
const isAdmin = computed(() => role.value === 'admin' || role.value === 'owner' || role.value === 'developer')
const canEdit = computed(() => isAdmin.value || role.value === 'moderator')

const editing = ref(false)
const draft = reactive({
  name: '',
  gd_id: '' as number | string,
  verify_date: '',
  days: '' as number | string,
  demon_ranking: '',
  placement_source: '',
  verification: '',
  verification_url: '',
})
const draftPosition = ref<number | string>('')
const saving = ref(false)
const saveError = ref<string | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

function startEdit() {
  draft.name = props.level.name ?? ''
  draft.gd_id = props.level.gd_id ?? ''
  draft.verify_date = props.level.verify_date ?? ''
  draft.days = props.level.days ?? ''
  draft.demon_ranking = props.level.demon_ranking ?? ''
  draft.placement_source = props.level.placement_source ?? ''
  draft.verification = props.level.verification ?? ''
  draft.verification_url = props.level.verification_url ?? ''
  draftPosition.value = props.level.position
  saveError.value = null
  deleteError.value = null
  editing.value = true
}
function cancelEdit() {
  editing.value = false
  saveError.value = null
  deleteError.value = null
}

watch(() => props.level.position, (next, prev) => {
  if (prev != null && next !== prev) cancelEdit()
})

async function saveEdit() {
  if (saving.value) return
  saving.value = true
  saveError.value = null
  try {
    await $fetch(`/api/admin/void/${props.level.position}`, { method: 'PATCH', body: { ...draft } })
    const newPos = Number(draftPosition.value)
    if (Number.isInteger(newPos) && newPos > 0 && newPos !== props.level.position) {
      await $fetch(`/api/admin/void/${props.level.position}/move`, { method: 'POST', body: { to: newPos } })
      await navigateTo(`/void/${newPos}`)
      return
    }
    emit('refresh')
    editing.value = false
  } catch (e: any) {
    saveError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Save failed.'
  } finally {
    saving.value = false
  }
}

async function deleteLevel() {
  if (deleting.value) return
  if (!confirm(`Delete "${props.level.name}" (#${props.level.position}) from the void list? This shifts everything below up by one and cannot be undone from the UI.`)) return
  deleting.value = true
  deleteError.value = null
  try {
    await $fetch(`/api/admin/void/${props.level.position}`, { method: 'DELETE' })
    await navigateTo('/void/1')
  } catch (e: any) {
    deleteError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Delete failed.'
  } finally {
    deleting.value = false
  }
}

const tags = computed(() => {
  const list: string[] = []
  if (props.level.demon_ranking) list.push(props.level.demon_ranking)
  if (props.level.placement_source) list.push(props.level.placement_source)
  return list
})

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

const ytId = computed(() => youtubeId(props.level.verification_url))
const fallbackSearch = computed(() => {
  if (!props.level.verification) return null
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(props.level.verification)}`
})
const gdLevelUrl = computed(() => props.level.gd_id ? `https://gdbrowser.com/${props.level.gd_id}` : null)
</script>

<template>
  <div class="px-8 py-6 max-w-3xl mx-auto w-full">
    <header class="mb-6 flex items-start gap-4">
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-3 flex-wrap">
          <span class="tabular-nums text-fuchsia-300 text-sm">#{{ level.position }}</span>
          <h1 class="text-3xl font-semibold tracking-tight">{{ level.name }}</h1>
          <span class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-fuchsia-900/40 text-fuchsia-300 border border-fuchsia-800/60">
            Void
          </span>
        </div>
        <p class="text-xs text-zinc-500 mt-1.5">
          Levels in the void list have no difficulty opinion.
        </p>
      </div>
      <button
        v-if="canEdit && !editing"
        type="button"
        class="shrink-0 rounded border border-accent/40 text-accent font-medium text-sm px-3 py-1.5 hover:bg-accent/10 transition-colors"
        @click="startEdit"
      >Edit</button>
    </header>

    <!-- Edit form -->
    <section v-if="editing" class="rounded-md border border-accent/40 bg-zinc-950/80 p-5 mb-6 space-y-4">
      <div class="flex items-baseline justify-between">
        <h2 class="text-xs uppercase tracking-widest text-accent font-medium">Editing void level</h2>
        <span class="text-[11px] text-zinc-500">Currently at #{{ level.position }}</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="block sm:col-span-2">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Name</span>
          <input v-model="draft.name" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Position <span class="text-zinc-600 normal-case">— moves the level, shifts neighbors</span></span>
          <input v-model="draftPosition" type="number" inputmode="numeric" min="1" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Level ID</span>
          <input v-model="draft.gd_id" inputmode="numeric" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verify date</span>
          <input v-model="draft.verify_date" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Days</span>
          <input v-model="draft.days" inputmode="numeric" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Demon ranking</span>
          <input v-model="draft.demon_ranking" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Source</span>
          <input v-model="draft.placement_source" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block sm:col-span-2">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verification (text)</span>
          <input v-model="draft.verification" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
        <label class="block sm:col-span-2">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verification URL</span>
          <input v-model="draft.verification_url" class="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </label>
      </div>

      <div class="flex items-center gap-3 pt-2 flex-wrap">
        <button
          type="button"
          :disabled="saving"
          class="rounded bg-accent text-zinc-950 font-medium text-sm px-4 py-1.5 hover:bg-accent/90 disabled:opacity-60 transition-colors"
          @click="saveEdit"
        >{{ saving ? 'Saving…' : 'Save' }}</button>
        <button
          type="button"
          class="rounded border border-zinc-700 text-sm px-4 py-1.5 hover:border-zinc-600 transition-colors"
          @click="cancelEdit"
        >Cancel</button>
        <button
          v-if="isAdmin"
          type="button"
          :disabled="deleting"
          class="ml-auto rounded border border-red-900/60 text-red-400 text-sm px-4 py-1.5 hover:bg-red-950/40 hover:border-red-700 disabled:opacity-60 transition-colors"
          @click="deleteLevel"
        >{{ deleting ? 'Deleting…' : 'Delete level' }}</button>
        <span v-if="saveError" class="text-xs text-red-400">{{ saveError }}</span>
        <span v-if="deleteError" class="text-xs text-red-400">{{ deleteError }}</span>
      </div>
    </section>

    <!-- Verification -->
    <div v-if="ytId" class="aspect-video rounded-md border border-zinc-800 bg-black mb-6 overflow-hidden">
      <iframe
        :src="`https://www.youtube.com/embed/${ytId}`"
        class="w-full h-full"
        :title="level.verification ?? 'Verification'"
        frameborder="0"
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      />
    </div>
    <a
      v-else-if="level.verification_url || fallbackSearch"
      :href="(level.verification_url ?? fallbackSearch)!"
      target="_blank"
      rel="noopener"
      class="block aspect-video rounded-md border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900 mb-6 relative group overflow-hidden hover:border-accent/40 transition-colors"
    >
      <div class="absolute inset-0 flex items-center justify-center">
        <div class="text-center px-6">
          <div class="w-14 h-14 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center mx-auto mb-3 group-hover:bg-accent/30 transition-colors">
            <svg viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6 text-accent translate-x-0.5">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <p class="text-sm font-medium text-zinc-300 max-w-md mx-auto line-clamp-2">{{ level.verification ?? 'Watch verification' }}</p>
          <p class="text-[11px] text-zinc-500 mt-2 uppercase tracking-wider">
            {{ level.verification_url ? 'Open verification ↗' : 'Search YouTube' }}
          </p>
        </div>
      </div>
    </a>

    <!-- Tags -->
    <div v-if="tags.length" class="flex flex-wrap items-center gap-2 mb-6">
      <span
        v-for="t in tags"
        :key="t"
        class="px-2.5 py-1 rounded-full text-[11px] font-medium bg-zinc-900 border border-zinc-800 text-zinc-300"
      >
        {{ t }}
      </span>
    </div>

    <!-- Stats grid -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 rounded-md overflow-hidden mb-6">
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Level ID</div>
        <a
          v-if="gdLevelUrl"
          :href="gdLevelUrl"
          target="_blank"
          rel="noopener"
          class="tabular-nums text-base text-zinc-100 hover:text-accent transition-colors"
        >{{ level.gd_id }}</a>
        <div v-else class="tabular-nums text-base text-zinc-600">—</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Days</div>
        <div class="tabular-nums text-base text-zinc-100">{{ level.days != null ? level.days.toLocaleString() : '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Verify date</div>
        <div class="tabular-nums text-sm text-zinc-100">{{ level.verify_date ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Added to pending</div>
        <div class="tabular-nums text-sm text-zinc-100">{{ level.added_on ?? '—' }}</div>
      </div>
    </div>

    <!-- Source / verification metadata -->
    <section class="rounded-md border border-zinc-800 bg-zinc-950/60">
      <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 px-4 pt-3 font-medium">Information</h2>
      <dl class="px-4 py-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt class="text-zinc-500">Source</dt><dd class="text-zinc-200">{{ level.placement_source ?? '—' }}</dd>
        <dt class="text-zinc-500">Demon ranking</dt><dd class="text-zinc-200">{{ level.demon_ranking ?? '—' }}</dd>
        <dt class="text-zinc-500">Verification</dt>
        <dd class="text-zinc-200 truncate" :title="level.verification ?? ''">{{ level.verification ?? '—' }}</dd>
      </dl>
    </section>
  </div>
</template>
