<script setup lang="ts">
import { useLevelPicker } from '~/composables/useLevelPicker'

type LevelMatch = { position: number; name: string }
type RowValue = { search: string; video: string; selected: LevelMatch | null; isVerificationClaim: boolean }

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
const isVerificationClaim = computed({
  get: () => props.modelValue.isVerificationClaim,
  set: (v: boolean) => emit('update:modelValue', { ...props.modelValue, isVerificationClaim: v }),
})
const selected = computed(() => props.modelValue.selected)
function setSelected(s: LevelMatch | null) {
  emit('update:modelValue', { ...props.modelValue, selected: s, isVerificationClaim: false })
}

const picker = useLevelPicker(search, selected, setSelected)

// Fetch verifier for the selected level so we know whether to show the claim checkbox.
const levelVerifier = ref<string | null | undefined>(undefined)
watch(selected, async (l) => {
  levelVerifier.value = undefined
  if (!l) return
  try {
    const data = await $fetch<{ verifier: string | null }>(`/api/levels/${l.position}`)
    levelVerifier.value = data.verifier ?? null
  } catch {
    levelVerifier.value = null
  }
})

const canClaimVerification = computed(
  () => selected.value != null && levelVerifier.value === null,
)
</script>

<template>
  <div class="relative">
    <input
      v-model="search"
      placeholder="Level…"
      autocomplete="off"
      class="field field-md"
      @focus="picker.openIfHasMatches()"
      @blur="picker.scheduleClose()"
    />
    <ul
      v-if="picker.open.value && picker.matches.value.length"
      :ref="picker.setScrollEl"
      class="absolute z-10 left-0 right-0 mt-1 max-h-64 overflow-y-auto popover divide-y divide-zinc-900"
      @scroll="picker.onScroll"
    >
      <li v-for="l in picker.matches.value" :key="l.position">
        <button
          type="button"
          class="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-900 flex items-center gap-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
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

  <!-- Video URL + inline verifier claim checkbox -->
  <div class="flex items-center gap-2">
    <input
      v-model="video"
      type="url"
      placeholder="https://www.youtube.com/watch?v=…"
      class="field field-md flex-1 min-w-0"
    />
    <label
      v-if="canClaimVerification"
      class="flex items-center gap-1.5 shrink-0 cursor-pointer select-none"
      title="Check if this video is the level's first clear (verification)"
    >
      <input
        v-model="isVerificationClaim"
        type="checkbox"
        class="accent-accent w-3.5 h-3.5"
      />
      <span class="text-[10px] text-zinc-400 whitespace-nowrap">I'm the verifier</span>
    </label>
  </div>
</template>
