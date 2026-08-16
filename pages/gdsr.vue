<script setup lang="ts">
import { GDSR_TIER_PRESETS, gdsrRequirementLabel } from '~/utils/gdsr-tiers'

/**
 * GDSR creator — build a list whose levels are sorted into difficulty tiers
 * rather than ranked 1..N.
 *
 * It writes ordinary custom lists (`kind = 'gdsr'`) whose tiers are packs, so
 * everything a list already has — sharing, ownership, records, the public
 * gallery — comes along without a second implementation of any of it.
 *
 * Saving is two requests on purpose. Packs reference item ids, and a brand new
 * list has none until its items exist; `replaceItems` reuses ids for levels
 * that stay, so the second request can always name what the first created.
 */
definePageMeta({ middleware: 'auth' })
useHead({ title: 'GDSR creator — All Levels List' })

type Level = { position: number; name: string; gddl_tier: string | null; difficulty: string | null }
type TierLevel = { level_id: number | null; position: number | null; name: string; gd_id: number | null }
type Tier = { name: string; color: string; requireCount: number | null; levels: TierLevel[] }
type ListRow = { public_id: string; title: string; kind?: string; item_count: number; updated_at: string; is_public: number }

const lists = ref<ListRow[]>([])
const loading = ref(true)
const listsError = ref<string | null>(null)

const editing = ref<string | null>(null)   // public_id being edited
const title = ref('')
const isPublic = ref(false)
const tiers = ref<Tier[]>([])
const saving = ref(false)
const saveError = ref<string | null>(null)
const savedAt = ref<number | null>(null)

/** Which tier the level picker is filling. */
const pickFor = ref<number | null>(null)
const pickerOpen = ref(false)

async function loadLists() {
  loading.value = true
  listsError.value = null
  try {
    const res = await $fetch<{ lists: ListRow[] }>('/api/custom-lists')
    lists.value = (res.lists ?? []).filter((l) => l.kind === 'gdsr')
  } catch (e: any) {
    listsError.value = e?.data?.statusMessage ?? 'Could not load your lists.'
  } finally {
    loading.value = false
  }
}
loadLists()

function blankTiers(): Tier[] {
  return GDSR_TIER_PRESETS.map((p) => ({
    name: p.name, color: p.color, requireCount: p.requireCount, levels: [],
  }))
}

async function createList() {
  const name = (prompt('Name this GDSR list', 'My GDSR') ?? '').trim()
  if (!name) return
  saveError.value = null
  try {
    const res = await $fetch<{ list: { public_id: string } }>('/api/custom-lists', {
      method: 'POST',
      body: { title: name, kind: 'gdsr' },
    })
    await loadLists()
    // A new list opens on the full ladder rather than an empty page.
    editing.value = res.list.public_id
    title.value = name
    isPublic.value = false
    tiers.value = blankTiers()
  } catch (e: any) {
    saveError.value = e?.data?.statusMessage ?? 'Could not create the list.'
  }
}

async function openList(publicId: string) {
  saveError.value = null
  try {
    const res = await $fetch<any>(`/api/custom-lists/${publicId}`)
    const list = res.list ?? res
    editing.value = publicId
    title.value = list.title
    isPublic.value = !!list.is_public

    const itemById = new Map<number, any>((list.items ?? []).map((i: any) => [i.id, i]))
    const packs: Tier[] = (list.packs ?? []).map((p: any) => ({
      name: p.name,
      color: p.color || '#71717a',
      requireCount: p.require_count ?? null,
      levels: (p.item_ids ?? [])
        .map((id: number) => itemById.get(id))
        .filter(Boolean)
        .map((i: any) => ({ level_id: i.level_id, position: i.position ?? null, name: i.name, gd_id: i.gd_id })),
    }))
    tiers.value = packs.length ? packs : blankTiers()
  } catch (e: any) {
    saveError.value = e?.data?.statusMessage ?? 'Could not open that list.'
  }
}

function closeList() {
  editing.value = null
  tiers.value = []
  savedAt.value = null
}

function addTier() {
  tiers.value.push({ name: 'New tier', color: '#71717a', requireCount: null, levels: [] })
}
function removeTier(i: number) {
  if (tiers.value[i]!.levels.length && !confirm(`Remove "${tiers.value[i]!.name}" and its ${tiers.value[i]!.levels.length} level(s)?`)) return
  tiers.value.splice(i, 1)
}
function moveTier(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= tiers.value.length) return
  const [t] = tiers.value.splice(i, 1)
  tiers.value.splice(j, 0, t!)
}

