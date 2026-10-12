<script setup lang="ts">
definePageMeta({ layout: 'level' })

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const { list } = useCustomList(publicId)
const showThumbs = useShowThumbnails()

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
          <ul class="p-1.5 space-y-1">
            <li v-for="id in p.item_ids" :key="id">
              <LevelRow
                v-if="itemById(id)"
                :to="`/lists/${publicId}/${itemById(id)!.rank}`"
                :rank="`#${itemById(id)!.rank}`"
                :name="itemById(id)!.name"
                :tier="itemById(id)!.gddl_tier"
                :gd-id="itemById(id)!.gd_id"
                :video-url="itemById(id)!.verification_url"
                :thumbs="showThumbs && l.show_thumbnails !== 0 && l.show_thumbnails !== false"
                :name-class="itemById(id)!.unverified ? 'truncate italic text-zinc-400' : 'truncate'"
              >
                <template #trailing>
                  <span
                    v-if="itemById(id)!.unverified"
                    class="text-xs px-1.5 py-px rounded bg-amber-950/60 text-amber-300/90 border border-amber-800/50"
                    title="Nobody has verified this level yet, so it can't be cleared"
                  >Unverified</span>
                  <span v-else class="text-[11px] tabular-nums text-amber-300/80">{{ itemById(id)!.points }}</span>
                </template>
              </LevelRow>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </CustomListShell>
</template>
