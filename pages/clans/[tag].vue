<script setup lang="ts">
import { tierColor, textOn } from '~/utils/tier-colors'
import { hexToRgbTriplet } from '~/utils/custom-list-colors'
import { listPercent } from '~/utils/list-progress'

/**
 * One clan: who is in it, and what they have beaten between them.
 *
 * The completions list is the reason this page exists. A roster and a points
 * total is what every other site shows; the question people actually ask about
 * a group is "what has it done", and the answer is one row per level with the
 * members who have it.
 */
const route = useRoute()
const tag = computed(() => String(route.params.tag))

type Member = {
  account_id: number; username: string; role: string; has_avatar: boolean
  country: string | null; player_name: string; completions: number; points: number; joined_at: string
}
type Completion = {
  position: number; sheet_placement: number | null; name: string; gd_id: number | null
  gddl_tier: string | null; points: number | null; beaten_by: number; members: string
  is_challenge: number
}

const { data, error, refresh } = await useFetch<{
  clan: {
    id: number; tag: string; name: string; description: string | null; color: string | null
    icon_url: string | null; banner_url: string | null; discord_url: string | null
    invite_only: number; owner_username: string | null; created_at: string
  }
  totals: { members: number; levels: number; completions: number; points: number; challenges: number }
  members: Member[]
  completions: Completion[]
  requests: { account_id: number; username: string; message: string | null; created_at: string; has_avatar: boolean }[]
  viewer: { signedIn: boolean; isOwner: boolean; isMember: boolean; inAnotherClan: boolean; requested: boolean }
}>(() => `/api/clans/${encodeURIComponent(tag.value)}`, { watch: [tag] })

const { data: statsRes } = await useFetch<{ totalLevels: number }>('/api/stats')

useHead(() => ({
  title: data.value ? `[${data.value.clan.tag}] ${data.value.clan.name} — Clans` : 'Clan',
}))

const clanStyle = computed(() => {
  const rgb = hexToRgbTriplet(data.value?.clan.color ?? null)
  return rgb ? { '--c-accent': rgb } : undefined
})

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

const busy = ref(false)
const notice = ref<string | null>(null)
const actionError = ref<string | null>(null)

async function act(action: string, accountId?: number, message?: string) {
  if (busy.value) return
  busy.value = true
  actionError.value = null
  notice.value = null
  try {
    const res = await $fetch<{ disbanded?: boolean; requested?: boolean }>(
      `/api/clans/${encodeURIComponent(tag.value)}/membership`,
      { method: 'POST', body: { action, account_id: accountId, message } },
    )
    if (res.disbanded) { await navigateTo('/clans'); return }
    notice.value = res.requested ? 'Asked to join — the owner has been told.' : null
    await refresh()
  } catch (e: any) {
    actionError.value = e?.data?.statusMessage ?? 'That didn\'t work.'
  } finally {
    busy.value = false
  }
}

/** Only the levels list is long enough to want filtering. */
const search = ref('')
const shownCompletions = computed(() => {
  const q = search.value.trim().toLowerCase()
  const rows = data.value?.completions ?? []
  if (!q) return rows
  return rows.filter((c) => c.name.toLowerCase().includes(q) || c.members.toLowerCase().includes(q))
})
</script>

