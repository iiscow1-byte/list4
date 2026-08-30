<script setup lang="ts">
/**
 * The site's split-pane list layout — at any width.
 *
 * Seven pages are built the same way: a navigation panel of every level, a
 * scrolling detail panel for the one you picked, and sometimes a third panel of
 * records beside it. Six of them wrote that as a bare `grid-cols-[20%_80%]`
 * with no breakpoint, which is fine on a monitor and unusable on a phone: at
 * 390px those columns are 78px and 312px, so the navigation is a column of
 * clipped single characters and the level itself gets less than a paperback's
 * width. The seventh — a custom list — did have breakpoints, and they hid both
 * side panels below `md`/`xl` with nothing to bring them back, so on a phone
 * the list's own levels and every record on them were simply unreachable.
 *
 * ## Why the side panels become drawers rather than stacking
 *
 * The obvious mobile move is to let the columns stack — nav, then detail, then
 * records, one after another. It is wrong here. The nav panel is *the whole
 * list*, hundreds of rows with its own search, sort and infinite scroll; put it
 * above the detail and every level page opens onto a wall of other levels, with
 * the thing you actually asked for somewhere below the fold. The panels aren't
 * sections of one document, they're three views competing for one screen, and
 * on a screen this size only one of them can win. The detail wins, because it
 * is what the URL names.
 *
 * So the two side panels stay exactly where they are in the DOM — one instance,
 * keeping its scroll position, its search box and its loaded pages — and become
 * off-canvas drawers, summoned from a bar that only exists while they are
 * drawers.
 *
 * ## Why they are `absolute` and not `fixed`
 *
 * A `fixed` drawer is positioned against the viewport, so it covers the site
 * header — and on a standalone custom list, whose own bar *is* the header, it
 * would cover the only way back out. `absolute` pins them to the pane area
 * instead, so a drawer opens under the chrome regardless of which layout the
 * page uses and whether that layout has a header at all.
 *
 * ## Why the layout is CSS rather than a `matchMedia` ref
 *
 * Deciding in script which layout to render would mean the server always
 * guesses one of them, and a phone would paint the three-column desktop version
 * for as long as hydration takes. The breakpoints are therefore real media
 * queries and the script only handles what CSS cannot — see `inert` below.
 *
 * Each pane names its own breakpoint because they don't share one: the main
 * list's nav needs `lg` before 20% is a usable width, while a custom list's is
 * a fixed 16rem and works from `md`.
 */
const props = withDefaults(defineProps<{
  /** `grid-template-columns` once the nav is a column. */
  columns: string
  /** `grid-template-columns` once the aside is a column too. Defaults to `columns`. */
  columnsWide?: string
  /**
   * The nav is collapsed to a zero-width column on desktop.
   *
   * Only meaningful once the nav is a column — collapsing it is a desktop
   * affordance, and a phone reaches the same panel through the drawer. The
   * layout needs to be told because a 0px column still contains every link the
   * panel has, and they stay tabbable behind it.
   */
  navCollapsed?: boolean
  /** Width at which the nav stops being a drawer. */
  navAt?: 'md' | 'lg'
  /** Width at which the aside stops being a drawer. */
  asideAt?: 'lg' | 'xl'
  /** The small-screen button that opens the nav pane. */
  navLabel?: string
  /** Provide the `aside` slot to get a third pane; this names its button. */
  asideLabel?: string
  /** Badge on the aside button — how many things are in there. */
  asideCount?: number | null
  /** Shown between the two buttons on small screens. */
  title?: string | null
}>(), {
  columnsWide: undefined,
  navCollapsed: false,
  navAt: 'lg',
  asideAt: 'lg',
  navLabel: 'Levels',
  asideLabel: 'Records',
  asideCount: null,
  title: null,
})

const slots = useSlots()
const hasAside = computed(() => !!slots.aside)

// The two drawer buttons are the most-pressed controls on a phone, and the
// labels arrive in English from the page — translated here rather than at each
// call site so every list gets it from one place. See `utils/i18n.ts`.
const { t } = useLocale()

const navOpen = ref(false)
const asideOpen = ref(false)

const rootClass = computed(() => [
  `nav-at-${props.navAt}`,
  hasAside.value ? `aside-at-${props.asideAt}` : 'no-aside',
])

/**
 * Whether each pane is currently a drawer, tracked in script as well as in CSS.
 *
 * A drawer that is merely translated off-screen is still in the tab order and
 * still read aloud, so it has to be `inert` while it is away — and only while
 * it is actually a drawer, or the desktop panels would be inert too. Both start
 * `false` so the server and the first client render agree on the no-JS case;
 * `onMounted` corrects them before anything can be tabbed to.
 */
