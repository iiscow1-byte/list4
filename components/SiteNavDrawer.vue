<script setup lang="ts">
import { SITE_NAV, navMatches, type NavLink } from '~/utils/site-nav'

/**
 * The site's navigation on a narrow screen.
 *
 * The header had none. Four dropdown triggers, an admin link, an inbox link, an
 * account link and a socials menu sat in one flat `flex` row with no responsive
 * class on any of it — around 550px of controls inside a 343px viewport, which
 * on a phone meant the header ran off the side of the page and took the
 * horizontal scrollbar with it. This is that row, as a drawer.
 *
 * It renders the same `SITE_NAV` the dropdowns do, so the two cannot disagree
 * about what the site contains — which is the failure a second hand-written
 * navigation would guarantee within a release or two.
 */
const props = defineProps<{
  open: boolean
  signedIn: boolean
  /** `moderator` / `admin` / … — the label differs, the link doesn't. */
  role?: string | null
  inboxUnread?: number
  adminPending?: number
  updatesUnread?: boolean
  /** Friend requests waiting on you — badged on the Friends row. */
  friendRequests?: number
}>()

const emit = defineEmits<{ (e: 'update:open', open: boolean): void }>()

// Same `SITE_NAV`, same translation of it — see the note in `SiteHeader`.
const { t } = useLocale()

const route = useRoute()
const panel = ref<HTMLElement | null>(null)

const close = () => emit('update:open', false)

// Any navigation closes it — including a click on the row you are already on,
// which would otherwise leave the drawer sitting over the page it just opened.
watch(() => route.fullPath, close)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) close()
}

/**
 * Hold the page still behind the drawer.
 *
 * Without this the page under the overlay scrolls when you swipe the drawer,
 * and you close it somewhere else entirely from where you opened it.
 */
watch(() => props.open, async (open) => {
  if (typeof document === 'undefined') return
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

/** Rows a signed-out visitor shouldn't be offered. */
const visible = (links: NavLink[]) => links.filter((l) => !l.authOnly || props.signedIn)
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
        <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="close" />

        <div
          ref="panel"
          tabindex="-1"
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
          class="absolute inset-y-0 right-0 w-[min(20rem,88vw)] bg-zinc-950 border-l border-zinc-800 shadow-2xl shadow-black/60 flex flex-col outline-none"
        >
          <header class="h-14 shrink-0 px-3 flex items-center justify-between border-b border-zinc-800/80">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">{{ t('Menu') }}</span>
            <button
              type="button"
              class="p-2 -mr-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              :aria-label="t('Close')"
              @click="close"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="w-5 h-5" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>

          <nav class="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            <template v-for="menu in SITE_NAV" :key="menu.key">
              <!-- The menu's own label is a heading here rather than a trigger:
                   there is nothing to drop down, the rows are already open. -->
              <p
                class="px-2 pt-3 pb-1 text-[9px] uppercase tracking-[0.14em] font-semibold select-none"
                :class="navMatches(route.path, menu) ? 'text-accent' : 'text-zinc-600'"
              >{{ t(menu.label) }}</p>

              <template v-for="group in menu.groups" :key="group.label">
                <p v-if="menu.groups.length > 1" class="px-2 pt-1.5 pb-0.5 text-[9px] uppercase tracking-[0.14em] text-zinc-700 select-none">
                  {{ t(group.label) }}
                </p>
                <NavMenuItem
                  v-for="link in visible(group.links)"
                  :key="link.label"
                  :to="link.to"
                  :href="link.href"
                  :hint="t(link.hint)"
                  :accent="link.accent"
                >
                  <template #icon><NavIcon :name="link.icon" /></template>
                  {{ t(link.label) }}
                  <span
                    v-if="link.flag === 'updates' && updatesUnread"
                    class="ml-1.5 align-middle inline-block w-1.5 h-1.5 rounded-full bg-accent"
                    aria-label="new"
                  />
                </NavMenuItem>
              </template>
            </template>

            <!-- Your own corner of the site, which on a wide screen lives to the
                 right of the divider rather than in any menu. -->
            <template v-if="signedIn">
              <p class="px-2 pt-3 pb-1 text-[9px] uppercase tracking-[0.14em] text-zinc-600 font-semibold select-none">You</p>
              <NavMenuItem to="/account" hint="Your profile and settings">
                <template #icon><NavIcon name="users" /></template>
                {{ t('Account') }}
              </NavMenuItem>
              <NavMenuItem to="/inbox" hint="Messages and notifications" :badge="inboxUnread || null">
                <template #icon><NavIcon name="inbox" /></template>
                {{ t('Inbox') }}
              </NavMenuItem>
              <!-- Friends are a section of your profile rather than a page of
                   the site, so this is a jump to that panel — the drawer's
                   counterpart to the social menu's entry on a wide screen. -->
              <NavMenuItem
                to="/account?panel=friends"
                hint="Your friends, and anyone waiting on you"
                :badge="friendRequests || null"
              >
                <template #icon><NavIcon name="userPlus" /></template>
                {{ t('Friends') }}
              </NavMenuItem>
              <NavMenuItem
                v-if="role && role !== 'user'"
                to="/admin"
                accent
                hint="Reviews, imports and settings"
                :badge="adminPending || null"
              >
                <template #icon><NavIcon name="verify" /></template>
                {{ role === 'moderator' ? 'Moderation' : 'Admin panel' }}
              </NavMenuItem>
            </template>
            <template v-else>
              <p class="px-2 pt-3 pb-1 text-[9px] uppercase tracking-[0.14em] text-zinc-600 font-semibold select-none">You</p>
              <NavMenuItem to="/login" accent hint="Records, lists and your profile">
                <template #icon><NavIcon name="users" /></template>
                {{ t('Log in') }}
              </NavMenuItem>
            </template>
          </nav>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
