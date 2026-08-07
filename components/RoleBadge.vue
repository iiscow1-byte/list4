<script setup lang="ts">
import { roleMeta, type AnyRole } from '~/utils/role-styles'

/**
 * A role, as one chip.
 *
 * There were seven of these written out by hand — in the leaderboard, the
 * follow lists, the admin user table, both profile headers, the name component
 * and the custom-list roster — at three text sizes and four paddings, so the
 * same badge was a different shape depending on where you met it. This is the
 * shape; `utils/role-styles.ts` is the colour and the wording.
 *
 * `user` renders nothing. Every call site was already guarding on
 * `role !== 'user'` before drawing one, and a badge that says "User" on a site
 * where everyone is a user is a chip carrying no information.
 */
const props = withDefaults(defineProps<{
  role: string | null | undefined
  /** `sm` for dense rows, `md` beside a heading. */
  size?: 'sm' | 'md'
}>(), { size: 'md' })

const meta = computed(() => roleMeta(props.role))
const shown = computed(() => !!props.role && props.role !== 'user')
</script>

<template>
  <span
    v-if="shown"
    class="shrink-0 inline-flex items-center rounded uppercase tracking-widest font-medium leading-none whitespace-nowrap"
    :class="[
      meta.tone,
      size === 'sm' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-1',
    ]"
    :title="meta.title"
  >{{ meta.label }}</span>
</template>
