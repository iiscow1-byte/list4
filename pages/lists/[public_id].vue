<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'

/**
 * A custom list rendered as a complete list site: ranked levels with points
 * and records, its own leaderboard, packs, a submission form, and — for the
 * owner — a moderation queue.
 */
type Record_ = {
  id: number
  item_id: number
  player_name: string
  percent: number
  hz: number | null
  video: string | null
  mobile: number
  account_username: string | null
}
type Item = {
  id: number
  rank: number
  points: number
  level_id: number | null
  name: string
  gd_id: number | null
  creator: string | null
  difficulty: string | null
  gddl_tier: string | null
  verification_url: string | null
  notes: string | null
  verifier: string | null
  percent_to_qualify: number
  fps: string | null
  game_version: string | null
  position: number | null
  sheet_placement: number | null
  records: Record_[]
}
type Pack = { id: number; name: string; color: string | null; item_ids: number[] }
type List = {
  id: number
  public_id: string
  title: string
  description: string | null
  owner_username: string | null
  is_public: number
  likes: number
  accepts_records: number
  max_points: number
  min_points: number
  scored_count: number
  copied_from_public_id: string | null
  copied_from_title: string | null
  items: Item[]
  packs: Pack[]
}

const route = useRoute()
const router = useRouter()
const publicId = computed(() => String(route.params.public_id))

const { data, error, refresh } = await useFetch<{ list: List; can_edit: boolean; liked_by_me: boolean }>(
  () => `/api/custom-lists/${publicId.value}`,
)

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)
const list = computed(() => data.value?.list)

type Tab = 'list' | 'leaderboard' | 'packs' | 'submit' | 'queue'
const tab = ref<Tab>('list')

// --- Leaderboard (loaded on demand) ---
type LbRow = {
  rank: number; player_name: string; points: number; completions: number
  progresses: number; hardest_name: string | null; hardest_rank: number | null
  account_username: string | null
}
const leaderboard = ref<LbRow[]>([])
const lbLoaded = ref(false)
async function loadLeaderboard() {
  try {
    const res = await $fetch<{ leaderboard: LbRow[] }>(`/api/custom-lists/${publicId.value}/leaderboard`)
    leaderboard.value = res.leaderboard
  } catch { leaderboard.value = [] } finally { lbLoaded.value = true }
}

// --- Moderation queue ---
type PendingRecord = Record_ & {
  level_name: string; note: string | null; submitted_at: string; submitted_by_username: string | null
}
const pending = ref<PendingRecord[]>([])
const pendingCount = ref(0)
async function loadPending() {
  if (!data.value?.can_edit) return
  try {
    const res = await $fetch<{ records: PendingRecord[]; pending_count: number }>(
      `/api/custom-lists/${publicId.value}/records`, { query: { status: 'pending' } },
    )
    pending.value = res.records
    pendingCount.value = res.pending_count
  } catch { pending.value = [] }
}
watch(() => data.value?.can_edit, (v) => { if (v) loadPending() }, { immediate: true })
watch(tab, (t) => {
  if (t === 'leaderboard' && !lbLoaded.value) loadLeaderboard()
  if (t === 'queue') loadPending()
})

const busy = ref(false)
const notice = ref<string | null>(null)

async function decide(r: PendingRecord, action: 'approve' | 'reject') {
  if (busy.value) return
  const reason = action === 'reject' ? (prompt('Reason for rejecting (optional):') ?? '') : ''
  busy.value = true
  try {
    await $fetch(`/api/custom-lists/${publicId.value}/records/${r.id}`, {
      method: 'POST', body: { action, reason },
    })
    await Promise.all([loadPending(), refresh()])
    lbLoaded.value = false
    notice.value = action === 'approve' ? 'Record accepted.' : 'Record rejected.'
  } catch (e: any) {
    notice.value = e?.data?.statusMessage ?? 'Failed.'
  } finally { busy.value = false }
}

// --- Submission form ---
const submitItemId = ref<number | null>(null)
const submitPercent = ref('100')
const submitVideo = ref('')
const submitHz = ref('')
const submitPlayer = ref('')
const submitNote = ref('')
const submitMobile = ref(false)
const submitError = ref<string | null>(null)
const submitOk = ref(false)

