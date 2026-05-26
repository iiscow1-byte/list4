<script setup lang="ts">
const links = [
  { to: '/leaderboard', label: 'Leaderboard' },
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

// Admin/mod pending count badge — shown on the Admin/Mod nav link.
// Shows the number of pending items that haven't been acknowledged yet
// (live count minus the last-seen baseline stored per user).
const adminPendingCount = ref(0)
async function loadAdminCounts() {
  const role = me.value?.role
  if (!role || role === 'user') { adminPendingCount.value = 0; return }
  try {
    const [live, seen] = await Promise.all([
      $fetch<Record<string, number>>('/api/admin/counts'),
      $fetch<Record<string, number>>('/api/admin/seen-counts'),
    ])
    let total = 0
    for (const [k, n] of Object.entries(live)) total += Math.max(0, n - (seen[k] ?? 0))
    adminPendingCount.value = total
  } catch {
    adminPendingCount.value = 0
  }
}
watch(me, loadAdminCounts, { immediate: true })
let adminCountTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => { adminCountTimer = setInterval(loadAdminCounts, 30_000) })
onBeforeUnmount(() => { if (adminCountTimer) clearInterval(adminCountTimer) })

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
      <NuxtLink to="/" class="flex items-center gap-2 group shrink-0">
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
          to="/records/submit"
          class="px-3 py-1.5 rounded text-sm font-medium whitespace-nowrap bg-zinc-800 text-zinc-200 hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
          active-class="bg-zinc-700 text-zinc-100"
        >Submit Record</NuxtLink>
        <NuxtLink
          to="/levels/submit"
          class="px-3 py-1.5 rounded text-sm font-medium whitespace-nowrap bg-zinc-800 text-zinc-200 hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
          active-class="bg-zinc-700 text-zinc-100"
        >Submit Level</NuxtLink>

        <NuxtLink
          v-if="me?.role && me.role !== 'user'"
          to="/admin"
          class="relative px-3 py-1.5 rounded text-sm font-medium text-accent/80 hover:text-accent hover:bg-zinc-900 transition-colors"
          active-class="text-accent bg-zinc-900"
        >
          {{ me.role === 'moderator' ? 'Mod' : 'Admin' }}
          <span
            v-if="adminPendingCount > 0"
            class="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-500 text-[10px] tabular-nums font-semibold text-white"
          >{{ adminPendingCount > 99 ? '99+' : adminPendingCount }}</span>
        </NuxtLink>

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
            <span class="w-5 h-5 rounded-full overflow-hidden bg-zinc-700 shrink-0 flex items-center justify-center">
              <img v-if="me.has_avatar" :src="`/api/users/${encodeURIComponent(me.username)}/avatar`" class="w-full h-full object-cover" alt="" />
              <span v-else class="text-[10px] font-semibold text-zinc-200 leading-none uppercase">{{ me.username.charAt(0) }}</span>
            </span>
            <span>{{ me.username }}</span>
          </NuxtLink>
        </template>
        <template v-else>
          <NuxtLink to="/login" class="px-3 py-1.5 rounded text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors">Log in</NuxtLink>
          <NuxtLink to="/signup" class="px-3 py-1.5 rounded text-sm font-medium text-accent hover:bg-zinc-900 transition-colors">Sign up</NuxtLink>
        </template>
        <ThemeMenu />
      </nav>
    </div>
  </header>
</template>
