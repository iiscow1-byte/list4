<script setup lang="ts">
/**
 * Staff tools on a level page: move it, edit it, and the rarer actions.
 *
 * Moderators and admins change the list directly; list helpers file a request
 * for an admin instead. A move or edit made here sticks through sheet
 * refreshes until the sheet itself changes that level (see server/db/import.ts).
 */
type StaffLevel = {
  id?: number
  position: number
  name: string
  gd_id: number | null
  gddl_tier: string | null
  difficulty: string | null
  rated: string | null
  placement_source: string | null
  main_skillset: string | null
  verify_date: string | null
  verification: string | null
  verification_url: string | null
  year_verified: number | null
  creator?: string | null
  verifier?: string | null
  publisher?: string | null
  enjoyment?: number | null
  description_override?: string | null
  same_as_above?: number | null
  duplicate_of_id?: number | null
  duplicate_of?: { position: number; name: string } | null
  is_alternate?: number | null
  alternate_of_id?: number | null
  alternate_of?: { position: number; name: string } | null
  tentative_placement?: number | null
  pinned?: number | null
  pinned_at?: string | null
  site_fields?: string[]
  site_only?: number | null
  permanent?: number | null
  challenge_rank?: number | null
  not_challenge?: number | boolean | null
  force_challenge?: number | boolean | null
}
type PickRow = { id?: number; position: number; name: string; gddl_tier: string | null }

const props = defineProps<{
  level: StaffLevel
  /** A level picked in the list while "place under…" is on. */
  pickedLevel?: PickRow | null
  groupPicks?: PickRow[]
  groupTarget?: PickRow | null
  groupPhase?: 'select' | 'target'
}>()
const emit = defineEmits<{
  (e: 'refresh'): void
  (e: 'start-pick'): void
  (e: 'end-pick'): void
  (e: 'start-group'): void
  (e: 'continue-group'): void
  (e: 'back-group'): void
  (e: 'end-group'): void
}>()

const { data: meRes } = useCurrentUser()
const role = computed(() => meRes.value?.account?.role ?? 'user')
const isAdmin = computed(() => ['admin', 'owner', 'developer'].includes(role.value))
const isMod = computed(() => isAdmin.value || role.value === 'moderator')
const isHelper = computed(() => role.value === 'list_helper')
const route = useRoute()

type Panel = null | 'move' | 'edit' | 'request' | 'group'
const panel = ref<Panel>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

function open(p: Panel) {
  error.value = null
  notice.value = null
  if (panel.value === 'move' && p !== 'move') emit('end-pick')
  if (panel.value === 'group' && p !== 'group') emit('end-group')
  panel.value = panel.value === p ? null : p
  if (panel.value === 'move') resetMove()
  if (panel.value === 'edit') startEdit()
  if (panel.value === 'group') emit('start-group')
}

function fail(e: any, fallback: string) {
  error.value = e?.data?.statusMessage ?? e?.statusMessage ?? fallback
}

// ---------------------------------------------------------------- move

const target = ref<number | null>(null)
const belowPick = ref<PickRow | null>(null)
const keepTier = ref(false)
const picking = ref(false)

function resetMove() {
  target.value = props.level.position
  belowPick.value = null
  keepTier.value = false
  picking.value = false
}

function nudge(by: number) {
  belowPick.value = null
  target.value = Math.max(1, (target.value ?? props.level.position) + by)
}

function togglePick() {
  picking.value = !picking.value
  if (picking.value) emit('start-pick')
  else emit('end-pick')
}

watch(() => props.pickedLevel, (p) => {
  if (!p || panel.value !== 'move') return
  if (p.position === props.level.position) return
  belowPick.value = p
  target.value = p.position < props.level.position ? p.position + 1 : p.position
  picking.value = false
  emit('end-pick')
})

const moveChanged = computed(() => {
  const t = Number(target.value)
  return Number.isInteger(t) && t > 0 && t !== props.level.position
})

