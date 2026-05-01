<script setup lang="ts">
import { useLevelPicker } from '~/composables/useLevelPicker'

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

const picker = useLevelPicker(search, selected, setSelected)
</script>

<template>
  <div class="relative">
    <input
      v-model="search"
      placeholder="Level…"
      autocomplete="off"
      class="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      @focus="picker.openIfHasMatches()"
      @blur="picker.scheduleClose()"
    />
    <ul
      v-if="picker.open.value && picker.matches.value.length"
      :ref="picker.setScrollEl"
      class="absolute z-10 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900 shadow-lg"
      @scroll="picker.onScroll"
    >
      <li v-for="l in picker.matches.value" :key="l.position">
        <button
          type="button"
          class="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-900 flex items-center gap-3"
          :class="{ 'bg-accent/10': picker.isExactMatch(l) }"
          @mousedown.prevent="picker.pick(l)"
        >
          <span class="tabular-nums text-accent text-xs w-12 shrink-0">#{{ l.position }}</span>
          <span class="truncate">{{ l.name }}</span>
          <span v-if="picker.isExactMatch(l)" class="ml-auto text-[10px] uppercase tracking-widest text-accent shrink-0">Exact</span>
        </button>
      </li>
      <li v-if="picker.loading.value" class="px-3 py-2 text-[11px] text-zinc-500 text-center">loading…</li>
    </ul>
  </div>
  <input
    v-model="video"
    type="url"
    placeholder="https://www.youtube.com/watch?v=…"
    class="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
  />
</template>
