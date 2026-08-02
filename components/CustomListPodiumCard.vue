<script setup lang="ts">
/**
 * Inside of a custom-list podium tile. Split out so the linked and unlinked
 * variants of the tile can share a body without a dynamic `<component :is>`.
 */
defineProps<{
  row: {
    rank: number
    player_name: string
    points: number
    hardest_name: string | null
    hardest_gd_id: number | null
    account_username: string | null
    has_avatar: boolean
  }
  /** Ring colour class for the avatar. */
  ring: string
  /** Rank-badge colour classes. */
  badge: string
}>()

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
</script>

<template>
  <LevelThumbBg
    :gd-id="row.hardest_gd_id"
    res="medium"
    sizes="(max-width: 640px) 100vw, 380px"
    img-class="opacity-[0.12] group-hover:opacity-25"
    overlay-class="bg-gradient-to-b from-zinc-950/80 to-zinc-950"
  />
  <span
    class="relative w-12 h-12 sm:w-14 sm:h-14 rounded-full overflow-hidden bg-zinc-800 ring-2 flex items-center justify-center shrink-0"
    :class="ring"
  >
    <img
      v-if="row.has_avatar && row.account_username"
      :src="`/api/users/${encodeURIComponent(row.account_username)}/avatar`"
      class="w-full h-full object-cover"
      alt=""
    />
    <span v-else class="text-lg font-black uppercase text-zinc-500">{{ row.player_name.charAt(0) }}</span>
  </span>
  <span class="relative rank-badge shrink-0" :class="badge">#{{ row.rank }}</span>
  <span class="relative text-sm font-semibold text-zinc-100 truncate w-full">{{ row.player_name }}</span>
  <span class="relative text-xs tabular-nums text-amber-300 font-semibold">{{ fmt(row.points) }} pts</span>
  <span v-if="row.hardest_name" class="relative text-[10px] text-zinc-500 truncate w-full">
    hardest: {{ row.hardest_name }}
  </span>
</template>
