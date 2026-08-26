<script setup lang="ts">
import { gdLevelUrl } from '~/utils/gd-links'
import { isEmbeddableVideo } from '~/utils/video-embed'
type OpenVerLevel = {
  id: number
  gd_id: number | null
  name: string
  fps: string | null
  game_version: string | null
  showcase_url: string | null
  verifier: string | null
  gddl_tier: string | null
  difficulty: string | null
  enjoyment: number | null
  main_skillset: string | null
  tags: string | null
  notes: string | null
  placement_source: string | null
  submitted_at: string
  submitter: string | null
}

const props = defineProps<{ level: OpenVerLevel }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

const { data: meRes } = useCurrentUser()
const role = computed(() => meRes.value?.account?.role ?? null)
const isAdmin = computed(() => role.value === 'admin' || role.value === 'owner' || role.value === 'developer')
const canEdit = computed(() => isAdmin.value || role.value === 'moderator')

const editing = ref(false)
const draft = reactive({
  name: '',
  gd_id: '' as number | string,
  fps: '',
  game_version: '',
  showcase_url: '',
  verifier: '',
  gddl_tier: '',
  difficulty: '',
  enjoyment: '' as number | string,
  main_skillset: '',
  tags: '',
  notes: '',
  placement_source: '',
})
const saving = ref(false)
const saveError = ref<string | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

function startEdit() {
  draft.name = props.level.name ?? ''
  draft.gd_id = props.level.gd_id ?? ''
  draft.fps = props.level.fps ?? ''
  draft.game_version = props.level.game_version ?? ''
  draft.showcase_url = props.level.showcase_url ?? ''
  draft.verifier = props.level.verifier ?? ''
  draft.gddl_tier = props.level.gddl_tier ?? ''
  draft.difficulty = props.level.difficulty ?? ''
  draft.enjoyment = props.level.enjoyment ?? ''
  draft.main_skillset = props.level.main_skillset ?? ''
  draft.tags = props.level.tags ?? ''
  draft.notes = props.level.notes ?? ''
  draft.placement_source = props.level.placement_source ?? ''
  saveError.value = null
  deleteError.value = null
  editing.value = true
}
function cancelEdit() {
  editing.value = false
  saveError.value = null
  deleteError.value = null
}

watch(() => props.level.id, (next, prev) => {
  if (prev != null && next !== prev) cancelEdit()
})

