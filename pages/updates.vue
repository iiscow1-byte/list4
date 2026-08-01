<script setup lang="ts">
import { SITE_UPDATES, SITE_VERSION } from '~/utils/site-updates'

/**
 * Website updates — every change the site itself has received, newest first.
 * Distinct from `/changelog`, which tracks level placements.
 */
useHead({ title: 'Updates — All Levels List' })

/**
 * The newest version the visitor has already read, kept in localStorage so the
 * "new" marker disappears once they've been here. Read on mount so SSR and the
 * first client render agree.
 */
const seenVersion = ref<string | null>(null)
onMounted(() => {
  try {
    seenVersion.value = localStorage.getItem('all:updates-seen')
    localStorage.setItem('all:updates-seen', SITE_VERSION)
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
          v{{ SITE_VERSION }}
        </span>
      </div>
      <p class="text-sm text-zinc-500 mt-1">
        Everything the website itself has gained, newest first. Looking for level
        placements instead? That's the
        <NuxtLink to="/changelog" class="text-accent hover:underline">list changelog</NuxtLink>.
      </p>
    </header>

    <ol class="relative space-y-8 border-l border-zinc-800 pl-6 ml-1.5">
      <li v-for="u in SITE_UPDATES" :key="u.version" class="relative">
        <!-- Timeline node -->
        <span
          class="absolute -left-[1.72rem] top-1.5 w-3 h-3 rounded-full ring-4 ring-zinc-950"
          :class="isRelease(u.version) ? 'bg-accent' : 'bg-zinc-700'"
          aria-hidden="true"
        />

        <div class="flex items-baseline gap-2 flex-wrap">
          <h2 class="text-lg font-semibold tracking-tight text-zinc-100">{{ u.title }}</h2>
          <span class="rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums bg-zinc-900 border border-zinc-800 text-zinc-300">
            v{{ u.version }}
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

        <ul class="mt-3 space-y-1.5">
          <li v-for="(c, i) in u.changes" :key="i" class="flex gap-2 text-sm text-zinc-300 leading-relaxed">
            <span class="text-accent/60 select-none shrink-0" aria-hidden="true">›</span>
            <span>{{ c }}</span>
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
