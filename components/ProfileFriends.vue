<script setup lang="ts">
/**
 * Your friends, on your own profile.
 *
 * They had a page of their own briefly, and that was wrong twice over: two
 * thirds of it is *pending* — asks waiting on you and asks waiting on somebody
 * else — which is nobody else's business, and the remaining third is a fact
 * about you, which is what a profile is for. A nav entry for it also put a
 * private list in the same menu as the leaderboard and the changelog.
 *
 * So it lives here, on the page you already go to to be yourself, and the
 * header's social menu links to it with a count of what is waiting.
 *
 * Sections are ordered by what needs doing: what somebody is waiting on you
 * for, then who you already know, then what you are waiting on.
 */
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

/** Opened by `?panel=friends`, and by the social menu, which links to that. */
const open = ref(false)

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

/**
 * Opens itself when somebody is waiting on you.
 *
 * A pending request behind a closed panel is a request that doesn't get
 * answered, and the whole reason this is on the profile is that it is the page
 * you already visit.
 */
const route = useRoute()
watch(incoming, (v) => {
  if (v.length || route.query.panel === 'friends') open.value = true
}, { immediate: true })

const busy = ref<number | null>(null)
async function act(person: Person, action: 'accept' | 'decline' | 'cancel' | 'remove') {
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
 * Here rather than only on profiles: "add a friend" is a thing you set out to
 * do, and making it require you to navigate to the right person's profile
 * first is making you solve the problem before you can use the tool.
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
  } catch { /* non-fatal — the lists below are already correct */ }
}

function profileHref(p: { username: string }) {
  return `/users/${encodeURIComponent(p.username)}`
}
</script>

