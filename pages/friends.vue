<script setup lang="ts">
/**
 * Your friends, and the requests either side of them.
 *
 * One page rather than a tab on the profile, because two thirds of it is
 * *pending* — asks waiting on you and asks waiting on somebody else — and none
 * of that belongs on a page other people read.
 *
 * The three sections are ordered by what needs doing: what somebody is waiting
 * on you for, then who you already know, then what you are waiting on.
 */
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Friends — All Levels List' })

type Person = {
  account_id: number
  username: string
  role: string
  has_avatar: boolean
  country: string | null
  claimed_player: string | null
  created_at: string
  message?: string | null
  clan_tag: string | null
  clan_name: string | null
  clan_color: string | null
}

const friends = ref<Person[]>([])
const incoming = ref<Person[]>([])
const outgoing = ref<Person[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  try {
    const res = await $fetch<{ friends: Person[]; incoming: Person[]; outgoing: Person[] }>('/api/friends')
    friends.value = res.friends
    incoming.value = res.incoming
    outgoing.value = res.outgoing
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not load your friends.'
  } finally {
    loading.value = false
  }
}
onMounted(load)

const busy = ref<number | null>(null)
async function act(person: Person, action: 'accept' | 'decline' | 'cancel' | 'remove' | 'request') {
  if (busy.value != null) return
  if (action === 'remove' && !confirm(`Remove ${person.username} from your friends?`)) return
  busy.value = person.account_id
  error.value = null
  try {
    await $fetch('/api/friends', { method: 'POST', body: { username: person.username, action } })
    await load()
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'That didn\'t work.'
  } finally {
    busy.value = null
  }
}

/**
 * Finding somebody to add.
 *
 * On this page rather than only on profiles: "add a friend" is a thing you set
 * out to do, and making it require you to first navigate to the right person's
 * profile is making you solve the problem before you can use the tool.
 */
type Hit = {
  id: number; username: string; claimed_player: string | null; country: string | null
  has_avatar: boolean; clan: { tag: string; name: string; color: string | null } | null
  state: 'self' | 'friends' | 'incoming' | 'outgoing' | 'none'
}
const query = ref('')
const hits = ref<Hit[]>([])
const searching = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null
let seq = 0

watch(query, (q) => {
  if (timer) clearTimeout(timer)
  if (q.trim().length < 2) { hits.value = []; return }
  timer = setTimeout(async () => {
    const mine = ++seq
    searching.value = true
    try {
      const res = await $fetch<{ items: Hit[] }>('/api/friends/search', { query: { q: q.trim() } })
      if (mine !== seq) return
      hits.value = res.items
    } catch {
      if (mine === seq) hits.value = []
    } finally {
      if (mine === seq) searching.value = false
    }
  }, 220)
})
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })

async function onHitChanged() {
  await load()
  // Re-run the search so the buttons in the result list reflect the new state.
  const q = query.value.trim()
  if (q.length < 2) return
  try {
    const res = await $fetch<{ items: Hit[] }>('/api/friends/search', { query: { q } })
    hits.value = res.items
  } catch { /* non-fatal — the list below is already correct */ }
}

function profileHref(p: { username: string }) {
  return `/users/${encodeURIComponent(p.username)}`
}
</script>

