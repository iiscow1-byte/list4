<script setup lang="ts">
import type { AdminSectionMeta } from '~/utils/admin-sections'
import { timeAgo } from '~/utils/relative-time'

/**
 * Where the admin panel opens: everything waiting, biggest first, each one
 * click from its queue; then, for admins, the site's switches and whether
 * Discord and the importers are healthy.
 *
 * The panel used to open on the level queue whatever was going on, so finding
 * out that six reports were waiting meant opening a menu to look.
 */
const props = defineProps<{
  queues: (AdminSectionMeta & { count: number; fresh: number })[]
  isAdmin: boolean
  /** Counts have loaded at least once. */
  loaded: boolean
}>()
const emit = defineEmits<{ (e: 'select', id: string): void }>()

const waiting = computed(() => props.queues.filter((q) => q.count > 0).sort((a, b) => b.fresh - a.fresh || b.count - a.count))
const clear = computed(() => props.queues.filter((q) => q.count === 0))
const total = computed(() => waiting.value.reduce((n, q) => n + q.count, 0))

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// ---- Health, for admins only
type Hook = { id: number; label: string | null; active: 0 | 1; kind: string; paused_reason: string | null; failures_7d: number; last_success_at: string | null }
type Status = { running: string[]; queued: string[]; progress: Record<string, { phase: string; done: number; total: number | null }> }

const hooks = ref<Hook[] | null>(null)
const schedule = ref<{ enabled: boolean; reason: string | null; next_run_at: string } | null>(null)
const imports = ref<Status | null>(null)

async function loadHealth() {
  if (!props.isAdmin) return
  const [h, s] = await Promise.allSettled([
    $fetch<{ items: Hook[]; schedule: typeof schedule.value }>('/api/admin/discord-webhooks'),
    $fetch<Status>('/api/admin/imports/status'),
  ])
  if (h.status === 'fulfilled') { hooks.value = h.value.items; schedule.value = h.value.schedule }
  if (s.status === 'fulfilled') imports.value = s.value
}
onMounted(loadHealth)
watch(() => props.isAdmin, loadHealth)

const troubled = computed(() => (hooks.value ?? []).filter((h) => h.paused_reason || h.failures_7d > 0))
const activeHooks = computed(() => (hooks.value ?? []).filter((h) => h.active).length)

const nextDigest = computed(() => {
  if (!schedule.value?.next_run_at) return ''
  const ms = Date.parse(schedule.value.next_run_at) - Date.now()
  if (ms <= 0) return 'any minute'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h ? `in ${h}h ${m}m` : `in ${m}m`
})

function pct(key: string): string {
  const p = imports.value?.progress[key]
  if (!p || !p.total) return ''
  return ` · ${Math.round((p.done / p.total) * 100)}%`
}
</script>