function openPicker(tierIndex: number) {
  pickFor.value = tierIndex
  pickerOpen.value = true
}
function onPick(lvl: Level) {
  const i = pickFor.value
  if (i == null || !tiers.value[i]) return
  const tier = tiers.value[i]!
  // The same level twice in one tier is always a mistake; across tiers it is
  // the author's call, so only the tier is deduped.
  if (tier.levels.some((l) => l.position === lvl.position)) return
  tier.levels.push({ level_id: null, position: lvl.position, name: lvl.name, gd_id: null })
}
function removeLevel(tierIndex: number, levelIndex: number) {
  tiers.value[tierIndex]!.levels.splice(levelIndex, 1)
}

const totalLevels = computed(() => tiers.value.reduce((n, t) => n + t.levels.length, 0))

/**
 * Resolve every tier's levels to `levels.id`, which is what a list item links
 * to. The picker hands back a list position; positions move, ids don't.
 */
async function resolveLevelIds() {
  const unresolved = tiers.value.flatMap((t) => t.levels).filter((l) => l.level_id == null && l.position != null)
  const byPosition = new Map<number, number>()
  for (const l of unresolved) {
    if (byPosition.has(l.position!)) continue
    const lvl = await $fetch<{ id: number }>(`/api/levels/${l.position}`)
    byPosition.set(l.position!, lvl.id)
  }
  for (const t of tiers.value) {
    for (const l of t.levels) {
      if (l.level_id == null && l.position != null) l.level_id = byPosition.get(l.position) ?? null
    }
  }
}

