<script setup lang="ts">
/** An on/off switch. Put it inside a `<label>` with the setting's name. */
defineProps<{ ariaLabel?: string }>()
const model = defineModel<boolean>({ required: true })
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="model"
    :aria-label="ariaLabel"
    class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    :class="model ? 'bg-accent' : 'bg-zinc-700'"
    @click="model = !model"
  >
    <span
      class="inline-block h-4 w-4 rounded-full bg-zinc-50 shadow transition-transform"
      :class="model ? 'translate-x-[18px]' : 'translate-x-0.5'"
    />
  </button>
</template>
