<script setup lang="ts">
/** Right panel of a custom list: records on the selected level. */
const props = defineProps<{
  item: any
  acceptsRecords: boolean
  canModerate?: boolean
  /** `/api/custom-lists/:public_id` — where record mutations go. */
  apiBase: string
  /** `/lists/:public_id` — where the submit page lives. */
  pageBase: string
}>()
const { to } = useStandaloneList()

const emit = defineEmits<{ (e: 'deleted'): void }>()

const busy = ref<number | null>(null)
const error = ref<string | null>(null)

async function removeRecord(id: number) {
  if (busy.value != null) return
  if (!confirm('Remove this record?')) return
  busy.value = id
  error.value = null
  try {
    await $fetch(`${props.apiBase}/records/${id}`, { method: 'DELETE' })
    emit('deleted')
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Failed to remove.'
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <aside class="flex flex-col min-h-0 border-l border-zinc-800/80 bg-zinc-950">
    <div class="p-3 border-b border-zinc-800/80 shrink-0 flex items-center gap-2">
      <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">
        Records
        <span class="ml-1 tabular-nums text-zinc-600">{{ item?.records?.length ?? 0 }}</span>
      </h2>
      <span v-if="item && item.percent_to_qualify < 100" class="ml-auto text-[10px] text-zinc-600 tabular-nums">
        {{ item.percent_to_qualify }}%+ to qualify
      </span>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto">
      <p v-if="error" class="px-3 py-2 text-[11px] text-red-400">{{ error }}</p>
      <div v-if="!item?.records?.length" class="p-6 text-center text-sm text-zinc-600">
        No records yet
      </div>
      <ul v-else class="divide-y divide-zinc-900">
        <li
          v-for="r in item.records"
          :key="r.id"
          class="px-3 py-2.5 hover:bg-zinc-900/60 transition-colors group"
        >
          <div class="flex items-baseline gap-2">
            <ClanTag v-if="r.clan" :tag="r.clan.tag" :name="r.clan.name" :color="r.clan.color" size="sm" class="self-center" />
            <NuxtLink
              v-if="r.account_username"
              :to="`/users/${encodeURIComponent(r.account_username)}`"
              class="text-sm font-medium truncate min-w-0 hover:text-accent transition-colors"
            >{{ r.player_name }}</NuxtLink>
            <span v-else class="text-sm font-medium truncate min-w-0">{{ r.player_name }}</span>
            <div class="ml-auto flex items-center gap-2 shrink-0">
              <a
                v-if="r.video"
                :href="r.video"
                target="_blank"
                rel="noopener"
                class="text-[11px] text-zinc-500 hover:text-accent transition-colors"
              >video ↗</a>
              <span class="tabular-nums text-xs text-amber-300">{{ r.percent }}%</span>
              <button
                v-if="canModerate"
                type="button"
                :disabled="busy != null"
                class="text-[10px] text-zinc-600 hover:text-red-400 disabled:opacity-30 transition-colors leading-none sm:opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                title="Remove record"
                aria-label="Remove record"
                @click="removeRecord(r.id)"
              >✕</button>
            </div>
          </div>
          <div class="flex items-center gap-2 mt-0.5 text-[11px] text-zinc-500">
            <span v-if="r.hz" class="tabular-nums">{{ r.hz }}hz</span>
            <Badge v-if="r.mobile" tone="sky" size="sm" title="Beaten on mobile">Mobile</Badge>
          </div>
        </li>
      </ul>
    </div>

    <div v-if="acceptsRecords && item" class="p-3 border-t border-zinc-800/80 shrink-0">
      <NuxtLink
        :to="to(`${pageBase}/submit?item=${item.id}`)"
        class="btn btn-sm btn-primary block w-full text-center"
      >Submit a record</NuxtLink>
    </div>
  </aside>
</template>