async function saveEdit() {
  if (saving.value) return
  saving.value = true
  saveError.value = null
  try {
    await $fetch(`/api/admin/open-verifications/${props.level.id}`, { method: 'PATCH', body: { ...draft } })
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
  if (!confirm(`Delete "${props.level.name}" from open verifications? This can't be undone.`)) return
  deleting.value = true
  deleteError.value = null
  try {
    await $fetch(`/api/admin/open-verifications/${props.level.id}`, { method: 'DELETE' })
    await navigateTo('/open-verifications')
  } catch (e: any) {
    deleteError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Delete failed.'
  } finally {
    deleting.value = false
  }
}

/**
 * Whether the showcase link is playable inline — YouTube, a Medal.tv clip or a
 * clip uploaded here. Anything else falls through to the link card below.
 */
const hasVideoEmbed = computed(() => isEmbeddableVideo(props.level.showcase_url))
const levelUrl = computed(() => gdLevelUrl(props.level.gd_id))

const tagList = computed(() => {
  if (!props.level.tags) return []
  return props.level.tags.split(',').map((t) => t.trim()).filter(Boolean)
})
</script>

<template>
  <div class="px-4 sm:px-8 py-6 max-w-3xl mx-auto w-full">
    <header class="mb-6 flex items-start justify-between gap-3 flex-wrap">
      <div>
        <div class="flex items-baseline gap-3 flex-wrap">
          <h1 class="text-3xl font-semibold tracking-tight">{{ level.name }}</h1>
          <span class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-violet-900/40 text-violet-300 border border-violet-800/60">
            Open verification
          </span>
        </div>
        <p class="text-xs text-zinc-500 mt-1.5">
          Submitted on {{ level.submitted_at }}<span v-if="level.submitter">
            · by
            <NuxtLink :to="`/users/${level.submitter}`" class="hover:text-accent">{{ level.submitter }}</NuxtLink>
          </span>
        </p>
      </div>
      <div class="shrink-0 flex flex-col items-end gap-1">
        <NuxtLink
          :to="`/open-verifications/${level.id}/submit-verification`"
          class="btn btn-md btn-primary"
        >
          Submit verification
        </NuxtLink>
        <button
          v-if="canEdit && !editing"
          type="button"
          class="rounded border border-accent/40 text-accent font-medium text-sm px-3 py-1.5 hover:bg-accent/10 transition-colors"
          @click="startEdit"
        >Edit</button>
      </div>
    </header>

    <!-- Edit form -->
    <section v-if="editing" class="rounded-md border border-accent/40 bg-zinc-950/80 p-5 mb-6 space-y-4">
      <div class="flex items-baseline justify-between">
        <h2 class="text-xs uppercase tracking-widest text-accent font-medium">Editing open verification</h2>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="block sm:col-span-2">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Name</span>
          <input v-model="draft.name" class="field field-md mt-1" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Level ID</span>
          <input v-model="draft.gd_id" inputmode="numeric" class="field field-md mt-1" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Verifier</span>
          <input v-model="draft.verifier" class="field field-md mt-1" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">FPS</span>
          <input v-model="draft.fps" class="field field-md mt-1" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Game version</span>
          <input v-model="draft.game_version" class="field field-md mt-1" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">GDDL Tier</span>
          <input v-model="draft.gddl_tier" class="field field-md mt-1" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Difficulty</span>
          <input v-model="draft.difficulty" class="field field-md mt-1" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Enjoyment <span class="text-zinc-600 normal-case">— 0–10</span></span>
          <input v-model="draft.enjoyment" inputmode="decimal" class="field field-md mt-1" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Main skillset</span>
          <input v-model="draft.main_skillset" class="field field-md mt-1" />
        </label>
        <label class="block">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Source</span>
          <input v-model="draft.placement_source" class="field field-md mt-1" />
        </label>
        <label class="block sm:col-span-2">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Showcase URL</span>
          <input v-model="draft.showcase_url" class="field field-md mt-1" />
        </label>
        <label class="block sm:col-span-2">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Tags <span class="text-zinc-600 normal-case">— comma-separated</span></span>
          <input v-model="draft.tags" class="field field-md mt-1" />
        </label>
        <label class="block sm:col-span-2">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Notes</span>
          <textarea v-model="draft.notes" rows="3" class="field field-md mt-1" />
        </label>
      </div>

      <div class="flex items-center gap-3 pt-2 flex-wrap">
        <button
          type="button"
          :disabled="saving"
          class="btn btn-md btn-primary"
          @click="saveEdit"
        >{{ saving ? 'Saving…' : 'Save' }}</button>
        <button
          type="button"
          class="btn btn-md btn-ghost"
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

    <!-- Showcase (replaces verification) -->
    <VideoEmbed
      v-if="hasVideoEmbed"
      :url="level.showcase_url"
      title="Showcase"
      frame-class="aspect-video rounded-xl border border-zinc-800 bg-black mb-6 overflow-hidden"
    />
    <a
      v-else-if="level.showcase_url"
      :href="level.showcase_url"
      target="_blank"
      rel="noopener"
      class="block aspect-video rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900 mb-6 relative group overflow-hidden hover:border-accent/40 transition-colors"
    >
      <div class="absolute inset-0 flex items-center justify-center">
        <div class="text-center px-6">
          <div class="w-14 h-14 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center mx-auto mb-3 group-hover:bg-accent/30 transition-colors">
            <svg viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6 text-accent translate-x-0.5">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <p class="text-sm font-medium text-zinc-300 max-w-md mx-auto line-clamp-2">Showcase</p>
          <p class="text-[11px] text-zinc-500 mt-2 uppercase tracking-wider">Open showcase ↗</p>
        </div>
      </div>
    </a>
    <div v-else class="card mb-6 px-6 py-12 text-center">
      <p class="text-sm text-zinc-400">No showcase video yet.</p>
    </div>

    <!-- Tags -->
    <div v-if="tagList.length" class="flex flex-wrap items-center gap-2 mb-6">
      <span
        v-for="t in tagList"
        :key="t"
        class="px-2.5 py-1 rounded-full text-[11px] font-medium bg-zinc-900 border border-zinc-800 text-zinc-300 capitalize"
      >
        {{ t === 'uldm' ? 'ULDM' : t }}
      </span>
    </div>

    <!-- Stats grid -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-zinc-800 rounded-md overflow-hidden mb-6">
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Level ID</div>
        <a
          v-if="levelUrl"
          :href="levelUrl"
          target="_blank"
          rel="noopener"
          class="tabular-nums text-base text-zinc-100 hover:text-accent transition-colors"
        >{{ level.gd_id }}</a>
        <div v-else class="tabular-nums text-base text-zinc-600">—</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">FPS</div>
        <div class="text-base text-zinc-100">{{ level.fps ?? 'any' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Version</div>
        <div class="text-base text-zinc-100">{{ level.game_version ?? 'any' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Verifier</div>
        <div class="text-base text-zinc-100 truncate">{{ level.verifier ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">GDDL Tier</div>
        <div class="text-base text-zinc-100">{{ level.gddl_tier ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Difficulty</div>
        <div class="text-base text-zinc-100">{{ level.difficulty ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Skillset</div>
        <div class="text-base text-zinc-100">{{ level.main_skillset ?? '—' }}</div>
      </div>
      <div class="bg-zinc-950 p-4">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Enjoyment</div>
        <div class="tabular-nums text-base text-zinc-100">{{ level.enjoyment != null ? Number(level.enjoyment).toFixed(1) : '—' }}</div>
      </div>
    </div>

    <section v-if="level.notes" class="card px-4 py-3 mb-6">
      <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1.5">Notes from submitter</h3>
      <p class="text-sm text-zinc-200 whitespace-pre-wrap">{{ level.notes }}</p>
    </section>

    <section class="card px-4 py-3">
      <CommentSection kind="open_verification" :target-id="level.id" />
    </section>
  </div>
</template>
