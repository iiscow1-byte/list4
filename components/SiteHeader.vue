<script setup lang="ts">
const links = [
  { to: '/leaderboard', label: 'Leaderboard' },
]

const route = useRoute()
const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

const listMenuOpen = ref(false)
const listMenuRef = ref<HTMLElement | null>(null)

const listActive = computed(() =>
  route.path.startsWith('/levels') || route.path.startsWith('/awaiting') || route.path.startsWith('/void'),
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
          v-if="me?.role === 'admin' || me?.role === 'moderator'"
          to="/admin"
          class="px-3 py-1.5 rounded text-sm font-medium text-accent/80 hover:text-accent hover:bg-zinc-900 transition-colors"
          active-class="text-accent bg-zinc-900"
        >{{ me.role === 'admin' ? 'Admin' : 'Mod' }}</NuxtLink>

        <span class="w-px h-5 bg-zinc-800 mx-1" />

        <template v-if="me">
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
          class="p-1.5 rounded text-zinc-400 hover:text-[#5865F2] hover:bg-zinc-900 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5" aria-hidden="true">
            <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3.2a.075.075 0 0 0-.079.037c-.34.602-.719 1.388-.984 2.005a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.997-2.005.078.078 0 0 0-.079-.037A19.74 19.74 0 0 0 5.171 4.37a.07.07 0 0 0-.032.027C2.144 8.84 1.32 13.179 1.724 17.46a.083.083 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.029.078.078 0 0 0 .085-.028 14.2 14.2 0 0 0 1.226-1.994.076.076 0 0 0-.041-.105 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.075.075 0 0 1 .078-.01c3.927 1.793 8.18 1.793 12.061 0a.075.075 0 0 1 .079.009c.12.099.245.198.372.292a.077.077 0 0 1-.006.128 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.106c.36.698.772 1.362 1.225 1.993a.077.077 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.029.077.077 0 0 0 .032-.054c.5-4.949-.838-9.252-3.549-13.064a.061.061 0 0 0-.031-.028zM8.02 14.852c-1.182 0-2.156-1.085-2.156-2.418 0-1.333.955-2.419 2.156-2.419 1.21 0 2.175 1.095 2.156 2.419 0 1.333-.955 2.418-2.156 2.418zm7.974 0c-1.182 0-2.156-1.085-2.156-2.418 0-1.333.955-2.419 2.156-2.419 1.21 0 2.175 1.095 2.156 2.419 0 1.333-.946 2.418-2.156 2.418z"/>
          </svg>
        </a>
        <ThemeMenu />
      </nav>
    </div>
  </header>
</template>
