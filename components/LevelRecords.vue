<script setup lang="ts">
type Record = { player: string; country: string | null; percent: number; hz: number | null; video: string | null }
defineProps<{ records: Record[] }>()
</script>

<template>
  <aside class="flex flex-col h-full border-l border-zinc-800 bg-zinc-950">
    <div class="p-3 border-b border-zinc-800">
      <h2 class="text-[10px] uppercase tracking-[0.2em] font-mono text-zinc-500">Records</h2>
    </div>
    <div class="flex-1 overflow-y-auto">
      <div v-if="records.length === 0" class="p-6 text-center text-sm text-zinc-600">
        No records
      </div>
      <ul v-else class="divide-y divide-zinc-900">
        <li v-for="r in records" :key="`${r.player}-${r.percent}`" class="px-3 py-2.5 hover:bg-zinc-900/60 transition-colors">
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-sm font-medium truncate">{{ r.player }}</span>
            <span class="font-mono text-xs text-amber-300 shrink-0">{{ r.percent }}%</span>
          </div>
          <div class="flex items-center gap-2 mt-0.5 text-[11px] text-zinc-500 font-mono">
            <span v-if="r.country" class="uppercase">{{ r.country }}</span>
            <span v-if="r.hz">{{ r.hz }}hz</span>
            <a v-if="r.video" :href="r.video" target="_blank" rel="noopener" class="hover:text-accent ml-auto">video ↗</a>
          </div>
        </li>
      </ul>
    </div>
  </aside>
</template>