watch(me, (v) => { if (v && !submitPlayer.value) submitPlayer.value = v.claimed_player ?? v.username }, { immediate: true })

async function submitRecord() {
  submitError.value = null
  submitOk.value = false
  if (!submitItemId.value) { submitError.value = 'Pick a level.'; return }
  if (!submitVideo.value.trim()) { submitError.value = 'A video link is required.'; return }
  busy.value = true
  try {
    const res = await $fetch<{ status: string }>(`/api/custom-lists/${publicId.value}/records`, {
      method: 'POST',
      body: {
        item_id: submitItemId.value,
        player_name: submitPlayer.value.trim() || undefined,
        percent: Number(submitPercent.value) || 100,
        hz: submitHz.value ? Number(submitHz.value) : undefined,
        video: submitVideo.value.trim(),
        mobile: submitMobile.value,
        note: submitNote.value.trim() || undefined,
      },
    })
    submitOk.value = true
    notice.value = res.status === 'approved'
      ? 'Record added to your list.'
      : 'Record submitted — the list owner will review it.'
    submitVideo.value = ''; submitNote.value = ''
    await refresh()
    lbLoaded.value = false
  } catch (e: any) {
    submitError.value = e?.data?.statusMessage ?? 'Submission failed.'
  } finally { busy.value = false }
}

// --- Like / copy / edit ---
const liked = ref(false)
const likeCount = ref(0)
watch(data, (d) => {
  liked.value = !!d?.liked_by_me
  likeCount.value = d?.list.likes ?? 0
}, { immediate: true })

async function toggleLike() {
  if (!me.value) { notice.value = 'Log in to like lists.'; return }
  try {
    const res = await $fetch<{ liked: boolean; likes: number }>(
      `/api/custom-lists/${publicId.value}/like`, { method: 'POST' },
    )
    liked.value = res.liked
    likeCount.value = res.likes
  } catch (e: any) { notice.value = e?.data?.statusMessage ?? 'Failed.' }
}

const { loadFrom } = useListBuilder()
async function editInBuilder() {
  if (!list.value) return
  loadFrom(list.value as any)
  await router.push('/builder')
}
async function copyList() {
  if (!me.value) { notice.value = 'Log in to copy a list.'; return }
  try {
    const res = await $fetch<{ list: any }>(`/api/custom-lists/${publicId.value}/copy`, { method: 'POST' })
    loadFrom(res.list)
    await router.push('/builder')
  } catch (e: any) { notice.value = e?.data?.statusMessage ?? 'Failed to copy.' }
}

const totalPoints = computed(() =>
  Math.round((list.value?.items ?? []).reduce((s, i) => s + i.points, 0) * 100) / 100,
)
const recordCount = computed(() =>
  (list.value?.items ?? []).reduce((s, i) => s + i.records.length, 0),
)

function itemById(id: number) {
  return list.value?.items.find((i) => i.id === id) ?? null
}

/** Pull a YouTube id out of any of the URL forms YouTube uses. */
function youtubeId(url: string | null): string | null {
  if (!url) return null
  for (const re of [
    /[?&]v=([A-Za-z0-9_-]{6,})/, /youtu\.be\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/, /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/,
  ]) {
    const m = url.match(re)
    if (m) return m[1]!
  }
  return null
}

const openItem = ref<number | null>(null)
const openLevel = computed(() => (openItem.value ? itemById(openItem.value) : null))

useHead(() => ({ title: list.value ? `${list.value.title} — All Levels List` : 'List' }))
</script>

