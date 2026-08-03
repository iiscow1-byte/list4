<script setup lang="ts">
/**
 * Who runs this list.
 *
 * Every list site of this shape prints its staff somewhere — it is how a reader
 * knows whose opinion the ordering is, and who to talk to about a record. Ours
 * knew the roster all along and only ever showed it on the settings page, which
 * is the one page nobody but the staff can open.
 *
 * Owner first, then editors alphabetically; the server settles that order so
 * the popover in the bar and the panel on the page can't disagree.
 */
export type ListStaff = {
  id: number
  username: string
  role: 'owner' | 'editor'
  has_avatar: boolean
}

const props = withDefaults(defineProps<{
  staff: ListStaff[]
  /** `panel` for the page block, `compact` for the header popover. */
  variant?: 'panel' | 'compact'
}>(), { variant: 'panel' })

const ROLE_LABEL: Record<ListStaff['role'], string> = {
  owner: 'Owner',
  editor: 'Editor',
}
const ROLE_TONE: Record<ListStaff['role'], string> = {
  owner: 'border-accent/40 bg-accent/10 text-accent',
  editor: 'border-zinc-800 bg-zinc-900 text-zinc-400',
}

const compact = computed(() => props.variant === 'compact')
</script>

<template>
  <div v-if="staff.length">
    <h3
      v-if="!compact"
      class="text-[10px] uppercase tracking-widest text-accent font-semibold mb-2"
    >List editors</h3>

    <ul :class="compact ? 'divide-y divide-zinc-900/70' : 'grid gap-px bg-zinc-800 rounded-xl overflow-hidden border border-zinc-800'">
      <li v-for="p in staff" :key="p.id" :class="compact ? '' : 'bg-zinc-950'">
        <NuxtLink
          :to="`/users/${encodeURIComponent(p.username)}`"
          class="flex items-center gap-2.5 px-3 py-2 group hover:bg-zinc-900/60 transition-colors"
        >
          <span class="w-7 h-7 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/50 shrink-0 flex items-center justify-center">
            <img
              v-if="p.has_avatar"
              :src="`/api/users/${encodeURIComponent(p.username)}/avatar`"
              class="w-full h-full object-cover"
              alt=""
              loading="lazy"
            />
            <span v-else class="text-[10px] font-bold uppercase text-zinc-500">{{ p.username.charAt(0) }}</span>
          </span>
          <span class="min-w-0 flex-1 truncate text-sm text-zinc-200 group-hover:text-accent transition-colors">
            {{ p.username }}
          </span>
          <span
            class="shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border"
            :class="ROLE_TONE[p.role]"
          >{{ ROLE_LABEL[p.role] }}</span>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