async function save() {
  if (saving.value || !editing.value) return
  saving.value = true
  saveError.value = null
  try {
    await resolveLevelIds()

    // Pass 1 — the levels themselves, flattened in tier order.
    const items = tiers.value.flatMap((t) =>
      t.levels.filter((l) => l.level_id != null).map((l) => ({ level_id: l.level_id })),
    )
    const afterItems = await $fetch<any>(`/api/custom-lists/${editing.value}`, {
      method: 'PATCH',
      body: { title: title.value, is_public: isPublic.value, items },
    })

    // Pass 2 — the tiers, naming the item ids that now exist.
    const saved = afterItems.list ?? afterItems
    const itemIdByLevel = new Map<number, number>()
    for (const i of saved.items ?? []) {
      if (i.level_id != null && !itemIdByLevel.has(i.level_id)) itemIdByLevel.set(i.level_id, i.id)
    }
    const packs = tiers.value.map((t) => ({
      name: t.name,
      color: t.color,
      require_count: t.requireCount,
      item_ids: t.levels.map((l) => (l.level_id != null ? itemIdByLevel.get(l.level_id) : null)).filter(Boolean),
    }))
    await $fetch(`/api/custom-lists/${editing.value}`, { method: 'PATCH', body: { packs } })

    savedAt.value = Date.now()
    await loadLists()
  } catch (e: any) {
    saveError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Could not save.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="container-tight py-8">
    <!-- ---------------------------------------------------------- gallery -->
    <template v-if="!editing">
      <div class="flex items-start justify-between gap-4 mb-1">
        <h1 class="text-3xl font-semibold tracking-tight">GDSR creator</h1>
        <button type="button" class="btn btn-primary shrink-0" @click="createList">New GDSR list</button>
      </div>
      <p class="text-sm text-zinc-400 mb-6 max-w-2xl">
        A GDSR list sorts levels into named difficulty tiers — Bronze through Legend — instead of
        ranking them. Each tier asks for a number of clears rather than all of them.
      </p>

      <p v-if="loading" class="text-sm text-zinc-500">Loading…</p>
      <p v-else-if="listsError" class="text-sm text-red-400">{{ listsError }}</p>
      <div v-else-if="!lists.length" class="card px-6 py-16 text-center">
        <p class="text-sm text-zinc-400">You haven't made a GDSR list yet.</p>
        <p class="text-xs text-zinc-600 mt-1">A new one starts with the full Bronze → Legend ladder.</p>
      </div>
      <ul v-else class="grid gap-3 sm:grid-cols-2">
        <li v-for="l in lists" :key="l.public_id">
          <button
            type="button"
            class="w-full card px-4 py-3 text-left hover:border-zinc-700 transition-colors"
            @click="openList(l.public_id)"
          >
            <span class="block text-sm text-zinc-100 font-medium truncate">{{ l.title }}</span>
            <span class="block text-[11px] text-zinc-500 mt-0.5">
              {{ l.item_count }} level{{ l.item_count === 1 ? '' : 's' }}
              · {{ l.is_public ? 'Public' : 'Private' }}
            </span>
          </button>
        </li>
      </ul>
    </template>

    <!-- ----------------------------------------------------------- editor -->
    <template v-else>
      <div class="flex items-center gap-3 mb-4">
        <button type="button" class="btn btn-sm btn-ghost shrink-0" @click="closeList">← All GDSR lists</button>
        <span class="flex-1" />
        <span v-if="savedAt" class="text-xs text-emerald-400">Saved</span>
        <span v-if="saveError" class="text-xs text-red-400">{{ saveError }}</span>
        <button type="button" class="btn btn-primary shrink-0" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>

      <div class="card px-4 py-3 mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <label class="flex-1 min-w-[16rem]">
          <span class="text-[11px] uppercase tracking-widest text-zinc-500">Title</span>
          <input v-model="title" type="text" maxlength="120" class="input w-full mt-1" />
        </label>
        <label class="flex items-center gap-2 text-sm text-zinc-300 mt-5">
          <input v-model="isPublic" type="checkbox" class="accent-current" />
          Public
        </label>
        <span class="text-xs text-zinc-500 mt-5 tabular-nums">
          {{ tiers.length }} tier{{ tiers.length === 1 ? '' : 's' }} · {{ totalLevels }} level{{ totalLevels === 1 ? '' : 's' }}
        </span>
      </div>

      <div class="space-y-3">
        <section
          v-for="(t, ti) in tiers"
          :key="ti"
          class="card overflow-hidden"
          :style="{ borderColor: `${t.color}55` }"
        >
          <header class="flex flex-wrap items-center gap-2 px-3 py-2 bg-zinc-900/40">
            <span class="h-4 w-4 rounded-full shrink-0 border border-black/30" :style="{ background: t.color }" />
            <input
              v-model="t.name"
              type="text"
              maxlength="80"
              class="input input-sm w-40 shrink-0"
              aria-label="Tier name"
            />
            <input v-model="t.color" type="color" class="h-7 w-9 rounded bg-transparent shrink-0 cursor-pointer" aria-label="Tier colour" />
            <label class="flex items-center gap-1.5 text-[11px] text-zinc-500 shrink-0">
              Clear any
              <input
                v-model.number="t.requireCount"
                type="number"
                min="1"
                :max="Math.max(1, t.levels.length)"
                placeholder="all"
                class="input input-sm w-16 tabular-nums"
              />
            </label>
            <span class="text-[11px] text-zinc-500 flex-1 min-w-0 truncate">
              {{ gdsrRequirementLabel(t.requireCount, t.levels.length) }}
            </span>
            <span class="flex items-center gap-1 shrink-0">
              <button type="button" class="btn btn-sm btn-ghost px-2" :disabled="ti === 0" @click="moveTier(ti, -1)">↑</button>
              <button type="button" class="btn btn-sm btn-ghost px-2" :disabled="ti === tiers.length - 1" @click="moveTier(ti, 1)">↓</button>
              <button type="button" class="btn btn-sm btn-ghost px-2 hover:text-red-400" @click="removeTier(ti)">✕</button>
            </span>
          </header>

          <ul v-if="t.levels.length" class="divide-y divide-zinc-900/60">
            <li v-for="(l, li) in t.levels" :key="li" class="flex items-center gap-3 px-3 py-2">
              <span class="text-[11px] text-zinc-600 tabular-nums w-10 shrink-0">
                <template v-if="l.position">#{{ l.position }}</template>
              </span>
              <span class="text-sm text-zinc-200 truncate flex-1">{{ l.name }}</span>
              <button type="button" class="btn btn-sm btn-ghost px-2 hover:text-red-400 shrink-0" @click="removeLevel(ti, li)">✕</button>
            </li>
          </ul>
          <p v-else class="px-3 py-4 text-xs text-zinc-600">No levels in this tier yet.</p>

          <div class="px-3 py-2 border-t border-zinc-900/60">
            <button type="button" class="btn btn-sm btn-ghost" @click="openPicker(ti)">+ Add level</button>
          </div>
        </section>
      </div>

      <button type="button" class="btn btn-ghost mt-3 w-full border-dashed" @click="addTier">+ Add tier</button>
    </template>

    <LevelComparisonDrawer
      v-model:open="pickerOpen"
      title="Add a level to this tier"
      @confirm="onPick"
    />
  </div>
</template>
