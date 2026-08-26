<script setup lang="ts">
definePageMeta({ layout: 'level' })

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const { list } = useCustomList(publicId)

function itemById(id: number) {
  return list.value?.items.find((i: any) => i.id === id) ?? null
}

useHead(() => ({ title: list.value ? `Packs — ${list.value.title}` : 'Packs' }))
</script>

<template>
  <CustomListShell :public-id="publicId" width="wide" title="Packs">
    <template #default="{ list: l }">
      <div v-if="!l.packs.length" class="card px-6 py-16 text-center">
        <p class="text-sm text-zinc-400">This list has no packs.</p>
        <p class="text-xs text-zinc-600 mt-1">Packs group levels under a name and colour.</p>
      </div>

      <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <section
          v-for="p in l.packs"
          :key="p.id"
          class="card overflow-hidden"
          :style="{ borderColor: p.color ? `${p.color}55` : undefined }"
        >
          <header
            class="px-4 py-2.5 border-b border-zinc-800/80 flex items-center gap-2"
            :style="{ backgroundColor: p.color ? `${p.color}12` : undefined }"
          >
            <span class="w-2.5 h-2.5 rounded-sm shrink-0" :style="{ backgroundColor: p.color || '#71717a' }" />
            <h3 class="text-sm font-semibold text-zinc-100 truncate">{{ p.name }}</h3>
            <span class="ml-auto text-[11px] text-zinc-600 tabular-nums shrink-0">{{ p.item_ids.length }}</span>
          </header>
          <ul class="divide-y divide-zinc-900/60">
            <li v-for="id in p.item_ids" :key="id">
              <NuxtLink
                v-if="itemById(id)"
                :to="`/lists/${publicId}/${itemById(id)!.rank}`"
                class="relative overflow-hidden flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:text-accent transition-colors group"
              >
                <LevelThumbBg
                  :gd-id="itemById(id)!.gd_id"
                  :video-url="itemById(id)!.verification_url"
                  res="small"
                  img-class="opacity-20 group-hover:opacity-40"
                  overlay-class="bg-gradient-to-r from-zinc-950/92 via-zinc-950/70 to-zinc-950/40"
                />
                <span class="relative text-zinc-600 tabular-nums text-[11px] shrink-0 w-7">#{{ itemById(id)!.rank }}</span>
                <span class="relative truncate" :class="itemById(id)!.unverified ? 'text-zinc-500 italic' : ''">
                  {{ itemById(id)!.name }}
                </span>
                <span
                  v-if="itemById(id)!.unverified"
                  class="relative shrink-0 text-[9px] uppercase tracking-widest px-1.5 py-px rounded bg-amber-950/60 text-amber-300/90 border border-amber-800/50"
                  title="Nobody has verified this level yet — it can't be cleared"
                >Unverified</span>
                <span
                  v-else
                  class="relative ml-auto shrink-0 text-[10px] tabular-nums text-amber-300/70"
                >{{ itemById(id)!.points }}</span>
              </NuxtLink>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </CustomListShell>
</template>