<template>
  <AdminSection title="Overview" width="lg">
    <template #actions>
      <span v-if="loaded" class="text-sm text-zinc-400">
        <template v-if="total">{{ total.toLocaleString() }} waiting across {{ waiting.length }} {{ waiting.length === 1 ? 'queue' : 'queues' }}</template>
        <template v-else>All clear</template>
      </span>
    </template>

    <!-- Waiting -->
    <section>
      <h2 class="section-title text-sm mb-3">Waiting for you</h2>
      <div v-if="!loaded" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="n in 3" :key="n" class="card h-[104px] animate-pulse" />
      </div>
      <div v-else-if="waiting.length" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button
          v-for="q in waiting"
          :key="q.id"
          type="button"
          class="card group text-left p-4 hover:border-zinc-600 hover:bg-zinc-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          @click="emit('select', q.id)"
        >
          <span class="flex items-start gap-3">
            <span class="w-9 h-9 rounded-lg bg-zinc-800/80 text-zinc-300 group-hover:text-accent flex items-center justify-center shrink-0 transition-colors">
              <NavIcon :name="q.icon" class="w-[18px] h-[18px]" />
            </span>
            <span class="flex-1 min-w-0">
              <span class="flex items-baseline gap-2">
                <span class="font-medium text-zinc-100 truncate">{{ q.label }}</span>
                <span v-if="q.fresh" class="text-[11px] font-semibold text-red-400 shrink-0">{{ q.fresh.toLocaleString() }} new</span>
              </span>
              <span class="block text-xs text-zinc-500 mt-0.5 line-clamp-2">{{ q.blurb }}</span>
            </span>
            <span class="font-display text-2xl font-semibold tabular-nums text-zinc-50 shrink-0">{{ q.count.toLocaleString() }}</span>
          </span>
          <span class="mt-3 flex items-center gap-1 text-xs font-medium text-zinc-500 group-hover:text-accent transition-colors">
            Review <span aria-hidden="true">→</span>
          </span>
        </button>
      </div>
      <div v-else class="card px-4 py-8 text-center">
        <p class="text-sm text-zinc-300">Nothing is waiting.</p>
        <p class="text-xs text-zinc-500 mt-1">New submissions and reports will show up here.</p>
      </div>
      <p v-if="loaded && waiting.length && clear.length" class="mt-3 text-xs text-zinc-500">
        Nothing waiting in {{ joinNames(clear.map((q) => q.label)) }}.
      </p>
    </section>

    <!-- Admin: switches and health -->
    <div v-if="isAdmin" class="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section>
        <h2 class="section-title text-sm mb-3">Site</h2>
        <AdminSiteSwitches />
      </section>

      <section>
        <h2 class="section-title text-sm mb-3">Health</h2>
        <ul class="card divide-y divide-zinc-800/80">
          <li>
            <button type="button" class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-900 transition-colors" @click="emit('select', 'discord')">
              <NavIcon name="bell" class="w-4 h-4 text-zinc-500 shrink-0" />
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-medium text-zinc-100">Discord</span>
                <span class="block text-xs mt-0.5 truncate" :class="troubled.length ? 'text-red-300' : 'text-zinc-500'">
                  <template v-if="hooks === null">Checking…</template>
                  <template v-else-if="!hooks.length">No webhooks yet.</template>
                  <template v-else-if="troubled.length">
                    {{ troubled.length }} {{ troubled.length === 1 ? 'webhook needs' : 'webhooks need' }} a look: {{ troubled.map((h) => h.label || 'Unnamed').join(', ') }}
                  </template>
                  <template v-else>{{ activeHooks }} of {{ hooks.length }} active, all posting fine.</template>
                </span>
              </span>
              <span v-if="schedule" class="text-xs text-zinc-500 shrink-0 text-right">
                <template v-if="schedule.enabled">Next digest {{ nextDigest }}</template>
                <template v-else>Digest off here</template>
              </span>
            </button>
          </li>
          <li>
            <button type="button" class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-900 transition-colors" @click="emit('select', 'imports')">
              <NavIcon name="sheet" class="w-4 h-4 text-zinc-500 shrink-0" />
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-medium text-zinc-100">Imports</span>
                <span class="block text-xs text-zinc-500 mt-0.5 truncate">
                  <template v-if="imports === null">Checking…</template>
                  <template v-else-if="imports.running.length">
                    Running {{ imports.running.map((k) => `${k}${pct(k)}`).join(', ') }}<template v-if="imports.queued.length">, {{ imports.queued.length }} queued</template>
                  </template>
                  <template v-else>Nothing running.</template>
                </span>
              </span>
              <span v-if="imports?.running.length" class="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" aria-hidden="true" />
            </button>
          </li>
          <li v-for="h in troubled.slice(0, 3)" :key="h.id" class="px-4 py-2.5 text-xs text-zinc-500">
            <span class="text-zinc-300">{{ h.label || 'Unnamed webhook' }}</span>:
            <template v-if="h.paused_reason">{{ h.paused_reason }}</template>
            <template v-else>{{ h.failures_7d }} failed {{ h.failures_7d === 1 ? 'post' : 'posts' }} this week<template v-if="h.last_success_at">, last worked {{ timeAgo(h.last_success_at) }}</template>.</template>
          </li>
        </ul>
      </section>
    </div>
  </AdminSection>
</template>
