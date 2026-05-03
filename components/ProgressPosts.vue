<script setup lang="ts">
type ProgressPost = {
  id: number
  level_name: string
  level_position: number | null
  start_percent: number
  end_percent: number
  video_url: string | null
  created_at: string
}

const props = defineProps<{
  posts: ProgressPost[]
  canPost?: boolean
}>()

const emit = defineEmits<{ (e: 'changed'): void }>()

const showForm = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)

const form = reactive({
  level_position: '' as string,
  level_name: '',
  start_percent: '' as string,
  end_percent: '' as string,
  video_url: '',
})

// Picker for an existing list level — same shape as the record submit form.
type LevelMatch = { position: number; name: string }
const levelSearch = ref('')
const levelSelected = ref<LevelMatch | null>(null)
const search = computed({
  get: () => levelSearch.value,
  set: (v) => { levelSearch.value = v },
})
const setSelected = (s: LevelMatch | null) => {
  levelSelected.value = s
  if (s) {
    form.level_position = String(s.position)
    form.level_name = s.name
  } else {
    form.level_position = ''
  }
}
const picker = useLevelPicker(search, levelSelected, setSelected)

function reset() {
  form.level_position = ''
  form.level_name = ''
  form.start_percent = ''
  form.end_percent = ''
  form.video_url = ''
  levelSelected.value = null
  levelSearch.value = ''
  error.value = null
}

async function submit() {
  if (submitting.value) return
  error.value = null
  submitting.value = true
  try {
    await $fetch('/api/account/progress', {
      method: 'POST',
      body: {
        level_position: form.level_position || undefined,
        level_name: form.level_name || undefined,
        start_percent: Number(form.start_percent),
        end_percent: Number(form.end_percent),
        video_url: form.video_url || undefined,
      },
    })
    reset()
    showForm.value = false
    emit('changed')
  } catch (e: any) {
    error.value = e?.statusMessage || e?.data?.statusMessage || 'Failed to post progress.'
  } finally {
    submitting.value = false
  }
}

async function remove(id: number) {
  if (!confirm('Delete this progress post?')) return
  try {
    await $fetch(`/api/account/progress/${id}`, { method: 'DELETE' })
    emit('changed')
  } catch (e: any) {
    alert(e?.statusMessage || 'Failed to delete.')
  }
}

function relative(at: string): string {
  const t = Date.parse(at)
  if (Number.isNaN(t)) return ''
  const diff = (Date.now() - t) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`
  return new Date(t).toLocaleDateString()
}
</script>

<template>
  <section class="rounded-md border border-zinc-800 bg-zinc-950/60">
    <div class="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
      <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium flex items-baseline gap-2">
        Progress
        <span class="text-[11px] text-zinc-600 normal-case tracking-normal">{{ posts.length }} post{{ posts.length === 1 ? '' : 's' }}</span>
      </h2>
      <button
        v-if="canPost"
        type="button"
        class="text-xs px-2 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
        @click="showForm = !showForm"
      >{{ showForm ? 'Cancel' : 'Post progress' }}</button>
    </div>

    <form v-if="canPost && showForm" class="px-4 pb-3 space-y-2 border-b border-zinc-900" @submit.prevent="submit">
      <div class="relative">
        <label class="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Level (search the list)</label>
        <input
          v-model="search"
          type="text"
          placeholder="Search by name…"
          autocomplete="off"
          class="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-accent/50"
          @focus="picker.openIfHasMatches()"
          @blur="picker.scheduleClose()"
        />
        <div
          v-if="picker.open.value && picker.matches.value.length"
          :ref="(el) => picker.setScrollEl(el as Element | null)"
          class="absolute left-0 right-0 z-10 mt-1 max-h-60 overflow-auto rounded border border-zinc-800 bg-zinc-950 shadow-lg"
          @scroll="picker.onScroll()"
        >
          <button
            v-for="m in picker.matches.value"
            :key="m.position"
            type="button"
            class="w-full text-left px-2 py-1.5 text-sm hover:bg-zinc-900 transition-colors"
            :class="picker.isExactMatch(m) ? 'text-accent' : 'text-zinc-200'"
            @mousedown.prevent="picker.pick(m)"
          >
            <span class="text-xs text-zinc-500 tabular-nums">#{{ m.position }}</span>
            {{ m.name }}
          </button>
        </div>
      </div>

      <div>
        <label class="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Or just type a name (for unrated levels)</label>
        <input
          v-model="form.level_name"
          type="text"
          placeholder="Level name"
          class="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-accent/50"
        />
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Start %</label>
          <input
            v-model="form.start_percent"
            type="number" min="0" max="100" required
            class="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-accent/50"
          />
        </div>
        <div>
          <label class="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">End %</label>
          <input
            v-model="form.end_percent"
            type="number" min="0" max="100" required
            class="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-accent/50"
          />
        </div>
      </div>

      <div>
        <label class="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Video URL (optional)</label>
        <input
          v-model="form.video_url"
          type="url"
          placeholder="https://…"
          class="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-accent/50"
        />
      </div>

      <p v-if="error" class="text-xs text-red-400">{{ error }}</p>
      <div class="flex justify-end">
        <button
          type="submit"
          :disabled="submitting"
          class="px-3 py-1.5 rounded text-sm font-medium bg-accent text-zinc-950 hover:bg-accent/90 transition-colors disabled:opacity-50"
        >{{ submitting ? 'Posting…' : 'Post' }}</button>
      </div>
    </form>

    <div v-if="posts.length === 0" class="px-4 pb-4 text-xs text-zinc-600">No progress posts yet.</div>
    <ul v-else class="divide-y divide-zinc-900">
      <li v-for="p in posts" :key="p.id" class="px-4 py-2.5">
        <div class="flex items-baseline gap-2 flex-wrap">
          <NuxtLink
            v-if="p.level_position"
            :to="`/levels/${p.level_position}`"
            class="text-sm text-zinc-100 hover:text-accent transition-colors"
          >{{ p.level_name }}</NuxtLink>
          <span v-else class="text-sm text-zinc-100">{{ p.level_name }}</span>
          <span class="text-xs text-zinc-500 tabular-nums">{{ p.start_percent }}% → {{ p.end_percent }}%</span>
          <a v-if="p.video_url" :href="p.video_url" target="_blank" rel="noopener" class="text-xs text-accent hover:underline">video</a>
          <span class="text-xs text-zinc-600 ml-auto">{{ relative(p.created_at) }}</span>
          <button
            v-if="canPost"
            type="button"
            class="text-xs text-zinc-600 hover:text-red-400 transition-colors"
            @click="remove(p.id)"
            aria-label="Delete progress post"
          >×</button>
        </div>
      </li>
    </ul>
  </section>
</template>
