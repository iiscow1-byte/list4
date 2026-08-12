<script setup lang="ts">
/**
 * The joined row of buttons that switches between views.
 *
 * There were nine of these written out by hand — the changelog's four, the
 * community feed, the lists gallery, the leaderboard's tabs, the records panel,
 * the account page — and they had drifted into four sizes (`text-[10px]`,
 * `text-[11px]`, `text-sm`, at three paddings), two inactive greys, and two
 * opinions about whether the container has a background. One of them drew the
 * divider by hand on the second button instead of using `first:border-l-0`, so
 * a third option would have had no divider at all.
 *
 * None of them told a screen reader anything: nine rows of `<button>` with no
 * indication of which was on. `aria-pressed` is the one line that fixes that,
 * and it belongs here rather than in nine places.
 */
type Option = {
  value: string
  label: string
  /** A number shown after the label — a count of what the option would show. */
  count?: number | null
  title?: string
}

withDefaults(defineProps<{
  options: Option[]
  /** `sm` for a filter row inside a panel, `md` for a page's tabs. */
  size?: 'sm' | 'md'
  ariaLabel?: string
}>(), { size: 'sm' })

const model = defineModel<string>({ required: true })

const SIZES = {
  sm: 'px-2.5 py-1 text-[11px]',
  md: 'px-3 py-1.5 text-sm',
} as const
</script>

<template>
  <div
    class="segmented"
    role="group"
    :aria-label="ariaLabel"
  >
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="font-medium transition-colors border-l border-zinc-800 first:border-l-0 whitespace-nowrap"
      :class="[
        SIZES[size],
        model === opt.value
          ? 'bg-zinc-800 text-zinc-100'
          : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900',
      ]"
      :aria-pressed="model === opt.value"
      :title="opt.title"
      @click="model = opt.value"
    >
      {{ opt.label }}
      <span v-if="opt.count != null" class="tabular-nums ml-1 opacity-60">{{ opt.count }}</span>
      <slot name="after" :option="opt" />
    </button>
  </div>
</template>
