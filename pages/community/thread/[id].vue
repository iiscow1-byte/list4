<script setup lang="ts">
import { relativeTime, absoluteTime } from '~/utils/relative-time'

/**
 * One thread.
 *
 * The opening post and its replies read as one conversation rather than as a
 * post plus a comment section: the first post is the same shape as every other,
 * just larger and labelled. Making it a different kind of thing visually is how
 * forums end up with people replying to the thread instead of to each other.
 */
const route = useRoute()
const id = computed(() => Number(route.params.id))

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  levels: 'Levels',
  progress: 'Progress',
  help: 'Help & advice',
  offtopic: 'Off topic',
}

type Author = {
  username: string; role: string; has_avatar: boolean
  clan: { tag: string; name: string; color: string | null } | null
} | null

type Thread = {
  id: number; category: string; title: string; body: string
  pinned: boolean; locked: boolean; reply_count: number
  likes: number; liked: boolean
  created_at: string; last_post_at: string; edited_at: string | null
  author: Author
  level: { id: number; position: number; sheet_placement: number | null; name: string; gd_id: number | null } | null
}
type Post = { id: number; body: string; created_at: string; edited_at: string | null; author: Author }

const { data, error, refresh } = await useFetch<{
  thread: Thread
  posts: Post[]
  viewer: { signedIn: boolean; username: string | null; isStaff: boolean; isAuthor: boolean }
}>(() => `/api/forum/${id.value}`, { watch: [id] })

useHead(() => ({ title: data.value ? `${data.value.thread.title} — Forum` : 'Forum' }))

const reply = ref('')
const posting = ref(false)
const actionError = ref<string | null>(null)

async function send() {
  if (posting.value || reply.value.trim().length < 2) return
  posting.value = true
  actionError.value = null
  try {
    await $fetch(`/api/forum/${id.value}/reply`, { method: 'POST', body: { body: reply.value } })
    reply.value = ''
    await refresh()
    // The new post is at the bottom; go and look at it.
    await nextTick()
    document.getElementById('reply-box')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  } catch (e: any) {
    actionError.value = e?.data?.statusMessage ?? 'Could not post that.'
  } finally {
    posting.value = false
  }
}

const busy = ref(false)
async function act(action: 'like' | 'unlike' | 'pin' | 'unpin' | 'lock' | 'unlock' | 'delete') {
  if (busy.value) return
  if (action === 'delete' && !confirm('Delete this thread and every reply to it?')) return
  busy.value = true
  actionError.value = null
  try {
    const res = await $fetch<{ deleted?: boolean }>(`/api/forum/${id.value}`, {
      method: 'POST', body: { action },
    })
    if (res.deleted) { await navigateTo('/community?tab=forum'); return }
    await refresh()
  } catch (e: any) {
    actionError.value = e?.data?.statusMessage ?? 'That didn\'t work.'
  } finally {
    busy.value = false
  }
}

function avatarFor(a: Author): string | null {
  return a?.has_avatar ? `/api/users/${encodeURIComponent(a.username)}/avatar` : null
}
</script>

