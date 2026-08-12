<script setup lang="ts">
import { relativeTime } from '~/utils/relative-time'

/**
 * The forum, as a section of the community hub.
 *
 * It had a page and a menu entry of its own for about a day, and that was the
 * wrong shape: "read what people are doing" and "talk about it" are not two
 * places on a site, they are the same room — and splitting them across two nav
 * entries meant a visitor picked one and never saw the other, so neither half
 * was ever busy.
 *
 * A component rather than a page so the hub can host it beside the feed without
 * `pages/community/index.vue` growing to eight hundred lines of two unrelated
 * concerns.
 */
const props = defineProps<{
  /**
   * Narrow to one level's threads. Set when arriving from a level's page, which
   * is the one place that links here with something already in mind.
   */
  levelId?: number | null
}>()

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  levels: 'Levels',
  progress: 'Progress',
  help: 'Help & advice',
  offtopic: 'Off topic',
}
const CATEGORIES = Object.keys(CATEGORY_LABELS)

type Thread = {
  id: number
  category: string
  title: string
  pinned: boolean
  locked: boolean
  reply_count: number
  likes: number
  liked: boolean
  created_at: string
  last_post_at: string
  author: {
    username: string; role: string; has_avatar: boolean
    clan: { tag: string; name: string; color: string | null } | null
  } | null
  level: {
    id: number; position: number; sheet_placement: number | null; name: string; gd_id: number | null
  } | null
}

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

const category = ref<string>('')
const sort = ref<'active' | 'new' | 'top'>('active')
const search = ref('')
const debounced = ref('')
let timer: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { debounced.value = v.trim() }, 220)
})
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })

/** Local, so "show the whole forum" can clear it without a navigation. */
const levelFilter = ref<number | null>(props.levelId ?? null)
watch(() => props.levelId, (v) => { levelFilter.value = v ?? null })

const { data } = await useFetch<{
  total: number
  items: Thread[]
  counts: Record<string, number>
  signedIn: boolean
}>('/api/forum', {
  query: computed(() => ({
    category: category.value || undefined,
    sort: sort.value,
    q: debounced.value || undefined,
    level_id: levelFilter.value ?? undefined,
    limit: 50,
  })),
})

const threads = computed(() => data.value?.items ?? [])
/** The level being filtered to, named — taken from whatever came back. */
const filterLevel = computed(() => (levelFilter.value ? threads.value[0]?.level ?? null : null))

/**
 * Starting a thread, in place.
 *
 * Behind a route of its own it would mean losing the list of what has already
 * been said — which is where a good half of new threads should start
 * ("somebody already asked this").
 */
const composeOpen = ref(false)
const posting = ref(false)
const postError = ref<string | null>(null)
const draft = reactive({ title: '', body: '', category: 'general', level_id: '' as string })

/** Attaching a level, by search rather than by id. Nobody knows level ids. */
type LevelHit = { id: number; position: number; sheet_placement: number | null; name: string }
const levelQuery = ref('')
const levelHits = ref<LevelHit[]>([])
const levelPicked = ref<LevelHit | null>(null)
let levelTimer: ReturnType<typeof setTimeout> | null = null

watch(levelQuery, (q) => {
  if (levelTimer) clearTimeout(levelTimer)
  if (q.trim().length < 2) { levelHits.value = []; return }
  levelTimer = setTimeout(async () => {
    try {
      const res = await $fetch<{ items: LevelHit[] }>(
        '/api/levels', { query: { search: q.trim(), pageSize: 8 } },
      )
      levelHits.value = res.items
    } catch {
      levelHits.value = []
    }
  }, 220)
})
onBeforeUnmount(() => { if (levelTimer) clearTimeout(levelTimer) })

function pickLevel(l: LevelHit) {
  levelPicked.value = l
  draft.level_id = String(l.id)
  levelQuery.value = ''
  levelHits.value = []
  // A thread about a level belongs in the levels category unless the author
  // has already said otherwise.
  if (draft.category === 'general') draft.category = 'levels'
}
function clearLevel() {
  levelPicked.value = null
  draft.level_id = ''
}

const router = useRouter()
async function submit() {
  if (posting.value) return
  posting.value = true
  postError.value = null
  try {
    const res = await $fetch<{ id: number }>('/api/forum', {
      method: 'POST',
      body: {
        title: draft.title,
        body: draft.body,
        category: draft.category,
        level_id: draft.level_id || null,
      },
    })
    await router.push(`/community/thread/${res.id}`)
  } catch (e: any) {
    postError.value = e?.data?.statusMessage ?? 'Could not post that.'
  } finally {
    posting.value = false
  }
}

