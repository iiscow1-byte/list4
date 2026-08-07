<script setup lang="ts">
/**
 * Gallery of custom lists.
 *
 * Two views over the same card: "Discover", which is every list its owner
 * published, and "My lists", which is everything you own — including the ones
 * you haven't published, since those are invisible in Discover by definition
 * and were previously only reachable from the builder.
 */
import { listAccentStyle } from '~/utils/custom-list-colors'

type CustomList = {
  public_id: string
  title: string
  description: string | null
  likes: number
  updated_at: string
  owner_username: string | null
  item_count: number
  liked_by_me: boolean
  cover_gd_ids: number[]
  accent_color: string | null
  icon_url: string | null
  /** Only present in the "mine" view. */
  is_public?: number
}

type View = 'discover' | 'mine'

// `?view=mine` so the header's "My lists" item can link straight here, and so
// the view survives a reload or a shared link.
const route = useRoute()
const view = ref<View>(route.query.view === 'mine' ? 'mine' : 'discover')
const sort = ref<'top' | 'new'>('top')
const search = ref('')

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

const { data, refresh } = await useFetch<{ lists: CustomList[] }>('/api/custom-lists/public', {
  query: computed(() => ({ sort: sort.value, search: search.value.trim() || undefined, limit: 60 })),
})

// Own lists are fetched separately and client-side: the endpoint needs the
// session, and the gallery has to work signed-out.
const myLists = ref<CustomList[] | null>(null)
const myListsError = ref<string | null>(null)

async function loadMyLists() {
  if (!me.value) { myLists.value = null; return }
  try {
    const res = await $fetch<{ lists: CustomList[] }>('/api/custom-lists')
    myLists.value = res.lists
    myListsError.value = null
  } catch (e: any) {
    myLists.value = []
    myListsError.value = e?.data?.statusMessage ?? 'Could not load your lists.'
  }
}
watch(me, loadMyLists, { immediate: true })

// Searching and sorting "My lists" happens here — the set is small, and the
// endpoint deliberately returns all of it so nothing you own can be hidden.
const shown = computed<CustomList[]>(() => {
  if (view.value === 'discover') return data.value?.lists ?? []
  const q = search.value.trim().toLowerCase()
  const rows = (myLists.value ?? []).filter(
    (l) => !q || l.title.toLowerCase().includes(q) || (l.description ?? '').toLowerCase().includes(q),
  )
  return sort.value === 'top'
    ? [...rows].sort((a, b) => b.likes - a.likes || b.updated_at.localeCompare(a.updated_at))
    : rows
})

const busy = ref<string | null>(null)
const error = ref<string | null>(null)

async function toggleLike(l: CustomList) {
  if (!me.value) { error.value = 'Log in to like lists.'; return }
  if (busy.value) return
  busy.value = l.public_id
  try {
    const res = await $fetch<{ liked: boolean; likes: number }>(
      `/api/custom-lists/${l.public_id}/like`, { method: 'POST' },
    )
    l.liked_by_me = res.liked
    l.likes = res.likes
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Failed.'
  } finally {
    busy.value = null
  }
}

const router = useRouter()
const { loadFrom } = useListBuilder()

async function copyList(l: CustomList) {
  if (!me.value) { error.value = 'Log in to copy a list.'; return }
  if (busy.value) return
  busy.value = l.public_id
  try {
    const res = await $fetch<{ list: any }>(`/api/custom-lists/${l.public_id}/copy`, { method: 'POST' })
    loadFrom(res.list)
    await router.push('/builder')
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Failed to copy.'
  } finally {
    busy.value = null
  }
}

let debounce: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (view.value !== 'discover') return
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => refresh(), 300)
})

watch(view, (v) => {
  router.replace({ query: v === 'mine' ? { ...route.query, view: 'mine' } : { ...route.query, view: undefined } })
})
// Back/forward through the two views.
watch(() => route.query.view, (v) => {
  const next: View = v === 'mine' ? 'mine' : 'discover'
  if (next !== view.value) view.value = next
})

useHead({ title: 'Custom lists — All Levels List' })
</script>

