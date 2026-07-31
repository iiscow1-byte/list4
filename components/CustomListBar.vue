<script setup lang="ts">
/**
 * The strip under the site header on every custom-list page: the list's
 * identity plus its own navigation. Keeps a custom list feeling like its own
 * site while staying inside the surrounding chrome.
 */
const props = defineProps<{
  list: { public_id: string; title: string; owner_username: string | null; is_public: number; likes: number; accepts_records: number; items: any[] }
  canEdit?: boolean
  pendingCount?: number
  liked?: boolean
  compact?: boolean
}>()
const emit = defineEmits<{ (e: 'like'): void }>()

const route = useRoute()
const base = computed(() => `/lists/${props.list.public_id}`)

const tabs = computed(() => [
  { to: base.value, label: 'List', match: (p: string) => p === base.value || /^\/lists\/[^/]+\/\d+$/.test(p) },
  { to: `${base.value}/leaderboard`, label: 'Leaderboard' },
  { to: `${base.value}/packs`, label: 'Packs' },
  ...(props.list.accepts_records ? [{ to: `${base.value}/submit`, label: 'Submit' }] : []),
  ...(props.canEdit ? [{ to: `${base.value}/queue`, label: 'Queue', badge: props.pendingCount }] : []),
  ...(props.canEdit ? [{ to: `${base.value}/settings`, label: 'Settings' }] : []),
])

function isActive(t: { to: string; match?: (p: string) => boolean }) {
  return t.match ? t.match(route.path) : route.path === t.to
}
</script>

<template>
  <div class="border-b border-zinc-800/80 bg-zinc-950/60 shrink-0">
    <div class="px-4 sm:px-6 flex items-center gap-x-4 gap-y-1 flex-wrap py-2">
      <NuxtLink :to="base" class="min-w-0 group">
        <h1 class="text-base font-bold tracking-tight text-zinc-50 truncate group-hover:text-accent transition-colors">
          {{ list.title }}
        </h1>
        <p class="text-[10px] text-zinc-600 truncate">
          <template v-if="list.owner_username">by {{ list.owner_username }} · </template>
          {{ list.items.length }} levels
          <template v-if="!list.is_public"> · <span class="text-amber-400">private</span></template>
        </p>
      </NuxtLink>

      <nav class="flex items-center gap-0.5 ml-auto">
        <NuxtLink
          v-for="t in tabs"
          :key="t.to"
          :to="t.to"
          class="relative px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
          :class="isActive(t) ? 'text-accent bg-accent/10' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900'"
        >
          {{ t.label }}
          <span
            v-if="t.badge"
            class="ml-1 inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-red-500 text-[9px] tabular-nums font-semibold text-white"
          >{{ t.badge }}</span>
        </NuxtLink>
        <button
          type="button"
          class="ml-1 inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors"
          :class="liked ? 'border-accent/60 text-accent bg-accent/10' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'"
          @click="emit('like')"
        >
          <span aria-hidden="true">{{ liked ? '★' : '☆' }}</span>
          <span class="tabular-nums">{{ list.likes }}</span>
        </button>
      </nav>
    </div>
  </div>
</template>
