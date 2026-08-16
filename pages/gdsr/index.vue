<script setup lang="ts">
import { GDSR_TIER_PRESETS, gdsrRequirementLabel } from '~/utils/gdsr-tiers'
import type { PaletteLevel } from '~/components/LevelPalette.vue'

/**
 * GDSR creator — a list whose levels are sorted into named difficulty tiers
 * rather than ranked 1..N.
 *
 * It writes ordinary custom lists (`kind = 'gdsr'`) whose tiers are packs, so
 * sharing, ownership, records and the public gallery all come along without a
 * second implementation of any of them.
 *
 * Saving is two requests on purpose: packs reference item ids, and a new list
 * has none until its items exist. `replaceItems` reuses ids for levels that
 * stay, so the second request can always name what the first created.
 */
definePageMeta({ middleware: 'auth' })
useHead({ title: 'GDSR creator — All Levels List' })

const route = useRoute()
const router = useRouter()

type TierLevel = {
  level_id: number | null
  position: number | null
  name: string
  gd_id: number | null
  creator: string | null
  gddl_tier: string | null
  unverified: boolean
  /** No ALL-list level behind it — typed in by hand. */
  custom: boolean
}
type Tier = { name: string; color: string; requireCount: number | null; levels: TierLevel[] }
type ListRow = { public_id: string; title: string; kind?: string; item_count: number; is_public: number }

const lists = ref<ListRow[]>([])
const loadingLists = ref(true)
const listsError = ref<string | null>(null)

const editing = ref<string | null>(null)
const title = ref('')
const isPublic = ref(false)
const description = ref('')
/** A ranked list of yours this GDSR is the tiered companion to. */
const linkedTo = ref('')
const rankedLists = ref<ListRow[]>([])
const tiers = ref<Tier[]>([])
const activeTier = ref(0)
const saving = ref(false)
const saveError = ref<string | null>(null)
const savedAt = ref<number | null>(null)
const dirty = ref(false)

watch([title, description, isPublic, linkedTo, tiers], () => { if (editing.value) dirty.value = true }, { deep: true })

// ------------------------------------------------------------------ loading
async function loadLists() {
  loadingLists.value = true
  listsError.value = null
  try {
    const res = await $fetch<{ lists: ListRow[] }>('/api/custom-lists')
    const all = res.lists ?? []
    lists.value = all.filter((l) => l.kind === 'gdsr')
    // Ranked lists are the candidates a GDSR can be attached to.
    rankedLists.value = all.filter((l) => (l.kind ?? 'ranked') !== 'gdsr')
  } catch (e: any) {
    listsError.value = e?.data?.statusMessage ?? 'Could not load your lists.'
  } finally {
    loadingLists.value = false
  }
}

function blankTiers(): Tier[] {
  return GDSR_TIER_PRESETS.map((p) => ({ name: p.name, color: p.color, requireCount: p.requireCount, levels: [] }))
}

async function openList(publicId: string) {
  saveError.value = null
  try {
    const res = await $fetch<any>(`/api/custom-lists/${publicId}`)
    const list = res.list ?? res
    const itemById = new Map<number, any>((list.items ?? []).map((i: any) => [i.id, i]))
    const packs: Tier[] = (list.packs ?? []).map((p: any) => ({
      name: p.name,
      color: p.color || '#71717a',
      requireCount: p.require_count ?? null,
      levels: (p.item_ids ?? []).map((id: number) => itemById.get(id)).filter(Boolean).map((i: any) => ({
        level_id: i.level_id ?? null,
        position: i.position ?? null,
        name: i.name,
        gd_id: i.gd_id ?? null,
        creator: i.creator ?? null,
        gddl_tier: i.gddl_tier ?? null,
        unverified: !!i.unverified,
        custom: i.level_id == null,
      })),
    }))
    editing.value = publicId
    title.value = list.title
    description.value = list.description ?? ''
    isPublic.value = !!list.is_public
    // Which ranked list points at this GDSR, if any. The link lives on that
    // list, so it is read from the other side.
    linkedTo.value = rankedLists.value.find((r) => (r as any).linked_gdsr_public_id === publicId)?.public_id ?? ''
    tiers.value = packs.length ? packs : blankTiers()
    activeTier.value = 0
    await nextTick()
    dirty.value = false
    router.replace({ query: { ...route.query, list: publicId } })
  } catch (e: any) {
    saveError.value = e?.data?.statusMessage ?? 'Could not open that list.'
  }
}

