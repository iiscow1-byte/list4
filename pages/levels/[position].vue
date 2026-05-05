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
  <div class="grid grid-cols-[20%_60%_20%] grid-rows-[minmax(0,1fr)] h-full">
    <LevelListNav
      :active-position="position"
      :pick-mode="moveBelowMode"
      :picked-position="moveBelowPick?.position ?? null"
      @pick="onNavPick"
    />
    <section class="overflow-y-auto min-h-0">
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
    </section>
    <LevelRecords :records="[...(level?.records ?? []), ...(level?.aredl_records ?? [])]" @refresh="refresh" />
  </div>
</template>
