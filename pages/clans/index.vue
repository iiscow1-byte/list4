<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'
import { hexToRgbTriplet } from '~/utils/custom-list-colors'
import { isValidClanTag } from '~/utils/clan-tag'
import { clanIconUrl } from '~/utils/clan-images'

/**
 * Clans: groups of players, ranked by what they have beaten between them —
 * and, now, a place to go looking for one.
 *
 * The page used to be a points leaderboard and nothing else, which answered
 * one question ("who is winning") and refused the two that a person without a
 * clan actually has: *which of these could I join*, and *what has started
 * recently*. The top of a points ranking is precisely where a new clan looking
 * for members is not.
 *
 * So the ordering is a choice and there are two filters, and every row shows
 * its standing regardless of how the list is currently sorted — the rank means
 * "by points", wherever it appears.
 */
useHead({ title: 'Clans — All Levels List' })

type Clan = {
  id: number; tag: string; name: string; description: string | null
  color: string | null; icon_url: string | null; has_icon: boolean
  banner_url: string | null; has_banner: boolean
  invite_only: number; created_at: string
  owner_username: string | null
  members: number; levels: number; completions: number; points: number
  rank: number | null
  hardest: { position: number; sheet_placement: number | null; name: string; gddl_tier: string | null } | null
}

type Invite = {
  id: number; tag: string; name: string; color: string | null; icon_url: string | null
  message: string | null; created_at: string; invited_by_username: string | null
}

type Sort = 'points' | 'levels' | 'members' | 'newest' | 'name'
const SORTS: { value: Sort; label: string }[] = [
  { value: 'points',  label: 'Points' },
  { value: 'levels',  label: 'Levels' },
  { value: 'members', label: 'Members' },
  { value: 'newest',  label: 'Newest' },
  { value: 'name',    label: 'Name' },
]

const sort = ref<Sort>('points')
const search = ref('')
const joinable = ref<'' | 'open' | 'invite'>('')

/**
 * Debounced, because the query is a server round trip now rather than a filter
 * over an array already in hand. 200ms is long enough that typing a clan's name
 * is one request instead of eight, and short enough not to feel like a wait.
 */
const debouncedSearch = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { debouncedSearch.value = v.trim() }, 200)
})
onBeforeUnmount(() => { if (searchTimer) clearTimeout(searchTimer) })

const { data, refresh } = await useFetch<{
  clans: Clan[]
  total: number
  mine: { id: number; tag: string; name: string; color: string | null; role: string } | null
  invites: Invite[]
  signedIn: boolean
}>('/api/clans', {
  query: computed(() => ({
    sort: sort.value,
    q: debouncedSearch.value || undefined,
    joinable: joinable.value || undefined,
  })),
})

const shown = computed(() => data.value?.clans ?? [])
const total = computed(() => data.value?.total ?? 0)
/** Whether anything is currently narrowing the list — decides the empty text. */
const filtered = computed(() => !!debouncedSearch.value || !!joinable.value)

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

function iconFor(c: Clan) { return clanIconUrl(c) }

