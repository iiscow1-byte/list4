<script setup lang="ts">
import { relativeTime, absoluteTime } from '~/utils/relative-time'
// Imported rather than resolved in the template: a message that points
// somewhere is a link and one that doesn't is a heading, and `resolveComponent`
// in a `v-for` would redo that lookup for every row on every render.
import { NuxtLink } from '#components'

/**
 * The inbox.
 *
 * It used to be a flat list of notices you could mark read and nothing else —
 * "messages from moderators about your submissions". It now carries things that
 * are *asking you something*: clan invites and friend requests, both of which
 * could previously only be answered by finding the right page first.
 *
 * So the page is built around that difference:
 *
 * - Anything waiting on an answer is answered here, in place, and is listed
 *   first under its own heading. A question you have to go and find is a
 *   question that doesn't get answered.
 * - Everything else is a notice, filterable and — finally — deletable. An inbox
 *   you can't clear is a list you stop reading.
 * - A message links to whatever it is about, so "your record was rejected" is
 *   one click from the record.
 */
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Inbox — All Levels List' })

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

type InboxItem = {
  id: number
  kind: string
  subject: string
  body: string | null
  related_kind: string | null
  related_id: number | null
  read_at: string | null
  created_at: string
  sent_by_username: string | null
  sent_by_has_avatar: boolean
  /** Set when the invite or request behind this message is still open. */
  actionable: 'clan_invite' | 'friend_request' | null
  clan: { tag: string; name: string; color: string | null } | null
}

const items = ref<InboxItem[]>([])
const unread = ref(0)
const loading = ref(false)
const actionError = ref<string | null>(null)

async function load() {
  loading.value = true
  try {
    const res = await $fetch<{ items: InboxItem[]; unread: number }>('/api/account/inbox')
    items.value = res.items
    unread.value = res.unread
  } finally {
    loading.value = false
  }
}
onMounted(load)

/**
 * Everything that is asking a question, and everything that isn't.
 *
 * Split rather than sorted: the two want different treatment — one gets buttons
 * and stays put until answered, the other gets a delete — and a single list
 * that mixed them would bury an invite under a week of notices.
 */
const pending = computed(() => items.value.filter((m) => m.actionable))
const notices = computed(() => items.value.filter((m) => !m.actionable))

/** Narrow the notices. `''` is everything; `unread` is the common case. */
const filter = ref<'' | 'unread' | 'submissions' | 'social'>('')
const SUBMISSION_KINDS = new Set([
  'level_rejected', 'record_rejected', 'awaiting_removed',
  'open_verification_approved', 'open_verification_rejected',
])
const SOCIAL_KINDS = new Set([
  'comment', 'clan', 'clan_invite', 'friend_request', 'friend_accepted', 'forum_reply',
  'custom_list_editor', 'custom_list_submission', 'custom_list_record',
])

const shownNotices = computed(() => {
  const rows = notices.value
  if (filter.value === 'unread') return rows.filter((m) => !m.read_at)
  if (filter.value === 'submissions') return rows.filter((m) => SUBMISSION_KINDS.has(m.kind))
  if (filter.value === 'social') return rows.filter((m) => SOCIAL_KINDS.has(m.kind))
  return rows
})

async function markRead(m: InboxItem) {
  if (m.read_at) return
  await $fetch(`/api/account/inbox/${m.id}`, { method: 'POST', body: { action: 'read' } })
  m.read_at = new Date().toISOString()
  unread.value = Math.max(0, unread.value - 1)
}
async function markUnread(m: InboxItem) {
  if (!m.read_at) return
  await $fetch(`/api/account/inbox/${m.id}`, { method: 'POST', body: { action: 'unread' } })
  m.read_at = null
  unread.value++
}
async function readAll() {
  if (unread.value === 0) return
  await $fetch('/api/account/inbox/read-all', { method: 'POST' })
  for (const m of items.value) if (!m.read_at) m.read_at = new Date().toISOString()
  unread.value = 0
  // Also reset admin panel badges if the user is a mod/admin
  const role = me.value?.role
  if (role && role !== 'user') {
    $fetch('/api/admin/mark-seen', { method: 'POST', body: { markAll: true } }).catch(() => {})
  }
}

