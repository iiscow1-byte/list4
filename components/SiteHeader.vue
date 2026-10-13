<script setup lang="ts">
import { SITE_VERSION, visibleUpdates } from '~/utils/site-updates'
import { SITE_NAV, SUBMIT_NAV, SUBMIT_MATCH, navMatches, pathMatches } from '~/utils/site-nav'

const route = useRoute()
const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)
const signupsOpen = computed(() => meRes.value?.site?.signupsEnabled ?? false)
const isStaff = computed(() => !!me.value?.role && me.value.role !== 'user')
const { t } = useLocale()

// Badge counts. One small request per navigation; staff review counts every minute.
const inboxUnread = ref(0)
const friendRequests = ref(0)
async function loadCounts() {
  if (!me.value) { inboxUnread.value = 0; friendRequests.value = 0; return }
  try {
    const res = await $fetch<{ inbox: number; friends: number }>('/api/account/counts')
    inboxUnread.value = res.inbox
    friendRequests.value = res.friends
  } catch { /* badges are a nicety */ }
}
watch(me, loadCounts, { immediate: true })
watch(() => route.path, loadCounts)

const adminPending = ref(0)
async function loadAdminCounts() {
  if (!isStaff.value) { adminPending.value = 0; return }
  try {
    const [live, seen] = await Promise.all([
      $fetch<Record<string, number>>('/api/admin/counts'),
      $fetch<Record<string, number>>('/api/admin/seen-counts'),
    ])
    adminPending.value = Object.entries(live).reduce((sum, [k, n]) => sum + Math.max(0, n - (seen[k] ?? 0)), 0)
  } catch {
    adminPending.value = 0
  }
}
watch(isStaff, loadAdminCounts, { immediate: true })
let adminTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => { adminTimer = setInterval(() => { if (!document.hidden) loadAdminCounts() }, 60_000) })
onBeforeUnmount(() => { if (adminTimer) clearInterval(adminTimer) })

// A dot on About until the visitor has seen the newest site update they can see.
const updatesUnread = ref(false)
const latestVersion = computed(() => visibleUpdates(isStaff.value)[0]?.version ?? SITE_VERSION)
function refreshUpdatesDot() {
  try {
    updatesUnread.value = localStorage.getItem('all:updates-seen') !== latestVersion.value
  } catch { updatesUnread.value = false }
}
onMounted(refreshUpdatesDot)
watch(latestVersion, () => { if (import.meta.client) refreshUpdatesDot() })
watch(() => route.path, (p) => { if (p === '/updates') updatesUnread.value = false })

const submitActive = computed(() => pathMatches(route.path, SUBMIT_MATCH))
const attention = computed(() => inboxUnread.value + friendRequests.value + adminPending.value)

