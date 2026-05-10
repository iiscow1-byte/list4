<script setup lang="ts">
definePageMeta({ layout: 'level', key: () => 'level-page' })

const route = useRoute()
const position = computed(() => Number(route.params.position))

const { data: level, error, refresh } = await useFetch(() => `/api/levels/${position.value}`, {
  watch: [position],
})

useHead(() => ({
  title: level.value ? `#${level.value.position} ${level.value.name} — All Levels List` : 'All Levels List',
}))

type NavLevel = { position: number; name: string; gddl_tier: string | null; difficulty: string | null; gd_id?: number | null }
const moveBelowMode = ref(false)
const moveBelowPick = ref<NavLevel | null>(null)
const groupMoveMode = ref(false)
const groupMovePhase = ref<'select' | 'target'>('select')
const groupMovePicks = ref<NavLevel[]>([])
const groupMoveTargetPick = ref<NavLevel | null>(null)
const sidebarOpen = ref(true)

function onNavPick(lvl: NavLevel) {
  if (groupMoveMode.value) {
    if (groupMovePhase.value === 'target') {
      groupMoveTargetPick.value = lvl
    } else {
      const idx = groupMovePicks.value.findIndex((p) => p.position === lvl.position)
      if (idx >= 0) groupMovePicks.value.splice(idx, 1)
      else groupMovePicks.value.push(lvl)
    }
  } else {
    moveBelowPick.value = lvl
  }
}
function onStartMoveBelow() {
  moveBelowMode.value = true
  moveBelowPick.value = null
}
function onEndMoveBelow() {
  moveBelowMode.value = false
  moveBelowPick.value = null
}
function onStartGroupMove() {
  groupMoveMode.value = true
  groupMovePhase.value = 'select'
  groupMovePicks.value = []
  groupMoveTargetPick.value = null
  moveBelowMode.value = false
  moveBelowPick.value = null
}
function onContinueGroupMove() {
  groupMovePhase.value = 'target'
  groupMoveTargetPick.value = null
}
function onBackGroupMove() {
  groupMovePhase.value = 'select'
  groupMoveTargetPick.value = null
}
function onEndGroupMove() {
  groupMoveMode.value = false
  groupMovePhase.value = 'select'
  groupMovePicks.value = []
  groupMoveTargetPick.value = null
}
// Reset all pick modes when navigating to a different level
watch(position, () => {
  moveBelowMode.value = false
  moveBelowPick.value = null
  groupMoveMode.value = false
  groupMovePhase.value = 'select'
  groupMovePicks.value = []
  groupMoveTargetPick.value = null
})

const navPickedPositions = computed(() =>
  groupMoveMode.value && groupMovePhase.value === 'select'
    ? groupMovePicks.value.map((p) => p.position)
    : [],
)
const navPickedPosition = computed(() =>
  groupMoveMode.value && groupMovePhase.value === 'target'
    ? groupMoveTargetPick.value?.position ?? null
    : moveBelowPick.value?.position ?? null,
)
const navHint = computed(() => {
  if (!groupMoveMode.value) return undefined
  return groupMovePhase.value === 'target'
    ? '← Click a level to place the group below it'
    : '← Click levels to add/remove from group'
})
</script>

<template>
  <div
    class="grid grid-rows-[minmax(0,1fr)] h-full transition-[grid-template-columns] duration-200"
    :class="sidebarOpen ? 'grid-cols-[20%_60%_20%]' : 'grid-cols-[0px_80%_20%]'"
  >
    <div class="flex flex-col overflow-hidden min-w-0">
      <LevelListNav
        v-show="sidebarOpen"
        :active-position="position"
        :pick-mode="moveBelowMode || groupMoveMode"
        :picked-position="navPickedPosition"
        :picked-positions="navPickedPositions"
        :pick-mode-hint="navHint"
        @pick="onNavPick"
      />
    </div>
    <div class="overflow-y-auto min-h-0 relative">
      <button
        type="button"
        class="absolute top-3 left-3 z-10 p-1 rounded border border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
        :title="sidebarOpen ? 'Collapse level list' : 'Expand level list'"
        @click="sidebarOpen = !sidebarOpen"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5 transition-transform" :class="sidebarOpen ? '' : 'rotate-180'" aria-hidden="true">
          <path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02z" clip-rule="evenodd" />
        </svg>
      </button>
      <div v-if="error" class="p-12 text-center text-zinc-500">
        <p class="text-sm">Level #{{ position }} not found.</p>
        <NuxtLink to="/levels/1" class="text-accent hover:underline text-sm mt-2 inline-block">Back to top of list</NuxtLink>
      </div>
      <LevelDetail
        v-else-if="level"
        :level="level"
        :move-below-pick="moveBelowPick"
        :group-move-picks="groupMovePicks"
        :group-move-target-pick="groupMoveTargetPick"
        :group-move-phase="groupMovePhase"
        @refresh="refresh"
        @start-move-below="onStartMoveBelow"
        @end-move-below="onEndMoveBelow"
        @start-group-move="onStartGroupMove"
        @continue-group-move="onContinueGroupMove"
        @back-group-move="onBackGroupMove"
        @end-group-move="onEndGroupMove"
      />
    </div>
    <LevelRecords
      :records="[
        ...(level?.records ?? []),
        ...(level?.aredl_records ?? []),
        ...(level?.pointercrate_records ?? []),
      ]"
      @refresh="refresh"
    />
  </div>
</template>