<template>
  <div class="container-tight max-w-4xl py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div class="min-w-0">
        <p class="text-[10px] uppercase tracking-widest text-accent font-semibold">Community</p>
        <h1 class="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-zinc-50">Friends</h1>
        <p class="mt-1 text-sm text-zinc-500 max-w-2xl">
          Friendships are mutual — both sides agree to one. Following is separate, and one-sided:
          you can follow anybody without asking.
        </p>
      </div>
      <dl class="flex gap-px rounded-xl overflow-hidden border border-zinc-800 bg-zinc-800/70 shrink-0">
        <div class="bg-zinc-950 px-3 py-1.5 min-w-[5rem]">
          <dt class="text-[9px] uppercase tracking-widest text-zinc-600">Friends</dt>
          <dd class="text-sm font-semibold tabular-nums text-zinc-200">{{ friends.length }}</dd>
        </div>
        <div class="bg-zinc-950 px-3 py-1.5 min-w-[5rem]">
          <dt class="text-[9px] uppercase tracking-widest text-zinc-600">Waiting</dt>
          <dd class="text-sm font-semibold tabular-nums" :class="incoming.length ? 'text-accent' : 'text-zinc-200'">
            {{ incoming.length }}
          </dd>
        </div>
      </dl>
    </header>

    <p v-if="error" class="text-sm text-red-400">{{ error }}</p>

    <!-- Find somebody -->
    <section class="card overflow-hidden">
      <div class="px-4 py-3 flex items-center gap-3 flex-wrap">
        <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold shrink-0">Add a friend</h2>
        <div class="relative flex-1 min-w-[14rem]">
          <input
            v-model="query"
            type="search"
            placeholder="Search accounts by name…"
            class="field field-md pr-8"
          />
          <span v-if="searching" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-600">…</span>
        </div>
      </div>
      <p v-if="query.trim().length === 1" class="px-4 pb-4 text-xs text-zinc-600">Two letters or more.</p>
      <p v-else-if="query.trim().length > 1 && !hits.length && !searching" class="px-4 pb-4 text-xs text-zinc-500">
        No account matches “{{ query.trim() }}”.
      </p>
      <ul v-else-if="hits.length" class="border-t border-zinc-800/80 divide-y divide-zinc-900/60 max-h-80 overflow-y-auto">
        <li v-for="h in hits" :key="h.id" class="px-4 py-2.5 flex items-center gap-3">
          <NuxtLink :to="profileHref(h)" class="flex items-center gap-3 min-w-0 flex-1 group">
            <span class="w-8 h-8 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/60 shrink-0 flex items-center justify-center">
              <img
                v-if="h.has_avatar"
                :src="`/api/users/${encodeURIComponent(h.username)}/avatar`"
                class="w-full h-full object-cover" alt="" loading="lazy"
              />
              <span v-else class="text-[11px] font-bold uppercase text-zinc-400">{{ h.username.charAt(0) }}</span>
            </span>
            <span class="min-w-0">
              <span class="block truncate text-sm text-zinc-100 group-hover:text-accent transition-colors">{{ h.username }}</span>
              <span v-if="h.claimed_player && h.claimed_player !== h.username" class="block truncate text-[11px] text-zinc-600">
                plays as {{ h.claimed_player }}
              </span>
            </span>
          </NuxtLink>
          <ClanTag
            v-if="h.clan"
            :tag="h.clan.tag" :name="h.clan.name" :color="h.clan.color"
            size="sm" :link="false" class="shrink-0"
          />
          <FriendButton
            :username="h.username"
            :initial-state="h.state"
            :can-friend="true"
            small
            class="shrink-0"
            @changed="onHitChanged"
          />
        </li>
      </ul>
    </section>

    <p v-if="loading" class="text-sm text-zinc-500">Loading…</p>

    <template v-else>
      <!-- Waiting on you. First, because it is the only part that is asking. -->
      <section v-if="incoming.length" class="space-y-2">
        <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">
          Wants to be your friend
          <span class="ml-1 normal-case tracking-normal text-zinc-600 tabular-nums">{{ incoming.length }}</span>
        </h2>
        <ul class="card divide-y divide-zinc-900/70 overflow-hidden">
          <li v-for="p in incoming" :key="p.account_id" class="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <NuxtLink :to="profileHref(p)" class="flex items-center gap-3 min-w-0 flex-1 group">
              <span class="w-9 h-9 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/60 shrink-0 flex items-center justify-center">
                <img
                  v-if="p.has_avatar"
                  :src="`/api/users/${encodeURIComponent(p.username)}/avatar`"
                  class="w-full h-full object-cover" alt="" loading="lazy"
                />
                <span v-else class="text-xs font-bold uppercase text-zinc-400">{{ p.username.charAt(0) }}</span>
              </span>
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium text-zinc-100 group-hover:text-accent transition-colors">{{ p.username }}</span>
                <span v-if="p.message" class="block truncate text-[11px] text-zinc-500 italic">“{{ p.message }}”</span>
              </span>
            </NuxtLink>
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button" :disabled="busy != null"
                class="btn btn-sm btn-primary"
                @click="act(p, 'accept')"
              >Accept</button>
              <button
                type="button" :disabled="busy != null"
                class="btn btn-sm btn-ghost hover:border-red-800 hover:text-red-300"
                @click="act(p, 'decline')"
              >Decline</button>
            </div>
          </li>
        </ul>
      </section>

      <!-- Who you know -->
      <section class="space-y-2">
        <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
          Your friends
          <span class="ml-1 normal-case tracking-normal text-zinc-600 tabular-nums">{{ friends.length }}</span>
        </h2>
        <p v-if="!friends.length" class="card px-6 py-12 text-center text-sm text-zinc-500">
          No friends yet. Search above, or add someone from their profile.
        </p>
        <ul v-else class="card divide-y divide-zinc-900/70 overflow-hidden">
          <li v-for="p in friends" :key="p.account_id" class="px-4 py-2.5 flex items-center gap-3 group/row">
            <NuxtLink :to="profileHref(p)" class="flex items-center gap-3 min-w-0 flex-1 group">
              <span class="w-8 h-8 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/60 shrink-0 flex items-center justify-center">
                <img
                  v-if="p.has_avatar"
                  :src="`/api/users/${encodeURIComponent(p.username)}/avatar`"
                  class="w-full h-full object-cover" alt="" loading="lazy"
                />
                <span v-else class="text-[11px] font-bold uppercase text-zinc-400">{{ p.username.charAt(0) }}</span>
              </span>
              <span class="min-w-0">
                <span class="block truncate text-sm text-zinc-100 group-hover:text-accent transition-colors">{{ p.username }}</span>
                <span v-if="p.claimed_player && p.claimed_player !== p.username" class="block truncate text-[11px] text-zinc-600">
                  plays as {{ p.claimed_player }}
                </span>
              </span>
            </NuxtLink>
            <ClanTag
              v-if="p.clan_tag"
              :tag="p.clan_tag" :name="p.clan_name ?? p.clan_tag" :color="p.clan_color"
              size="sm" :link="false" class="shrink-0"
            />
            <CountryFlag :country="p.country" size="sm" class="shrink-0" />
            <button
              type="button"
              :disabled="busy != null"
              class="shrink-0 text-[11px] text-zinc-700 hover:text-red-400 transition-opacity opacity-0 group-hover/row:opacity-100 focus:opacity-100"
              title="Remove from your friends"
              @click="act(p, 'remove')"
            >Remove</button>
          </li>
        </ul>
      </section>

      <!-- Waiting on them -->
      <section v-if="outgoing.length" class="space-y-2">
        <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
          Waiting for a reply
          <span class="ml-1 normal-case tracking-normal text-zinc-600 tabular-nums">{{ outgoing.length }}</span>
        </h2>
        <ul class="card divide-y divide-zinc-900/70 overflow-hidden">
          <li v-for="p in outgoing" :key="p.account_id" class="px-4 py-2.5 flex items-center gap-3">
            <NuxtLink :to="profileHref(p)" class="min-w-0 flex-1 truncate text-sm text-zinc-300 hover:text-accent transition-colors">
              {{ p.username }}
            </NuxtLink>
            <button
              type="button"
              :disabled="busy != null"
              class="shrink-0 text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors"
              title="Take the request back"
              @click="act(p, 'cancel')"
            >Cancel</button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
