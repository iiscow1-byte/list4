<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'
import { hexToRgbTriplet } from '~/utils/custom-list-colors'
import { isValidClanTag } from '~/utils/clan-tag'

/**
 * Clans: groups of players, ranked by what they have beaten between them.
 *
 * The leaderboard is the page. A clan's numbers are the sum of its members'
 * completions, read live — so the standing here is never a stored total that
 * has drifted from the records behind it.
 */
useHead({ title: 'Clans — All Levels List' })

type Clan = {
  id: number; tag: string; name: string; description: string | null
  color: string | null; icon_url: string | null; owner_username: string | null
  members: number; levels: number; completions: number; points: number
  hardest: { position: number; sheet_placement: number | null; name: string; gddl_tier: string | null } | null
}

const { data, refresh } = await useFetch<{
  clans: Clan[]
  mine: { id: number; tag: string; name: string; color: string | null; role: string } | null
  signedIn: boolean
}>('/api/clans')

const clans = computed(() => data.value?.clans ?? [])
const search = ref('')
const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return clans.value
  return clans.value.filter(
    (c) => c.name.toLowerCase().includes(q) || c.tag.toLowerCase().includes(q),
  )
})

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

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
          Groups of players, ranked by what they've beaten between them. A clan's points count
          each level once, however many members have it — so a clan climbs by covering more of
          the list, not by having the same level several times over.
        </p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <NuxtLink
          v-if="data?.mine"
          :to="`/clans/${data.mine.tag}`"
          class="inline-flex items-center gap-1.5 rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
        >
          Your clan
          <ClanTag :tag="data.mine.tag" :name="data.mine.name" :color="data.mine.color" size="sm" :link="false" />
        </NuxtLink>
        <button
          v-else-if="data?.signedIn"
          type="button"
          class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-accent/60 hover:text-accent transition-colors"
          @click="creating = !creating"
        >{{ creating ? 'Cancel' : 'Start a clan' }}</button>
        <NuxtLink
          v-else
          to="/login"
          class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-accent/60 hover:text-accent transition-colors"
        >Log in to start one</NuxtLink>
      </div>
    </header>

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
        <input v-model="form.name" maxlength="60" placeholder="The Skeleton Key" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
      </label>
      <label class="block sm:col-span-2">
        <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Description</span>
        <textarea v-model="form.description" rows="2" maxlength="500" placeholder="What this clan is about." class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
      </label>
      <div class="flex items-center gap-4 sm:col-span-2 flex-wrap">
        <label class="flex items-center gap-2 text-xs text-zinc-400">
          Colour
          <input v-model="form.color" type="color" class="h-8 w-12 rounded border border-zinc-800 bg-zinc-900 cursor-pointer" />
        </label>
        <label class="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
          <input v-model="form.invite_only" type="checkbox" class="accent-accent" />
          Ask before joining
        </label>
        <button
          type="submit"
          :disabled="busy || !form.tag.trim() || !form.name.trim() || !tagOk"
          class="ml-auto rounded-lg bg-accent text-zinc-950 font-semibold text-sm px-4 py-2 hover:bg-accent/90 disabled:opacity-40 transition-colors"
        >{{ busy ? 'Creating…' : 'Create clan' }}</button>
      </div>
      <p v-if="error" class="sm:col-span-2 text-xs text-red-400">{{ error }}</p>
    </form>

    <div v-if="clans.length > 6" class="flex justify-end">
      <input
        v-model="search"
        type="search"
        placeholder="Search clans…"
        class="w-full sm:w-64 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>

    <p v-if="!clans.length" class="card px-6 py-12 text-center text-sm text-zinc-500">
      No clans yet.
      <template v-if="data?.signedIn">Start the first one.</template>
    </p>
    <p v-else-if="!shown.length" class="card px-6 py-10 text-center text-sm text-zinc-500">
      No clans match “{{ search.trim() }}”.
    </p>

    <!-- The leaderboard -->
    <ol v-else class="space-y-2">
      <li
        v-for="(c, i) in shown"
        :key="c.id"
        class="card overflow-hidden"
        :style="clanStyle(c)"
        :class="data?.mine?.id === c.id ? 'ring-1 ring-inset ring-accent/40' : ''"
      >
        <NuxtLink :to="`/clans/${c.tag}`" class="flex items-center gap-3 px-3 sm:px-4 py-3 group">
          <span class="w-8 shrink-0 text-center tabular-nums text-sm font-bold text-zinc-600">{{ i + 1 }}</span>

          <span
            v-if="c.icon_url"
            class="w-9 h-9 rounded-lg overflow-hidden border border-zinc-800 shrink-0 bg-zinc-900"
          >
            <img :src="c.icon_url" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="w-full h-full object-cover" />
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
            </span>
            <span class="block truncate text-[11px] text-zinc-600">
              {{ c.members }} member{{ c.members === 1 ? '' : 's' }}
              <template v-if="c.owner_username"> · run by {{ c.owner_username }}</template>
              <template v-if="c.hardest">
                · hardest
                <span class="text-zinc-500">{{ c.hardest.name }}</span>
              </template>
            </span>
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
