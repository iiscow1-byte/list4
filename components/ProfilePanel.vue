<script setup lang="ts">
/**
 * One box on a profile.
 *
 * The profile column had five of these written out by hand and they had drifted
 * into two shapes: the charts used `rounded-md … p-3`, everything else
 * `rounded-xl … p-4`, and they sit directly on top of each other in the same
 * sidebar, so the corners visibly disagree down the length of the page. The
 * headings had drifted too — some were an `h2`, some an `h2` wrapping a button
 * with the count outside it and no space between them.
 *
 * So: one shell, one heading, one place for a count and one for an action.
 *
 * `flush` is for a box whose contents draw their own padding — the comment
 * thread — so it can sit in the same frame without being padded twice.
 */
withDefaults(defineProps<{
  title: string
  /** Shown after the title, quietly. Usually a total. */
  count?: number | string | null
  /** A few words after the count — "beaten", "records". */
  note?: string | null
  /** Makes the heading itself a button, for a box that opens something. */
  clickable?: boolean
  /** The body draws its own padding. */
  flush?: boolean
}>(), { count: null, note: null, clickable: false, flush: false })

const emit = defineEmits<{ (e: 'titleClick'): void }>()
</script>

<template>
  <section class="card overflow-hidden">
    <header class="flex items-baseline gap-2 px-4 pt-3.5 pb-2.5">
      <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold min-w-0 truncate">
        <button
          v-if="clickable"
          type="button"
          class="uppercase tracking-widest hover:text-accent transition-colors rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          @click="emit('titleClick')"
        >{{ title }}</button>
        <template v-else>{{ title }}</template>
      </h2>
      <span v-if="count != null" class="shrink-0 tabular-nums text-[11px] text-zinc-600">{{ count }}</span>
      <span v-if="note" class="shrink-0 text-[11px] text-zinc-600 truncate">{{ note }}</span>
      <span class="ml-auto shrink-0 flex items-center gap-2"><slot name="action" /></span>
    </header>
    <div :class="flush ? '' : 'px-4 pb-4'"><slot /></div>
  </section>
</template>
