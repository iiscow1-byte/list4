<script setup lang="ts">
import {
  SITE_VERSION, versionLabel, visibleUpdates, changeText, isAdminChange,
} from '~/utils/site-updates'

/**
 * Website updates — every change the site itself has received, newest first.
 * Distinct from `/changelog`, which tracks level placements.
 *
 * ## Two readings of one history
 *
 * A third of what has shipped here is admin tooling, and to somebody reading
 * the list those entries describe buttons their page does not have. Staff see
 * the whole file; everybody else sees the lines written for them, and a release
 * that was entirely internal simply isn't there.
 *
 * The filtering is `visibleUpdates()` in the data file rather than a `v-if` in
 * the markup, so the same rule governs the page, the "new since your last
 * visit" marker and anything else that ever reads this — a dot promising an
 * update that turns out to be invisible is worse than no dot.
 */
useHead({ title: 'Updates — All Levels List' })

const { data: meRes } = useCurrentUser()
/**
 * Moderators count as staff here. The admin lines describe the review queues
 * and the filters moderators use, so hiding them from the people doing the
 * moderating would be the wrong way round.
 */
const isStaff = computed(() => {
  const r = meRes.value?.account?.role
  return r === 'moderator' || r === 'admin' || r === 'owner' || r === 'developer'
})

const updates = computed(() => visibleUpdates(isStaff.value))

/** What the newest *visible* release is, which is what "new" is measured against. */
const latestVisible = computed(() => updates.value[0]?.version ?? SITE_VERSION)

/**
 * The newest version the visitor has already read, kept in localStorage so the
 * "new" marker disappears once they've been here. Read on mount so SSR and the
 * first client render agree.
 */
const seenVersion = ref<string | null>(null)
onMounted(() => {
  try {
    seenVersion.value = localStorage.getItem('all:updates-seen')
    // Stamped with the newest release *this reader can see*. Writing the
    // absolute newest would mark an admin-only release as read for somebody
    // who was never shown it, and the dot would then be cleared by a page that
    // appeared not to have changed.
    localStorage.setItem('all:updates-seen', latestVisible.value)
  } catch { /* private mode — the marker just always shows */ }
})

function isNew(version: string): boolean {
  if (!seenVersion.value) return false
  return compareVersions(version, seenVersion.value) > 0
}

/** Numeric compare of `a.b.c` strings; missing parts count as 0. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

/** A major/minor bump reads as a release; a patch is a smaller drop. */
function isRelease(version: string): boolean {
  return version.endsWith('.0')
}
</script>

<template>
  <div class="container-tight max-w-3xl py-8">
    <header class="mb-8">
      <div class="flex items-center gap-2 flex-wrap">
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">List updates</h1>
        <span class="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent tabular-nums">
          {{ versionLabel(latestVisible) }}
        </span>
      </div>
      <p class="text-sm text-zinc-500 mt-1">
        Site changes, newest first. Level placements are in the
        <NuxtLink to="/changelog" class="text-accent hover:underline">list changelog</NuxtLink>.
      </p>
      <!-- Said plainly rather than left to be noticed: staff are reading a
           longer page than everybody else, and it should be obvious which one
           you are on before you quote a line from it to somebody. -->
      <p v-if="isStaff" class="text-[11px] text-zinc-600 mt-2 inline-flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" aria-hidden="true" />
        Amber entries are staff-only. Regular users don't see them.
      </p>
    </header>

    <ol class="relative space-y-8 border-l border-zinc-800 pl-6 ml-1.5">
      <li v-for="u in updates" :key="u.version" class="relative">
        <!-- Timeline node -->
        <span
          class="absolute -left-[1.72rem] top-1.5 w-3 h-3 rounded-full ring-4 ring-zinc-950"
          :class="isRelease(u.version) ? 'bg-accent' : 'bg-zinc-700'"
          aria-hidden="true"
        />

        <div class="flex items-baseline gap-2 flex-wrap">
          <h2 class="text-lg font-semibold tracking-tight text-zinc-100">{{ u.title }}</h2>
          <span class="rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums bg-zinc-900 border border-zinc-800 text-zinc-300">
            {{ versionLabel(u.version) }}
          </span>
          <span
            v-if="isNew(u.version)"
            class="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest bg-accent/15 text-accent border border-accent/30"
          >New</span>
          <span class="text-[11px] text-zinc-600 ml-auto">{{ formatDate(u.date) }}</span>
        </div>

        <div v-if="u.tags?.length" class="mt-1.5 flex flex-wrap gap-1">
          <span
            v-for="t in u.tags"
            :key="t"
            class="rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500"
          >{{ t }}</span>
        </div>

        <!-- Staff-only lines are marked rather than merely present. Somebody
             writing release notes for the community needs to know at a glance
             which lines they can quote, and the chevron changing colour is
             enough to say so without a label on every row. -->
        <ul class="mt-3 space-y-1.5">
          <li
            v-for="(c, i) in u.changes"
            :key="i"
            class="flex gap-2 text-sm leading-relaxed"
            :class="isAdminChange(c) ? 'text-zinc-400' : 'text-zinc-300'"
          >
            <span
              class="select-none shrink-0"
              :class="isAdminChange(c) ? 'text-amber-500/70' : 'text-accent/60'"
              :title="isAdminChange(c) ? 'Staff only, hidden from regular users' : undefined"
              aria-hidden="true"
            >›</span>
            <span>
              <span
                v-if="isAdminChange(c)"
                class="mr-1.5 align-[0.09em] rounded border border-amber-900/60 bg-amber-950/40 px-1 py-px text-[9px] uppercase tracking-widest text-amber-400/90"
              >Staff</span>{{ changeText(c) }}
            </span>
          </li>
        </ul>
      </li>
    </ol>

    <p class="mt-10 text-[11px] text-zinc-600">
      Spotted something broken, or want something added? Say so in the
      <a href="https://discord.gg/KfZvUpS3PB" target="_blank" rel="noopener noreferrer" class="text-zinc-400 hover:text-accent transition-colors">Discord ↗</a>.
    </p>
  </div>
</template>