const navDrawer = ref(false)
const asideDrawer = ref(false)
const QUERIES = {
  md: '(max-width: 767.98px)',
  lg: '(max-width: 1023.98px)',
  xl: '(max-width: 1279.98px)',
}
let navMq: MediaQueryList | null = null
let asideMq: MediaQueryList | null = null

function syncNav() {
  navDrawer.value = !!navMq?.matches
  if (!navDrawer.value) navOpen.value = false
}
function syncAside() {
  asideDrawer.value = !!asideMq?.matches
  if (!asideDrawer.value) asideOpen.value = false
}

function closeAll() {
  navOpen.value = false
  asideOpen.value = false
}

const navPanel = ref<HTMLElement | null>(null)
const asidePanel = ref<HTMLElement | null>(null)

async function open(which: 'nav' | 'aside') {
  navOpen.value = which === 'nav'
  asideOpen.value = which === 'aside'
  await nextTick()
  const el = which === 'nav' ? navPanel.value : asidePanel.value
  el?.querySelector<HTMLElement>('[data-pane-close]')?.focus({ preventScroll: true })
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && (navOpen.value || asideOpen.value)) closeAll()
}

onMounted(() => {
  navMq = window.matchMedia(QUERIES[props.navAt])
  asideMq = window.matchMedia(QUERIES[props.asideAt])
  syncNav()
  syncAside()
  navMq.addEventListener('change', syncNav)
  asideMq.addEventListener('change', syncAside)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  navMq?.removeEventListener('change', syncNav)
  asideMq?.removeEventListener('change', syncAside)
  document.removeEventListener('keydown', onKey)
})

// Picking a level from the drawer navigates, and the drawer's job is then done.
// Pick modes — "move below", group move — don't change the route, so those stay
// open, which is what selecting several levels in a row needs.
const route = useRoute()
watch(() => route.fullPath, closeAll)

const scrimShown = computed(() => navOpen.value || asideOpen.value)
/**
 * `null` removes the attribute; `inert="false"` would still be inert.
 *
 * A pane is unreachable in two different ways — parked off-screen as a closed
 * drawer, or squeezed to a zero-width column by the desktop collapse — and both
 * leave every link inside it focusable. The second is why the main list's nav
 * used to be `v-show`n away, which is not available here: hiding it outright
 * would also empty the drawer that a phone opens.
 */
const navInert = computed(() => {
  if (navDrawer.value) return navOpen.value ? null : true
  return props.navCollapsed ? true : null
})
const asideInert = computed(() => (asideDrawer.value && !asideOpen.value ? true : null))
</script>

<template>
  <div
    class="pane-grid relative h-full grid transition-[grid-template-columns] duration-200"
    :class="rootClass"
    :style="{
      '--pane-cols': columns,
      '--pane-cols-wide': columnsWide ?? columns,
    }"
  >
    <div
      ref="navPanel"
      class="pane-side pane-nav"
      :class="{ 'is-open': navOpen }"
      :inert="navInert"
    >
      <!-- A strip rather than a close button floated over the panel: every nav
           panel on this site already puts something in its own top-right corner
           — a match count, a "Reset all" — and an overlay would sit on top of
           it. -->
      <div v-if="navDrawer" class="pane-head">
        <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold truncate">{{ t(navLabel) }}</span>
        <button type="button" data-pane-close class="pane-close focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60" :aria-label="t('Close')" :title="t('Close')" @click="closeAll">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="w-4 h-4" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <slot name="nav" />
    </div>

    <!-- The detail pane: the page itself, and the only one always on screen. -->
    <div class="min-w-0 min-h-0 flex flex-col">
      <!-- The only way to reach a pane while it is a drawer. Each button
           disappears at its own pane's breakpoint, and the bar with the last
           of them. -->
      <div class="pane-bar shrink-0 flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-sm">
        <button type="button" class="pane-btn pane-btn-nav focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60" @click="open('nav')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="w-3.5 h-3.5" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          {{ t(navLabel) }}
        </button>

        <span v-if="title" class="flex-1 min-w-0 truncate text-center text-[11px] text-zinc-500">{{ title }}</span>
        <span v-else class="flex-1" />

        <button v-if="hasAside" type="button" class="pane-btn pane-btn-aside focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60" @click="open('aside')">
          {{ t(asideLabel) }}
          <span v-if="asideCount" class="tabular-nums text-zinc-500">{{ asideCount }}</span>
        </button>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto relative">
        <slot />
      </div>
    </div>

    <!-- The aside, mirrored: in from the right, out to the right. -->
    <div
      v-if="hasAside"
      ref="asidePanel"
      class="pane-side pane-aside"
      :class="{ 'is-open': asideOpen }"
      :inert="asideInert"
    >
      <div v-if="asideDrawer" class="pane-head">
        <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold truncate">{{ t(asideLabel) }}</span>
        <button type="button" data-pane-close class="pane-close focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60" :aria-label="t('Close')" :title="t('Close')" @click="closeAll">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="w-4 h-4" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <slot name="aside" />
    </div>

    <div
      v-if="scrimShown"
      class="absolute inset-0 z-20 bg-black/60"
      aria-hidden="true"
      @click="closeAll"
    />
  </div>
