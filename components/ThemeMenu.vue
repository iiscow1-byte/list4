<script setup lang="ts">
import type { ThemeOverrideKey } from '~/composables/useTheme'

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
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.759 6.759 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.213-1.281z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    </button>

    <div
      v-if="open"
      class="absolute right-0 top-full mt-2 w-72 rounded-md border border-zinc-800 bg-zinc-950 shadow-xl shadow-black/40 z-50"
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

      <div v-if="hasOverrides || state.preset !== 'default'" class="border-t border-zinc-800 px-4 py-2 flex justify-end">
        <button
          type="button"
          class="text-[11px] text-zinc-500 hover:text-zinc-300 underline-offset-2 hover:underline"
          @click="reset"
        >Reset to default</button>
      </div>
    </div>
  </div>
</template>
