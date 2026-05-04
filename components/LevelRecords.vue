<script setup lang="ts">
type Record = {
  player: string
  country: string | number | null
  percent: number
  hz: number | null
  video: string | null
  source?: 'all' | 'aredl'
  is_verification?: number | null
}
defineProps<{ records: Record[] }>()
</script>

<template>
  <aside class="flex flex-col min-h-0 border-l border-zinc-800 bg-zinc-950">
    <div class="p-3 border-b border-zinc-800 shrink-0">
      <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Records</h2>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div v-if="records.length === 0" class="p-6 text-center text-sm text-zinc-600">
        No records
      </div>
      <ul v-else class="divide-y divide-zinc-900">
        <li
          v-for="(r, idx) in records"
          :key="`${r.source ?? 'all'}-${r.player}-${r.percent}-${idx}`"
          class="px-3 py-2.5 hover:bg-zinc-900/60 transition-colors"
        >
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-sm font-medium truncate">{{ r.player }}</span>
            <span class="tabular-nums text-xs text-amber-300 shrink-0">{{ r.percent }}%</span>
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
