<script setup lang="ts">
definePageMeta({ layout: 'level' })

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const { list, canEdit, refresh } = useCustomList(publicId)
const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

type Pending = {
  id: number
  name: string
  gd_id: number | null
  creator: string | null
  verifier: string | null
  verification_url: string | null
  suggested_rank: number | null
  note: string | null
  status: string
  reject_reason: string | null
  submitted_at: string
  submitted_by_username: string | null
  all_position: number | null
  sheet_placement: number | null
}
const pending = ref<Pending[]>([])
const canModerate = ref(false)
const busy = ref<number | null>(null)
const notice = ref<string | null>(null)

async function load() {
  try {
    const res = await $fetch<{ pending: Pending[]; can_moderate: boolean }>(
      `/api/custom-lists/${publicId.value}/pending`,
    )
    pending.value = res.pending
    canModerate.value = res.can_moderate
  } catch { pending.value = [] }
}
await load()

async function decide(p: Pending, action: 'approve' | 'reject') {
  if (busy.value != null) return
  const reason = action === 'reject' ? (prompt('Reason for declining (optional):') ?? '') : ''
  busy.value = p.id
  try {
    await $fetch(`/api/custom-lists/${publicId.value}/pending/${p.id}`, {
      method: 'POST', body: { action, reason },
    })
    notice.value = action === 'approve' ? `${p.name} added to the list.` : `${p.name} declined.`
    await Promise.all([load(), refresh()])
  } catch (e: any) {
    notice.value = e?.data?.statusMessage ?? 'Failed.'
  } finally { busy.value = null }
}

// --- Suggestion form ---
const name = ref('')
const gdId = ref('')
const creator = ref('')
const verifier = ref('')
const videoUrl = ref('')
const rank = ref('')
const note = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)

async function submit() {
  error.value = null
  if (!name.value.trim()) { error.value = 'A level name is required.'; return }
  submitting.value = true
  try {
    const res = await $fetch<{ status: string }>(`/api/custom-lists/${publicId.value}/pending`, {
      method: 'POST',
      body: {
        name: name.value.trim(),
        gd_id: gdId.value ? Number(gdId.value) : undefined,
        creator: creator.value.trim() || undefined,
        verifier: verifier.value.trim() || undefined,
        verification_url: videoUrl.value.trim() || undefined,
        suggested_rank: rank.value ? Number(rank.value) : undefined,
        note: note.value.trim() || undefined,
      },
    })
    notice.value = res.status === 'approved'
      ? `${name.value.trim()} added to the list.`
      : 'Suggestion sent — an editor will review it.'
    name.value = ''; gdId.value = ''; creator.value = ''
    verifier.value = ''; videoUrl.value = ''; rank.value = ''; note.value = ''
    await Promise.all([load(), refresh()])
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not send that suggestion.'
  } finally { submitting.value = false }
}

const field = 'mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'
const label = 'text-[10px] uppercase tracking-widest text-zinc-500 font-medium'

useHead(() => ({ title: list.value ? `Suggest a level — ${list.value.title}` : 'Suggest' }))
</script>

