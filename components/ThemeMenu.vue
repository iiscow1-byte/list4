<script setup lang="ts">
import { DEFAULT_PRESET, type ThemeOverrideKey } from '~/composables/useTheme'

const { state, PRESETS, setPreset, setOverride, reset, effectiveHex } = useTheme()

const open = ref(false)
const advanced = ref(false)
const root = ref<HTMLElement | null>(null)

function toggle() {
  open.value = !open.value
}

function close() {
  open.value = false
  advanced.value = false
}

function onDocClick(e: MouseEvent) {
  if (!open.value) return
  if (root.value && !root.value.contains(e.target as Node)) close()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  document.removeEventListener('keydown', onKey)
})

const overrideRows: { key: ThemeOverrideKey; label: string }[] = [
  { key: 'accent',  label: 'Accent' },
  { key: 'bg',      label: 'Background' },
  { key: 'surface', label: 'Surface' },
  { key: 'border',  label: 'Border' },
  { key: 'text',    label: 'Text' },
]

function onPickerInput(key: ThemeOverrideKey, e: Event) {
  const value = (e.target as HTMLInputElement).value
  setOverride(key, value)
}

function clearOverride(key: ThemeOverrideKey) {
  setOverride(key, null)
}

const hasOverrides = computed(() => Object.keys(state.value.overrides).length > 0)
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
      :class="{ 'bg-zinc-900 text-zinc-100': open }"
      aria-label="Theme settings"
      @click="toggle"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-5 h-5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
      </svg>
    </button>

    <div
      v-if="open"
      class="absolute right-0 top-full mt-2 w-72 popover z-50"
    >
      <div class="px-4 py-3 border-b border-zinc-800">
        <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-2">Theme</p>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="(p, name) in PRESETS"
            :key="name"
            type="button"
            class="flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs transition-colors"
            :class="state.preset === name
              ? 'border-accent bg-accent/10 text-zinc-100'
              : 'border-zinc-800 text-zinc-300 hover:border-zinc-700'"
            @click="setPreset(name)"
          >
            <span class="flex shrink-0 -space-x-1">
              <span class="w-3 h-3 rounded-full border border-zinc-950" :style="{ backgroundColor: p.swatch.bg }" />
              <span class="w-3 h-3 rounded-full border border-zinc-950" :style="{ backgroundColor: p.swatch.surface }" />
              <span class="w-3 h-3 rounded-full border border-zinc-950" :style="{ backgroundColor: p.swatch.accent }" />
            </span>
            <span class="truncate">{{ p.label }}</span>
          </button>
        </div>
      </div>

      <div class="px-4 py-3">
        <button
          type="button"
          class="w-full flex items-center justify-between text-[10px] uppercase tracking-widest text-zinc-500 hover:text-zinc-300 font-medium"
          @click="advanced = !advanced"
        >
          <span>Advanced</span>
          <span class="text-zinc-600">{{ advanced ? '▾' : '▸' }}</span>
        </button>

        <div v-if="advanced" class="mt-3 space-y-2">
          <div
            v-for="row in overrideRows"
            :key="row.key"
            class="flex items-center gap-3 text-xs"
          >
            <input
              type="color"
              :value="effectiveHex(row.key)"
              class="w-7 h-7 rounded cursor-pointer border border-zinc-800 bg-zinc-900 p-0 shrink-0"
              @input="(e) => onPickerInput(row.key, e)"
            />
            <span class="flex-1 text-zinc-300">{{ row.label }}</span>
            <button
              v-if="state.overrides[row.key]"
              type="button"
              class="text-[10px] uppercase tracking-widest text-zinc-500 hover:text-zinc-300"
              @click="clearOverride(row.key)"
            >Clear</button>
          </div>
        </div>
      </div>

      <div v-if="hasOverrides || state.preset !== DEFAULT_PRESET" class="border-t border-zinc-800 px-4 py-2 flex justify-end">
        <button
          type="button"
          class="text-[11px] text-zinc-500 hover:text-zinc-300 underline-offset-2 hover:underline"
          @click="reset"
        >Reset to default</button>
      </div>
    </div>
  </div>
</template>
