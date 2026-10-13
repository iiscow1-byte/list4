<script setup lang="ts">
import { ADMIN_GROUPS, ADMIN_SECTIONS, adminSection, sectionsFor, type AdminTabId } from '~/utils/admin-sections'
import type { AdminNavGroup } from '~/components/AdminNav.vue'

/**
 * The admin panel: a sidebar of sections, and the open section beside it.
 *
 * What each section is called, who can open it and which group it sits in all
 * live in `utils/admin-sections.ts`. This page only decides which one is open,
 * keeps the counts fresh, and hosts the panel-wide toasts and dialog.
 *
 * Every section is its own component. This file used to be two thousand lines
 * holding five of them inline, which is why each drew its headings, buttons
 * and notices differently.
 */
definePageMeta({ middleware: 'mod', layout: 'level' })
useHead({ title: 'Admin — All Levels List' })

const route = useRoute()
const router = useRouter()
const { data: meRes } = useCurrentUser()
const role = computed(() => meRes.value?.account?.role ?? null)
const isAdmin = computed(() => role.value === 'admin' || role.value === 'owner' || role.value === 'developer')
const sections = computed(() => sectionsFor(role.value))

const requested = typeof route.query.tab === 'string' && ADMIN_SECTIONS.some((s) => s.id === route.query.tab)
  ? (route.query.tab as AdminTabId)
  : 'overview'
const tab = ref<AdminTabId>(requested)

/**
 * Keep the open section to one this account can see.
 *
 * `?tab=accounts` is typeable, and the role arrives asynchronously, so a check
 * done once at setup would let a helper sit on a section that is about to
 * disappear from the sidebar. Not a security boundary: every endpoint checks
 * the role itself.
 */
watch(sections, (list) => {
  if (list.length && !list.some((s) => s.id === tab.value)) tab.value = 'overview'
}, { immediate: true })

// ---------------------------------------------------------------- counts
/**
 * How many are waiting in each queue (`live`), and how many there were when
 * this account last opened it (`seen`). The difference is what is new, and is
 * what turns a count red.
 */
type Counts = Record<string, number>
const live = ref<Counts | null>(null)
const seen = reactive<Counts>({})

async function fetchCounts() {
  try {
    const res = await $fetch<Counts>('/api/admin/counts')
    live.value = res
    const lowered: Counts = {}
    for (const [k, v] of Object.entries(res)) {
      // Seed sections with nothing stored yet (a section added since).
      if (!(k in seen)) seen[k] = v
      // A queue that shrank was worked through, here or by someone else. Without
      // lowering the mark, the next arrivals only refill it and never show as new.
      else if (v < seen[k]!) { seen[k] = v; lowered[k] = v }
    }
    if (Object.keys(lowered).length) {
      $fetch('/api/admin/mark-seen', { method: 'POST', body: { counts: lowered } }).catch(() => {})
    }
  } catch { /* non-fatal */ }
}

function fresh(id: string): number {
  if (!live.value) return 0
  const n = live.value[id] ?? 0
  return Math.max(0, n - (seen[id] ?? n))
}

function markSeen(id: string) {
  if (!live.value || !(id in live.value)) return
  const n = live.value[id]!
  if (seen[id] === n) return
  seen[id] = n
  $fetch('/api/admin/mark-seen', { method: 'POST', body: { counts: { [id]: n } } }).catch(() => {})
}

let countTimer: ReturnType<typeof setInterval> | null = null
onMounted(async () => {
  // Seen counts first, so the first live fetch isn't taken as "all seen".
  try {
    const res = await $fetch<Counts>('/api/admin/seen-counts')
    for (const [k, v] of Object.entries(res)) seen[k] = v
  } catch { /* non-fatal */ }
  fetchCounts()
  countTimer = setInterval(fetchCounts, 30_000)
})
onBeforeUnmount(() => { if (countTimer) clearInterval(countTimer) })

const navGroups = computed<AdminNavGroup[]>(() =>
  ADMIN_GROUPS
    .map((g) => ({
      key: g.key,
      label: g.label,
      items: g.ids
        .map((id) => sections.value.find((s) => s.id === id))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => ({
          id: s.id,
          label: s.label,
          icon: s.icon,
          count: s.queue ? (live.value?.[s.id] ?? 0) : null,
          fresh: s.queue ? fresh(s.id) : 0,
        })),
    }))
    .filter((g) => g.items.length > 0),
)

const queues = computed(() =>
  sections.value
    .filter((s) => s.queue)
    .map((s) => ({ ...s, count: live.value?.[s.id] ?? 0, fresh: fresh(s.id) })),
)
const anyFresh = computed(() => queues.value.some((q) => q.fresh > 0))

// ---------------------------------------------------------------- navigation
const drawerOpen = ref(false)

watch(tab, (t) => {
  router.replace({ query: { ...route.query, tab: t === 'overview' ? undefined : t } })
  markSeen(t)
  drawerOpen.value = false
})

function open(id: string) {
  if (sections.value.some((s) => s.id === id)) tab.value = id as AdminTabId
}

