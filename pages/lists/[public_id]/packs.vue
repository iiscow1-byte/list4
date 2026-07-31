<script setup lang="ts">
definePageMeta({ layout: 'level' })

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const { list, canEdit, base, pendingCount, liked, toggleLike } = useCustomList(publicId)

function itemById(id: number) {
  return list.value?.items.find((i: any) => i.id === id) ?? null
}

useHead(() => ({ title: list.value ? `Packs — ${list.value.title}` : 'Packs' }))
</script>

<template>
  <div v-if="list" class="h-full flex flex-col min-h-0">
    <CustomListBar :list="list" :can-edit="canEdit" :pending-count="pendingCount" :liked="liked" @like="toggleLike" />
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold mb-3">Packs</h2>

        <p v-if="!list.packs.length" class="text-sm text-zinc-500 py-16 text-center">
          This list has no packs.
        </p>
        <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="p in list.packs" :key="p.id" class="card overflow-hidden">
            <div class="px-4 py-2.5 border-b border-zinc-800/80 flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-sm shrink-0" :style="{ backgroundColor: p.color || '#71717a' }" />
              <h3 class="text-sm font-semibold text-zinc-100 truncate">{{ p.name }}</h3>
              <span class="ml-auto text-[11px] text-zinc-600 tabular-nums">{{ p.item_ids.length }}</span>
            </div>
            <ul class="divide-y divide-zinc-900/60">
              <li v-for="id in p.item_ids" :key="id">
                <NuxtLink
                  v-if="itemById(id)"
                  :to="`${base}/${itemById(id)!.rank}`"
                  class="flex items-center gap-2 px-4 py-1.5 text-sm text-zinc-300 hover:text-accent hover:bg-zinc-900/50 transition-colors"
                >
                  <span class="text-zinc-600 tabular-nums text-[11px] shrink-0">#{{ itemById(id)!.rank }}</span>
                  <span class="truncate">{{ itemById(id)!.name }}</span>
                </NuxtLink>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