async function toggleLike(t: Thread) {
  if (!me.value) return
  const wasLiked = t.liked
  // Optimistic: a like is instant feedback or it is nothing.
  t.liked = !wasLiked
  t.likes += wasLiked ? -1 : 1
  try {
    await $fetch(`/api/forum/${t.id}`, {
      method: 'POST',
      body: { action: wasLiked ? 'unlike' : 'like' },
    })
  } catch {
    t.liked = wasLiked
    t.likes += wasLiked ? 1 : -1
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Compose, above the list. The button that opens it is in the hub's own
         header, so this is only the form. -->
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <p class="text-sm text-zinc-500 min-w-0">
        Talk about levels, post progress, ask for advice. A thread can name a level — those
        show up on that level's own page.
      </p>
      <button
        v-if="me"
        type="button"
        class="btn btn-sm btn-primary shrink-0"
        @click="composeOpen = !composeOpen"
      >{{ composeOpen ? 'Cancel' : 'New thread' }}</button>
      <NuxtLink v-else to="/login" class="btn btn-sm btn-ghost shrink-0 hover:border-accent/60 hover:text-accent">
        Log in to post
      </NuxtLink>
    </div>

    <form v-if="composeOpen && me" class="card p-4 space-y-3" @submit.prevent="submit">
      <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <label class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Title</span>
          <input v-model="draft.title" maxlength="140" placeholder="What's this about?" class="field field-md mt-1" />
        </label>
        <label class="block">
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Category</span>
          <select v-model="draft.category" class="field field-md mt-1">
            <option v-for="c in CATEGORIES" :key="c" :value="c">{{ CATEGORY_LABELS[c] }}</option>
          </select>
        </label>
      </div>

      <label class="block">
        <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Post</span>
        <textarea
          v-model="draft.body"
          rows="5"
          maxlength="8000"
          placeholder="Say what you mean."
          class="field field-md mt-1"
        />
      </label>

      <!-- Attach a level, by name. Nobody knows level ids. -->
      <div class="block relative">
        <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">
          About a level <span class="text-zinc-600 normal-case">optional</span>
        </span>
        <div v-if="levelPicked" class="mt-1 flex items-center gap-2">
          <span class="inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs text-accent">
            #{{ levelPicked.sheet_placement ?? levelPicked.position }} {{ levelPicked.name }}
          </span>
          <button type="button" class="text-[11px] text-zinc-500 hover:text-red-400 transition-colors" @click="clearLevel">
            Remove
          </button>
        </div>
        <template v-else>
          <input v-model="levelQuery" placeholder="Search a level by name…" class="field field-md mt-1" />
          <ul
            v-if="levelHits.length"
            class="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto popover py-1"
          >
            <li v-for="l in levelHits" :key="l.id">
              <button
                type="button"
                class="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-900 transition-colors flex items-center gap-2"
                @click="pickLevel(l)"
              >
                <span class="tabular-nums text-zinc-600 shrink-0">#{{ l.sheet_placement ?? l.position }}</span>
                <span class="truncate text-zinc-200">{{ l.name }}</span>
              </button>
            </li>
          </ul>
        </template>
      </div>

      <div class="flex items-center gap-3">
        <p v-if="postError" class="text-xs text-red-400 flex-1">{{ postError }}</p>
        <span v-else class="flex-1" />
        <button
          type="submit"
          :disabled="posting || draft.title.trim().length < 3 || draft.body.trim().length < 2"
          class="btn btn-md btn-primary"
        >{{ posting ? 'Posting…' : 'Post thread' }}</button>
      </div>
    </form>

    <!-- Arrived from a level's page. Named and removable, because a filtered
         board that doesn't say it is filtered reads as an empty forum. -->
    <div v-if="levelFilter" class="flex items-center gap-2 flex-wrap">
      <span class="inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs text-accent">
        Threads about
        <template v-if="filterLevel">
          #{{ filterLevel.sheet_placement ?? filterLevel.position }} {{ filterLevel.name }}
        </template>
        <template v-else>this level</template>
      </span>
      <button
        type="button"
        class="text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors"
        @click="levelFilter = null"
      >Show the whole forum</button>
    </div>

    <!-- Filters -->
    <div class="card px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div class="flex flex-wrap items-center gap-1.5">
        <label
          class="cursor-pointer select-none px-2 py-0.5 rounded-lg border text-[11px] transition-colors"
          :class="category === ''
            ? 'border-accent/60 text-accent bg-accent/10'
            : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
        >
          <input v-model="category" type="radio" value="" class="sr-only" />
          All
        </label>
        <label
          v-for="c in CATEGORIES"
          :key="c"
          class="cursor-pointer select-none px-2 py-0.5 rounded-lg border text-[11px] transition-colors"
          :class="category === c
            ? 'border-accent/60 text-accent bg-accent/10'
            : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
        >
          <input v-model="category" type="radio" :value="c" class="sr-only" />
          {{ CATEGORY_LABELS[c] }}
          <span v-if="data?.counts?.[c]" class="text-zinc-600 tabular-nums">{{ data.counts[c] }}</span>
        </label>
      </div>
      <input
        v-model="search"
        type="search"
        placeholder="Search threads…"
        class="field field-sm flex-1 min-w-[10rem] text-xs"
      />
      <SegmentedControl
        v-model="sort"
        size="sm"
        aria-label="Sort threads"
        :options="[
          { value: 'active', label: 'Active' },
          { value: 'new', label: 'New' },
          { value: 'top', label: 'Top' },
        ]"
      />
    </div>

    <!-- Threads -->
    <p v-if="!threads.length" class="card px-6 py-16 text-center text-sm text-zinc-500">
      <template v-if="debounced">No threads match “{{ debounced }}”.</template>
      <template v-else-if="category">Nothing in {{ CATEGORY_LABELS[category] }} yet.</template>
      <template v-else>No threads yet. Start the first one.</template>
    </p>

    <ul v-else class="card divide-y divide-zinc-900/70 overflow-hidden">
      <li
        v-for="t in threads"
        :key="t.id"
        class="relative overflow-hidden group/row"
        :class="t.pinned ? 'bg-accent/[0.04]' : ''"
      >
        <LevelThumbBg
          v-if="t.level?.gd_id"
          :gd-id="t.level.gd_id"
          res="small"
          img-class="opacity-[0.10] group-hover/row:opacity-20"
          overlay-class="bg-gradient-to-r from-zinc-950/96 via-zinc-950/88 to-zinc-950/60"
        />
        <div class="relative px-4 py-3 flex items-start gap-3">
          <NuxtLink
            v-if="t.author"
            :to="`/users/${encodeURIComponent(t.author.username)}`"
            class="shrink-0 mt-0.5"
          >
            <span class="w-9 h-9 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/60 flex items-center justify-center">
              <img
                v-if="t.author.has_avatar"
                :src="`/api/users/${encodeURIComponent(t.author.username)}/avatar`"
                class="w-full h-full object-cover" alt="" loading="lazy"
              />
              <span v-else class="text-[11px] font-bold uppercase text-zinc-400">{{ t.author.username.charAt(0) }}</span>
            </span>
          </NuxtLink>
          <span v-else class="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 shrink-0" aria-hidden="true" />

          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-2 flex-wrap">
              <span v-if="t.pinned" class="text-[9px] uppercase tracking-widest text-accent shrink-0" title="Pinned">📌</span>
              <NuxtLink
                :to="`/community/thread/${t.id}`"
                class="font-semibold text-zinc-100 hover:text-accent transition-colors truncate max-w-full"
              >{{ t.title }}</NuxtLink>
              <span v-if="t.locked" class="text-[9px] uppercase tracking-widest text-zinc-600 shrink-0">locked</span>
              <span class="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-zinc-800 text-zinc-500 shrink-0">
                {{ CATEGORY_LABELS[t.category] ?? t.category }}
              </span>
            </div>

            <p class="mt-1 text-[11px] text-zinc-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <template v-if="t.author">
                <NuxtLink
                  :to="`/users/${encodeURIComponent(t.author.username)}`"
                  class="text-zinc-400 hover:text-accent transition-colors"
                >{{ t.author.username }}</NuxtLink>
                <ClanTag
                  v-if="t.author.clan"
                  :tag="t.author.clan.tag" :name="t.author.clan.name" :color="t.author.clan.color"
                  size="sm" :link="false"
                />
              </template>
              <span v-else class="text-zinc-600">deleted account</span>
              <span class="text-zinc-700">·</span>
              <span class="tabular-nums">{{ relativeTime(t.created_at) }}</span>
              <template v-if="t.level">
                <span class="text-zinc-700">·</span>
                <NuxtLink
                  :to="`/levels/${t.level.position}`"
                  class="text-zinc-400 hover:text-accent transition-colors truncate"
                >#{{ t.level.sheet_placement ?? t.level.position }} {{ t.level.name }}</NuxtLink>
              </template>
            </p>
          </div>

          <div class="shrink-0 flex items-center gap-3 text-[11px]">
            <button
              type="button"
              :disabled="!me"
              class="inline-flex items-center gap-1 tabular-nums transition-colors disabled:cursor-default"
              :class="t.liked ? 'text-accent' : 'text-zinc-600 enabled:hover:text-accent'"
              :title="me ? (t.liked ? 'Remove your like' : 'Like this thread') : 'Log in to like'"
              @click="toggleLike(t)"
            >
              <span aria-hidden="true">{{ t.liked ? '★' : '☆' }}</span>{{ t.likes }}
            </button>
            <NuxtLink
              :to="`/community/thread/${t.id}`"
              class="text-right text-zinc-500 hover:text-accent transition-colors"
              :title="`${t.reply_count} repl${t.reply_count === 1 ? 'y' : 'ies'}`"
            >
              <span class="block text-sm font-semibold tabular-nums text-zinc-300">{{ t.reply_count }}</span>
              <span class="block text-[9px] uppercase tracking-widest text-zinc-600">repl{{ t.reply_count === 1 ? 'y' : 'ies' }}</span>
            </NuxtLink>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