const menuOpen = ref(false)
watch(() => route.fullPath, () => { menuOpen.value = false })

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await refreshNuxtData('auth-me')
  await navigateTo('/login')
}
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
    <div class="container-wide flex h-14 items-center gap-4">
      <NuxtLink
        to="/"
        class="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        aria-label="All Levels List home"
      >
        <AllLogo :size="30" wordmark responsive-wordmark />
      </NuxtLink>

      <nav class="hidden lg:flex items-center gap-0.5 ml-2" aria-label="Main">
        <template v-for="menu in SITE_NAV" :key="menu.key">
          <NavMenu
            v-if="menu.links"
            :label="t(menu.label)"
            :to="menu.to"
            :active="navMatches(route.path, menu)"
            :dot="menu.key === 'about' && updatesUnread"
          >
            <NavMenuItem
              v-for="link in menu.links"
              :key="link.label"
              :to="link.to"
              :href="link.href"
              :icon="link.icon"
              :dot="link.flag === 'updates' && updatesUnread"
            >{{ t(link.label) }}</NavMenuItem>
          </NavMenu>
          <div v-else class="relative">
            <NuxtLink
              :to="menu.to"
              class="block px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              :class="navMatches(route.path, menu) ? 'text-zinc-50' : 'text-zinc-400 hover:text-zinc-100'"
            >{{ t(menu.label) }}</NuxtLink>
            <span
              v-if="navMatches(route.path, menu)"
              class="absolute left-2.5 right-2.5 -bottom-[13px] h-0.5 rounded-full bg-accent"
              aria-hidden="true"
            />
          </div>
        </template>
      </nav>

      <div class="ml-auto flex items-center gap-1">
        <NavMenu :label="t('Submit')" align="right" :active="submitActive" class="hidden lg:flex">
          <NavMenuItem v-for="link in SUBMIT_NAV" :key="link.label" :to="link.to" :icon="link.icon">{{ t(link.label) }}</NavMenuItem>
        </NavMenu>

        <a
          href="https://discord.gg/KfZvUpS3PB"
          target="_blank"
          rel="noopener noreferrer"
          class="hidden sm:inline-flex p-2 rounded-md text-zinc-400 hover:text-[#7289ff] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          title="Discord"
          aria-label="Discord"
        >
          <SocialIcon name="Discord" class="w-[19px] h-[19px]" />
        </a>

        <ThemeMenu />

        <NavMenu v-if="me" align="right" width="min-w-[13rem]" :aria-label="t('Account')" :dot="attention > 0" class="hidden lg:flex">
          <template #trigger>
            <span class="w-6 h-6 rounded-full overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center">
              <img v-if="me.has_avatar" :src="`/api/users/${encodeURIComponent(me.username)}/avatar`" class="w-full h-full object-cover" alt="" />
              <span v-else class="text-[11px] font-semibold text-zinc-200 uppercase">{{ me.username.charAt(0) }}</span>
            </span>
            <span class="max-w-[9rem] truncate">{{ me.username }}</span>
          </template>
          <!-- Who is signed in, above what they can do. -->
          <div class="flex items-center gap-2.5 px-2.5 pt-1.5 pb-2.5 mb-1 border-b border-zinc-800">
            <span class="w-8 h-8 rounded-full overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center">
              <img v-if="me.has_avatar" :src="`/api/users/${encodeURIComponent(me.username)}/avatar`" class="w-full h-full object-cover" alt="" />
              <span v-else class="text-xs font-semibold text-zinc-200 uppercase">{{ me.username.charAt(0) }}</span>
            </span>
            <span class="min-w-0">
              <span class="block truncate text-sm font-semibold text-zinc-50">{{ me.username }}</span>
              <span v-if="me.claimed_player && me.claimed_player.toLowerCase() !== me.username.toLowerCase()" class="block truncate text-xs text-zinc-500">{{ me.claimed_player }}</span>
            </span>
          </div>
          <NavMenuItem to="/account" icon="user">{{ t('Profile') }}</NavMenuItem>
          <NavMenuItem to="/inbox" icon="inbox" :badge="inboxUnread || null">{{ t('Inbox') }}</NavMenuItem>
          <NavMenuItem to="/account?panel=friends" icon="users" :badge="friendRequests || null">{{ t('Friends') }}</NavMenuItem>
          <NavMenuItem v-if="isStaff" to="/admin" icon="admin" :badge="adminPending || null">{{ me.role === 'moderator' ? t('Mod') : t('Admin') }}</NavMenuItem>
          <NavMenuSection />
          <NavMenuItem danger icon="logout" @click="logout">{{ t('Log out') }}</NavMenuItem>
        </NavMenu>
        <template v-else>
          <NuxtLink to="/login" class="hidden lg:inline-flex btn btn-sm btn-ghost">{{ t('Log in') }}</NuxtLink>
          <NuxtLink v-if="signupsOpen" to="/signup" class="hidden lg:inline-flex btn btn-sm btn-primary">{{ t('Sign up') }}</NuxtLink>
        </template>

        <button
          type="button"
          class="lg:hidden relative p-2 -mr-1.5 rounded-md text-zinc-300 hover:text-zinc-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          :aria-expanded="menuOpen"
          :aria-label="t('Open menu')"
          @click="menuOpen = true"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="w-5 h-5" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <span v-if="attention > 0 || updatesUnread" class="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent ring-2 ring-zinc-950" aria-hidden="true" />
        </button>
      </div>
    </div>

    <SiteNavDrawer
      v-model:open="menuOpen"
      :me="me"
      :signups-open="signupsOpen"
      :inbox-unread="inboxUnread"
      :admin-pending="adminPending"
      :friend-requests="friendRequests"
      :updates-unread="updatesUnread"
      @logout="logout"
    />
  </header>
</template>