<template>
  <div class="container-wide py-8 space-y-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">Custom lists</h1>
        <p class="text-sm text-zinc-500 mt-1">Rankings built and shared by the community.</p>
      </div>
      <NuxtLink
        to="/builder"
        class="rounded-lg bg-accent text-zinc-950 font-semibold text-sm px-4 py-2 hover:bg-accent/90 transition-colors"
      >Build your own →</NuxtLink>
    </header>

    <div class="flex flex-wrap items-center gap-2">
      <div class="inline-flex rounded-lg border border-zinc-800 overflow-hidden">
        <button
          type="button"
          class="px-3 py-1 text-[11px] font-medium transition-colors"
          :class="view === 'discover' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
          @click="view = 'discover'"
        >Discover</button>
        <button
          type="button"
          class="px-3 py-1 text-[11px] font-medium transition-colors border-l border-zinc-800 flex items-center gap-1.5"
          :class="view === 'mine' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
          @click="view = 'mine'"
        >
          My lists
          <span v-if="myLists?.length" class="tabular-nums text-[10px] text-zinc-500">{{ myLists.length }}</span>
        </button>
      </div>

      <div class="inline-flex rounded-lg border border-zinc-800 overflow-hidden">
        <button
          type="button"
          class="px-3 py-1 text-[11px] font-medium transition-colors"
          :class="sort === 'top' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
          @click="sort = 'top'"
        >Most liked</button>
        <button
          type="button"
          class="px-3 py-1 text-[11px] font-medium transition-colors border-l border-zinc-800"
          :class="sort === 'new' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'"
          @click="sort = 'new'"
        >{{ view === 'mine' ? 'Recently edited' : 'Newest' }}</button>
      </div>

      <input
        v-model="search"
        type="search"
        :placeholder="view === 'mine' ? 'Search your lists…' : 'Search lists…'"
        class="ml-auto rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>

    <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
    <p v-if="view === 'mine' && myListsError" class="text-sm text-red-400">{{ myListsError }}</p>

    <p v-if="view === 'mine' && !me" class="text-sm text-zinc-500 py-12 text-center">
      <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink>
      to see the lists you've built.
    </p>

    <p v-else-if="shown.length === 0" class="text-sm text-zinc-500 py-12 text-center">
      <template v-if="view === 'mine'">
        You haven't built a list yet.
        <NuxtLink to="/builder" class="text-accent hover:underline">Start one →</NuxtLink>
      </template>
      <template v-else-if="search.trim()">No lists match “{{ search.trim() }}”.</template>
      <template v-else>
        No custom lists yet. <NuxtLink to="/builder" class="text-accent hover:underline">Be the first →</NuxtLink>
      </template>
    </p>

    <ul v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <!-- A list's own colour, on its card. The same `--c-accent` swap the list
           itself uses, so a list you recognise by its colour is recognisable
           here too — the like button, the "Open →" link and the rule under the
           cover all follow it. -->
      <li
        v-for="l in shown"
        :key="l.public_id"
        class="card overflow-hidden flex flex-col group"
        :style="listAccentStyle(l)"
      >
        <NuxtLink :to="`/lists/${l.public_id}`" class="relative block h-24 overflow-hidden bg-zinc-900">
          <div class="absolute inset-0 flex">
            <div
              v-for="(gd, i) in (l.cover_gd_ids.length ? l.cover_gd_ids : [null])"
              :key="`${gd}-${i}`"
              class="relative flex-1 overflow-hidden"
            >
              <LevelThumbBg :gd-id="gd" res="small" img-class="opacity-50 group-hover:opacity-70" />
            </div>
          </div>
          <div class="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/50 to-transparent" />
          <span
            v-if="l.is_public === 0"
            class="absolute top-2 right-2 rounded-full border border-zinc-700 bg-zinc-950/80 px-2 py-0.5 text-[9px] uppercase tracking-widest text-zinc-400"
          >Private</span>
          <h2 class="absolute bottom-2 left-3 right-3 flex items-center gap-1.5 font-semibold text-zinc-50 drop-shadow">
            <img
              v-if="l.icon_url"
              :src="l.icon_url"
              alt=""
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
              class="w-5 h-5 rounded shrink-0 object-cover border border-white/10"
            />
            <span class="truncate">{{ l.title }}</span>
          </h2>
          <span
            v-if="l.accent_color"
            class="absolute inset-x-0 bottom-0 h-0.5 bg-accent"
            aria-hidden="true"
          />
        </NuxtLink>

        <div class="p-3 flex-1 flex flex-col gap-2">
          <p v-if="l.description" class="text-xs text-zinc-500 line-clamp-2">{{ l.description }}</p>
          <div class="flex items-center gap-2 text-[11px] text-zinc-600 mt-auto">
            <NuxtLink
              v-if="l.owner_username && view === 'discover'"
              :to="`/users/${encodeURIComponent(l.owner_username)}`"
              class="hover:text-accent transition-colors truncate"
            >{{ l.owner_username }}</NuxtLink>
            <span class="tabular-nums">{{ view === 'discover' ? '· ' : '' }}{{ l.item_count }} levels</span>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              :disabled="busy === l.public_id"
              class="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50"
              :class="l.liked_by_me
                ? 'border-accent/60 text-accent bg-accent/10'
                : 'border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'"
              @click="toggleLike(l)"
            >
              <span aria-hidden="true">{{ l.liked_by_me ? '★' : '☆' }}</span>
              <span class="tabular-nums">{{ l.likes }}</span>
            </button>
            <NuxtLink
              v-if="view === 'mine'"
              :to="`/lists/${l.public_id}/settings`"
              class="rounded-lg border border-zinc-800 text-zinc-400 px-2 py-1 text-[11px] font-medium hover:text-zinc-200 hover:border-zinc-700 transition-colors"
            >Settings</NuxtLink>
            <button
              v-else
              type="button"
              :disabled="busy === l.public_id"
              class="rounded-lg border border-zinc-800 text-zinc-400 px-2 py-1 text-[11px] font-medium hover:text-zinc-200 hover:border-zinc-700 transition-colors disabled:opacity-50"
              title="Copy this list into your own"
              @click="copyList(l)"
            >Copy</button>
            <NuxtLink
              :to="`/lists/${l.public_id}`"
              class="ml-auto text-[11px] text-zinc-500 hover:text-accent transition-colors"
            >Open →</NuxtLink>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
