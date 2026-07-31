<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

type Item = {
  id: number
  level_id: number | null
  name: string
  gd_id: number | null
  creator: string | null
  difficulty: string | null
  gddl_tier: string | null
  verification_url: string | null
  notes: string | null
  position: number | null
}
type List = {
  public_id: string
  title: string
  description: string | null
  owner_username: string | null
  updated_at: string
  items: Item[]
}

const route = useRoute()
const publicId = computed(() => String(route.params.public_id))
const { data, error } = await useFetch<{ list: List; can_edit: boolean }>(
  () => `/api/custom-lists/${publicId.value}`,
)

const { loadFrom } = useListBuilder()
const router = useRouter()

/** Load into the builder and jump to the home page to edit. */
async function editList() {
  if (!data.value) return
  loadFrom(data.value.list as any)
  await router.push('/')
}

useHead(() => ({ title: data.value ? `${data.value.list.title} — All Levels List` : 'List' }))
</script>

<template>
  <div class="container-tight py-8 space-y-5">
    <div v-if="error" class="py-16 text-center">
      <p class="text-sm text-zinc-500">This list doesn't exist.</p>
      <NuxtLink to="/" class="text-accent hover:underline text-sm mt-2 inline-block">Build your own →</NuxtLink>
    </div>

    <template v-else-if="data">
      <header class="space-y-2">
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">{{ data.list.title }}</h1>
        <p v-if="data.list.description" class="text-sm text-zinc-400 leading-relaxed">{{ data.list.description }}</p>
        <div class="flex flex-wrap items-center gap-3 text-[11px] text-zinc-600">
          <span v-if="data.list.owner_username">
            by
            <NuxtLink :to="`/users/${encodeURIComponent(data.list.owner_username)}`" class="text-zinc-400 hover:text-accent transition-colors">
              {{ data.list.owner_username }}
            </NuxtLink>
          </span>
          <span class="tabular-nums">{{ data.list.items.length }} level{{ data.list.items.length === 1 ? '' : 's' }}</span>
          <button
            v-if="data.can_edit"
            type="button"
            class="text-accent hover:underline"
            @click="editList"
          >Edit in builder →</button>
        </div>
      </header>

      <ol class="space-y-1.5">
        <li
          v-for="(item, i) in data.list.items"
          :key="item.id"
          class="relative overflow-hidden flex items-center gap-3 rounded-xl border border-zinc-800/70 px-2 py-2.5 group"
        >
          <LevelThumbBg
            :gd-id="item.gd_id"
            res="medium"
            img-class="opacity-30 group-hover:opacity-50"
            overlay-class="bg-gradient-to-r from-zinc-950/92 via-zinc-950/65 to-zinc-950/25"
          />
          <span class="relative shrink-0 w-9 text-center tabular-nums text-lg font-bold text-accent">{{ i + 1 }}</span>
          <span
            v-if="item.gddl_tier"
            class="relative shrink-0 text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold"
            :style="{ backgroundColor: tierColor(item.gddl_tier), color: textOn(tierColor(item.gddl_tier)) }"
          >{{ item.gddl_tier }}</span>
          <div class="relative flex-1 min-w-0">
            <NuxtLink
              v-if="item.position"
              :to="`/levels/${item.position}`"
              class="block truncate font-medium text-zinc-100 hover:text-accent transition-colors"
            >{{ item.name }}</NuxtLink>
            <span v-else class="block truncate font-medium text-zinc-100">{{ item.name }}</span>
            <span v-if="item.creator || item.notes" class="block truncate text-[11px] text-zinc-500">
              <template v-if="item.creator">{{ item.creator }}</template>
              <template v-if="item.creator && item.notes"> · </template>
              <template v-if="item.notes">{{ item.notes }}</template>
            </span>
          </div>
          <a
            v-if="item.verification_url"
            :href="item.verification_url"
            target="_blank"
            rel="noopener"
            class="relative shrink-0 text-[11px] text-zinc-500 hover:text-accent transition-colors"
          >video ↗</a>
          <span v-if="item.position" class="relative shrink-0 text-[10px] text-zinc-600 tabular-nums">ALL #{{ item.position }}</span>
        </li>
      </ol>

      <p v-if="data.list.items.length === 0" class="text-sm text-zinc-500 py-8 text-center">This list is empty.</p>
    </template>
  </div>
</template>
