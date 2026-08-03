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
    description?: string | null
    owner_username: string | null
    is_public: number
    likes: number
    accepts_records: number
    accepts_submissions?: number
    icon_url?: string | null
    accent_color?: string | null
    discord_url?: string | null
    youtube_url?: string | null
    items: any[]
    packs?: any[]
  }
  canEdit?: boolean
  pendingCount?: number
  suggestionCount?: number
  liked?: boolean
}>()
const emit = defineEmits<{ (e: 'like'): void }>()

const route = useRoute()
const base = computed(() => `/lists/${props.list.public_id}`)
// Standalone: this bar is the page's header rather than a strip under one, so
// it carries the identity at full size and offers the one link out.
const { standalone, to } = useStandaloneList()

/** The list route is the base path and any `/lists/:id/<number>` under it. */
const onListTab = computed(
  () => route.path === base.value || /^\/lists\/[^/]+\/\d+$/.test(route.path),
)

/** Levels on this list that aren't linked to an ALL level. */
const unlinkedCount = computed(
  () => (props.list.items ?? []).filter((i: any) => i.level_id == null).length,
)

const tabs = computed(() => [
  { to: base.value, label: 'List', active: onListTab.value },
  { to: `${base.value}/leaderboard`, label: 'Leaderboard' },
  ...(props.list.packs?.length ? [{ to: `${base.value}/packs`, label: 'Packs' }] : []),
  { to: `${base.value}/changelog`, label: 'Changelog' },
  ...(props.list.accepts_submissions || props.canEdit
    ? [{ to: `${base.value}/suggest`, label: 'Suggest', badge: props.suggestionCount }]
    : []),
  ...(props.list.accepts_records ? [{ to: `${base.value}/submit`, label: 'Submit' }] : []),
  // Only worth showing when there's actually something the ALL doesn't have.
  ...(props.canEdit && unlinkedCount.value > 0
    ? [{ to: `${base.value}/to-all`, label: 'To the ALL', badge: unlinkedCount.value }]
    : []),
  ...(props.canEdit ? [{ to: `${base.value}/queue`, label: 'Queue', badge: props.pendingCount }] : []),
  ...(props.canEdit ? [{ to: `${base.value}/settings`, label: 'Settings' }] : []),
])

/**
 * Fullscreen just the list, not the browser tab.
 *
 * The target is the list's own root (`[data-list-root]`), so everything
 * outside it — the site header above all — is excluded by the Fullscreen API
 * itself rather than by hiding things one at a time. The list's own bar stays,
 * since you still need its tabs while reading.
 */
const barRoot = ref<HTMLElement | null>(null)
const isFullscreen = ref(false)

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
}
onMounted(() => document.addEventListener('fullscreenchange', onFullscreenChange))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', onFullscreenChange))

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }
    const target = barRoot.value?.closest('[data-list-root]') as HTMLElement | null
    await (target ?? document.documentElement).requestFullscreen()
  } catch { /* denied or unsupported — the button just does nothing */ }
}

function isActive(t: { to: string; active?: boolean }) {
  return t.active ?? route.path === t.to
}

const levelCount = computed(() => props.list.items?.length ?? 0)
</script>

<template>
  <div
    ref="barRoot"
    class="border-b bg-zinc-950/70 backdrop-blur-sm shrink-0"
    :class="standalone ? 'border-zinc-800' : 'border-zinc-800/80'"
  >
    <div
      class="px-4 sm:px-6 flex items-center gap-x-4 gap-y-2 flex-wrap"
      :class="standalone ? 'py-3.5' : 'py-2.5'"
    >
      <!-- Identity -->
      <NuxtLink :to="to(base)" class="min-w-0 flex items-center gap-2.5 group shrink-0">
        <img
          v-if="list.icon_url"
          :src="list.icon_url"
          alt=""
          class="rounded-lg object-cover border border-zinc-800 shrink-0 bg-zinc-900"
          :class="standalone ? 'w-10 h-10' : 'w-8 h-8'"
          referrerpolicy="no-referrer"
        />
        <span
          v-else
          class="rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center font-black shrink-0"
          :class="[standalone ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-[11px]', list.accent_color ? '' : 'text-accent']"
          :style="list.accent_color ? { color: list.accent_color } : undefined"
          aria-hidden="true"
        >{{ list.title.slice(0, 2).toUpperCase() }}</span>
        <span class="min-w-0">
          <component
            :is="standalone ? 'h1' : 'span'"
            class="block font-bold tracking-tight text-zinc-50 truncate group-hover:text-accent transition-colors"
            :class="standalone ? 'text-base sm:text-lg' : 'text-sm'"
          >{{ list.title }}</component>
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
          :to="to(t.to)"
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

        <!-- Standalone mode hides the site's own header, so this is the only
             way back to the rest of the site. It drops the flag deliberately:
             following it means leaving the list, not viewing the ALL inside it. -->
        <NuxtLink
          v-if="standalone"
          to="/"
          class="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:border-accent/60 hover:text-accent transition-colors"
          title="Open the All Levels List"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5" aria-hidden="true">
            <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
          <span class="hidden sm:inline">All Levels List</span>
          <span class="sm:hidden">ALL</span>
        </NuxtLink>

        <!-- The list's own community links -->
        <a
          v-if="list.discord_url"
          :href="list.discord_url"
          target="_blank"
          rel="noopener noreferrer"
          class="shrink-0 p-1.5 rounded-lg text-zinc-500 hover:text-[#5865F2] hover:bg-zinc-900 transition-colors"
          aria-label="Discord"
          title="Discord"
        >
          <svg viewBox="0 0 127.14 96.36" fill="currentColor" class="w-4 h-4" aria-hidden="true">
            <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"/>
          </svg>
        </a>
        <a
          v-if="list.youtube_url"
          :href="list.youtube_url"
          target="_blank"
          rel="noopener noreferrer"
          class="shrink-0 p-1.5 rounded-lg text-zinc-500 hover:text-red-500 hover:bg-zinc-900 transition-colors"
          aria-label="YouTube"
          title="YouTube"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4" aria-hidden="true">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
          </svg>
        </a>

        <button
          type="button"
          class="shrink-0 p-1.5 rounded-lg text-zinc-500 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
          :aria-pressed="isFullscreen"
          :aria-label="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
          :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
          @click="toggleFullscreen"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4" aria-hidden="true">
            <path v-if="!isFullscreen" d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" />
            <path v-else d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3m8 0v-3a2 2 0 0 1 2-2h3" />
          </svg>
        </button>

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
