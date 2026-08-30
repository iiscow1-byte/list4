<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  options?: string[]
  optionObjects?: { label: string; value: string }[]
  placeholder?: string
  emptyLabel?: string
  inputClass?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

const open = ref(false)
const query = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

const allOptions = computed<{ label: string; value: string }[]>(() => {
  if (props.optionObjects) return props.optionObjects
  return (props.options ?? []).map((o) => ({ label: o, value: o }))
})

const selectedLabel = computed(() => {
  if (!props.modelValue) return ''
  const found = allOptions.value.find((o) => o.value === props.modelValue)
  return found ? found.label : props.modelValue
})

const filtered = computed(() => {
  const q = query.value.toLowerCase()
  if (!q) return allOptions.value
  return allOptions.value.filter((o) => o.label.toLowerCase().includes(q))
})

function onFocus() {
  query.value = ''
  open.value = true
}

function scheduleClose() {
  setTimeout(() => {
    open.value = false
    query.value = ''
  }, 150)
}

function pick(val: string) {
  emit('update:modelValue', val)
  open.value = false
  query.value = ''
  inputEl.value?.blur()
}
</script>

<template>
  <div class="relative">
    <div class="relative">
      <input
        ref="inputEl"
        :value="open ? query : selectedLabel"
        :placeholder="!open && !modelValue ? (placeholder ?? emptyLabel ?? '') : (open ? 'Type to search…' : '')"
        :class="inputClass ?? 'field field-md pr-7'"
        autocomplete="off"
        @focus="onFocus"
        @blur="scheduleClose"
        @input="(e) => { query = (e.target as HTMLInputElement).value; open = true }"
      />
      <span class="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 text-xs pointer-events-none select-none">▾</span>
    </div>
    <ul
      v-if="open"
      class="absolute z-20 left-0 right-0 mt-1 max-h-60 overflow-y-auto popover divide-y divide-zinc-900/60"
    >
      <li v-if="emptyLabel">
        <button
          type="button"
          class="w-full px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          :class="modelValue === '' ? 'text-accent bg-accent/10' : 'text-zinc-400 hover:bg-zinc-900 italic'"
          @mousedown.prevent="pick('')"
        >{{ emptyLabel }}</button>
      </li>
      <li v-for="opt in filtered" :key="opt.value">
        <button
          type="button"
          class="w-full px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          :class="opt.value === modelValue ? 'text-accent bg-accent/10' : 'text-zinc-200 hover:bg-zinc-900'"
          @mousedown.prevent="pick(opt.value)"
        >{{ opt.label }}</button>
      </li>
      <li v-if="filtered.length === 0" class="px-3 py-2 text-sm text-zinc-500 italic">
        No matches
      </li>
    </ul>
  </div>
</template>