// The neighbours it would land between, read from the list as it stands.
type Neighbour = { position: number; name: string; gddl_tier: string | null }
const preview = ref<{ above: Neighbour[]; below: Neighbour[] } | null>(null)
let previewTimer: ReturnType<typeof setTimeout> | null = null
watch(target, (t) => {
  if (previewTimer) clearTimeout(previewTimer)
  preview.value = null
  if (!moveChanged.value) return
  previewTimer = setTimeout(async () => {
    const n = Number(t)
    const slot = n > props.level.position ? n + 1 : n
    try {
      const res = await $fetch<{ above: Neighbour[]; below: Neighbour[] }>('/api/admin/levels/placement-preview', { query: { position: slot } })
      if (Number(target.value) !== n) return
      const notSelf = (r: Neighbour) => r.position !== props.level.position
      preview.value = { above: res.above.filter(notSelf).slice(-1), below: res.below.filter(notSelf).slice(0, 1) }
    } catch { /* the preview is a nicety */ }
  }, 250)
})

async function applyMove() {
  if (!moveChanged.value || busy.value) return
  busy.value = true
  error.value = null
  try {
    const body = belowPick.value?.id != null
      ? { below_id: belowPick.value.id, keep_tier: keepTier.value }
      : { to: Number(target.value), keep_tier: keepTier.value }
    const res = await $fetch<{ to: number; tier_from: string | null; tier_to: string | null }>(
      `/api/admin/levels/${props.level.position}/move`,
      { method: 'POST', body },
    )
    panel.value = null
    await navigateTo({ path: `/levels/${res.to}`, query: route.query })
  } catch (e: any) {
    fail(e, 'Move failed.')
  } finally {
    busy.value = false
  }
}

async function followSheet(body: { placement?: boolean; fields?: string[] | 'all' }) {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    const res = await $fetch<{ position: number }>(`/api/admin/levels/${props.level.position}/follow-sheet`, { method: 'POST', body })
    if (res.position !== props.level.position) await navigateTo({ path: `/levels/${res.position}`, query: route.query })
    else emit('refresh')
    notice.value = body.placement ? 'Back in the sheet\'s order.' : 'The sheet\'s values return on the next refresh.'
  } catch (e: any) {
    fail(e, 'Failed.')
  } finally {
    busy.value = false
  }
}

const placementEditorOpen = ref(false)

// ---------------------------------------------------------------- group move

const groupBelowLabel = computed(() => props.groupTarget ? `#${props.groupTarget.position} ${props.groupTarget.name}` : null)
async function applyGroupMove() {
  if (!props.groupPicks?.length || !props.groupTarget || busy.value) return
  busy.value = true
  error.value = null
  try {
    const res = await $fetch<{ moved: number }>('/api/admin/levels/group-move', {
      method: 'POST',
      body: { positions: props.groupPicks.map((p) => p.position), below_position: props.groupTarget.position },
    })
    notice.value = `Moved ${res.moved} level${res.moved === 1 ? '' : 's'}.`
    panel.value = null
    emit('end-group')
    emit('refresh')
  } catch (e: any) {
    fail(e, 'Group move failed.')
  } finally {
    busy.value = false
  }
}

// ---------------------------------------------------------------- edit

const FIELDS = [
  'name', 'gd_id', 'gddl_tier', 'difficulty', 'main_skillset', 'enjoyment', 'rated',
  'creator', 'verifier', 'publisher', 'verification_url', 'verification', 'verify_date', 'year_verified',
  'placement_source', 'description_override', 'same_as_above', 'duplicate_of_id', 'is_alternate',
  'alternate_of_id', 'tentative_placement',
] as const
type Field = (typeof FIELDS)[number]
const draft = reactive<Record<Field, any>>({} as any)
const dupOf = ref<{ position: number; name: string } | null>(null)
const altOf = ref<{ position: number; name: string } | null>(null)
const dupPickerOpen = ref(false)
const altPickerOpen = ref(false)

function startEdit() {
  for (const f of FIELDS) {
    const v = (props.level as any)[f]
    draft[f] = ['same_as_above', 'is_alternate', 'tentative_placement'].includes(f) ? !!v : (v ?? '')
  }
  dupOf.value = props.level.duplicate_of ?? null
  altOf.value = props.level.alternate_of ?? null
}

const changedFields = computed(() => FIELDS.filter((f) => {
  const before = (props.level as any)[f]
  const now = draft[f]
  if (typeof now === 'boolean') return now !== !!before
  return String(now ?? '').trim() !== String(before ?? '').trim()
}))