async function init() {
  await loadLists()
  const wanted = String(route.query.list ?? '')
  if (wanted && lists.value.some((l) => l.public_id === wanted)) await openList(wanted)
}
init()

// ------------------------------------------------------------------ create
const creating = ref(false)
const newTitle = ref('')
async function createList() {
  const name = newTitle.value.trim()
  if (!name || creating.value) return
  creating.value = true
  saveError.value = null
  try {
    const res = await $fetch<{ list: { public_id: string } }>('/api/custom-lists', {
      method: 'POST', body: { title: name, kind: 'gdsr' },
    })
    newTitle.value = ''
    await loadLists()
    editing.value = res.list.public_id
    title.value = name
    description.value = ''
    linkedTo.value = ''
    isPublic.value = false
    tiers.value = blankTiers()
    activeTier.value = 0
    await nextTick()
    dirty.value = false
    router.replace({ query: { ...route.query, list: res.list.public_id } })
  } catch (e: any) {
    saveError.value = e?.data?.statusMessage ?? 'Could not create the list.'
  } finally {
    creating.value = false
  }
}

function closeList() {
  if (dirty.value && !confirm('You have unsaved changes. Leave anyway?')) return
  editing.value = null
  tiers.value = []
  savedAt.value = null
  dirty.value = false
  router.replace({ query: {} })
}

// ------------------------------------------------------------------- tiers
function addTier() {
  tiers.value.push({ name: 'New tier', color: '#71717a', requireCount: null, levels: [] })
  activeTier.value = tiers.value.length - 1
}
function removeTier(i: number) {
  const t = tiers.value[i]!
  if (t.levels.length && !confirm(`Remove "${t.name}" and its ${t.levels.length} level(s)?`)) return
  tiers.value.splice(i, 1)
  activeTier.value = Math.max(0, Math.min(activeTier.value, tiers.value.length - 1))
}
function moveTier(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= tiers.value.length) return
  const [t] = tiers.value.splice(i, 1)
  tiers.value.splice(j, 0, t!)
  if (activeTier.value === i) activeTier.value = j
}
function moveLevel(ti: number, li: number, dir: -1 | 1) {
  const arr = tiers.value[ti]!.levels
  const j = li + dir
  if (j < 0 || j >= arr.length) return
  const [l] = arr.splice(li, 1)
  arr.splice(j, 0, l!)
}
function removeLevel(ti: number, li: number) { tiers.value[ti]!.levels.splice(li, 1) }

/** Every ALL-list level already placed, so the palette can dim them. */
const usedLevelIds = computed(() => {
  const s = new Set<number>()
  for (const t of tiers.value) for (const l of t.levels) if (l.level_id != null) s.add(l.level_id)
  return s
})

function pickFromPalette(l: PaletteLevel) {
  const tier = tiers.value[activeTier.value]
  if (!tier) return
  if (tier.levels.some((x) => x.level_id === l.id)) return   // already in this tier
  tier.levels.push({
    level_id: l.id, position: l.position, name: l.name, gd_id: l.gd_id ?? null,
    creator: l.creator ?? null, gddl_tier: l.gddl_tier ?? null, unverified: false, custom: false,
  })
}

// ------------------------------------------------------------- drag & drop
/**
 * Two things can be dragged: a level out of the palette, and a level already in
 * a tier. The second is how levels move between tiers and reorder within one,
 * so the drag payload records where it came from.
 */
type DragSource = { from: 'palette' } | { from: 'tier'; ti: number; li: number }
const dragging = ref<DragSource | null>(null)
const dropTier = ref<number | null>(null)

