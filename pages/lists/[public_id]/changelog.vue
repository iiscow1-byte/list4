<script setup lang="ts">
definePageMeta({ layout: 'level' })

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const { list, base } = useCustomList(publicId)

type Change = {
  id: number
  item_id: number | null
  level_name: string
  kind: 'add' | 'move' | 'remove'
  from_rank: number | null
  to_rank: number | null
  changed_at: string
  changed_by_username: string | null
  current_sort_order: number | null
}
const { data } = await useFetch<{ days: { date: string; changes: Change[] }[] }>(
  () => `/api/custom-lists/${publicId.value}/changes`,
)
const days = computed(() => data.value?.days ?? [])
const total = computed(() => days.value.reduce((n, d) => n + d.changes.length, 0))

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

useHead(() => ({ title: list.value ? `Changelog — ${list.value.title}` : 'Changelog' }))
</script>

<template>
  <CustomListShell :public-id="publicId">
    <template #default>
      <div class="flex items-baseline justify-between gap-3 mb-3">
        <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Changelog</h2>
        <span class="text-[11px] text-zinc-600 tabular-nums">{{ total.toLocaleString() }} entries</span>
      </div>

      <div v-if="!total" class="card px-6 py-16 text-center">
        <p class="text-sm text-zinc-400">Nothing has changed yet.</p>
        <p class="text-xs text-zinc-600 mt-1">
          Adding, moving or removing levels will show up here.
        </p>
      </div>

      <div v-else class="space-y-4">
        <section v-for="day in days" :key="day.date" class="card overflow-hidden">
          <header class="px-4 py-2.5 border-b border-zinc-800/80 flex items-baseline justify-between gap-3">
            <h3 class="text-sm font-semibold text-zinc-100">{{ formatDay(day.date) }}</h3>
            <span class="text-[11px] text-zinc-500 tabular-nums">
              {{ day.changes.length }} change{{ day.changes.length === 1 ? '' : 's' }}
            </span>
          </header>
          <ul class="divide-y divide-zinc-900/60">
            <li
              v-for="c in day.changes"
              :key="c.id"
              class="px-4 py-2 text-sm flex items-center gap-2 hover:bg-zinc-900/40 transition-colors"
            >
              <span
                v-if="c.kind === 'add'"
                class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-emerald-950/60 text-emerald-300 border border-emerald-900/60"
              >Added</span>
              <span
                v-else-if="c.kind === 'remove'"
                class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-red-950/60 text-red-300 border border-red-900/60"
              >Removed</span>
              <span
                v-else-if="c.from_rank != null && c.to_rank != null && c.to_rank < c.from_rank"
                class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-sky-950/60 text-sky-300 border border-sky-900/60"
              >▲ Moved</span>
              <span
                v-else
                class="shrink-0 text-[10px] uppercase tracking-widest px-1.5 py-px rounded bg-amber-950/60 text-amber-300 border border-amber-900/60"
              >▼ Moved</span>

              <NuxtLink
                v-if="c.current_sort_order != null"
                :to="`${base}/${c.current_sort_order + 1}`"
                class="truncate text-zinc-200 hover:text-accent transition-colors"
              >{{ c.level_name }}</NuxtLink>
              <span v-else class="truncate text-zinc-400">{{ c.level_name }}</span>

              <span class="ml-auto shrink-0 text-sm font-semibold tabular-nums">
                <template v-if="c.kind === 'add'">
                  <span class="text-accent">#{{ c.to_rank }}</span>
                </template>
                <template v-else-if="c.kind === 'remove'">
                  <span class="text-zinc-600">was #{{ c.from_rank }}</span>
                </template>
                <template v-else>
                  <span class="text-zinc-500">#{{ c.from_rank }}</span>
                  <span class="text-zinc-600 mx-1">→</span>
                  <span class="text-accent">#{{ c.to_rank }}</span>
                </template>
              </span>
              <span v-if="c.changed_by_username" class="shrink-0 text-[10px] text-zinc-600 hidden sm:inline">
                {{ c.changed_by_username }}
              </span>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </CustomListShell>
</template>