<template>
  <div class="container-wide py-8 space-y-5">
    <div v-if="error" class="py-16 text-center">
      <p class="text-sm text-zinc-500">This list doesn't exist.</p>
      <NuxtLink to="/builder" class="text-accent hover:underline text-sm mt-2 inline-block">Build your own →</NuxtLink>
    </div>

    <template v-else-if="list">
      <!-- Header -->
      <header class="relative overflow-hidden rounded-2xl border border-zinc-800 px-5 py-5 sm:px-7 sm:py-6">
        <div class="absolute inset-0 flex opacity-60" aria-hidden="true">
          <div v-for="(i, n) in list.items.slice(0, 5)" :key="n" class="relative flex-1 overflow-hidden">
            <LevelThumbBg :gd-id="i.gd_id" res="small" img-class="opacity-40" />
          </div>
        </div>
        <div class="absolute inset-0 bg-gradient-to-r from-zinc-950 via-zinc-950/90 to-zinc-950/60" />
        <div class="relative">
          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-50">{{ list.title }}</h1>
          <p v-if="list.description" class="text-sm text-zinc-400 mt-1.5 max-w-2xl">{{ list.description }}</p>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] text-zinc-500">
            <span v-if="list.owner_username">
              by
              <NuxtLink :to="`/users/${encodeURIComponent(list.owner_username)}`" class="text-zinc-300 hover:text-accent transition-colors">
                {{ list.owner_username }}
              </NuxtLink>
            </span>
            <span class="tabular-nums">{{ list.items.length }} levels</span>
            <span class="tabular-nums">{{ recordCount }} records</span>
            <span class="tabular-nums">{{ totalPoints.toLocaleString() }} points on offer</span>
            <span v-if="!list.is_public" class="text-amber-400">Private</span>
            <span v-if="list.copied_from_public_id">
              copied from
              <NuxtLink :to="`/lists/${list.copied_from_public_id}`" class="text-zinc-400 hover:text-accent transition-colors">
                {{ list.copied_from_title }}
              </NuxtLink>
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-2 mt-4">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors"
              :class="liked ? 'border-accent/60 text-accent bg-accent/10' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'"
              @click="toggleLike"
            >
              <span aria-hidden="true">{{ liked ? '★' : '☆' }}</span>
              <span class="tabular-nums">{{ likeCount }}</span>
            </button>
            <button
              type="button"
              class="rounded-lg border border-zinc-700 text-zinc-300 text-xs px-2.5 py-1 hover:border-zinc-500 transition-colors"
              @click="copyList"
            >Copy</button>
            <button
              v-if="data!.can_edit"
              type="button"
              class="rounded-lg bg-accent text-zinc-950 font-semibold text-xs px-3 py-1 hover:bg-accent/90 transition-colors"
              @click="editInBuilder"
            >Edit in builder</button>
          </div>
        </div>
      </header>

      <p v-if="notice" class="text-sm text-emerald-400">{{ notice }}</p>

      <!-- Tabs -->
      <nav class="flex flex-wrap items-center gap-1 border-b border-zinc-800">
        <button
          v-for="t in ([
            { id: 'list', label: 'List' },
            { id: 'leaderboard', label: 'Leaderboard' },
            ...(list.packs.length ? [{ id: 'packs', label: 'Packs' }] : []),
            ...(list.accepts_records ? [{ id: 'submit', label: 'Submit a record' }] : []),
            ...(data!.can_edit ? [{ id: 'queue', label: 'Queue' }] : []),
          ] as { id: Tab; label: string }[])"
          :key="t.id"
          type="button"
          class="relative px-3 py-2 text-sm font-medium transition-colors -mb-px border-b-2"
          :class="tab === t.id
            ? 'text-accent border-accent'
            : 'text-zinc-500 border-transparent hover:text-zinc-200'"
          @click="tab = t.id"
        >
          {{ t.label }}
          <span
            v-if="t.id === 'queue' && pendingCount > 0"
            class="ml-1.5 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-500 text-[10px] tabular-nums font-semibold text-white"
          >{{ pendingCount }}</span>
        </button>
      </nav>

      <!-- LIST -->
      <ol v-if="tab === 'list'" class="space-y-1.5">
        <li
          v-for="item in list.items"
          :key="item.id"
          class="relative overflow-hidden rounded-xl border border-zinc-800/70 group"
        >
          <LevelThumbBg
            :gd-id="item.gd_id"
            res="medium"
            img-class="opacity-25 group-hover:opacity-45"
            overlay-class="bg-gradient-to-r from-zinc-950/94 via-zinc-950/75 to-zinc-950/35"
          />
          <div class="relative flex items-center gap-3 px-2.5 py-2.5">
            <span class="shrink-0 w-9 text-center tabular-nums text-lg font-bold text-accent">{{ item.rank }}</span>
            <span
              v-if="item.gddl_tier"
              class="shrink-0 text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold"
              :style="{ backgroundColor: tierColor(item.gddl_tier), color: textOn(tierColor(item.gddl_tier)) }"
            >{{ item.gddl_tier }}</span>
            <button
              type="button"
              class="flex-1 min-w-0 text-left"
              @click="openItem = openItem === item.id ? null : item.id"
            >
              <span class="block truncate font-medium text-zinc-50 group-hover:text-accent transition-colors">{{ item.name }}</span>
              <span class="block truncate text-[11px] text-zinc-500">
                <template v-if="item.creator">{{ item.creator }}</template>
                <template v-if="item.creator && item.verifier"> · </template>
                <template v-if="item.verifier">verified by {{ item.verifier }}</template>
                <template v-if="item.notes"> · {{ item.notes }}</template>
              </span>
            </button>
            <span class="shrink-0 text-right">
              <span class="block tabular-nums text-sm font-semibold text-amber-300">{{ item.points }}</span>
              <span class="block text-[10px] text-zinc-600">points</span>
            </span>
            <span class="shrink-0 hidden sm:block text-right w-16">
              <span class="block tabular-nums text-sm text-zinc-300">{{ item.records.length }}</span>
              <span class="block text-[10px] text-zinc-600">records</span>
            </span>
            <span v-if="item.percent_to_qualify < 100" class="shrink-0 text-[10px] text-zinc-500 tabular-nums">{{ item.percent_to_qualify }}%</span>
          </div>

          <!-- Expanded level detail -->
          <div v-if="openItem === item.id" class="relative border-t border-zinc-800/80 bg-zinc-950/80 p-4 space-y-4">
            <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
              <div class="space-y-3">
                <div v-if="youtubeId(item.verification_url)" class="aspect-video rounded-lg overflow-hidden border border-zinc-800 bg-black">
                  <iframe
                    :src="`https://www.youtube.com/embed/${youtubeId(item.verification_url)}`"
                    class="w-full h-full" frameborder="0" allowfullscreen
                    referrerpolicy="strict-origin-when-cross-origin" :title="item.name"
                  />
                </div>
                <a
                  v-else-if="item.verification_url"
                  :href="item.verification_url" target="_blank" rel="noopener"
                  class="inline-block text-xs text-accent hover:underline"
                >Watch the verification ↗</a>
                <dl class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div v-if="item.gd_id"><dt class="text-[10px] uppercase tracking-wider text-zinc-500">Level ID</dt><dd class="tabular-nums text-zinc-200">{{ item.gd_id }}</dd></div>
                  <div><dt class="text-[10px] uppercase tracking-wider text-zinc-500">To qualify</dt><dd class="tabular-nums text-zinc-200">{{ item.percent_to_qualify }}%</dd></div>
                  <div v-if="item.fps"><dt class="text-[10px] uppercase tracking-wider text-zinc-500">FPS</dt><dd class="text-zinc-200">{{ item.fps }}</dd></div>
                  <div v-if="item.game_version"><dt class="text-[10px] uppercase tracking-wider text-zinc-500">Version</dt><dd class="text-zinc-200">{{ item.game_version }}</dd></div>
                  <div v-if="item.difficulty"><dt class="text-[10px] uppercase tracking-wider text-zinc-500">Difficulty</dt><dd class="text-zinc-200">{{ item.difficulty }}</dd></div>
                  <div v-if="item.position"><dt class="text-[10px] uppercase tracking-wider text-zinc-500">On the ALL list</dt><dd><NuxtLink :to="`/levels/${item.position}`" class="text-accent hover:underline tabular-nums">#{{ item.sheet_placement ?? item.position }}</NuxtLink></dd></div>
                </dl>
              </div>

              <div>
                <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-2">
                  Records <span class="text-zinc-600 tabular-nums">{{ item.records.length }}</span>
                </h3>
                <p v-if="!item.records.length" class="text-xs text-zinc-600">No records yet.</p>
                <ul v-else class="space-y-1">
                  <li v-for="r in item.records" :key="r.id" class="flex items-center gap-2 text-xs">
                    <NuxtLink
                      v-if="r.account_username"
                      :to="`/users/${encodeURIComponent(r.account_username)}`"
                      class="truncate flex-1 text-zinc-200 hover:text-accent transition-colors"
                    >{{ r.player_name }}</NuxtLink>
                    <span v-else class="truncate flex-1 text-zinc-200">{{ r.player_name }}</span>
                    <span v-if="r.hz" class="text-zinc-600 tabular-nums shrink-0">{{ r.hz }}hz</span>
                    <a v-if="r.video" :href="r.video" target="_blank" rel="noopener" class="text-zinc-600 hover:text-accent shrink-0">▶</a>
                    <span class="tabular-nums text-amber-300 shrink-0">{{ r.percent }}%</span>
                  </li>
                </ul>
                <button
                  v-if="list.accepts_records"
                  type="button"
                  class="mt-3 w-full rounded-lg border border-zinc-700 text-zinc-300 text-xs px-3 py-1.5 hover:border-accent/50 hover:text-accent transition-colors"
                  @click="submitItemId = item.id; tab = 'submit'"
                >Submit a record for this level</button>
              </div>
            </div>
          </div>
        </li>
        <li v-if="!list.items.length" class="text-sm text-zinc-500 py-12 text-center">This list is empty.</li>
      </ol>

      <!-- LEADERBOARD -->
      <section v-else-if="tab === 'leaderboard'" class="card overflow-hidden">
        <div class="px-4 py-3 border-b border-zinc-800/80 flex items-center justify-between gap-2">
          <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Leaderboard</h2>
          <span class="text-[10px] text-zinc-600">
            #1 worth {{ list.max_points }} pts · last worth {{ list.min_points }}
          </span>
        </div>
        <p v-if="lbLoaded && !leaderboard.length" class="px-4 py-12 text-sm text-zinc-500 text-center">
          No approved records yet — the leaderboard fills in as records come in.
        </p>
        <ul v-else class="divide-y divide-zinc-900/60">
          <li v-for="p in leaderboard" :key="p.player_name" class="px-4 py-2.5 flex items-center gap-3 text-sm hover:bg-zinc-900/40 transition-colors">
            <span
              class="shrink-0 w-8 text-center tabular-nums font-bold"
              :class="p.rank === 1 ? 'text-amber-300' : p.rank <= 3 ? 'text-zinc-300' : 'text-zinc-600'"
            >{{ p.rank }}</span>
            <NuxtLink
              v-if="p.account_username"
              :to="`/users/${encodeURIComponent(p.account_username)}`"
              class="font-medium text-zinc-100 hover:text-accent transition-colors truncate"
            >{{ p.player_name }}</NuxtLink>
            <span v-else class="font-medium text-zinc-100 truncate">{{ p.player_name }}</span>
            <span v-if="p.hardest_name" class="hidden sm:block text-[11px] text-zinc-600 truncate flex-1">
              hardest: {{ p.hardest_name }}
            </span>
            <span class="ml-auto shrink-0 text-[11px] text-zinc-500 tabular-nums">
              {{ p.completions }} done<template v-if="p.progresses"> · {{ p.progresses }} prog</template>
            </span>
            <span class="shrink-0 tabular-nums text-amber-300 font-semibold w-20 text-right">{{ p.points }}</span>
          </li>
        </ul>
      </section>

      <!-- PACKS -->
      <section v-else-if="tab === 'packs'" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="p in list.packs" :key="p.id" class="card overflow-hidden">
          <div class="px-4 py-2.5 border-b border-zinc-800/80 flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-sm shrink-0" :style="{ backgroundColor: p.color || '#71717a' }" />
            <h2 class="text-sm font-semibold text-zinc-100 truncate">{{ p.name }}</h2>
            <span class="ml-auto text-[11px] text-zinc-600 tabular-nums">{{ p.item_ids.length }}</span>
          </div>
          <ul class="divide-y divide-zinc-900/60">
            <li v-for="id in p.item_ids" :key="id" class="px-4 py-1.5 text-sm text-zinc-300 truncate">
              <span class="text-zinc-600 tabular-nums text-[11px] mr-2">#{{ itemById(id)?.rank }}</span>
              {{ itemById(id)?.name }}
            </li>
          </ul>
        </div>
      </section>

      <!-- SUBMIT -->
      <section v-else-if="tab === 'submit'" class="card p-4 sm:p-5 max-w-2xl">
        <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold mb-3">Submit a record</h2>
        <p v-if="!me" class="text-sm text-zinc-500">
          <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink> to submit a record to this list.
        </p>
        <form v-else class="grid gap-3 sm:grid-cols-2" @submit.prevent="submitRecord">
          <label class="block sm:col-span-2">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Level *</span>
            <select
              v-model.number="submitItemId"
              class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option :value="null">Pick a level…</option>
              <option v-for="i in list.items" :key="i.id" :value="i.id">
                #{{ i.rank }} — {{ i.name }} ({{ i.percent_to_qualify }}%+)
              </option>
            </select>
          </label>
          <label class="block">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Player name</span>
            <input v-model="submitPlayer" type="text" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <label class="block">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Percent *</span>
            <input v-model="submitPercent" inputmode="numeric" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <label class="block sm:col-span-2">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Video link *</span>
            <input v-model="submitVideo" type="url" placeholder="https://youtube.com/watch?v=…" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <label class="block">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Refresh rate</span>
            <input v-model="submitHz" inputmode="numeric" placeholder="60" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <label class="flex items-end gap-2 pb-1.5 cursor-pointer select-none">
            <input v-model="submitMobile" type="checkbox" class="accent-accent" />
            <span class="text-xs text-zinc-400">Played on mobile</span>
          </label>
          <label class="block sm:col-span-2">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Note</span>
            <input v-model="submitNote" type="text" maxlength="500" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </label>
          <div class="sm:col-span-2 flex items-center gap-3">
            <button
              type="submit"
              :disabled="busy"
              class="rounded-lg bg-accent text-zinc-950 font-semibold text-sm px-4 py-1.5 hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >{{ busy ? 'Submitting…' : 'Submit record' }}</button>
            <span v-if="submitError" class="text-xs text-red-400">{{ submitError }}</span>
            <span v-else-if="submitOk" class="text-xs text-emerald-400">Sent.</span>
          </div>
        </form>
      </section>

      <!-- QUEUE (owner) -->
      <section v-else-if="tab === 'queue'" class="card overflow-hidden">
        <h2 class="px-4 py-3 border-b border-zinc-800/80 text-[10px] uppercase tracking-widest text-accent font-semibold">
          Pending records
        </h2>
        <p v-if="!pending.length" class="px-4 py-12 text-sm text-zinc-500 text-center">Nothing waiting for review.</p>
        <ul v-else class="divide-y divide-zinc-900/60">
          <li v-for="r in pending" :key="r.id" class="px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
            <div class="min-w-0 flex-1">
              <p class="text-zinc-100 truncate">
                <span class="font-medium">{{ r.player_name }}</span>
                <span class="text-zinc-500"> on </span>{{ r.level_name }}
                <span class="tabular-nums text-amber-300"> {{ r.percent }}%</span>
              </p>
              <p class="text-[11px] text-zinc-600 truncate">
                <span v-if="r.submitted_by_username">submitted by {{ r.submitted_by_username }}</span>
                <span v-if="r.hz"> · {{ r.hz }}hz</span>
                <span v-if="r.mobile"> · mobile</span>
                <span v-if="r.note"> · {{ r.note }}</span>
              </p>
            </div>
            <a v-if="r.video" :href="r.video" target="_blank" rel="noopener" class="text-xs text-zinc-500 hover:text-accent shrink-0">video ↗</a>
            <div class="flex items-center gap-1.5 shrink-0">
              <button
                type="button" :disabled="busy"
                class="rounded-lg bg-emerald-600/90 text-white text-xs px-3 py-1 hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                @click="decide(r, 'approve')"
              >Accept</button>
              <button
                type="button" :disabled="busy"
                class="rounded-lg border border-red-900/60 text-red-400 text-xs px-3 py-1 hover:bg-red-950/40 disabled:opacity-50 transition-colors"
                @click="decide(r, 'reject')"
              >Reject</button>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