function onPaletteDragStart() { dragging.value = { from: 'palette' } }
function onTierLevelDragStart(ev: DragEvent, ti: number, li: number) {
  dragging.value = { from: 'tier', ti, li }
  ev.dataTransfer?.setData('text/plain', tiers.value[ti]!.levels[li]!.name)
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move'
}
function endDrag() { dragging.value = null; dropTier.value = null }

function onTierDragOver(ev: DragEvent, ti: number) {
  if (!dragging.value) return
  ev.preventDefault()
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = dragging.value.from === 'palette' ? 'copy' : 'move'
  dropTier.value = ti
  activeTier.value = ti
}

/**
 * @param at index to insert before, or null for the end of the tier
 */
function onTierDrop(ev: DragEvent, ti: number, at: number | null = null) {
  ev.preventDefault()
  const src = dragging.value
  const tier = tiers.value[ti]
  if (!tier) { endDrag(); return }

  if (src?.from === 'tier') {
    const fromTier = tiers.value[src.ti]
    const moved = fromTier?.levels[src.li]
    if (!moved) { endDrag(); return }
    // Remove first, then insert — and correct the target index when the removal
    // happened above it in the same tier, or the row lands one place too late.
    fromTier!.levels.splice(src.li, 1)
    let idx = at ?? tier.levels.length
    if (src.ti === ti && src.li < idx) idx--
    tier.levels.splice(Math.max(0, Math.min(idx, tier.levels.length)), 0, moved)
    endDrag()
    return
  }

  // From the palette: the level rides in the drag payload, so a drop works even
  // if the palette re-rendered mid-drag.
  const raw = ev.dataTransfer?.getData('application/x-als-level')
  if (raw) {
    try {
      const l = JSON.parse(raw) as PaletteLevel
      if (!tier.levels.some((x) => x.level_id === l.id)) {
        const row: TierLevel = {
          level_id: l.id, position: l.position, name: l.name, gd_id: l.gd_id ?? null,
          creator: l.creator ?? null, gddl_tier: l.gddl_tier ?? null, unverified: false, custom: false,
        }
        tier.levels.splice(at ?? tier.levels.length, 0, row)
      }
    } catch { /* not our payload */ }
  }
  endDrag()
}

// ----------------------------------------------------------- custom levels
const customOpen = ref(false)
const cName = ref('')
const cCreator = ref('')
const cGdId = ref('')
const cUnverified = ref(false)
const customError = ref<string | null>(null)
function addCustomLevel() {
  const name = cName.value.trim()
  const tier = tiers.value[activeTier.value]
  if (!name || !tier) return
  customError.value = null

  /**
   * Two custom levels cannot share a name on one list.
   *
   * A custom row has no level to be identified by, so `replaceItems` matches it
   * on name + Level ID — and the tier save maps names back to the ids it
   * created. Two rows called the same thing would resolve to one item and land
   * in whichever tier asked last, silently. Adding a Level ID or a creator to
   * the name is the fix, so say so rather than accepting it.
   */
  const clash = tiers.value.some((t) => t.levels.some(
    (l) => l.custom && l.name.toLowerCase() === name.toLowerCase(),
  ))
  if (clash) {
    customError.value = `This list already has a custom level called "${name}". Give it a distinguishing name.`
    return
  }

  const id = Number(cGdId.value.trim())
  tier.levels.push({
    level_id: null, position: null, name: name.slice(0, 200),
    gd_id: Number.isInteger(id) && id > 0 ? id : null,
    creator: cCreator.value.trim().slice(0, 200) || null,
    gddl_tier: null, unverified: cUnverified.value, custom: true,
  })
  cName.value = ''; cCreator.value = ''; cGdId.value = ''; cUnverified.value = false
  customError.value = null
  customOpen.value = false
}

// ------------------------------------------------------------------ counts
const totalLevels = computed(() => tiers.value.reduce((n, t) => n + t.levels.length, 0))
const unverifiedCount = computed(() =>
  tiers.value.reduce((n, t) => n + t.levels.filter((l) => l.unverified).length, 0))