<template>
  <div v-if="error" class="container-tight py-16 text-center">
    <p class="text-sm text-zinc-500">No such clan.</p>
    <NuxtLink to="/clans" class="text-accent hover:underline text-sm mt-2 inline-block">All clans →</NuxtLink>
  </div>

  <div v-else-if="data" :style="clanStyle">
    <!-- Header -->
    <header class="relative border-b border-zinc-800/80 overflow-hidden">
      <div class="absolute inset-0 bg-[radial-gradient(70%_120%_at_20%_0%,rgb(var(--c-accent)/0.14),transparent)]" aria-hidden="true" />
      <div class="container-tight max-w-5xl relative py-7">
        <NuxtLink to="/clans" class="text-[11px] text-zinc-500 hover:text-accent transition-colors">← All clans</NuxtLink>
        <div class="mt-3 flex items-start gap-4 flex-wrap">
          <span
            v-if="data.clan.icon_url"
            class="w-14 h-14 rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900 shrink-0"
          >
            <img :src="data.clan.icon_url" alt="" decoding="async" referrerpolicy="no-referrer" class="w-full h-full object-cover" />
          </span>
          <span
            v-else
            class="w-14 h-14 rounded-xl border border-zinc-800 bg-zinc-900 shrink-0 flex items-center justify-center text-sm font-black uppercase text-accent"
          >{{ data.clan.tag.slice(0, 3) }}</span>

          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-2 flex-wrap">
              <!-- `link` off: this is the clan's own page, so the tag has
                   nowhere to go. -->
              <ClanTag :tag="data.clan.tag" :name="data.clan.name" :color="data.clan.color" :link="false" class="self-center" />
              <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-50">{{ data.clan.name }}</h1>
              <Badge v-if="data.clan.invite_only" tone="quiet" title="The owner adds people">Invite only</Badge>
            </div>
            <p v-if="data.clan.description" class="mt-1.5 text-sm text-zinc-400 max-w-2xl whitespace-pre-wrap">{{ data.clan.description }}</p>
            <p class="mt-1 text-[11px] text-zinc-600">
              <template v-if="data.clan.owner_username">
                run by
                <NuxtLink :to="`/users/${encodeURIComponent(data.clan.owner_username)}`" class="text-zinc-400 hover:text-accent transition-colors">{{ data.clan.owner_username }}</NuxtLink>
              </template>
              <a
                v-if="data.clan.discord_url"
                :href="data.clan.discord_url"
                target="_blank"
                rel="noopener noreferrer"
                class="ml-2 text-zinc-500 hover:text-[#5865F2] transition-colors"
              >Discord ↗</a>
            </p>
          </div>

          <div class="shrink-0 flex items-center gap-2">
            <button
              v-if="data.viewer.isMember"
              type="button"
              :disabled="busy"
              class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-red-800 hover:text-red-300 disabled:opacity-50 transition-colors"
              @click="act('leave')"
            >{{ data.viewer.isOwner && data.totals.members === 1 ? 'Disband' : 'Leave' }}</button>
            <button
              v-else-if="data.viewer.signedIn && !data.viewer.inAnotherClan"
              type="button"
              :disabled="busy || data.viewer.requested"
              class="rounded-lg bg-accent text-zinc-950 px-3 py-1.5 text-xs font-semibold hover:bg-accent/90 disabled:opacity-50 transition-colors"
              @click="act(data.viewer.requested ? 'cancel' : 'join')"
            >{{ data.viewer.requested ? 'Requested' : data.clan.invite_only ? 'Ask to join' : 'Join' }}</button>
            <button
              v-if="data.viewer.requested"
              type="button"
              :disabled="busy"
              class="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors"
              @click="act('cancel')"
            >Cancel request</button>
            <span v-else-if="data.viewer.inAnotherClan" class="text-[11px] text-zinc-600 max-w-[10rem]">
              You're in another clan.
            </span>
            <NuxtLink
              v-else-if="!data.viewer.signedIn"
              to="/login"
              class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-accent/60 hover:text-accent transition-colors"
            >Log in to join</NuxtLink>
          </div>
        </div>

        <p v-if="notice" class="mt-3 text-xs text-emerald-400">{{ notice }}</p>
        <p v-if="actionError" class="mt-3 text-xs text-red-400">{{ actionError }}</p>

        <dl class="mt-5 grid grid-cols-2 sm:grid-cols-5 gap-px rounded-xl overflow-hidden bg-zinc-800/70 border border-zinc-800">
          <div class="bg-zinc-950 px-3 py-2.5">
            <dt class="text-[10px] uppercase tracking-widest text-zinc-500">Points</dt>
            <dd class="tabular-nums text-lg font-semibold text-amber-300">{{ fmt(data.totals.points) }}</dd>
          </div>
          <div class="bg-zinc-950 px-3 py-2.5">
            <dt class="text-[10px] uppercase tracking-widest text-zinc-500">Levels</dt>
            <dd class="tabular-nums text-lg font-semibold text-zinc-100">{{ fmt(data.totals.levels) }}</dd>
          </div>
          <div class="bg-zinc-950 px-3 py-2.5" :title="`${fmt(data.totals.levels)} of ${fmt(statsRes?.totalLevels ?? 0)} levels`">
            <dt class="text-[10px] uppercase tracking-widest text-zinc-500">Of the list</dt>
            <dd class="tabular-nums text-lg font-semibold text-zinc-100">
              {{ listPercent(data.totals.levels, statsRes?.totalLevels ?? 0) }}
            </dd>
          </div>
          <div class="bg-zinc-950 px-3 py-2.5">
            <dt class="text-[10px] uppercase tracking-widest text-zinc-500">Challenges</dt>
            <dd class="tabular-nums text-lg font-semibold text-zinc-100">{{ fmt(data.totals.challenges) }}</dd>
          </div>
          <div class="bg-zinc-950 px-3 py-2.5">
            <dt class="text-[10px] uppercase tracking-widest text-zinc-500">Members</dt>
            <dd class="tabular-nums text-lg font-semibold text-zinc-100">{{ fmt(data.totals.members) }}</dd>
          </div>
        </dl>
      </div>
    </header>

    <div class="container-tight max-w-5xl py-6 grid lg:grid-cols-[minmax(0,1fr)_18rem] gap-6 items-start">
      <!-- What the clan has beaten -->
      <main class="min-w-0 space-y-3">
        <div class="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">
            Completions
            <span class="ml-1.5 normal-case tracking-normal text-zinc-600 tabular-nums">
              {{ fmt(data.completions.length) }} level{{ data.completions.length === 1 ? '' : 's' }}, hardest first
            </span>
          </h2>
          <input
            v-if="data.completions.length > 10"
            v-model="search"
            type="search"
            placeholder="Level or member…"
            class="w-44 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <p v-if="!data.completions.length" class="card px-6 py-12 text-center text-sm text-zinc-500">
          Nobody in this clan has an approved record yet.
        </p>
        <p v-else-if="!shownCompletions.length" class="card px-6 py-8 text-center text-sm text-zinc-500">
          Nothing matches “{{ search.trim() }}”.
        </p>
        <ul v-else class="card divide-y divide-zinc-900/70 overflow-hidden">
          <li v-for="c in shownCompletions" :key="c.position" class="px-3 py-2 hover:bg-zinc-900/40 transition-colors">
            <div class="flex items-center gap-3">
              <span
                class="text-[11px] tabular-nums px-2 py-0.5 w-14 shrink-0 text-center font-medium rounded"
                :style="{ backgroundColor: tierColor(c.gddl_tier), color: textOn(tierColor(c.gddl_tier)) }"
                :title="c.gddl_tier ?? undefined"
              >#{{ c.sheet_placement ?? c.position }}</span>
              <NuxtLink :to="`/levels/${c.position}`" class="min-w-0 flex-1 group">
                <span class="block truncate text-sm text-zinc-200 group-hover:text-accent transition-colors">
                  {{ c.name }}
                  <span v-if="c.is_challenge" class="ml-1 text-[9px] uppercase tracking-widest text-amber-500/80">challenge</span>
                </span>
                <span class="block truncate text-[10px] text-zinc-600">{{ c.members.split(',').join(', ') }}</span>
              </NuxtLink>
              <span v-if="c.beaten_by > 1" class="shrink-0 text-[10px] tabular-nums text-zinc-500" :title="`${c.beaten_by} members have this`">
                ×{{ c.beaten_by }}
              </span>
              <span class="shrink-0 tabular-nums text-xs text-amber-300 w-12 text-right">{{ c.points ?? '—' }}</span>
            </div>
          </li>
        </ul>
      </main>

      <!-- Who is in it -->
      <aside class="space-y-4">
        <section class="card overflow-hidden">
          <h2 class="px-3 py-2.5 text-[10px] uppercase tracking-widest text-zinc-500 font-semibold border-b border-zinc-900 flex items-baseline gap-2">
            Members
            <span class="ml-auto tabular-nums text-zinc-600">{{ data.members.length }}</span>
          </h2>
          <ol class="p-1.5 space-y-0.5">
            <li v-for="(m, i) in data.members" :key="m.account_id">
              <div class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-900 transition-colors group">
                <span class="w-4 shrink-0 text-center text-[10px] tabular-nums text-zinc-700">{{ i + 1 }}</span>
                <span class="w-6 h-6 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/50 shrink-0 flex items-center justify-center">
                  <img
                    v-if="m.has_avatar"
                    :src="`/api/users/${encodeURIComponent(m.username)}/avatar`"
                    class="w-full h-full object-cover" alt="" loading="lazy"
                  />
                  <span v-else class="text-[9px] font-bold uppercase text-zinc-500">{{ m.username.charAt(0) }}</span>
                </span>
                <NuxtLink
                  :to="`/users/${encodeURIComponent(m.username)}`"
                  class="min-w-0 flex-1 truncate text-xs text-zinc-200 group-hover:text-accent transition-colors"
                >{{ m.username }}</NuxtLink>
                <CountryFlag :country="m.country" size="sm" class="shrink-0" />
                <RoleBadge v-if="m.role === 'owner'" role="list-owner" size="sm" />
                <span class="shrink-0 tabular-nums text-[11px] text-amber-300/90 w-10 text-right">{{ fmt(m.points) }}</span>
                <button
                  v-if="data.viewer.isOwner && m.role !== 'owner'"
                  type="button"
                  :disabled="busy"
                  class="shrink-0 text-[11px] text-zinc-700 hover:text-red-400 transition-colors"
                  title="Remove from the clan"
                  @click="act('remove', m.account_id)"
                >✕</button>
              </div>
            </li>
          </ol>
        </section>

        <!-- Requests, owner only -->
        <section v-if="data.viewer.isOwner && data.requests.length" class="card overflow-hidden">
          <h2 class="px-3 py-2.5 text-[10px] uppercase tracking-widest text-accent font-semibold border-b border-zinc-900">
            Asking to join
            <span class="ml-1 tabular-nums text-zinc-600">{{ data.requests.length }}</span>
          </h2>
          <ul class="p-2 space-y-2">
            <li v-for="r in data.requests" :key="r.account_id" class="text-xs">
              <div class="flex items-center gap-2">
                <NuxtLink :to="`/users/${encodeURIComponent(r.username)}`" class="flex-1 truncate text-zinc-200 hover:text-accent transition-colors">{{ r.username }}</NuxtLink>
                <button
                  type="button" :disabled="busy"
                  class="rounded bg-emerald-600/90 text-white px-2 py-0.5 text-[11px] hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                  @click="act('accept', r.account_id)"
                >Add</button>
                <button
                  type="button" :disabled="busy"
                  class="rounded border border-red-900/60 text-red-400 px-2 py-0.5 text-[11px] hover:bg-red-950/40 disabled:opacity-50 transition-colors"
                  @click="act('decline', r.account_id)"
                >No</button>
              </div>
              <p v-if="r.message" class="mt-0.5 text-[11px] text-zinc-500 truncate">“{{ r.message }}”</p>
            </li>
          </ul>
        </section>

        <!-- Handing it over -->
        <section v-if="data.viewer.isOwner && data.members.length > 1" class="card p-3">
          <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Hand over the clan</h2>
          <p class="mt-1 text-[11px] text-zinc-600">
            You have to do this before you can leave a clan that still has members.
          </p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="m in data.members.filter((x) => x.role !== 'owner')"
              :key="m.account_id"
              type="button"
              :disabled="busy"
              class="rounded-lg border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:border-accent/50 hover:text-accent disabled:opacity-50 transition-colors"
              @click="act('transfer', m.account_id)"
            >{{ m.username }}</button>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>