/** "3 days ago" for a clan founded recently; a date once it isn't news. */
function founded(at: string): string {
  const iso = at.includes('T') ? at : at.replace(' ', 'T') + 'Z'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const days = Math.floor((Date.now() - t) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

/** A clan's own colour, applied the same way a custom list's is. */
function clanStyle(c: { color: string | null }) {
  const rgb = hexToRgbTriplet(c.color)
  return rgb ? { '--c-accent': rgb } : undefined
}

// --- Starting one ---
const creating = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const form = reactive({ tag: '', name: '', description: '', color: '#f4c430', invite_only: false })
const tagOk = computed(() => !form.tag.trim() || isValidClanTag(form.tag.trim()))

/**
 * Answering an invite from here.
 *
 * An invite that can only be answered on the clan's own page is an invite you
 * have to already know about. This is the list of them, and it takes the answer
 * as well as showing it.
 */
const answering = ref<number | null>(null)
async function answerInvite(inv: Invite, action: 'join-invite' | 'reject-invite') {
  if (answering.value != null) return
  answering.value = inv.id
  error.value = null
  try {
    await $fetch(`/api/clans/${encodeURIComponent(inv.tag)}/membership`, {
      method: 'POST', body: { action },
    })
    await refresh()
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'That didn\'t work.'
  } finally {
    answering.value = null
  }
}

const router = useRouter()
async function create() {
  if (busy.value) return
  error.value = null
  busy.value = true
  try {
    const res = await $fetch<{ tag: string }>('/api/clans', { method: 'POST', body: { ...form } })
    await router.push(`/clans/${res.tag}`)
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not create that clan.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="container-tight max-w-5xl py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div class="min-w-0">
        <p class="text-[10px] uppercase tracking-widest text-accent font-semibold">Community</p>
        <h1 class="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-zinc-50">Clans</h1>
        <p class="mt-1 text-sm text-zinc-500 max-w-2xl">
          Groups of players ranked by their combined clears. Each level counts once per clan,
          no matter how many members have beaten it.
        </p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <NuxtLink
          v-if="data?.mine"
          :to="`/clans/${data.mine.tag}`"
          class="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-600 hover:text-zinc-100 transition-colors"
        >
          Your clan
          <ClanTag
            :tag="data.mine.tag"
            :name="data.mine.name"
            :color="data.mine.color"
            size="sm"
            variant="solid"
            :link="false"
          />
        </NuxtLink>
        <button
          v-else-if="data?.signedIn"
          type="button"
          class="btn btn-sm btn-ghost hover:border-accent/60 hover:text-accent"
          @click="creating = !creating"
        >{{ creating ? 'Cancel' : 'Start a clan' }}</button>
        <NuxtLink
          v-else
          to="/login"
          class="btn btn-sm btn-ghost hover:border-accent/60 hover:text-accent"
        >Log in to start one</NuxtLink>
      </div>
    </header>

    <!-- Invites waiting on you. Above everything, because it is the only thing
         on this page that is asking a question. -->
    <section v-if="data?.invites?.length" class="space-y-2">
      <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">
        You've been invited
        <span class="ml-1 normal-case tracking-normal text-zinc-600 tabular-nums">{{ data.invites.length }}</span>
      </h2>
      <ul class="space-y-2">
        <li
          v-for="inv in data.invites"
          :key="inv.id"
          class="card px-3 sm:px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2"
          :style="clanStyle(inv)"
        >
          <ClanTag :tag="inv.tag" :name="inv.name" :color="inv.color" variant="solid" class="shrink-0" />
          <div class="min-w-0 flex-1">
            <NuxtLink :to="`/clans/${inv.tag}`" class="block truncate text-sm font-semibold text-zinc-100 hover:text-accent transition-colors">
              {{ inv.name }}
            </NuxtLink>
            <p class="text-[11px] text-zinc-600 truncate">
              <template v-if="inv.invited_by_username">invited by {{ inv.invited_by_username }}</template>
              <template v-if="inv.message"> · “{{ inv.message }}”</template>
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              type="button"
              :disabled="answering != null || !!data.mine"
              :title="data.mine ? 'Leave your current clan first' : undefined"
              class="btn btn-sm btn-primary"
              @click="answerInvite(inv, 'join-invite')"
            >Join</button>
            <button
              type="button"
              :disabled="answering != null"
              class="btn btn-sm btn-ghost hover:border-red-800 hover:text-red-300"
              @click="answerInvite(inv, 'reject-invite')"
            >Dismiss</button>
          </div>
        </li>
      </ul>
      <p v-if="data.mine" class="text-[11px] text-zinc-600">
        You're already in a clan. Leave it first to accept an invite.
      </p>
    </section>

    <!-- New clan -->
    <form v-if="creating" class="card p-4 grid gap-3 sm:grid-cols-2" @submit.prevent="create">
      <label class="block">
        <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Tag <span class="text-zinc-600 normal-case">2–6 letters or digits</span></span>
        <input
          v-model="form.tag"
          maxlength="6"
          placeholder="TSK"
          class="mt-1 w-full rounded-lg border bg-zinc-900 px-3 py-2 text-sm uppercase tracking-widest focus:outline-none focus:ring-1 focus:ring-accent"
          :class="tagOk ? 'border-zinc-800 focus:border-accent' : 'border-red-800'"
        />
      </label>
      <label class="block">
        <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Name</span>
        <input v-model="form.name" maxlength="60" placeholder="The Skeleton Key" class="field field-md mt-1" />
      </label>
      <label class="block sm:col-span-2">
        <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Description</span>
        <textarea v-model="form.description" rows="2" maxlength="500" placeholder="What this clan is about." class="field field-md mt-1" />
      </label>
      <div class="flex items-center gap-4 sm:col-span-2 flex-wrap">
        <label class="flex items-center gap-2 text-xs text-zinc-400">
          Colour
          <input v-model="form.color" type="color" class="h-8 w-12 rounded border border-zinc-800 bg-zinc-900 cursor-pointer" />
        </label>
        <label class="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
          <input v-model="form.invite_only" type="checkbox" class="accent-accent" />
          Invite only
        </label>
        <button
          type="submit"
          :disabled="busy || !form.tag.trim() || !form.name.trim() || !tagOk"
          class="btn btn-md btn-primary ml-auto"
        >{{ busy ? 'Creating…' : 'Create clan' }}</button>
      </div>
      <p v-if="error" class="sm:col-span-2 text-xs text-red-400">{{ error }}</p>
    </form>

    <!-- Browse controls. One row: what to search for, what to order by, and
         whether to hide the clans you'd have to ask to get into. -->
    <div class="card px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
      <input
        v-model="search"
        type="search"
        placeholder="Search clans by name or tag…"
        class="field field-sm flex-1 min-w-[12rem] text-xs"
      />
      <label class="flex items-center gap-2 text-[11px] text-zinc-500">
        Sort
        <select v-model="sort" class="field field-sm text-xs w-28">
          <option v-for="s in SORTS" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </label>
      <div class="flex items-center gap-1.5">
        <label
          v-for="opt in ([
            { value: '', label: 'All' },
            { value: 'open', label: 'Open to join' },
            { value: 'invite', label: 'Invite only' },
          ] as const)"
          :key="opt.value"
          class="cursor-pointer select-none px-2 py-0.5 rounded-lg border text-[11px] transition-colors"
          :class="joinable === opt.value
            ? 'border-accent/60 text-accent bg-accent/10'
            : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
        >
          <input v-model="joinable" type="radio" :value="opt.value" class="sr-only" />
          {{ opt.label }}
        </label>
      </div>
      <span class="text-[11px] text-zinc-600 tabular-nums ml-auto">
        {{ shown.length }}<template v-if="shown.length !== total"> of {{ total }}</template>
        clan{{ total === 1 ? '' : 's' }}
      </span>
    </div>

    <p v-if="!total" class="card px-6 py-12 text-center text-sm text-zinc-500">
      No clans yet.
      <template v-if="data?.signedIn">Start the first one.</template>
    </p>
    <p v-else-if="!shown.length" class="card px-6 py-10 text-center text-sm text-zinc-500">
      <template v-if="debouncedSearch">No clans match “{{ debouncedSearch }}”.</template>
      <template v-else-if="joinable === 'open'">Every clan is invite only right now.</template>
      <template v-else>No clans match those filters.</template>
    </p>

    <!-- The leaderboard -->
    <ol v-else class="space-y-2">
      <li
        v-for="c in shown"
        :key="c.id"
        class="card overflow-hidden"
        :style="clanStyle(c)"
        :class="data?.mine?.id === c.id ? 'ring-1 ring-inset ring-accent/40' : ''"
      >
        <NuxtLink :to="`/clans/${c.tag}`" class="flex items-center gap-3 px-3 sm:px-4 py-3 group">
          <!-- The clan's standing by points, not its position in this list.
               Ordering by "newest" doesn't make a young clan first overall, and
               a number that changed meaning with the sort would be a lie. -->
          <span
            class="w-8 shrink-0 text-center tabular-nums text-sm font-bold text-zinc-600"
            :title="c.rank ? `#${c.rank} by points` : undefined"
          >{{ c.rank ?? '—' }}</span>

          <span
            v-if="iconFor(c)"
            class="w-9 h-9 rounded-lg overflow-hidden border border-zinc-800 shrink-0 bg-zinc-900"
          >
            <img :src="iconFor(c)!" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="w-full h-full object-cover" />
          </span>
          <span
            v-else
            class="w-9 h-9 rounded-lg border border-zinc-800 bg-zinc-900 shrink-0 flex items-center justify-center text-[10px] font-black uppercase text-accent"
          >{{ c.tag.slice(0, 3) }}</span>

          <span class="min-w-0 flex-1">
            <span class="flex items-baseline gap-2 min-w-0">
              <!-- The same tag component that prints beside a member's name
                   everywhere else, so a clan is recognisable from its tag alone
                   rather than only from this page. -->
              <ClanTag :tag="c.tag" :name="c.name" :color="c.color" :link="false" class="self-center" />
              <span class="truncate font-semibold text-zinc-100 group-hover:text-accent transition-colors">{{ c.name }}</span>
              <!-- Whether you can simply join. The single most useful fact on
                   this row for somebody who hasn't got a clan yet. -->
              <span
                v-if="!c.invite_only"
                class="shrink-0 text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-emerald-900/60 bg-emerald-950/40 text-emerald-400/90"
              >Open</span>
              <span
                v-else
                class="shrink-0 text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-zinc-800 text-zinc-600"
              >Invite only</span>
            </span>
            <span class="block truncate text-[11px] text-zinc-600">
              {{ c.members }} member{{ c.members === 1 ? '' : 's' }}
              <template v-if="c.owner_username"> · run by {{ c.owner_username }}</template>
              <template v-if="sort === 'newest'"> · started {{ founded(c.created_at) }}</template>
              <template v-else-if="c.hardest">
                · hardest
                <span class="text-zinc-500">{{ c.hardest.name }}</span>
              </template>
            </span>
            <span v-if="c.description" class="block truncate text-[11px] text-zinc-500 mt-0.5">{{ c.description }}</span>
          </span>

          <span
            v-if="c.hardest?.gddl_tier"
            class="hidden sm:inline-block shrink-0 text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold"
            :style="{ backgroundColor: tierColor(c.hardest.gddl_tier), color: textOn(tierColor(c.hardest.gddl_tier)) }"
          >{{ c.hardest.gddl_tier }}</span>

          <span class="shrink-0 text-right w-16">
            <span class="block text-sm font-semibold tabular-nums text-amber-300">{{ fmt(c.points) }}</span>
            <span class="block text-[10px] text-zinc-600">points</span>
          </span>
          <span class="shrink-0 text-right w-14 hidden sm:block">
            <span class="block text-sm font-semibold tabular-nums text-zinc-200">{{ fmt(c.levels) }}</span>
            <span class="block text-[10px] text-zinc-600">levels</span>
          </span>
        </NuxtLink>
      </li>
    </ol>
  </div>
</template>