async function saveEdit() {
  if (busy.value || !changedFields.value.length) return
  busy.value = true
  error.value = null
  try {
    const body: Record<string, unknown> = {}
    for (const f of changedFields.value) body[f] = draft[f]
    if ('same_as_above' in body && !draft.same_as_above) body.duplicate_of_id = null
    if ('is_alternate' in body && !draft.is_alternate) body.alternate_of_id = null
    await $fetch(`/api/admin/levels/${props.level.position}`, { method: 'PATCH', body })
    panel.value = null
    notice.value = 'Saved.'
    emit('refresh')
  } catch (e: any) {
    fail(e, 'Save failed.')
  } finally {
    busy.value = false
  }
}

const siteFields = computed(() => new Set(props.level.site_fields ?? []))
const FIELD_LABELS: Record<string, string> = {
  name: 'Name', gd_id: 'Level ID', gddl_tier: 'Tier', difficulty: 'Difficulty', main_skillset: 'Skillset',
  placement_source: 'Source', verify_date: 'Verify date', verification: 'Video title',
  verification_url: 'Video link', year_verified: 'Year verified',
}
const siteFieldList = computed(() => [...siteFields.value].map((f) => FIELD_LABELS[f] ?? f).join(', '))

// ---------------------------------------------------------------- other actions

const moreOpen = ref(false)
const moreRoot = ref<HTMLElement | null>(null)
function onDocClick(e: MouseEvent) {
  if (moreOpen.value && moreRoot.value && !moreRoot.value.contains(e.target as Node)) moreOpen.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  if (previewTimer) clearTimeout(previewTimer)
})

async function act(fn: () => Promise<unknown>, fallback: string) {
  moreOpen.value = false
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    await fn()
  } catch (e: any) {
    fail(e, fallback)
  } finally {
    busy.value = false
  }
}

const isChallenge = computed(() => props.level.challenge_rank != null)
function setChallenge(on: boolean) {
  return act(async () => {
    await $fetch(`/api/admin/levels/${props.level.position}/challenge`, { method: 'POST', body: { challenge: on } })
    emit('refresh')
  }, 'Failed.')
}
function sendToAwaiting() {
  if (!confirm(`Send "${props.level.name}" back to Awaiting placement? It leaves the list and everything below moves up one.`)) return
  return act(async () => {
    await $fetch(`/api/admin/levels/${props.level.position}/to-awaiting`, { method: 'POST' })
    await navigateTo('/awaiting')
  }, 'Failed.')
}
function removeLevel() {
  const reason = prompt(`Remove "${props.level.name}" (#${props.level.position}) from the list?\n\nReason (optional, shown in the changelog):`)
  if (reason === null) return
  return act(async () => {
    await $fetch(`/api/admin/levels/${props.level.position}`, { method: 'DELETE', body: { reason } })
    await navigateTo(`/levels/${Math.max(1, props.level.position - 1)}`)
  }, 'Remove failed.')
}

// ---------------------------------------------------------------- helper requests

const request = reactive({ kind: 'move' as 'move' | 'challenge' | 'unchallenge' | 'remove', to: '' as string | number, reason: '' })
async function sendRequest() {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    await $fetch('/api/admin/helper-requests', {
      method: 'POST',
      body: { kind: request.kind, position: props.level.position, to_position: Number(request.to) || null, reason: request.reason || null },
    })
    panel.value = null
    notice.value = 'Request sent to the admins.'
  } catch (e: any) {
    fail(e, 'Couldn\'t send that.')
  } finally {
    busy.value = false
  }
}