const busy = ref<number | null>(null)

async function remove(m: InboxItem) {
  if (busy.value != null) return
  busy.value = m.id
  try {
    await $fetch(`/api/account/inbox/${m.id}`, { method: 'DELETE' })
    items.value = items.value.filter((x) => x.id !== m.id)
    if (!m.read_at) unread.value = Math.max(0, unread.value - 1)
  } catch (e: any) {
    actionError.value = e?.data?.statusMessage ?? 'Could not delete that.'
  } finally {
    busy.value = null
  }
}

async function clearRead() {
  if (!notices.value.some((m) => m.read_at)) return
  if (!confirm('Delete every message you have already read?')) return
  try {
    await $fetch('/api/account/inbox/clear-read', { method: 'POST' })
    await load()
  } catch (e: any) {
    actionError.value = e?.data?.statusMessage ?? 'Could not clear those.'
  }
}

/**
 * Answering in place.
 *
 * The message is where the invite is, so the message is where the answer
 * belongs. After answering, the row is reloaded rather than patched: accepting
 * a clan invite changes your clan, which changes what several other messages in
 * the same list can offer.
 */
async function answerClan(m: InboxItem, action: 'join-invite' | 'reject-invite') {
  if (busy.value != null || !m.clan) return
  busy.value = m.id
  actionError.value = null
  try {
    await $fetch(`/api/clans/${encodeURIComponent(m.clan.tag)}/membership`, {
      method: 'POST', body: { action },
    })
    await markRead(m).catch(() => {})
    await load()
  } catch (e: any) {
    actionError.value = e?.data?.statusMessage ?? 'That didn\'t work.'
  } finally {
    busy.value = null
  }
}

async function answerFriend(m: InboxItem, action: 'accept' | 'decline') {
  if (busy.value != null || !m.sent_by_username) return
  busy.value = m.id
  actionError.value = null
  try {
    await $fetch('/api/friends', {
      method: 'POST', body: { username: m.sent_by_username, action },
    })
    await markRead(m).catch(() => {})
    await load()
  } catch (e: any) {
    actionError.value = e?.data?.statusMessage ?? 'That didn\'t work.'
  } finally {
    busy.value = null
  }
}

const KIND_LABELS: Record<string, string> = {
  level_rejected: 'Level rejected',
  record_rejected: 'Record rejected',
  open_verification_approved: 'Verification approved',
  open_verification_rejected: 'Verification rejected',
  awaiting_removed: 'Removed from awaiting',
  role_changed: 'Role changed',
  comment: 'New comment',
  clan: 'Clan',
  clan_invite: 'Clan invite',
  friend_request: 'Friend request',
  friend_accepted: 'Friend',
  forum_reply: 'Forum reply',
  custom_list_editor: 'List editor',
  custom_list_submission: 'List submission',
  custom_list_record: 'List record',
  staff: 'Staff notice',
}
function kindLabel(kind: string) { return KIND_LABELS[kind] ?? kind }

/** Colour by what the message *is*, so the list is scannable at a glance. */
function kindTone(kind: string): string {
  if (kind === 'level_rejected' || kind === 'record_rejected' || kind === 'open_verification_rejected') {
    return 'border-red-900/60 bg-red-950/30 text-red-300/90'
  }
  if (kind === 'open_verification_approved' || kind === 'friend_accepted') {
    return 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300/90'
  }
  if (kind === 'clan' || kind === 'clan_invite' || kind === 'friend_request') {
    return 'border-accent/40 bg-accent/10 text-accent'
  }
  if (kind === 'staff' || kind === 'role_changed') {
    return 'border-amber-900/60 bg-amber-950/30 text-amber-300/90'
  }
  return 'border-zinc-800 text-zinc-500'
}

