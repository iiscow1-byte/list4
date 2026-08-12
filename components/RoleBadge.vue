<script setup lang="ts">
import { roleMeta } from '~/utils/role-styles'

/**
 * A role, as one chip.
 *
 * There were seven of these written out by hand — in the leaderboard, the
 * follow lists, the admin user table, both profile headers, the name component
 * and the custom-list roster — at three text sizes and four paddings, so the
 * same badge was a different shape depending on where you met it. `Badge` is
 * the shape; `utils/role-styles.ts` is the colour and the wording.
 *
 * `user` renders nothing. Every call site was already guarding on
 * `role !== 'user'` before drawing one, and a badge that says "User" on a site
 * where everyone is a user is a chip carrying no information. The exception is
 * the admin user table, where the column exists to state each account's role
 * and a blank cell would read as missing data rather than as "no role" — that
 * one passes `always`.
 */
const props = withDefaults(defineProps<{
  role: string | null | undefined
  /** `sm` for dense rows, `md` beside a heading. */
  size?: 'sm' | 'md'
  /** Draw the chip even for a plain user. */
  always?: boolean
}>(), { size: 'md', always: false })

const meta = computed(() => roleMeta(props.role))
const shown = computed(() => props.always || (!!props.role && props.role !== 'user'))
</script>

<template>
  <!-- Dotted, because on a role badge the colour *is* the information: violet
       against amber is admin against owner, and a tint behind 9px text is the
       hardest place to read a colour. -->
  <Badge v-if="shown" :tone="meta.tone" :size="size" :title="meta.title" dot>{{ meta.label }}</Badge>
</template>
