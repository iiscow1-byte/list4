<script setup lang="ts">
const links = [
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/global', label: 'Global' },
]

const route = useRoute()
const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

// Inbox unread badge — only fetched when logged in. Refreshes on route change
// so the count drops as soon as the user opens the inbox page.
const inboxUnread = ref(0)
async function loadInboxUnread() {
  if (!me.value) { inboxUnread.value = 0; return }
  try {
    const res = await $fetch<{ unread: number }>('/api/account/inbox')
    inboxUnread.value = res.unread
  } catch {
    inboxUnread.value = 0
  }
}
watch(me, loadInboxUnread, { immediate: true })
watch(() => route.fullPath, loadInboxUnread)

const listMenuOpen = ref(false)
const listMenuRef = ref<HTMLElement | null>(null)

const listActive = computed(() =>
  route.path.startsWith('/levels')
  || route.path.startsWith('/awaiting')
  || route.path.startsWith('/void')
  || route.path.startsWith('/open-verifications'),
)

function onDocClick(e: MouseEvent) {
  if (!listMenuOpen.value) return
  if (listMenuRef.value && !listMenuRef.value.contains(e.target as Node)) {
    listMenuOpen.value = false
  }
}
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') listMenuOpen.value = false
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onEsc)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onEsc)
})

watch(() => route.fullPath, () => { listMenuOpen.value = false })
</script>

<template>
  <header class="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-30">
    <div class="container-tight flex h-14 items-center justify-between gap-4">
      <NuxtLink to="/" class="flex items-center gap-2 group">
        <span class="text-accent text-lg font-bold tracking-tight">ALL</span>
        <span class="text-sm uppercase tracking-widest font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors">Levels List</span>
      </NuxtLink>
      <nav class="flex items-center gap-1">
        <!-- List + dropdown for void / awaiting -->
        <div ref="listMenuRef" class="relative flex items-stretch">
          <NuxtLink
            to="/levels/1"
            class="pl-3 pr-2 py-1.5 rounded-l text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
            :class="{ 'text-zinc-100 bg-zinc-900': listActive }"
          >List</NuxtLink>
          <button
            type="button"
            class="px-1.5 py-1.5 rounded-r text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
            :class="{ 'text-zinc-100 bg-zinc-900': listMenuOpen || listActive }"
            :aria-expanded="listMenuOpen"
            aria-haspopup="menu"
            aria-label="Other lists"
            @click="listMenuOpen = !listMenuOpen"
          >
            <svg
              viewBox="0 0 20 20" fill="currentColor"
              class="w-3.5 h-3.5 transition-transform"
              :class="{ 'rotate-180': listMenuOpen }"
              aria-hidden="true"
            >
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z" clip-rule="evenodd" />
            </svg>
          </button>
          <div
            v-if="listMenuOpen"
            role="menu"
            class="absolute left-0 top-full mt-1 min-w-[12rem] rounded-md border border-zinc-800 bg-zinc-950 shadow-lg shadow-black/40 py-1 z-40"
          >
            <NuxtLink
              to="/awaiting"
              role="menuitem"
              class="block px-3 py-1.5 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
            >Awaiting placement</NuxtLink>
            <NuxtLink
              to="/void/1"
              role="menuitem"
              class="block px-3 py-1.5 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
            >Void list</NuxtLink>
            <NuxtLink
              to="/open-verifications"
              role="menuitem"
              class="block px-3 py-1.5 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
            >Open verifications</NuxtLink>
          </div>
        </div>

        <NuxtLink
          v-for="l in links"
          :key="l.to"
          :to="l.to"
          class="px-3 py-1.5 rounded text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
          active-class="text-zinc-100 bg-zinc-900"
        >
          {{ l.label }}
        </NuxtLink>

        <NuxtLink
          to="/levels/submit"
          class="px-3 py-1.5 rounded text-sm font-medium bg-accent text-zinc-950 hover:bg-accent/90 transition-colors"
          active-class="bg-accent/90"
        >Submit level</NuxtLink>

        <NuxtLink
          v-if="me?.role && me.role !== 'user'"
          to="/admin"
          class="px-3 py-1.5 rounded text-sm font-medium text-accent/80 hover:text-accent hover:bg-zinc-900 transition-colors"
          active-class="text-accent bg-zinc-900"
        >{{ me.role === 'moderator' ? 'Mod' : 'Admin' }}</NuxtLink>

        <span class="w-px h-5 bg-zinc-800 mx-1" />

        <template v-if="me">
          <NuxtLink
            to="/inbox"
            class="relative px-3 py-1.5 rounded text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
            active-class="text-zinc-100 bg-zinc-900"
            aria-label="Inbox"
          >
            Inbox
            <span
              v-if="inboxUnread > 0"
              class="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-accent text-[10px] tabular-nums font-semibold text-zinc-950"
            >{{ inboxUnread > 99 ? '99+' : inboxUnread }}</span>
          </NuxtLink>
          <NuxtLink
            to="/account"
            class="px-3 py-1.5 rounded text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 transition-colors flex items-center gap-2"
            active-class="text-zinc-100 bg-zinc-900"
          >
            <span
              v-if="me.has_avatar"
              class="w-5 h-5 rounded-full overflow-hidden bg-zinc-800"
            >
              <img :src="`/api/users/${encodeURIComponent(me.username)}/avatar`" class="w-full h-full object-cover" alt="" />
            </span>
            <span>{{ me.username }}</span>
          </NuxtLink>
        </template>
        <template v-else>
          <NuxtLink to="/login" class="px-3 py-1.5 rounded text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors">Log in</NuxtLink>
          <NuxtLink to="/signup" class="px-3 py-1.5 rounded text-sm font-medium text-accent hover:bg-zinc-900 transition-colors">Sign up</NuxtLink>
        </template>

        <span class="w-px h-5 bg-zinc-800 mx-1" />
        <a
          href="https://discord.gg/KfZvUpS3PB"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Discord"
          class="inline-flex items-center justify-center p-1.5 rounded text-zinc-400 hover:text-[#5865F2] hover:bg-zinc-900 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 127.14 96.36" fill="currentColor" class="w-5 h-5 block" aria-hidden="true">
            <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"/>
          </svg>
        </a>
        <ThemeMenu />
      </nav>
    </div>
  </header>
</template>