/**
 * Where a message points.
 *
 * A notice about a thing you can look at should take you to it. Built from
 * `related_kind` / `related_id`, which every sender already fills in — they were
 * simply never read.
 */
function linkFor(m: InboxItem): string | null {
  if (m.kind === 'forum_reply' && m.related_id) return `/community/thread/${m.related_id}`
  if (m.kind === 'clan_invite' && m.clan) return `/clans/${encodeURIComponent(m.clan.tag)}`
  if ((m.kind === 'friend_request' || m.kind === 'friend_accepted') && m.sent_by_username) {
    return `/users/${encodeURIComponent(m.sent_by_username)}`
  }
  if (m.related_kind === 'level' && m.related_id) return `/levels/${m.related_id}`
  if (m.related_kind === 'account' && m.sent_by_username) {
    return `/users/${encodeURIComponent(m.sent_by_username)}`
  }
  return null
}
</script>

<template>
  <div class="container-tight py-8 max-w-3xl space-y-5">
    <header class="flex items-start justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <h1 class="text-3xl font-semibold tracking-tight">Inbox</h1>
        <p class="text-sm text-zinc-400">
          Decisions on your submissions, replies, invites and friend requests.
          <span v-if="unread > 0" class="text-accent">{{ unread }} unread</span>
        </p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          v-if="unread > 0"
          type="button"
          class="btn btn-sm btn-ghost"
          @click="readAll"
        >Mark all read</button>
        <button
          v-if="notices.some((m) => m.read_at)"
          type="button"
          class="btn btn-sm btn-ghost hover:border-red-800 hover:text-red-300"
          title="Delete every message you have already read"
          @click="clearRead"
        >Clear read</button>
      </div>
    </header>

    <p v-if="actionError" class="text-sm text-red-400">{{ actionError }}</p>

    <div v-if="loading && !items.length" class="text-sm text-zinc-500">Loading…</div>

    <template v-else>
      <!-- Waiting on you. Its own section, above everything: an invite buried
           under a week of notices is an invite nobody answers. -->
      <section v-if="pending.length" class="space-y-2">
        <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">
          Waiting on you
          <span class="ml-1 normal-case tracking-normal text-zinc-600 tabular-nums">{{ pending.length }}</span>
        </h2>
        <ul class="space-y-2">
          <li
            v-for="m in pending"
            :key="m.id"
            class="card px-4 py-3 ring-1 ring-inset ring-accent/25 flex flex-wrap items-center gap-x-3 gap-y-2"
          >
            <span class="w-9 h-9 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/60 shrink-0 flex items-center justify-center">
              <img
                v-if="m.sent_by_has_avatar && m.sent_by_username"
                :src="`/api/users/${encodeURIComponent(m.sent_by_username)}/avatar`"
                class="w-full h-full object-cover" alt="" loading="lazy"
              />
              <span v-else class="text-[11px] font-bold uppercase text-zinc-400">
                {{ (m.sent_by_username ?? '?').charAt(0) }}
              </span>
            </span>

            <div class="min-w-0 flex-1">
              <p class="text-sm text-zinc-100">{{ m.subject }}</p>
              <p v-if="m.body" class="text-xs text-zinc-400 italic mt-0.5 line-clamp-2">“{{ m.body }}”</p>
              <p class="text-[11px] text-zinc-600 tabular-nums mt-0.5" :title="absoluteTime(m.created_at)">
                {{ relativeTime(m.created_at) }}
              </p>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <template v-if="m.actionable === 'clan_invite'">
                <button
                  type="button" :disabled="busy != null"
                  class="btn btn-sm btn-primary"
                  @click="answerClan(m, 'join-invite')"
                >Join</button>
                <button
                  type="button" :disabled="busy != null"
                  class="btn btn-sm btn-ghost hover:border-red-800 hover:text-red-300"
                  @click="answerClan(m, 'reject-invite')"
                >Decline</button>
              </template>
              <template v-else>
                <button
                  type="button" :disabled="busy != null"
                  class="btn btn-sm btn-primary"
                  @click="answerFriend(m, 'accept')"
                >Accept</button>
                <button
                  type="button" :disabled="busy != null"
                  class="btn btn-sm btn-ghost hover:border-red-800 hover:text-red-300"
                  @click="answerFriend(m, 'decline')"
                >Decline</button>
              </template>
            </div>
          </li>
        </ul>
      </section>

      <!-- Everything else -->
      <section class="space-y-2">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Messages</h2>
          <div class="flex flex-wrap items-center gap-1.5">
            <label
              v-for="opt in ([
                { value: '', label: 'All' },
                { value: 'unread', label: 'Unread' },
                { value: 'submissions', label: 'Submissions' },
                { value: 'social', label: 'Social' },
              ] as const)"
              :key="opt.value"
              class="cursor-pointer select-none px-2 py-0.5 rounded-lg border text-[11px] transition-colors"
              :class="filter === opt.value
                ? 'border-accent/60 text-accent bg-accent/10'
                : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'"
            >
              <input v-model="filter" type="radio" :value="opt.value" class="sr-only" />
              {{ opt.label }}
            </label>
          </div>
        </div>

        <div v-if="!notices.length" class="card p-6 text-center text-sm text-zinc-500">
          Nothing here yet.
        </div>
        <div v-else-if="!shownNotices.length" class="card p-6 text-center text-sm text-zinc-500">
          Nothing matches that filter.
        </div>
        <ul v-else class="card divide-y divide-zinc-900 overflow-hidden">
          <li
            v-for="m in shownNotices"
            :key="m.id"
            class="px-4 py-3 transition-colors group/row"
            :class="m.read_at ? 'text-zinc-400' : 'text-zinc-100 bg-accent/5'"
          >
            <div class="flex items-baseline gap-2 flex-wrap">
              <span
                class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border shrink-0"
                :class="m.read_at ? 'border-zinc-800 text-zinc-500' : kindTone(m.kind)"
              >{{ kindLabel(m.kind) }}</span>
              <component
                :is="linkFor(m) ? NuxtLink : 'h3'"
                :to="linkFor(m) ?? undefined"
                class="text-sm font-medium flex-1 min-w-0 truncate"
                :class="linkFor(m) ? 'hover:text-accent transition-colors' : ''"
              >{{ m.subject }}</component>
              <span
                class="text-[11px] text-zinc-500 tabular-nums shrink-0"
                :title="absoluteTime(m.created_at)"
              >{{ relativeTime(m.created_at) }}</span>
            </div>

            <p v-if="m.body" class="text-sm mt-2 whitespace-pre-wrap leading-relaxed text-zinc-300">{{ m.body }}</p>
            <p v-else-if="m.kind.endsWith('_rejected')" class="text-[11px] text-zinc-600 mt-2 italic">No reason given.</p>

            <div class="flex items-center gap-3 mt-2 text-[11px]">
              <NuxtLink
                v-if="m.sent_by_username"
                :to="`/users/${encodeURIComponent(m.sent_by_username)}`"
                class="text-zinc-500 hover:text-accent transition-colors"
              >From {{ m.sent_by_username }}</NuxtLink>
              <button
                type="button"
                class="ml-auto text-zinc-500 hover:text-accent transition-colors"
                @click="m.read_at ? markUnread(m) : markRead(m)"
              >{{ m.read_at ? 'Mark unread' : 'Mark read' }}</button>
              <button
                type="button"
                :disabled="busy != null"
                class="text-zinc-700 hover:text-red-400 transition-opacity opacity-0 group-hover/row:opacity-100 focus:opacity-100"
                title="Delete this message"
                @click="remove(m)"
              >Delete</button>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
