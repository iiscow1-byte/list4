<script setup lang="ts">
/**
 * A page-like admin section: a title saying what it is, one line saying what
 * it is for, its main actions on the right, then its content.
 *
 * Every section drew its own heading before: an uppercase label in one, a
 * `text-sm` heading in the next, none at all in a third. Whichever section you
 * opened, you had to work out where you were from the content.
 */
withDefaults(defineProps<{
  title: string
  description?: string
  /** `md` for forms and lists, `lg` for tables that want the room. */
  width?: 'md' | 'lg'
}>(), { width: 'md' })
</script>

<template>
  <div class="flex-1 min-h-0 overflow-y-auto">
    <div class="mx-auto px-4 sm:px-6 py-6" :class="width === 'lg' ? 'max-w-5xl' : 'max-w-3xl'">
      <header class="flex items-start justify-between gap-x-4 gap-y-3 flex-wrap mb-5">
        <div class="min-w-0">
          <h1 class="font-display text-xl font-semibold text-zinc-50">{{ title }}</h1>
          <p v-if="description" class="mt-1 text-sm text-zinc-400 max-w-xl">{{ description }}</p>
        </div>
        <div v-if="$slots.actions" class="flex items-center gap-2 flex-wrap shrink-0">
          <slot name="actions" />
        </div>
      </header>
      <slot />
    </div>
  </div>
</template>