const clearableCount = computed(() => totalLevels.value - unverifiedCount.value)

/** Clearable levels in a tier — the number its requirement is measured against. */
function clearableIn(t: Tier) { return t.levels.filter((l) => !l.unverified).length }

// ------------------------------------------------------------------ saving
async function resolveLevelIds() {
  const pending = tiers.value.flatMap((t) => t.levels).filter((l) => !l.custom && l.level_id == null && l.position != null)
  const byPos = new Map<number, number>()
  for (const l of pending) {
    if (byPos.has(l.position!)) continue
    const lvl = await $fetch<{ id: number }>(`/api/levels/${l.position}`)
    byPos.set(l.position!, lvl.id)
  }
  for (const t of tiers.value) {
    for (const l of t.levels) if (!l.custom && l.level_id == null && l.position != null) l.level_id = byPos.get(l.position) ?? null
  }
}

async function save() {
  if (saving.value || !editing.value) return
  saving.value = true
  saveError.value = null
  try {
    await resolveLevelIds()

    // Pass 1 — the levels, flattened in tier order. Custom rows carry their own
    // fields; linked rows carry only the id and take their display from `levels`.
    const flat = tiers.value.flatMap((t) => t.levels)
    const items = flat.map((l) => l.custom
      ? { level_id: null, name: l.name, gd_id: l.gd_id, creator: l.creator, unverified: l.unverified ? 1 : 0 }
      : { level_id: l.level_id, unverified: l.unverified ? 1 : 0 })
    const res = await $fetch<any>(`/api/custom-lists/${editing.value}`, {
      method: 'PATCH',
      body: {
        title: title.value,
        description: description.value,
        is_public: isPublic.value,
        items,
      },
    })

    // Pass 2 — the tiers, naming the item ids that now exist. Linked rows match
    // on level_id; custom rows have no id to match on, so they go by name.
    const saved = res.list ?? res
    const byLevel = new Map<number, number>()
    const byName = new Map<string, number>()
    for (const i of saved.items ?? []) {
      if (i.level_id != null) { if (!byLevel.has(i.level_id)) byLevel.set(i.level_id, i.id) }
      else if (!byName.has(String(i.name).toLowerCase())) byName.set(String(i.name).toLowerCase(), i.id)
    }
    const packs = tiers.value.map((t) => ({
      name: t.name,
      color: t.color,
      require_count: t.requireCount,
      item_ids: t.levels
        .map((l) => (l.custom ? byName.get(l.name.toLowerCase()) : l.level_id != null ? byLevel.get(l.level_id) : null))
        .filter((v): v is number => typeof v === 'number'),
    }))
    await $fetch(`/api/custom-lists/${editing.value}`, { method: 'PATCH', body: { packs } })

    // The link is a property of the ranked list, so it is written there — and
    // any other list of yours that claimed this GDSR is released first, so one
    // GDSR can never appear as the companion of two lists at once.
    for (const r of rankedLists.value) {
      const claims = (r as any).linked_gdsr_public_id === editing.value
      if (claims && r.public_id !== linkedTo.value) {
        await $fetch(`/api/custom-lists/${r.public_id}`, { method: 'PATCH', body: { linked_gdsr_public_id: '' } })
      }
    }
    if (linkedTo.value) {
      await $fetch(`/api/custom-lists/${linkedTo.value}`, {
        method: 'PATCH', body: { linked_gdsr_public_id: editing.value },
      })
    }

    savedAt.value = Date.now()
    dirty.value = false
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
    <!-- ══════════════════════════════════════════════════════ gallery ══ -->
    <template v-if="!editing">
      <h1 class="text-3xl font-semibold tracking-tight mb-1">GDSR creator</h1>
      <p class="text-sm text-zinc-400 mb-6 max-w-2xl">
        A GDSR sorts levels into named difficulty tiers — Bronze through Legend — instead of ranking
        them. Each tier is earned by clearing a number of its levels, not all of them.
      </p>

      <form class="card px-4 py-3 mb-6 flex flex-wrap items-end gap-3" @submit.prevent="createList">
        <label class="flex-1 min-w-[14rem]">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">New GDSR</span>
          <input v-model="newTitle" type="text" maxlength="120" placeholder="Name it…" class="field field-md w-full mt-1" />
        </label>
        <button type="submit" class="btn btn-primary shrink-0" :disabled="!newTitle.trim() || creating">
          {{ creating ? 'Creating…' : 'Create' }}
        </button>
      </form>
      <p v-if="saveError" class="text-xs text-red-400 -mt-4 mb-4">{{ saveError }}</p>

      <p v-if="loadingLists" class="text-sm text-zinc-500">Loading…</p>
      <p v-else-if="listsError" class="text-sm text-red-400">{{ listsError }}</p>
      <div v-else-if="!lists.length" class="card px-6 py-14 text-center">
        <p class="text-sm text-zinc-400">No GDSR lists yet.</p>
        <p class="text-xs text-zinc-600 mt-1">A new one starts with the full Bronze → Legend ladder.</p>
      </div>
      <ul v-else class="grid gap-3 sm:grid-cols-2">
        <li v-for="l in lists" :key="l.public_id">
          <button type="button" class="w-full card px-4 py-3 text-left hover:border-zinc-700 transition-colors" @click="openList(l.public_id)">
            <span class="block text-sm text-zinc-100 font-medium truncate">{{ l.title }}</span>
            <span class="block text-[11px] text-zinc-500 mt-0.5 tabular-nums">
              {{ l.item_count }} level{{ l.item_count === 1 ? '' : 's' }} · {{ l.is_public ? 'Public' : 'Private' }}
            </span>
          </button>
        </li>
      </ul>
    </template>

    <!-- ═══════════════════════════════════════════════════════ editor ══ -->
    <template v-else>
      <!-- Header -->
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <button type="button" class="btn btn-sm btn-ghost shrink-0" @click="closeList">← All GDSR lists</button>
        <NuxtLink :to="`/lists/${editing}/packs`" class="btn btn-sm btn-ghost shrink-0">View list ↗</NuxtLink>
        <span class="flex-1" />
        <span v-if="saveError" class="text-xs text-red-400">{{ saveError }}</span>
        <span v-else-if="dirty" class="text-xs text-amber-400">Unsaved changes</span>
        <span v-else-if="savedAt" class="text-xs text-emerald-400">Saved</span>
        <button type="button" class="btn btn-primary shrink-0" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>

      <!-- Title + counts -->
      <div class="card px-4 py-3 mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <input
          v-model="title"
          type="text"
          maxlength="120"
          placeholder="List title"
          class="flex-1 min-w-[12rem] bg-transparent text-lg font-semibold tracking-tight text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
        />
        <label class="flex items-center gap-2 text-xs text-zinc-400 shrink-0">
          <input v-model="isPublic" type="checkbox" class="accent-current" /> Public
        </label>
        <span class="text-[11px] text-zinc-500 tabular-nums shrink-0">
          {{ tiers.length }} tiers · {{ totalLevels }} levels
          <template v-if="unverifiedCount">
            · <span class="text-amber-400/90">{{ unverifiedCount }} unverified</span>
            · {{ clearableCount }} clearable
          </template>
        </span>
      </div>

      <!-- Everything else a custom list can say about itself. The rest of the
           presentation options (icon, banner, accent, links, row density) are
           the same ones every list has, so they stay on the shared settings
           page rather than being reimplemented here. -->
      <details class="card px-4 py-3 mb-4 group">
        <summary class="cursor-pointer text-[10px] uppercase tracking-widest text-zinc-500 font-semibold select-none">
          Details &amp; links
        </summary>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <label class="block sm:col-span-2">
            <span class="text-[11px] text-zinc-500">Description</span>
            <textarea
              v-model="description"
              rows="2"
              maxlength="2000"
              placeholder="What this GDSR is, and how its tiers are meant to be read."
              class="field field-md w-full mt-1 resize-y"
            />
          </label>
          <label class="block">
            <span class="text-[11px] text-zinc-500">Companion to a ranked list</span>
            <select v-model="linkedTo" class="field field-md w-full mt-1">
              <option value="">Not linked</option>
              <option v-for="r in rankedLists" :key="r.public_id" :value="r.public_id">{{ r.title }}</option>
            </select>
            <span class="block text-[10px] text-zinc-600 mt-1">
              Adds a small GDSR button at the top of that list.
            </span>
          </label>
          <div class="flex items-end">
            <NuxtLink :to="`/lists/${editing}/settings`" class="btn btn-sm btn-ghost w-full">
              All list settings ↗
            </NuxtLink>
          </div>
        </div>
      </details>

      <div class="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)] items-start">
        <!-- ── Palette ─────────────────────────────────────────────── -->
        <div class="lg:sticky lg:top-20 space-y-3">
          <LevelPalette
            :used="usedLevelIds"
            :title="`Add to ${tiers[activeTier]?.name ?? 'a tier'}`"
            max-height="26rem"
            @pick="pickFromPalette"
            @dragstart="onPaletteDragStart"
            @dragend="endDrag"
          />
          <p class="text-[11px] text-zinc-600 px-1">Click a level, or drag it onto a tier.</p>

          <!-- Custom level -->
          <div class="card overflow-hidden">
            <button
              type="button"
              class="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-zinc-900/40 transition-colors"
              @click="customOpen = !customOpen"
            >
              <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Custom level</span>
              <span class="text-zinc-600 text-[11px] transition-transform" :class="customOpen ? 'rotate-180' : ''">▾</span>
            </button>
            <form v-if="customOpen" class="px-4 pb-3 pt-1 space-y-2 border-t border-zinc-800/80" @submit.prevent="addCustomLevel">
              <p class="text-[11px] text-zinc-600">For levels that aren't on the ALL list.</p>
              <input v-model="cName" type="text" maxlength="200" placeholder="Level name *" class="field field-md w-full" />
              <input v-model="cCreator" type="text" maxlength="200" placeholder="Creator" class="field field-md w-full" />
              <input v-model="cGdId" type="text" inputmode="numeric" placeholder="Level ID (optional)" class="field field-md w-full tabular-nums" />
              <label class="flex items-center gap-2 text-xs text-zinc-400">
                <input v-model="cUnverified" type="checkbox" class="accent-current" /> Unverified
              </label>
              <p v-if="customError" class="text-[11px] text-red-400">{{ customError }}</p>
              <button type="submit" class="btn btn-sm btn-primary w-full" :disabled="!cName.trim()">
                Add to {{ tiers[activeTier]?.name ?? 'tier' }}
              </button>
            </form>
          </div>
        </div>

        <!-- ── Tiers ───────────────────────────────────────────────── -->
        <div class="space-y-3">
          <section
            v-for="(t, ti) in tiers"
            :key="ti"
            class="card overflow-hidden transition-shadow"
            :class="[
              activeTier === ti ? 'ring-1 ring-inset' : '',
              dropTier === ti ? 'ring-2 ring-inset ring-accent' : '',
            ]"
            :style="{
              borderColor: `${t.color}55`,
              ...(activeTier === ti && dropTier !== ti ? { '--tw-ring-color': `${t.color}99` } : {}),
            }"
            @dragover="onTierDragOver($event, ti)"
            @dragleave="dropTier === ti && (dropTier = null)"
            @drop="onTierDrop($event, ti)"
          >
            <header
              class="flex flex-wrap items-center gap-2 px-3 py-2 cursor-pointer"
              :style="{ backgroundColor: `${t.color}12` }"
              @click="activeTier = ti"
            >
              <span class="h-4 w-4 rounded-full shrink-0 border border-black/40" :style="{ background: t.color }" />
              <input
                v-model="t.name"
                type="text"
                maxlength="80"
                class="field field-sm w-36 shrink-0 font-semibold"
                aria-label="Tier name"
                @click.stop
              />
              <input
                v-model="t.color"
                type="color"
                class="h-7 w-8 rounded bg-transparent border border-zinc-800 shrink-0 cursor-pointer"
                aria-label="Tier colour"
                @click.stop
              />
              <label class="flex items-center gap-1.5 text-[11px] text-zinc-500 shrink-0" @click.stop>
                Clear any
                <input
                  v-model.number="t.requireCount"
                  type="number"
                  min="1"
                  :max="Math.max(1, clearableIn(t))"
                  placeholder="all"
                  class="field field-sm w-16 tabular-nums"
                />
              </label>
              <span class="text-[11px] text-zinc-500 flex-1 min-w-0 truncate">
                {{ gdsrRequirementLabel(t.requireCount, clearableIn(t)) }}
              </span>
              <span class="flex items-center gap-0.5 shrink-0" @click.stop>
                <button type="button" class="btn btn-sm btn-ghost px-1.5" :disabled="ti === 0" title="Move up" @click="moveTier(ti, -1)">↑</button>
                <button type="button" class="btn btn-sm btn-ghost px-1.5" :disabled="ti === tiers.length - 1" title="Move down" @click="moveTier(ti, 1)">↓</button>
                <button type="button" class="btn btn-sm btn-ghost px-1.5 hover:text-red-400" title="Remove tier" @click="removeTier(ti)">✕</button>
              </span>
            </header>

            <ul v-if="t.levels.length" class="divide-y divide-zinc-900/60">
              <li
                v-for="(l, li) in t.levels"
                :key="li"
                draggable="true"
                class="flex items-center gap-2 px-3 py-1.5 group cursor-grab active:cursor-grabbing"
                :class="l.unverified ? 'bg-amber-950/10' : ''"
                @dragstart="onTierLevelDragStart($event, ti, li)"
                @dragend="endDrag"
                @dragover="onTierDragOver($event, ti)"
                @drop.stop="onTierDrop($event, ti, li)"
              >
                <span class="text-[10px] text-zinc-600 tabular-nums w-11 shrink-0">
                  <template v-if="l.position">#{{ l.position }}</template>
                  <span v-else class="text-zinc-700">—</span>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm text-zinc-200 truncate">{{ l.name }}</span>
                  <span v-if="l.creator" class="block text-[10px] text-zinc-600 truncate">by {{ l.creator }}</span>
                </span>
                <span v-if="l.custom" class="text-[9px] uppercase tracking-widest px-1.5 py-px rounded bg-zinc-800/70 text-zinc-400 border border-zinc-700/60 shrink-0">Custom</span>
                <button
                  type="button"
                  class="text-[9px] uppercase tracking-widest px-1.5 py-px rounded border shrink-0 transition-colors"
                  :class="l.unverified
                    ? 'bg-amber-900/40 text-amber-300 border-amber-800/60'
                    : 'bg-transparent text-zinc-600 border-zinc-800 hover:text-amber-300 hover:border-amber-800/60'"
                  :title="l.unverified ? 'Marked unverified — excluded from clears' : 'Mark as unverified'"
                  @click="l.unverified = !l.unverified"
                >Unverified</button>
                <span class="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button type="button" class="btn btn-sm btn-ghost px-1.5" :disabled="li === 0" @click="moveLevel(ti, li, -1)">↑</button>
                  <button type="button" class="btn btn-sm btn-ghost px-1.5" :disabled="li === t.levels.length - 1" @click="moveLevel(ti, li, 1)">↓</button>
                  <button type="button" class="btn btn-sm btn-ghost px-1.5 hover:text-red-400" @click="removeLevel(ti, li)">✕</button>
                </span>
              </li>
            </ul>
            <p v-else class="px-3 py-5 text-xs text-zinc-600 text-center">
              {{ dropTier === ti
                ? 'Drop to add'
                : activeTier === ti
                  ? 'Drag levels here, or click them in the palette.'
                  : 'Empty — click or drag onto this tier to fill it.' }}
            </p>
          </section>

          <button type="button" class="btn btn-ghost w-full border border-dashed border-zinc-800" @click="addTier">
            + Add tier
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
