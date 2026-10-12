<script setup lang="ts">
import { DEFAULT_PRESET, type ThemeOverrideKey } from '~/composables/useTheme'
import { LOCALES, type LocaleCode } from '~/utils/i18n'

const { state, PRESETS, setPreset, setOverride, reset, effectiveHex } = useTheme()

/**
 * Language lives here rather than in a control of its own.
 *
 * It is the same kind of setting as the theme — how the site looks to you, held
 * on your machine, affecting nothing anybody else sees — and the header has no
 * room for a second icon that opens a list of nine things.
 */
const { locale, setLocale, t } = useLocale()

function pickLocale(code: LocaleCode) {
  setLocale(code)
  close()
}

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
      class="p-2 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      :class="open ? 'text-zinc-50' : 'text-zinc-400 hover:text-zinc-100'"
      :aria-label="`${t('Theme')} / ${t('Language')}`"
      :title="`${t('Theme')} / ${t('Language')}`"
      :aria-expanded="open"
      @click="toggle"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="w-[19px] h-[19px]" aria-hidden="true">
        <circle cx="13.5" cy="6.5" r="1.2" /><circle cx="17.5" cy="10.5" r="1.2" /><circle cx="8.5" cy="7.5" r="1.2" /><circle cx="6.5" cy="12.5" r="1.2" />
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.17-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.56-2.5 5.56-5.55C21.97 6.01 17.46 2 12 2z" />
      </svg>
    </button>

    <div v-if="open" class="absolute right-0 top-full mt-2 w-72 popover z-50 p-3 space-y-4">
      <section>
        <p class="label mb-2">{{ t('Theme') }}</p>
        <div class="grid grid-cols-2 gap-1.5">
          <button
            v-for="(p, name) in PRESETS"
            :key="name"
            type="button"
            class="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            :class="state.preset === name ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-300 hover:bg-zinc-800/60'"
            :aria-pressed="state.preset === name"
            @click="setPreset(name)"
          >
            <span class="w-3.5 h-3.5 rounded-full shrink-0 ring-1 ring-black/40" :style="{ backgroundColor: p.swatch.accent }" />
            <span class="truncate">{{ p.label }}</span>
          </button>
        </div>
      </section>

      <section>
        <p class="label mb-2">{{ t('Language') }}</p>
        <div class="grid grid-cols-2 gap-1">
          <button
            v-for="l in LOCALES"
            :key="l.code"
            type="button"
            class="rounded-md px-2.5 py-1.5 text-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            :class="locale === l.code ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-300 hover:bg-zinc-800/60'"
            :title="l.english"
            :aria-pressed="locale === l.code"
            @click="pickLocale(l.code)"
          >{{ l.native }}</button>
        </div>
        <p class="mt-2 text-xs text-zinc-500">Level names, comments and lists stay as written.</p>
      </section>

      <section>
        <button
          type="button"
          class="w-full flex items-center justify-between text-sm text-zinc-400 hover:text-zinc-100 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          :aria-expanded="advanced"
          @click="advanced = !advanced"
        >
          <span>Custom colours</span>
          <svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 transition-transform" :class="{ 'rotate-180': advanced }" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z" clip-rule="evenodd" /></svg>
        </button>
        <div v-if="advanced" class="mt-2 space-y-1.5">
          <div v-for="row in overrideRows" :key="row.key" class="flex items-center gap-3 text-sm">
            <input
              type="color"
              :value="effectiveHex(row.key)"
              class="w-7 h-7 rounded cursor-pointer border border-zinc-700 bg-zinc-900 p-0 shrink-0"
              :aria-label="row.label"
              @input="(e) => onPickerInput(row.key, e)"
            />
            <span class="flex-1 text-zinc-300">{{ row.label }}</span>
            <button v-if="state.overrides[row.key]" type="button" class="text-xs text-zinc-500 hover:text-zinc-200" @click="clearOverride(row.key)">Clear</button>
          </div>
        </div>
      </section>

      <button
        v-if="hasOverrides || state.preset !== DEFAULT_PRESET"
        type="button"
        class="text-xs text-zinc-500 hover:text-zinc-200"
        @click="reset"
      >Reset to default</button>
    </div>
  </div>
</template>