function pinnedDate(at: string | null | undefined) {
  if (!at) return ''
  return new Date(`${at.replace(' ', 'T')}Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
</script>

<template>
  <section class="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/60">
    <div class="flex flex-wrap items-center gap-2 px-3 py-2">
      <span class="text-xs font-medium text-zinc-500 mr-1">Staff</span>
      <template v-if="isMod">
        <button type="button" class="btn btn-sm" :class="panel === 'move' ? 'btn-primary' : 'btn-ghost'" @click="open('move')">Move</button>
        <button type="button" class="btn btn-sm" :class="panel === 'edit' ? 'btn-primary' : 'btn-ghost'" @click="open('edit')">Edit</button>
        <div ref="moreRoot" class="relative">
          <button type="button" class="btn btn-sm btn-ghost" :aria-expanded="moreOpen" @click="moreOpen = !moreOpen">
            More
            <svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z" clip-rule="evenodd" /></svg>
          </button>
          <div v-if="moreOpen" class="absolute left-0 top-full mt-1 min-w-[16rem] popover p-1 z-30" role="menu">
            <button type="button" role="menuitem" class="menu-row" @click="moreOpen = false; open('group')">Move several levels…</button>
            <button v-if="isAdmin" type="button" role="menuitem" class="menu-row" @click="moreOpen = false; placementEditorOpen = true">Drag into place…</button>
            <button v-if="isAdmin && isChallenge" type="button" role="menuitem" class="menu-row" @click="setChallenge(false)">Take off the challenge list</button>
            <button v-else-if="isAdmin" type="button" role="menuitem" class="menu-row" @click="setChallenge(true)">Mark as a challenge</button>
            <template v-if="isAdmin">
              <div class="my-1 border-t border-zinc-800" />
              <button type="button" role="menuitem" class="menu-row" @click="sendToAwaiting">Send to awaiting placement</button>
              <button type="button" role="menuitem" class="menu-row menu-row-danger" @click="removeLevel">Remove from the list…</button>
            </template>
          </div>
        </div>
      </template>
      <button v-else-if="isHelper" type="button" class="btn btn-sm" :class="panel === 'request' ? 'btn-primary' : 'btn-ghost'" @click="open('request')">Request a change</button>

      <span v-if="level.pinned" class="ml-auto text-xs text-zinc-400 flex items-center gap-2">
        <span>Placed by staff {{ pinnedDate(level.pinned_at) }}, kept through sheet updates</span>
        <button v-if="isMod" type="button" class="link" :disabled="busy" @click="followSheet({ placement: true })">Use the sheet's spot</button>
      </span>
    </div>

    <p v-if="error" class="px-3 pb-2 text-sm text-red-300">{{ error }}</p>
    <p v-else-if="notice" class="px-3 pb-2 text-sm text-emerald-300">{{ notice }}</p>

    <!-- Move -->
    <div v-if="panel === 'move'" class="border-t border-zinc-800 p-3 space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <label class="text-sm text-zinc-400" for="move-target">Move to #</label>
        <input
          id="move-target"
          v-model.number="target"
          type="number"
          min="1"
          inputmode="numeric"
          class="field field-sm w-28 tabular-nums"
          @input="belowPick = null"
          @keydown.enter="applyMove"
        />
        <div class="segmented">
          <button
            v-for="n in [-10, -5, -1, 1, 5, 10]"
            :key="n"
            type="button"
            class="px-2 py-1.5 text-xs tabular-nums text-zinc-300 hover:bg-zinc-800 border-l border-zinc-800 first:border-l-0"
            :title="n < 0 ? `${-n} harder` : `${n} easier`"
            @click="nudge(n)"
          >{{ n > 0 ? `+${n}` : n }}</button>
        </div>
        <button type="button" class="btn btn-sm" :class="picking ? 'btn-primary' : 'btn-ghost'" @click="togglePick">
          {{ picking ? 'Click a level in the list…' : 'Place under a level…' }}
        </button>
      </div>

      <div v-if="moveChanged" class="text-sm text-zinc-300 space-y-1">
        <p>
          <span class="tabular-nums">#{{ level.position }} → <strong class="text-accent">#{{ target }}</strong></span>
          <span v-if="belowPick" class="text-zinc-400">, under {{ belowPick.name }}</span>
        </p>
        <p v-if="preview" class="text-xs text-zinc-500">
          Between
          <template v-if="preview.above[0]">#{{ preview.above[0].position }} {{ preview.above[0].name }} ({{ preview.above[0].gddl_tier ?? 'no tier' }})</template>
          <template v-else>the top</template>
          and
          <template v-if="preview.below[0]">#{{ preview.below[0].position }} {{ preview.below[0].name }} ({{ preview.below[0].gddl_tier ?? 'no tier' }})</template>
          <template v-else>the bottom</template>.
        </p>
        <label class="flex items-center gap-2 text-xs text-zinc-400 select-none">
          <input v-model="keepTier" type="checkbox" class="accent-accent" />
          Keep {{ level.gddl_tier ?? 'its tier' }} (otherwise it takes its new neighbours' tier)
        </label>
      </div>

      <div class="flex items-center gap-2">
        <button type="button" class="btn btn-md btn-primary" :disabled="!moveChanged || busy" @click="applyMove">{{ busy ? 'Moving…' : moveChanged ? `Move to #${target}` : 'Move' }}</button>
        <button type="button" class="btn btn-md btn-ghost" @click="open(null)">Cancel</button>
      </div>
    </div>

    <!-- Several levels at once -->
    <div v-if="panel === 'group'" class="border-t border-zinc-800 p-3 space-y-3">
      <p class="text-sm text-zinc-300">
        <template v-if="groupPhase !== 'target'">Click levels in the list to select them ({{ groupPicks?.length ?? 0 }} selected).</template>
        <template v-else-if="!groupTarget">Now click the level they should go under.</template>
        <template v-else>Move {{ groupPicks?.length }} level{{ groupPicks?.length === 1 ? '' : 's' }} under {{ groupBelowLabel }}, keeping their order.</template>
      </p>
      <ul v-if="groupPicks?.length" class="text-sm text-zinc-400 max-h-40 overflow-y-auto">
        <li v-for="p in groupPicks" :key="p.position" class="tabular-nums">#{{ p.position }} {{ p.name }}</li>
      </ul>
      <div class="flex items-center gap-2">
        <button v-if="groupPhase !== 'target'" type="button" class="btn btn-md btn-primary" :disabled="!groupPicks?.length" @click="emit('continue-group')">Next</button>
        <template v-else>
          <button type="button" class="btn btn-md btn-primary" :disabled="!groupTarget || busy" @click="applyGroupMove">{{ busy ? 'Moving…' : 'Move' }}</button>
          <button type="button" class="btn btn-md btn-ghost" @click="emit('back-group')">Back</button>
        </template>
        <button type="button" class="btn btn-md btn-ghost" @click="open(null)">Cancel</button>
      </div>
    </div>

    <!-- Edit -->
    <form v-if="panel === 'edit'" class="border-t border-zinc-800 p-3 space-y-5" @submit.prevent="saveEdit">
      <p v-if="siteFields.size" class="text-xs text-zinc-400">
        Edited here, so the sheet won't overwrite: {{ siteFieldList }}.
        <button type="button" class="link" @click="followSheet({ fields: 'all' })">Use the sheet's values</button>
      </p>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="sm:col-span-2"><span class="label">Name</span><input v-model="draft.name" class="field field-md mt-1" /></label>
        <label><span class="label">Level ID</span><input v-model="draft.gd_id" inputmode="numeric" class="field field-md mt-1" /></label>
        <label><span class="label">Tier</span><input v-model="draft.gddl_tier" placeholder="Tier 25" class="field field-md mt-1" /></label>
        <label><span class="label">Difficulty</span><input v-model="draft.difficulty" placeholder="Extreme Demon" class="field field-md mt-1" /></label>
        <label><span class="label">Skillset</span><input v-model="draft.main_skillset" class="field field-md mt-1" /></label>
        <label><span class="label">Enjoyment (0–10)</span><input v-model="draft.enjoyment" inputmode="decimal" class="field field-md mt-1" /></label>
        <label><span class="label">Rating override</span><input v-model="draft.rated" placeholder="From Geometry Dash" class="field field-md mt-1" /></label>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <label><span class="label">Creators</span><input v-model="draft.creator" class="field field-md mt-1" /></label>
        <label><span class="label">Verifier</span><input v-model="draft.verifier" class="field field-md mt-1" /></label>
        <label><span class="label">Publisher</span><input v-model="draft.publisher" class="field field-md mt-1" /></label>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="sm:col-span-2"><span class="label">Verification video</span><input v-model="draft.verification_url" placeholder="https://youtu.be/…" class="field field-md mt-1" /></label>
        <label><span class="label">Video title</span><input v-model="draft.verification" class="field field-md mt-1" /></label>
        <label><span class="label">Verify date</span><input v-model="draft.verify_date" placeholder="YYYY-MM-DD" class="field field-md mt-1" /></label>
        <label class="sm:col-span-2"><span class="label">Sources (separate with |)</span><input v-model="draft.placement_source" class="field field-md mt-1" /></label>
        <label v-if="isAdmin" class="sm:col-span-2"><span class="label">Description (replaces the one from Geometry Dash)</span><textarea v-model="draft.description_override" rows="2" class="field field-md mt-1" /></label>
      </div>

      <div class="space-y-2 text-sm">
        <label class="flex items-center gap-2"><input v-model="draft.tentative_placement" type="checkbox" class="accent-accent" /> Tentative placement</label>
        <div class="flex flex-wrap items-center gap-2">
          <label class="flex items-center gap-2"><input v-model="draft.same_as_above" type="checkbox" class="accent-accent" /> Duplicate (same points as the level above)</label>
          <template v-if="draft.same_as_above">
            <button type="button" class="link text-xs" @click="dupPickerOpen = true">{{ dupOf ? `of #${dupOf.position} ${dupOf.name}` : 'link the original…' }}</button>
          </template>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <label class="flex items-center gap-2"><input v-model="draft.is_alternate" type="checkbox" class="accent-accent" /> Alternate version</label>
          <template v-if="draft.is_alternate">
            <button type="button" class="link text-xs" @click="altPickerOpen = true">{{ altOf ? `of #${altOf.position} ${altOf.name}` : 'link the original…' }}</button>
          </template>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button type="submit" class="btn btn-md btn-primary" :disabled="busy || !changedFields.length">{{ busy ? 'Saving…' : 'Save' }}</button>
        <button type="button" class="btn btn-md btn-ghost" @click="open(null)">Cancel</button>
        <span v-if="changedFields.length" class="text-xs text-zinc-500">{{ changedFields.length }} change{{ changedFields.length === 1 ? '' : 's' }}</span>
      </div>
    </form>

    <!-- Helper request -->
    <form v-if="panel === 'request'" class="border-t border-zinc-800 p-3 space-y-3" @submit.prevent="sendRequest">
      <div class="flex flex-wrap items-center gap-2">
        <select v-model="request.kind" class="field field-sm w-auto">
          <option value="move">Move it</option>
          <option value="challenge">Mark as a challenge</option>
          <option value="unchallenge">Take off the challenge list</option>
          <option value="remove">Remove it</option>
        </select>
        <template v-if="request.kind === 'move'">
          <span class="text-sm text-zinc-400">to #</span>
          <input v-model="request.to" type="number" min="1" class="field field-sm w-28" />
        </template>
      </div>
      <textarea v-model="request.reason" rows="2" maxlength="1000" placeholder="Why? (optional)" class="field field-md" />
      <div class="flex items-center gap-2">
        <button type="submit" class="btn btn-md btn-primary" :disabled="busy">Send request</button>
        <button type="button" class="btn btn-md btn-ghost" @click="open(null)">Cancel</button>
      </div>
    </form>

    <PlacementEditor v-model:open="placementEditorOpen" :position="level.position" :name="level.name" @moved="emit('refresh')" />
    <LevelComparisonDrawer
      v-model:open="dupPickerOpen"
      :confirm-on-pick="true"
      title="Pick the original level"
      hint="The level this one duplicates."
      @confirm="(lvl) => { draft.duplicate_of_id = lvl.id ?? null; dupOf = { position: lvl.position, name: lvl.name } }"
    />
    <LevelComparisonDrawer
      v-model:open="altPickerOpen"
      :confirm-on-pick="true"
      title="Pick the original level"
      hint="The level this one is a version of."
      @confirm="(lvl) => { draft.alternate_of_id = lvl.id ?? null; altOf = { position: lvl.position, name: lvl.name } }"
    />
  </section>
</template>

<style scoped>
.menu-row {
  @apply w-full text-left px-2.5 py-2 rounded-md text-sm text-zinc-300 whitespace-nowrap hover:bg-zinc-800 hover:text-zinc-50 transition-colors;
}
.menu-row-danger {
  @apply text-red-300 hover:bg-red-950/40 hover:text-red-200;
}
</style>
