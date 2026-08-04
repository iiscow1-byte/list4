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
 * the popover in the bar and the panel on the page can't disagree. One shape
 * for both, for the same reason: they are the same list of people, and the two
 * variants this used to have differed only in padding.
 */
export type ListStaff = {
  id: number
  username: string
  role: 'owner' | 'editor'
  has_avatar: boolean
}

defineProps<{ staff: ListStaff[] }>()

const ROLE_LABEL: Record<ListStaff['role'], string> = {
  owner: 'Owner',
  editor: 'Editor',
}
const ROLE_TONE: Record<ListStaff['role'], string> = {
  owner: 'border-accent/40 bg-accent/10 text-accent',
  editor: 'border-zinc-800 bg-zinc-900 text-zinc-400',
}
</script>

<template>
  <ul v-if="staff.length" class="p-1.5 space-y-0.5">
    <li v-for="p in staff" :key="p.id">
      <NuxtLink
        :to="`/users/${encodeURIComponent(p.username)}`"
        class="flex items-center gap-2.5 px-2 py-1.5 rounded-lg group hover:bg-zinc-900 transition-colors"
        :title="`${p.username} — ${ROLE_LABEL[p.role].toLowerCase()} of this list`"
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
          class="shrink-0 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border leading-none"
          :class="ROLE_TONE[p.role]"
        >{{ ROLE_LABEL[p.role] }}</span>
      </NuxtLink>
    </li>
  </ul>
</template>
