<script setup lang="ts">
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

// Credits dialog, opened from the socials menu.
const creditsOpen = ref(false)
watch(() => route.fullPath, () => { creditsOpen.value = false })

const startsWith = (...prefixes: string[]) =>
  prefixes.some((p) => route.path === p || route.path.startsWith(`${p}/`))

const buildActive = computed(() => startsWith('/builder', '/lists'))
const listActive = computed(() => startsWith('/levels', '/awaiting', '/void', '/open-verifications'))
const communityActive = computed(() => startsWith('/community', '/leaderboard', '/changelog', '/users', '/about'))
const submitActive = computed(() => startsWith('/records', '/opinions') || route.path === '/levels/submit')
</script>

<template>
  <header class="border-b border-zinc-800/80 bg-zinc-950/75 backdrop-blur-md sticky top-0 z-30">
    <div class="container-wide flex h-14 items-center justify-between gap-3">
      <NuxtLink to="/" class="flex items-center gap-2 group shrink-0">
        <span class="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accent text-zinc-950 text-xs font-black tracking-tight">ALL</span>
        <span class="hidden lg:inline text-sm uppercase tracking-widest font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors">Levels List</span>
      </NuxtLink>

      <nav class="flex items-center gap-1">
        <!-- Build your own list — the first menu -->
        <NavMenu label="Build" to="/builder" :active="buildActive">
          <NavMenuItem to="/builder" accent hint="Drag levels in and rank them yourself">Build your own list</NavMenuItem>
          <NavMenuItem to="/lists" hint="Lists shared by the community">Public lists</NavMenuItem>
        </NavMenu>

        <!-- The list -->
        <NavMenu label="List" to="/levels/1" :active="listActive">
          <NavMenuItem to="/levels/1" hint="Every ranked level">Main list</NavMenuItem>
          <NavMenuItem to="/awaiting" hint="Approved, not yet placed">Awaiting placement</NavMenuItem>
          <NavMenuItem to="/void" hint="No difficulty opinion yet">Void list</NavMenuItem>
          <NavMenuItem to="/open-verifications" hint="Unverified levels looking for a verifier">Open verifications</NavMenuItem>
        </NavMenu>

        <!-- Community -->
        <NavMenu label="Community" to="/community" :active="communityActive">
          <NavMenuItem to="/community" hint="Activity from people you follow">Community hub</NavMenuItem>
          <NavMenuItem to="/leaderboard" hint="Ranked players">Leaderboard</NavMenuItem>
          <NavMenuItem to="/changelog" hint="Placements and movements">Changelog</NavMenuItem>
          <NavMenuItem to="/about" hint="How the list works, and stats">About &amp; stats</NavMenuItem>
        </NavMenu>

        <!-- Submit -->
        <NavMenu label="Submit" :active="submitActive">
          <NavMenuItem to="/levels/find" accent hint="Search Geometry Dash and submit from results">Find a level</NavMenuItem>
          <NavMenuItem to="/levels/submit" hint="Add a level to the list">Submit a level</NavMenuItem>
          <NavMenuItem to="/records/submit" hint="Claim a completion">Submit a record</NavMenuItem>
          <NavMenuItem to="/opinions/submit" hint="Rate difficulty and enjoyment">Submit an opinion</NavMenuItem>
        </NavMenu>

        <NuxtLink
          v-if="me?.role && me.role !== 'user'"
          to="/admin"
          class="relative px-3 py-1.5 rounded-lg text-sm font-medium text-accent/80 hover:text-accent hover:bg-zinc-900 transition-colors"
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
            class="relative px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
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
            class="px-2 py-1.5 rounded-lg text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 transition-colors flex items-center gap-2"
            active-class="text-zinc-100 bg-zinc-900"
          >
            <span class="w-5 h-5 rounded-full overflow-hidden bg-zinc-700 shrink-0 flex items-center justify-center">
              <img v-if="me.has_avatar" :src="`/api/users/${encodeURIComponent(me.username)}/avatar`" class="w-full h-full object-cover" alt="" />
              <span v-else class="text-[10px] font-semibold text-zinc-200 leading-none uppercase">{{ me.username.charAt(0) }}</span>
            </span>
            <span class="hidden sm:inline">{{ me.username }}</span>
          </NuxtLink>
        </template>
        <template v-else>
          <NuxtLink to="/login" class="px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors">Log in</NuxtLink>
          <NuxtLink to="/signup" class="px-3 py-1.5 rounded-lg text-sm font-semibold bg-accent text-zinc-950 hover:bg-accent/90 transition-colors">Sign up</NuxtLink>
        </template>

        <!-- Socials, collapsed into one menu instead of four loose icons -->
        <NavMenu icon-only aria-label="Social links" align="right" width="min-w-[11rem]">
          <template #trigger>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-[18px] h-[18px]" aria-hidden="true">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <path d="m8.59 13.51 6.83 3.98M15.41 6.51 8.59 10.49" />
            </svg>
          </template>
          <NavMenuItem href="https://discord.gg/KfZvUpS3PB">
            <template #icon>
              <svg viewBox="0 0 127.14 96.36" fill="currentColor" class="w-4 h-4 shrink-0 text-[#5865F2]" aria-hidden="true">
                <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"/>
              </svg>
            </template>
            Discord
          </NavMenuItem>
          <NavMenuItem href="https://www.youtube.com/@AllLevelsList">
            <template #icon>
              <svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4 shrink-0 text-red-500" aria-hidden="true">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
            </template>
            YouTube
          </NavMenuItem>
          <NavMenuItem href="https://x.com/alllevelslist">
            <template #icon>
              <svg viewBox="0 0 24 24" fill="currentColor" class="w-3.5 h-3.5 shrink-0 text-zinc-200" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.259 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
              </svg>
            </template>
            Twitter / X
          </NavMenuItem>
          <NavMenuItem href="https://tiktok.com/@alllevelslist">
            <template #icon>
              <svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4 shrink-0 text-zinc-200" aria-hidden="true">
                <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.21 8.21 0 0 0 4.81 1.54V6.79a4.85 4.85 0 0 1-1.04-.1z"/>
              </svg>
            </template>
            TikTok
          </NavMenuItem>

          <div class="my-1 border-t border-zinc-800" />
          <button
            type="button"
            role="menuitem"
            class="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-left text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
            @click="creditsOpen = true"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 shrink-0 text-accent" aria-hidden="true">
              <path d="M12 21s-7-4.35-9-8.5A5 5 0 0 1 12 6a5 5 0 0 1 9 6.5C19 16.65 12 21 12 21z" />
            </svg>
            Credits
          </button>
        </NavMenu>

        <!-- Credits -->
        <Teleport to="body">
          <div
            v-if="creditsOpen"
            class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            @click.self="creditsOpen = false"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="credits-title"
              class="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl p-5"
            >
              <button
                type="button"
                class="absolute top-3 right-3 rounded-lg p-1 text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                aria-label="Close"
                @click="creditsOpen = false"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>

              <h2 id="credits-title" class="text-[10px] uppercase tracking-widest text-accent font-semibold">Credits</h2>

              <dl class="mt-3 space-y-3 text-sm">
                <div>
                  <dt class="text-[10px] uppercase tracking-wider text-zinc-500">Website</dt>
                  <dd class="text-zinc-200">GERG, cinnamings, Silk, Farm</dd>
                </div>
                <div>
                  <dt class="text-[10px] uppercase tracking-wider text-zinc-500">ALL data</dt>
                  <dd class="text-zinc-200">Cinder</dd>
                </div>
              </dl>

              <p class="mt-4 text-[11px] text-zinc-600 leading-relaxed">
                Thanks to everyone who submits records, levels and opinions to keep the list current.
              </p>
            </div>
          </div>
        </Teleport>

        <ThemeMenu />
      </nav>
    </div>
  </header>
</template>
