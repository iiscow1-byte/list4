<script setup lang="ts">
type LevelMatch = { position: number; name: string }
type RowValue = { search: string; video: string; selected: LevelMatch | null }

const props = defineProps<{ modelValue: RowValue }>()
const emit = defineEmits<{ 'update:modelValue': [value: RowValue] }>()

const search = computed({
  get: () => props.modelValue.search,
  set: (v: string) => emit('update:modelValue', { ...props.modelValue, search: v }),
})
const video = computed({
  get: () => props.modelValue.video,
  set: (v: string) => emit('update:modelValue', { ...props.modelValue, video: v }),
})
const selected = computed(() => props.modelValue.selected)
function setSelected(s: LevelMatch | null) {
  emit('update:modelValue', { ...props.modelValue, selected: s })
}

const matches = ref<LevelMatch[]>([])
const matchesOpen = ref(false)

let debounce: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (selected.value && v !== `#${selected.value.position} ${selected.value.name}`) {
    setSelected(null)
  }
  if (selected.value) { matches.value = []; matchesOpen.value = false; return }
  if (debounce) clearTimeout(debounce)
  if (!v.trim()) { matches.value = []; matchesOpen.value = false; return }
  debounce = setTimeout(async () => {
    try {
      const res = await $fetch<{ items: LevelMatch[] }>('/api/levels', {
        query: { search: v.trim(), pageSize: 20 },
      })
      matches.value = res.items
      matchesOpen.value = res.items.length > 0
    } catch {
      matches.value = []
      matchesOpen.value = false
    }
  }, 200)
})

function pick(l: LevelMatch) {
  setSelected(l)
  search.value = `#${l.position} ${l.name}`
  matches.value = []
  matchesOpen.value = false
}
</script>

<template>
  <div class="relative">
    <input
      v-model="search"
      placeholder="Level…"
      autocomplete="off"
      class="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      @focus="matchesOpen = matches.length > 0"
      @blur="setTimeout(() => matchesOpen = false, 150)"
    />
    <ul
      v-if="matchesOpen && matches.length"
      class="absolute z-10 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900 shadow-lg"
    >
      <li v-for="l in matches" :key="l.position">
        <button
          type="button"
          class="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-900 flex items-center gap-3"
          @mousedown.prevent="pick(l)"
        >
          <span class="tabular-nums text-accent text-xs w-12 shrink-0">#{{ l.position }}</span>
          <span class="truncate">{{ l.name }}</span>
        </button>
      </li>
    </ul>
  </div>
  <input
    v-model="video"
    type="url"
    placeholder="https://www.youtube.com/watch?v=…"
    class="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
  />
</template>
