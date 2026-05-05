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

type NavLevel = { position: number; name: string; gddl_tier: string | null; difficulty: string | null }
const moveBelowMode = ref(false)
const moveBelowPick = ref<NavLevel | null>(null)
const sidebarOpen = ref(true)

function onNavPick(lvl: NavLevel) {
  moveBelowPick.value = lvl
}
function onStartMoveBelow() {
  moveBelowMode.value = true
  moveBelowPick.value = null
}
function onEndMoveBelow() {
  moveBelowMode.value = false
  moveBelowPick.value = null
}
// Reset pick mode when navigating to a different level
watch(position, () => { moveBelowMode.value = false; moveBelowPick.value = null })
</script>

<template>
  <div
    class="grid grid-rows-[minmax(0,1fr)] h-full transition-[grid-template-columns] duration-200"
    :class="sidebarOpen ? 'grid-cols-[20%_60%_20%]' : 'grid-cols-[80%_20%]'"
  >
    <LevelListNav
      v-if="sidebarOpen"
      :active-position="position"
      :pick-mode="moveBelowMode"
      :picked-position="moveBelowPick?.position ?? null"
      @pick="onNavPick"
    />
    <div class="flex flex-col min-h-0">
      <div class="shrink-0 px-3 py-1.5 border-b border-zinc-900/60 flex items-center gap-1.5 bg-zinc-950/80">
        <button
          type="button"
          class="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors"
          :title="sidebarOpen ? 'Collapse level list' : 'Expand level list'"
          @click="sidebarOpen = !sidebarOpen"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5 transition-transform" :class="sidebarOpen ? '' : 'rotate-180'" aria-hidden="true">
            <path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02z" clip-rule="evenodd" />
          </svg>
          {{ sidebarOpen ? 'Hide list' : 'Show list' }}
        </button>
      </div>
      <div class="overflow-y-auto flex-1 min-h-0">
        <div v-if="error" class="p-12 text-center text-zinc-500">
          <p class="text-sm">Level #{{ position }} not found.</p>
          <NuxtLink to="/levels/1" class="text-accent hover:underline text-sm mt-2 inline-block">Back to top of list</NuxtLink>
        </div>
        <LevelDetail
          v-else-if="level"
          :level="level"
          :move-below-pick="moveBelowPick"
          @refresh="refresh"
          @start-move-below="onStartMoveBelow"
          @end-move-below="onEndMoveBelow"
        />
      </div>
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