/** The sidebar's width, remembered. The review queues want the room. */
const collapseCookie = useCookie<string | null>('als_admin_nav', {
  maxAge: 60 * 60 * 24 * 365,
  sameSite: 'lax',
  path: '/',
  decode: (v: string) => v,
  encode: (v: string) => v,
})
const collapsed = computed(() => collapseCookie.value === 'mini')
function toggleCollapsed() {
  collapseCookie.value = collapsed.value ? null : 'mini'
}

const current = computed(() => adminSection(tab.value))

function onDrawerKey(e: KeyboardEvent) {
  if (e.key === 'Escape') drawerOpen.value = false
}
onMounted(() => window.addEventListener('keydown', onDrawerKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onDrawerKey))
</script>

<template>
  <div class="h-full flex flex-col lg:flex-row min-h-0">
    <!-- Phones and tablets: the section you are in, and a button for the rest. -->
    <div class="lg:hidden shrink-0 flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-950">
      <button
        type="button"
        class="relative btn btn-sm btn-ghost"
        :aria-expanded="drawerOpen"
        @click="drawerOpen = true"
      >
        <NavIcon name="menu" class="w-4 h-4" />
        <span>{{ current?.label ?? 'Admin' }}</span>
        <span v-if="anyFresh" class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-zinc-950" aria-label="Something new is waiting" />
      </button>
    </div>

    <!-- Wide screens: the sidebar. -->
    <aside
      class="hidden lg:flex flex-col shrink-0 border-r border-zinc-800 bg-zinc-950 transition-[width] duration-150"
      :class="collapsed ? 'w-14' : 'w-60'"
    >
      <div v-if="!collapsed" class="shrink-0 px-5 pt-4 pb-1">
        <p class="font-display font-semibold text-zinc-50">Admin</p>
      </div>
      <AdminNav
        class="flex-1 min-h-0"
        :groups="navGroups"
        :active="tab"
        :collapsed="collapsed"
        @select="open"
        @toggle="toggleCollapsed"
      />
    </aside>

    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-150"
        enter-from-class="opacity-0"
        leave-active-class="transition-opacity duration-100"
        leave-to-class="opacity-0"
      >
        <div v-if="drawerOpen" class="lg:hidden fixed inset-0 z-[70] bg-black/60" @click.self="drawerOpen = false">
          <div class="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-zinc-950 border-r border-zinc-800 flex flex-col shadow-2xl">
            <div class="shrink-0 flex items-center justify-between px-5 pt-4 pb-1">
              <p class="font-display font-semibold text-zinc-50">Admin</p>
              <button type="button" class="p-1 rounded text-zinc-500 hover:text-zinc-200" aria-label="Close" @click="drawerOpen = false">
                <NavIcon name="close" class="w-4 h-4" />
              </button>
            </div>
            <AdminNav class="flex-1 min-h-0" :groups="navGroups" :active="tab" @select="open" />
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- The open section. Queues and the log manage their own scrolling; the
         rest scroll as a page inside AdminSection. -->
    <main class="flex-1 min-w-0 min-h-0 flex flex-col">
      <AdminOverview
        v-if="tab === 'overview'"
        :queues="queues"
        :is-admin="isAdmin"
        :loaded="live !== null"
        @select="open"
      />

      <AdminRecordsReview v-else-if="tab === 'records'" class="flex-1 min-h-0" @changed="fetchCounts" />
      <AdminOpinionsReview v-else-if="tab === 'opinions'" class="flex-1 min-h-0" />
      <AdminLevelsReview v-else-if="tab === 'levels'" source="submitted" class="flex-1 min-h-0" />
      <AdminLevelsReview v-else-if="tab === 'imported-levels'" source="gdl_import" class="flex-1 min-h-0" />
      <AdminAwaitingReview v-else-if="tab === 'awaiting'" class="flex-1 min-h-0" />
      <AdminMovementsReview v-else-if="tab === 'movements'" class="flex-1 min-h-0" />
      <AdminImportedMovements v-else-if="tab === 'imported-movements'" class="flex-1 min-h-0" />
      <AdminOpenVerificationsReview v-else-if="tab === 'open-verifications'" class="flex-1 min-h-0" />

      <div v-else-if="tab === 'reports'" class="flex-1 min-h-0 overflow-y-auto">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 py-6">
          <AdminReports @changed="fetchCounts" />
        </div>
      </div>
      <div v-else-if="tab === 'helper-requests'" class="flex-1 min-h-0 overflow-y-auto">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 py-6">
          <AdminHelperRequests @changed="fetchCounts" />
        </div>
      </div>

      <AdminStatistics v-else-if="tab === 'statistics'" class="flex-1 min-h-0" />
      <AdminActivityLog v-else-if="tab === 'log'" class="flex-1 min-h-0" />

      <AdminAccounts v-else-if="tab === 'accounts'" @changed="fetchCounts" @navigate="open" />
      <AdminClaims v-else-if="tab === 'claims'" @changed="fetchCounts" />
      <AdminSection
        v-else-if="tab === 'custom-lists'"
        title="Custom lists"
        description="Build a custom list from a slice of the ALL list or any imported list."
      >
        <AdminCustomLists />
      </AdminSection>
      <AdminImports v-else-if="tab === 'imports'" />
      <AdminDiscord v-else-if="tab === 'discord'" />
    </main>

    <AdminToasts />
    <AdminConfirmDialog />
  </div>
</template>
