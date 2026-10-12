<script setup lang="ts">
import { SITE_NAV, SUBMIT_NAV, SITE_SOCIALS, navMatches, type NavLink } from '~/utils/site-nav'

/** The navigation on screens narrower than `lg`: the same `SITE_NAV` as the header. */
const props = defineProps<{
  open: boolean
  me: { username: string; role: string; has_avatar?: boolean } | null
  signupsOpen?: boolean
  inboxUnread?: number
  adminPending?: number
  friendRequests?: number
  updatesUnread?: boolean
}>()
const emit = defineEmits<{ (e: 'update:open', open: boolean): void; (e: 'logout'): void }>()

const { t } = useLocale()
const route = useRoute()
const panel = ref<HTMLElement | null>(null)
const close = () => emit('update:open', false)

watch(() => route.fullPath, close)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) close()
}
watch(() => props.open, async (open) => {
  if (typeof document === 'undefined') return
  // Hold the page still behind the drawer.
  document.body.style.overflow = open ? 'hidden' : ''
  if (!open) return
  await nextTick()
  panel.value?.focus()
})
onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  if (typeof document !== 'undefined') document.body.style.overflow = ''
})

type Section = { label: string | null; active: boolean; links: NavLink[] }
const sections = computed<Section[]>(() => {
  const out: Section[] = []
  for (const m of SITE_NAV) {
    if (m.links) {
      out.push({ label: m.label, active: navMatches(route.path, m), links: m.links })
      continue
    }
    // A menu with nothing under it is one link, and a heading over it would
    // only repeat its name. Neighbouring ones share a headless group.
    const link: NavLink = { label: m.label, to: m.to }
    const prev = out[out.length - 1]
    if (prev && prev.label === null) prev.links.push(link)
    else out.push({ label: null, active: false, links: [link] })
  }
  out.push({ label: 'Submit', active: false, links: SUBMIT_NAV })
  return out
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-100"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-50 lg:hidden">
        <div class="absolute inset-0 bg-black/70" @click="close" />
        <div
          ref="panel"
          tabindex="-1"
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
          class="absolute inset-y-0 right-0 w-[min(19rem,86vw)] bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col outline-none"
        >
          <header class="h-14 shrink-0 pl-4 pr-2 flex items-center justify-between border-b border-zinc-800">
            <span class="font-display font-semibold text-zinc-100">{{ t('Menu') }}</span>
            <button
              type="button"
              class="p-2 rounded-md text-zinc-400 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              :aria-label="t('Close')"
              @click="close"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="w-5 h-5" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </header>

          <nav class="flex-1 min-h-0 overflow-y-auto px-2 py-3 space-y-4">
            <div v-if="me" class="space-y-0.5">
              <div class="flex items-center gap-2.5 px-2.5 pb-2">
                <span class="w-8 h-8 rounded-full overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center">
                  <img v-if="me.has_avatar" :src="`/api/users/${encodeURIComponent(me.username)}/avatar`" class="w-full h-full object-cover" alt="" />
                  <span v-else class="text-xs font-semibold uppercase">{{ me.username.charAt(0) }}</span>
                </span>
                <span class="font-medium truncate">{{ me.username }}</span>
              </div>
              <NavMenuItem to="/account">{{ t('Profile') }}</NavMenuItem>
              <NavMenuItem to="/inbox" :badge="inboxUnread || null">{{ t('Inbox') }}</NavMenuItem>
              <NavMenuItem to="/account?panel=friends" :badge="friendRequests || null">{{ t('Friends') }}</NavMenuItem>
              <NavMenuItem v-if="me.role !== 'user'" to="/admin" :badge="adminPending || null">{{ me.role === 'moderator' ? t('Mod') : t('Admin') }}</NavMenuItem>
            </div>
            <div v-else class="flex gap-2 px-2.5">
              <NuxtLink to="/login" class="btn btn-md btn-ghost flex-1">{{ t('Log in') }}</NuxtLink>
              <NuxtLink v-if="signupsOpen" to="/signup" class="btn btn-md btn-primary flex-1">{{ t('Sign up') }}</NuxtLink>
            </div>

            <div v-for="(s, i) in sections" :key="s.label ?? `links-${i}`">
              <p v-if="s.label" class="px-2.5 pb-1 text-xs font-medium" :class="s.active ? 'text-accent' : 'text-zinc-500'">{{ t(s.label) }}</p>
              <NavMenuItem
                v-for="link in s.links"
                :key="link.label"
                :to="link.to"
                :href="link.href"
                :dot="link.flag === 'updates' && updatesUnread"
              >{{ t(link.label) }}</NavMenuItem>
            </div>
          </nav>

          <footer class="shrink-0 border-t border-zinc-800 px-4 py-3 flex items-center gap-4">
            <a
              v-for="s in SITE_SOCIALS"
              :key="s.label"
              :href="s.href"
              target="_blank"
              rel="noopener noreferrer"
              class="text-zinc-500 hover:text-zinc-200"
              :aria-label="s.label"
            ><SocialIcon :name="s.label" class="w-[18px] h-[18px]" /></a>
            <button v-if="me" type="button" class="ml-auto text-sm text-zinc-400 hover:text-red-300" @click="emit('logout')">{{ t('Log out') }}</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