<template>
  <CustomListShell :public-id="publicId">
    <template #default="{ list: l }">
      <div class="flex items-baseline justify-between gap-3 mb-3">
        <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">
          {{ canModerate ? 'Suggested levels' : 'Suggest a level' }}
        </h2>
        <span v-if="notice" class="text-[11px] text-emerald-400">{{ notice }}</span>
      </div>

      <!-- Queue (editors) / your own suggestions -->
      <ul v-if="pending.length" class="card divide-y divide-zinc-900/60 overflow-hidden mb-5">
        <li
          v-for="p in pending"
          :key="p.id"
          class="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm transition-opacity"
          :class="busy === p.id ? 'opacity-50' : ''"
        >
          <div class="min-w-0 flex-1">
            <p class="text-zinc-100 truncate">
              <span class="font-semibold">{{ p.name }}</span>
              <span v-if="p.creator" class="text-zinc-500"> by {{ p.creator }}</span>
              <span v-if="p.suggested_rank" class="text-accent tabular-nums ml-1">→ #{{ p.suggested_rank }}</span>
            </p>
            <p class="text-[11px] text-zinc-600 truncate mt-0.5">
              <span v-if="p.submitted_by_username">by {{ p.submitted_by_username }}</span>
              <span v-if="p.gd_id"> · ID {{ p.gd_id }}</span>
              <span v-if="p.verifier"> · verified by {{ p.verifier }}</span>
              <span v-if="p.note"> · “{{ p.note }}”</span>
            </p>
          </div>
          <NuxtLink
            v-if="p.all_position"
            :to="`/levels/${p.all_position}`"
            class="shrink-0 text-[11px] text-zinc-500 hover:text-accent tabular-nums"
          >ALL #{{ p.sheet_placement ?? p.all_position }}</NuxtLink>
          <a
            v-if="p.verification_url"
            :href="p.verification_url" target="_blank" rel="noopener"
            class="shrink-0 rounded-lg border border-zinc-800 text-zinc-400 text-[11px] px-2.5 py-1 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
          >Video ↗</a>
          <div v-if="canModerate" class="flex items-center gap-1.5 shrink-0">
            <button
              type="button" :disabled="busy != null"
              class="rounded-lg bg-emerald-600/90 text-white text-xs font-medium px-3 py-1.5 hover:bg-emerald-600 disabled:opacity-50 transition-colors"
              @click="decide(p, 'approve')"
            >Add</button>
            <button
              type="button" :disabled="busy != null"
              class="rounded-lg border border-red-900/60 text-red-400 text-xs px-3 py-1.5 hover:bg-red-950/40 disabled:opacity-50 transition-colors"
              @click="decide(p, 'reject')"
            >Decline</button>
          </div>
          <span v-else class="shrink-0 text-[10px] uppercase tracking-wider text-zinc-600">{{ p.status }}</span>
        </li>
      </ul>
      <p v-else-if="canModerate" class="card px-6 py-10 text-center text-sm text-zinc-400 mb-5">
        No suggestions waiting.
      </p>

      <!-- Form -->
      <div v-if="!l.accepts_submissions && !canEdit" class="card px-6 py-10 text-center">
        <p class="text-sm text-zinc-400">This list isn't taking level suggestions.</p>
      </div>
      <div v-else-if="!me" class="card px-6 py-10 text-center">
        <p class="text-sm text-zinc-400">
          <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink> to suggest a level.
        </p>
      </div>
      <form v-else class="card p-4 sm:p-5 grid gap-3 sm:grid-cols-2" @submit.prevent="submit">
        <p class="sm:col-span-2 text-xs text-zinc-500">
          {{ canEdit ? 'As an editor, what you add here goes straight onto the list.' : 'An editor will review your suggestion.' }}
        </p>
        <label class="block sm:col-span-2">
          <span :class="label">Level name *</span>
          <input v-model="name" type="text" :class="field" />
        </label>
        <label class="block">
          <span :class="label">Level ID</span>
          <input v-model="gdId" inputmode="numeric" :class="field" />
        </label>
        <label class="block">
          <span :class="label">Creator</span>
          <input v-model="creator" type="text" :class="field" />
        </label>
        <label class="block">
          <span :class="label">Verifier</span>
          <input v-model="verifier" type="text" :class="field" />
        </label>
        <label class="block">
          <span :class="label">Suggested placement</span>
          <input v-model="rank" inputmode="numeric" placeholder="bottom of the list" :class="field" />
        </label>
        <label class="block sm:col-span-2">
          <span :class="label">Verification video</span>
          <input v-model="videoUrl" type="url" :class="field" />
        </label>
        <label class="block sm:col-span-2">
          <span :class="label">Note</span>
          <input v-model="note" type="text" maxlength="500" :class="field" />
        </label>
        <div class="sm:col-span-2 flex items-center gap-3 pt-1">
          <button
            type="submit" :disabled="submitting || !name.trim()"
            class="rounded-lg bg-accent text-zinc-950 font-semibold text-sm px-4 py-2 hover:bg-accent/90 disabled:opacity-40 transition-colors"
          >{{ submitting ? 'Sending…' : canEdit ? 'Add to list' : 'Suggest level' }}</button>
          <span v-if="error" class="text-xs text-red-400">{{ error }}</span>
        </div>
      </form>
    </template>
  </CustomListShell>
</template>