<template>
  <div v-if="error" class="container-tight py-16 text-center">
    <p class="text-sm text-zinc-500">No such thread.</p>
    <NuxtLink to="/community?tab=forum" class="text-accent hover:underline text-sm mt-2 inline-block">Back to the forum →</NuxtLink>
  </div>

  <div v-else-if="data" class="container-tight max-w-3xl py-8 space-y-4">
    <NuxtLink to="/community?tab=forum" class="text-[11px] text-zinc-500 hover:text-accent transition-colors">← Community · Forum</NuxtLink>

    <header class="space-y-2">
      <div class="flex items-baseline gap-2 flex-wrap">
        <span v-if="data.thread.pinned" class="text-accent" title="Pinned" aria-hidden="true">📌</span>
        <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-zinc-50">{{ data.thread.title }}</h1>
        <span class="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-zinc-800 text-zinc-500">
          {{ CATEGORY_LABELS[data.thread.category] ?? data.thread.category }}
        </span>
        <span v-if="data.thread.locked" class="text-[9px] uppercase tracking-widest text-zinc-600">locked</span>
      </div>

      <!-- The level this is about, when it is about one. A card rather than a
           link, because it is context for everything below it. -->
      <NuxtLink
        v-if="data.thread.level"
        :to="`/levels/${data.thread.level.position}`"
        class="relative overflow-hidden flex items-center gap-3 rounded-xl border border-zinc-800/80 px-3 py-2 group hover:border-zinc-700 transition-colors"
      >
        <LevelThumbBg
          :gd-id="data.thread.level.gd_id"
          res="medium"
          img-class="opacity-25 group-hover:opacity-40"
          overlay-class="bg-gradient-to-r from-zinc-950/94 via-zinc-950/80 to-zinc-950/45"
        />
        <span class="relative text-[10px] uppercase tracking-widest text-zinc-500 shrink-0">About</span>
        <span class="relative tabular-nums text-xs text-accent font-semibold shrink-0">
          #{{ data.thread.level.sheet_placement ?? data.thread.level.position }}
        </span>
        <span class="relative truncate text-sm font-medium text-zinc-100 group-hover:text-accent transition-colors">
          {{ data.thread.level.name }}
        </span>
      </NuxtLink>

      <div class="flex items-center gap-3 flex-wrap text-[11px]">
        <button
          type="button"
          :disabled="!data.viewer.signedIn || busy"
          class="inline-flex items-center gap-1 tabular-nums transition-colors disabled:cursor-default"
          :class="data.thread.liked ? 'text-accent' : 'text-zinc-500 enabled:hover:text-accent'"
          @click="act(data.thread.liked ? 'unlike' : 'like')"
        >
          <span aria-hidden="true">{{ data.thread.liked ? '★' : '☆' }}</span>
          {{ data.thread.likes }} like{{ data.thread.likes === 1 ? '' : 's' }}
        </button>
        <span class="text-zinc-600 tabular-nums">{{ data.thread.reply_count }} repl{{ data.thread.reply_count === 1 ? 'y' : 'ies' }}</span>

        <template v-if="data.viewer.isStaff">
          <span class="text-zinc-800">|</span>
          <button
            type="button" :disabled="busy"
            class="text-zinc-500 hover:text-accent transition-colors"
            @click="act(data.thread.pinned ? 'unpin' : 'pin')"
          >{{ data.thread.pinned ? 'Unpin' : 'Pin' }}</button>
          <button
            type="button" :disabled="busy"
            class="text-zinc-500 hover:text-accent transition-colors"
            @click="act(data.thread.locked ? 'unlock' : 'lock')"
          >{{ data.thread.locked ? 'Unlock' : 'Lock' }}</button>
        </template>
        <button
          v-if="data.viewer.isStaff || data.viewer.isAuthor"
          type="button" :disabled="busy"
          class="text-zinc-600 hover:text-red-400 transition-colors"
          @click="act('delete')"
        >Delete</button>
      </div>
      <p v-if="actionError" class="text-xs text-red-400">{{ actionError }}</p>
    </header>

    <!-- The opening post, then the replies. Same shape, deliberately: making
         the first post a different kind of object is how a forum ends up with
         everybody replying to the thread instead of to each other. -->
    <article class="card p-4 space-y-3 ring-1 ring-inset ring-accent/20">
      <div class="flex items-center gap-3">
        <NuxtLink
          v-if="data.thread.author"
          :to="`/users/${encodeURIComponent(data.thread.author.username)}`"
          class="shrink-0"
        >
          <span class="w-9 h-9 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/60 flex items-center justify-center">
            <img v-if="avatarFor(data.thread.author)" :src="avatarFor(data.thread.author)!" class="w-full h-full object-cover" alt="" />
            <span v-else class="text-[11px] font-bold uppercase text-zinc-400">{{ data.thread.author.username.charAt(0) }}</span>
          </span>
        </NuxtLink>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <NuxtLink
              v-if="data.thread.author"
              :to="`/users/${encodeURIComponent(data.thread.author.username)}`"
              class="text-sm font-semibold text-zinc-100 hover:text-accent transition-colors"
            >{{ data.thread.author.username }}</NuxtLink>
            <span v-else class="text-sm text-zinc-600">deleted account</span>
            <ClanTag
              v-if="data.thread.author?.clan"
              :tag="data.thread.author.clan.tag" :name="data.thread.author.clan.name"
              :color="data.thread.author.clan.color" size="sm" :link="false"
            />
            <RoleBadge v-if="data.thread.author" :role="data.thread.author.role" size="sm" />
          </div>
          <p class="text-[11px] text-zinc-600 tabular-nums" :title="absoluteTime(data.thread.created_at)">
            {{ relativeTime(data.thread.created_at) }}
            <span v-if="data.thread.edited_at" class="italic"> · edited</span>
          </p>
        </div>
      </div>
      <p class="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">{{ data.thread.body }}</p>
    </article>

    <ul v-if="data.posts.length" class="space-y-2">
      <li v-for="p in data.posts" :key="p.id" class="card p-4 space-y-2.5">
        <div class="flex items-center gap-3">
          <NuxtLink v-if="p.author" :to="`/users/${encodeURIComponent(p.author.username)}`" class="shrink-0">
            <span class="w-7 h-7 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/60 flex items-center justify-center">
              <img v-if="avatarFor(p.author)" :src="avatarFor(p.author)!" class="w-full h-full object-cover" alt="" loading="lazy" />
              <span v-else class="text-[10px] font-bold uppercase text-zinc-400">{{ p.author.username.charAt(0) }}</span>
            </span>
          </NuxtLink>
          <div class="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
            <NuxtLink
              v-if="p.author"
              :to="`/users/${encodeURIComponent(p.author.username)}`"
              class="text-xs font-semibold text-zinc-200 hover:text-accent transition-colors"
            >{{ p.author.username }}</NuxtLink>
            <span v-else class="text-xs text-zinc-600">deleted account</span>
            <ClanTag
              v-if="p.author?.clan"
              :tag="p.author.clan.tag" :name="p.author.clan.name" :color="p.author.clan.color"
              size="sm" :link="false"
            />
            <span class="text-[11px] text-zinc-600 tabular-nums ml-auto" :title="absoluteTime(p.created_at)">
              {{ relativeTime(p.created_at) }}
            </span>
          </div>
        </div>
        <p class="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">{{ p.body }}</p>
      </li>
    </ul>

    <!-- Reply -->
    <div id="reply-box">
      <p v-if="data.thread.locked" class="card px-4 py-6 text-center text-sm text-zinc-500">
        This thread is locked.
      </p>
      <form v-else-if="data.viewer.signedIn" class="card p-3 space-y-2" @submit.prevent="send">
        <textarea
          v-model="reply"
          rows="3"
          maxlength="8000"
          placeholder="Reply…"
          class="field field-md"
        />
        <div class="flex items-center gap-3">
          <span class="text-[11px] text-zinc-600 flex-1">
            Everyone in this thread is told when you reply.
          </span>
          <button
            type="submit"
            :disabled="posting || reply.trim().length < 2"
            class="btn btn-sm btn-primary"
          >{{ posting ? 'Posting…' : 'Reply' }}</button>
        </div>
      </form>
      <p v-else class="card px-4 py-6 text-center text-sm text-zinc-500">
        <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink> to reply.
      </p>
    </div>
  </div>
</template>
