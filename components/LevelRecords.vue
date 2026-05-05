<script setup lang="ts">
type Record = {
  id?: number
  player: string
  country: string | number | null
  percent: number
  hz: number | null
  video: string | null
  source?: 'all' | 'aredl'
  is_verification?: number | null
}

const props = defineProps<{ records: Record[] }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

const { data: meRes } = useCurrentUser()
const isAdmin = computed(() => {
  const role = meRes.value?.account?.role
  return role === 'admin' || role === 'owner' || role === 'developer'
})

type Filter = 'all' | 'site' | 'aredl'
const filter = ref<Filter>('all')

const hasSite = computed(() => props.records.some((r) => !r.source || r.source === 'all'))
const hasAredl = computed(() => props.records.some((r) => r.source === 'aredl'))
const showFilter = computed(() => hasSite.value && hasAredl.value)

const filtered = computed(() => {
  if (filter.value === 'site') return props.records.filter((r) => !r.source || r.source === 'all')
  if (filter.value === 'aredl') return props.records.filter((r) => r.source === 'aredl')
  return props.records
})

const deletingId = ref<number | null>(null)
async function deleteRecord(id: number) {
  if (deletingId.value != null) return
  deletingId.value = id
  try {
    await $fetch(`/api/admin/records/${id}`, { method: 'DELETE' })
    emit('refresh')
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <aside class="flex flex-col min-h-0 border-l border-zinc-800 bg-zinc-950">
    <div class="p-3 border-b border-zinc-800 shrink-0">
      <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-2">Records</h2>
      <div v-if="showFilter" class="inline-flex rounded border border-zinc-800 overflow-hidden">
        <button
          v-for="[val, label] in [['all','All'],['site','ALL'],['aredl','AREDL']] as [Filter, string][]"
          :key="val"
          type="button"
          class="px-2.5 py-1 text-[10px] font-medium transition-colors"
          :class="filter === val ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
          @click="filter = val"
        >{{ label }}</button>
      </div>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div v-if="filtered.length === 0" class="p-6 text-center text-sm text-zinc-600">
        No records
      </div>
      <ul v-else class="divide-y divide-zinc-900">
        <li
          v-for="(r, idx) in filtered"
          :key="`${r.source ?? 'all'}-${r.player}-${r.percent}-${idx}`"
          class="px-3 py-2.5 hover:bg-zinc-900/60 transition-colors group"
        >
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-sm font-medium truncate">{{ r.player }}</span>
            <div class="flex items-center gap-1.5 shrink-0">
              <span class="tabular-nums text-xs text-amber-300">{{ r.percent }}%</span>
              <button
                v-if="isAdmin && r.id && r.source !== 'aredl'"
                type="button"
                :disabled="deletingId != null"
                class="opacity-0 group-hover:opacity-100 text-[10px] text-zinc-600 hover:text-red-400 disabled:opacity-30 transition-all leading-none"
                title="Remove record"
                @click="deleteRecord(r.id!)"
              >✕</button>
            </div>
          </div>
          <div class="flex items-center gap-2 mt-0.5 text-[11px] text-zinc-500">
            <span v-if="r.country" class="uppercase">{{ r.country }}</span>
            <span v-if="r.hz" class="tabular-nums">{{ r.hz }}hz</span>
            <span
              v-if="r.source === 'aredl'"
              class="text-[9px] uppercase tracking-wider px-1 py-px rounded bg-zinc-900 text-zinc-400"
              :title="r.is_verification ? 'Verified on AREDL' : 'Imported from AREDL'"
            >AREDL</span>
            <a v-if="r.video" :href="r.video" target="_blank" rel="noopener" class="hover:text-accent ml-auto">video ↗</a>
          </div>
        </li>
      </ul>
    </div>
  </aside>
</template>
