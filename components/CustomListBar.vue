<script setup lang="ts">
/**
 * The strip under the site header on every custom-list page: the list's
 * identity plus its own navigation. Keeps a custom list feeling like its own
 * site while staying inside the surrounding chrome.
 */
const props = defineProps<{
  list: {
    public_id: string
    title: string
    owner_username: string | null
    is_public: number
    likes: number
    accepts_records: number
    items: any[]
    packs?: any[]
  }
  canEdit?: boolean
  pendingCount?: number
  liked?: boolean
}>()
const emit = defineEmits<{ (e: 'like'): void }>()

const route = useRoute()
const base = computed(() => `/lists/${props.list.public_id}`)

/** The list route is the base path and any `/lists/:id/<number>` under it. */
const onListTab = computed(
  () => route.path === base.value || /^\/lists\/[^/]+\/\d+$/.test(route.path),
)

const tabs = computed(() => [
  { to: base.value, label: 'List', active: onListTab.value },
  { to: `${base.value}/leaderboard`, label: 'Leaderboard' },
  ...(props.list.packs?.length ? [{ to: `${base.value}/packs`, label: 'Packs' }] : []),
  ...(props.list.accepts_records ? [{ to: `${base.value}/submit`, label: 'Submit' }] : []),
  ...(props.canEdit ? [{ to: `${base.value}/queue`, label: 'Queue', badge: props.pendingCount }] : []),
  ...(props.canEdit ? [{ to: `${base.value}/settings`, label: 'Settings' }] : []),
])

function isActive(t: { to: string; active?: boolean }) {
  return t.active ?? route.path === t.to
}

const levelCount = computed(() => props.list.items?.length ?? 0)
</script>

<template>
  <div class="border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-sm shrink-0">
    <div class="px-4 sm:px-6 py-2.5 flex items-center gap-x-4 gap-y-2 flex-wrap">
      <!-- Identity -->
      <NuxtLink :to="base" class="min-w-0 flex items-center gap-2.5 group shrink-0">
        <span
          class="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[11px] font-black text-accent shrink-0"
          aria-hidden="true"
        >{{ list.title.slice(0, 2).toUpperCase() }}</span>
        <span class="min-w-0">
          <span class="block text-sm font-bold tracking-tight text-zinc-50 truncate group-hover:text-accent transition-colors">
            {{ list.title }}
          </span>
          <span class="block text-[10px] text-zinc-600 truncate">
            <template v-if="list.owner_username">by {{ list.owner_username }} · </template>
            <span class="tabular-nums">{{ levelCount }}</span> level{{ levelCount === 1 ? '' : 's' }}
            <template v-if="!list.is_public"> · <span class="text-amber-400">private</span></template>
          </span>
        </span>
      </NuxtLink>

      <!-- Tabs -->
      <nav class="flex items-center gap-0.5 ml-auto overflow-x-auto">
        <NuxtLink
          v-for="t in tabs"
          :key="t.to"
          :to="t.to"
          class="relative whitespace-nowrap px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
          :class="isActive(t)
            ? 'text-accent bg-accent/10 ring-1 ring-inset ring-accent/25'
            : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900'"
        >
          {{ t.label }}
          <span
            v-if="t.badge"
            class="ml-1 inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-red-500 text-[9px] tabular-nums font-semibold text-white align-middle"
          >{{ t.badge }}</span>
        </NuxtLink>

        <span class="w-px h-5 bg-zinc-800 mx-1.5 shrink-0" />

        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors shrink-0"
          :class="liked
            ? 'border-accent/50 text-accent bg-accent/10'
            : 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'"
          :aria-pressed="!!liked"
          aria-label="Like this list"
          @click="emit('like')"
        >
          <span aria-hidden="true">{{ liked ? '★' : '☆' }}</span>
          <span class="tabular-nums">{{ list.likes }}</span>
        </button>
      </nav>
    </div>
  </div>
</template>