<template>
  <section id="friends" class="card overflow-hidden scroll-mt-20">
    <button
      type="button"
      class="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-zinc-900/40 transition-colors"
      :aria-expanded="open"
      @click="open = !open"
    >
      <h2 class="text-xs uppercase tracking-widest text-zinc-500 font-medium">Friends</h2>
      <span class="text-[11px] text-zinc-600 tabular-nums">{{ friends.length }}</span>
      <!-- The one thing worth seeing without opening the panel. -->
      <span
        v-if="incoming.length"
        class="rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold tabular-nums text-zinc-950"
      >{{ incoming.length }} waiting</span>
      <span class="ml-auto text-zinc-600 transition-transform shrink-0" :class="open ? 'rotate-180' : ''">▾</span>
    </button>

    <div v-if="open" class="border-t border-zinc-900 px-4 py-4 space-y-5">
      <p class="text-[11px] text-zinc-600 -mt-1">
        Friends are mutual, so both sides have to accept. Following is separate and doesn't need approval.
      </p>

      <p v-if="error" class="text-xs text-red-400">{{ error }}</p>
      <p v-if="loading" class="text-xs text-zinc-500">Loading…</p>

      <template v-else>
        <!-- Waiting on you. First, because it is the only part that is asking. -->
        <div v-if="incoming.length" class="space-y-2">
          <h3 class="text-[10px] uppercase tracking-widest text-accent font-semibold">
            Wants to be your friend
            <span class="ml-1 normal-case tracking-normal text-zinc-600 tabular-nums">{{ incoming.length }}</span>
          </h3>
          <ul class="rounded-xl border border-accent/25 divide-y divide-zinc-900/70 overflow-hidden">
            <li v-for="p in incoming" :key="p.account_id" class="px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <NuxtLink :to="profileHref(p)" class="flex items-center gap-2.5 min-w-0 flex-1 group">
                <span class="w-8 h-8 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/60 shrink-0 flex items-center justify-center">
                  <img
                    v-if="p.has_avatar"
                    :src="`/api/users/${encodeURIComponent(p.username)}/avatar`"
                    class="w-full h-full object-cover" alt="" loading="lazy"
                  />
                  <span v-else class="text-[11px] font-bold uppercase text-zinc-400">{{ p.username.charAt(0) }}</span>
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
        </div>

        <!-- Who you know -->
        <div class="space-y-2">
          <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
            Your friends
            <span class="ml-1 normal-case tracking-normal text-zinc-600 tabular-nums">{{ friends.length }}</span>
          </h3>
          <p v-if="!friends.length" class="rounded-xl border border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
            No friends yet. Search below, or add someone from their profile.
          </p>
          <ul v-else class="rounded-xl border border-zinc-800 divide-y divide-zinc-900/70 overflow-hidden">
            <li v-for="p in friends" :key="p.account_id" class="px-3 py-2 flex items-center gap-2.5 group/row">
              <NuxtLink :to="profileHref(p)" class="flex items-center gap-2.5 min-w-0 flex-1 group">
                <span class="w-7 h-7 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/60 shrink-0 flex items-center justify-center">
                  <img
                    v-if="p.has_avatar"
                    :src="`/api/users/${encodeURIComponent(p.username)}/avatar`"
                    class="w-full h-full object-cover" alt="" loading="lazy"
                  />
                  <span v-else class="text-[10px] font-bold uppercase text-zinc-400">{{ p.username.charAt(0) }}</span>
                </span>
                <span class="min-w-0">
                  <span class="block truncate text-xs text-zinc-100 group-hover:text-accent transition-colors">{{ p.username }}</span>
                  <span v-if="p.claimed_player && p.claimed_player !== p.username" class="block truncate text-[10px] text-zinc-600">
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
        </div>

        <!-- Waiting on them -->
        <div v-if="outgoing.length" class="space-y-2">
          <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
            Waiting for a reply
            <span class="ml-1 normal-case tracking-normal text-zinc-600 tabular-nums">{{ outgoing.length }}</span>
          </h3>
          <ul class="rounded-xl border border-zinc-800 divide-y divide-zinc-900/70 overflow-hidden">
            <li v-for="p in outgoing" :key="p.account_id" class="px-3 py-2 flex items-center gap-3">
              <NuxtLink :to="profileHref(p)" class="min-w-0 flex-1 truncate text-xs text-zinc-300 hover:text-accent transition-colors">
                {{ p.username }}
              </NuxtLink>
              <button
                type="button"
                :disabled="busy != null"
                class="shrink-0 text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors"
                title="Cancel the request"
                @click="act(p, 'cancel')"
              >Cancel</button>
            </li>
          </ul>
        </div>

        <!-- Find somebody -->
        <div class="space-y-2 border-t border-zinc-900 pt-4">
          <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Add a friend</h3>
          <div class="relative">
            <input
              v-model="query"
              type="search"
              placeholder="Search accounts by name…"
              class="field field-sm text-xs"
            />
            <span v-if="searching" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-600">…</span>
          </div>
          <p v-if="query.trim().length === 1" class="text-[11px] text-zinc-600">Two letters or more.</p>
          <p v-else-if="query.trim().length > 1 && !hits.length && !searching" class="text-[11px] text-zinc-500">
            No account matches “{{ query.trim() }}”.
          </p>
          <ul v-else-if="hits.length" class="rounded-xl border border-zinc-800 divide-y divide-zinc-900/70 overflow-hidden max-h-72 overflow-y-auto">
            <li v-for="h in hits" :key="h.id" class="px-3 py-2 flex items-center gap-2.5">
              <NuxtLink :to="profileHref(h)" class="flex items-center gap-2.5 min-w-0 flex-1 group">
                <span class="w-7 h-7 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/60 shrink-0 flex items-center justify-center">
                  <img
                    v-if="h.has_avatar"
                    :src="`/api/users/${encodeURIComponent(h.username)}/avatar`"
                    class="w-full h-full object-cover" alt="" loading="lazy"
                  />
                  <span v-else class="text-[10px] font-bold uppercase text-zinc-400">{{ h.username.charAt(0) }}</span>
                </span>
                <span class="min-w-0">
                  <span class="block truncate text-xs text-zinc-100 group-hover:text-accent transition-colors">{{ h.username }}</span>
                  <span v-if="h.claimed_player && h.claimed_player !== h.username" class="block truncate text-[10px] text-zinc-600">
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
        </div>
      </template>
    </div>
  </section>
</template>