</template>

<style scoped>
/*
 * The small-screen layout is the default and the wide one is the override, so
 * a page renders correctly before any JS runs and stays correct if none does.
 */
.pane-grid {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  /*
   * A closed drawer sits a full panel-width outside this box. Every layout
   * using this component happens to clip already, but a side panel that can
   * add a horizontal scrollbar to the whole site if a parent forgets to is not
   * something to leave to the caller.
   */
  overflow: hidden;
}

.pane-side {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 30;
  width: 86%;
  max-width: 21rem;
  box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.6);
  transition: transform 200ms ease-out;
}

/*
 * Every panel on this site is a self-contained `<aside class="flex flex-col
 * min-h-0">` that used to be a grid item and took its height from the row.
 * Inside a wrapper it has to be told to fill one — all of it except the drawer
 * strip above it, which is sized by its own content.
 */
.pane-side > *:not(.pane-head) {
  flex: 1 1 0%;
  min-height: 0;
}

.pane-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.5rem 0.5rem 0.875rem;
  border-bottom: 1px solid rgb(var(--c-zinc-800) / 0.8);
  background: rgb(var(--c-zinc-950));
}

.pane-nav {
  left: 0;
  transform: translateX(-100%);
}
.pane-aside {
  right: 0;
  transform: translateX(100%);
}
.pane-side.is-open {
  transform: translateX(0);
}

.pane-close {
  flex: none;
  padding: 0.375rem;
  border-radius: 0.5rem;
  color: rgb(var(--c-zinc-400));
  transition: color 150ms, background-color 150ms;
}
.pane-close:hover {
  color: rgb(var(--c-zinc-100));
  background: rgb(var(--c-zinc-900));
}

.pane-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.625rem;
  border-radius: 0.5rem;
  font-size: 0.75rem;
  line-height: 1rem;
  font-weight: 500;
  color: rgb(var(--c-zinc-300));
  background: rgb(var(--c-zinc-900));
  border: 1px solid rgb(var(--c-zinc-800));
  transition: color 150ms, border-color 150ms;
}
.pane-btn:hover {
  color: rgb(var(--c-zinc-100));
  border-color: rgb(var(--c-zinc-700));
}

/*
 * A pane stops being a drawer at its own breakpoint, and takes its button with
 * it. The `columns-wide` rules come last so that when both panes are columns
 * the three-column template wins over the two-column one.
 */
@media (min-width: 768px) {
  .nav-at-md {
    grid-template-columns: var(--pane-cols);
  }
  .nav-at-md .pane-nav {
    position: static;
    width: auto;
    max-width: none;
    transform: none;
    box-shadow: none;
    z-index: auto;
  }
  .nav-at-md .pane-btn-nav {
    display: none;
  }
  .nav-at-md.no-aside .pane-bar {
    display: none;
  }
}

@media (min-width: 1024px) {
  .nav-at-lg {
    grid-template-columns: var(--pane-cols);
  }
  .nav-at-lg .pane-nav {
    position: static;
    width: auto;
    max-width: none;
    transform: none;
    box-shadow: none;
    z-index: auto;
  }
  .nav-at-lg .pane-btn-nav {
    display: none;
  }
  .nav-at-lg.no-aside .pane-bar {
    display: none;
  }

  .aside-at-lg {
    grid-template-columns: var(--pane-cols-wide);
  }
  .aside-at-lg .pane-aside {
    position: static;
    width: auto;
    max-width: none;
    transform: none;
    box-shadow: none;
    z-index: auto;
  }
  .aside-at-lg .pane-btn-aside {
    display: none;
  }
  .nav-at-md.aside-at-lg .pane-bar,
  .nav-at-lg.aside-at-lg .pane-bar {
    display: none;
  }
}

@media (min-width: 1280px) {
  .aside-at-xl {
    grid-template-columns: var(--pane-cols-wide);
  }
  .aside-at-xl .pane-aside {
    position: static;
    width: auto;
    max-width: none;
    transform: none;
    box-shadow: none;
    z-index: auto;
  }
  .aside-at-xl .pane-btn-aside {
    display: none;
  }
  .nav-at-md.aside-at-xl .pane-bar,
  .nav-at-lg.aside-at-xl .pane-bar {
    display: none;
  }
}
</style>
