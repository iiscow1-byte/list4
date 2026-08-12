<script setup lang="ts">
/**
 * Comments on one thing: a profile, a progress post, a level, an open
 * verification.
 *
 * Two shapes. `toggle` is a disclosure that starts closed, for the places where
 * comments sit at the end of something else and shouldn't take up room until
 * asked for. `open` is the whole block with its own heading and count, for a
 * card that exists to hold comments and nothing else — that card used to print
 * its own title and then contain a second control also labelled "Comments",
 * collapsed, so the section a page had made room for started out empty.
 */
const props = withDefaults(defineProps<{
  kind: 'profile' | 'progress' | 'open_verification' | 'level'
  targetId: number
  variant?: 'toggle' | 'open'
  /** Heading, in `open` mode only. */
  title?: string
}>(), { variant: 'toggle', title: 'Comments' })

type Comment = {
  id: number
  account_id: number
  username: string
  role: string
  has_avatar: boolean
  name_emoji?: string | null
  name_badge?: string | null
  name_badge_color?: string | null
  clan?: { tag: string; name: string; color: string | null } | null
  body: string
  created_at: string
}

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)
const canMod = computed(() => {
  const r = me.value?.role
  return r === 'moderator' || r === 'admin' || r === 'owner' || r === 'developer'
})

const { filter } = useProfanityFilter()

const alwaysOpen = computed(() => props.variant === 'open')
const open = ref(false)
const shown = computed(() => alwaysOpen.value || open.value)
const comments = ref<Comment[]>([])
const count = ref(0)
const loaded = ref(false)
const loading = ref(false)

async function load() {
  if (loaded.value) return
  loading.value = true
  try {
    const res = await $fetch<{ items: Comment[] }>('/api/comments', {
      query: { kind: props.kind, target_id: props.targetId },
    })
    comments.value = res.items
    count.value = res.items.length
    loaded.value = true
  } catch {
    comments.value = []
  } finally {
    loading.value = false
  }
}

/**
 * In `open` mode the comments are part of the page, so the server renders them.
 *
 * Fetching on mount is right for the disclosure — nothing is on screen until
 * someone asks — but wrong for a section that is already open: the profile
 * shipped a card headed "Comments 0" with an empty body, and the real ones
 * appeared a moment after hydration. `immediate` is off otherwise, so a feed of
 * twenty progress posts still costs no queries until a comment thread is
 * opened.
 */
const listReq = await useAsyncData(
  () => `comments-${props.kind}-${props.targetId}`,
  () => $fetch<{ items: Comment[] }>('/api/comments', {
    query: { kind: props.kind, target_id: props.targetId },
  }),
  { server: alwaysOpen.value, immediate: alwaysOpen.value, default: () => null },
)
// Safe as an immediate watcher: the request above is awaited, so `data` already
// holds its answer by the time this runs.
watch(listReq.data, (d) => {
  if (!d) return
  comments.value = d.items
  count.value = d.items.length
  loaded.value = true
}, { immediate: true })

// The disclosure still loads its count on mount, so the number beside it is
// real before anyone opens it.
if (!alwaysOpen.value) onMounted(load)

async function toggle() {
  open.value = !open.value
  if (open.value) await load()
}

const draft = ref('')
const submitting = ref(false)
const submitError = ref<string | null>(null)

async function post() {
  if (submitting.value || !draft.value.trim()) return
  submitError.value = null
  submitting.value = true
  try {
    const c = await $fetch<Comment>('/api/comments', {
      method: 'POST',
      body: { kind: props.kind, target_id: props.targetId, body: draft.value.trim() },
    })
    comments.value.push(c)
    count.value++
    draft.value = ''
  } catch (e: any) {
    submitError.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed to post.'
  } finally {
    submitting.value = false
  }
}

async function remove(id: number) {
  if (!confirm('Delete this comment?')) return
  try {
    await $fetch(`/api/comments/${id}`, { method: 'DELETE' })
    comments.value = comments.value.filter((c) => c.id !== id)
    count.value = Math.max(0, count.value - 1)
  } catch (e: any) {
    alert(e?.data?.statusMessage ?? 'Failed to delete.')
  }
}

function relative(at: string): string {
  const t = Date.parse(at)
  if (Number.isNaN(t)) return ''
  const diff = (Date.now() - t) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`
  return new Date(t).toLocaleDateString()
}

function canDelete(c: Comment): boolean {
  if (!me.value) return false
  if (canMod.value) return true
  return c.account_id === me.value.id
}

function avatarOf(username: string) {
  return `/api/users/${encodeURIComponent(username)}/avatar`
}
</script>

<template>
  <div>
    <!-- Heading, when this component *is* the section -->
    <header
      v-if="alwaysOpen"
      class="px-4 py-3 flex items-baseline gap-2 border-b border-zinc-800/80"
    >
      <h2 class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">{{ title }}</h2>
      <span class="ml-auto text-[10px] tabular-nums text-zinc-600">{{ count }}</span>
    </header>

    <!-- …or the disclosure that opens it -->
    <button
      v-else
      type="button"
      class="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mt-2"
      :aria-expanded="open"
      @click="toggle"
    >
      <svg
        class="w-3.5 h-3.5 transition-transform"
        :class="open ? 'rotate-90' : ''"
        viewBox="0 0 16 16" fill="currentColor"
      ><path d="M6 4l4 4-4 4V4z"/></svg>
      Comments
      <span class="tabular-nums text-zinc-600">{{ count }}</span>
    </button>

    <div v-if="shown" :class="alwaysOpen ? 'p-3 sm:p-4 space-y-3' : 'mt-2 space-y-2 pl-1'">
      <p v-if="loading" class="text-xs text-zinc-600">Loading…</p>

      <ul v-else-if="comments.length" class="space-y-2">
        <li
          v-for="c in comments"
          :key="c.id"
          class="rounded-lg bg-zinc-900/50 border border-zinc-800/60 px-3 py-2.5 group"
        >
          <div class="flex items-center gap-2">
            <NuxtLink
              :to="`/users/${encodeURIComponent(c.username)}`"
              class="w-6 h-6 rounded-full overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center"
            >
              <img v-if="c.has_avatar" :src="avatarOf(c.username)" class="w-full h-full object-cover" alt="" loading="lazy" />
              <span v-else class="text-[9px] font-bold uppercase text-zinc-500">{{ c.username.charAt(0) }}</span>
            </NuxtLink>
            <UserName
              class="text-xs font-medium text-zinc-200"
              size="sm"
              :username="c.username"
              :emoji="c.name_emoji"
              :badge="c.name_badge"
              :badge-color="c.name_badge_color"
              :role="c.role !== 'user' ? c.role : null"
              :clan="c.clan"
              :to="`/users/${encodeURIComponent(c.username)}`"
            />
            <span class="ml-auto shrink-0 text-[11px] text-zinc-600 tabular-nums">{{ relative(c.created_at) }}</span>
            <button
              v-if="canDelete(c)"
              type="button"
              class="shrink-0 text-[11px] text-zinc-700 hover:text-red-400 transition-colors sm:opacity-0 group-hover:opacity-100 focus:opacity-100"
              title="Delete this comment"
              @click="remove(c.id)"
            >Delete</button>
          </div>
          <p class="mt-1.5 text-sm text-zinc-300 whitespace-pre-wrap break-words">{{ filter(c.body) }}</p>
        </li>
      </ul>
      <p v-else class="text-xs text-zinc-600" :class="alwaysOpen ? 'py-2' : ''">
        No comments yet.<template v-if="me"> Say the first thing.</template>
      </p>

      <form v-if="me" class="flex items-start gap-2 pt-1" @submit.prevent="post">
        <span class="w-6 h-6 mt-1 rounded-full overflow-hidden bg-zinc-800 shrink-0 hidden sm:flex items-center justify-center">
          <img v-if="me.has_avatar" :src="avatarOf(me.username)" class="w-full h-full object-cover" alt="" />
          <span v-else class="text-[9px] font-bold uppercase text-zinc-500">{{ me.username.charAt(0) }}</span>
        </span>
        <textarea
          v-model="draft"
          rows="2"
          maxlength="1000"
          placeholder="Write a comment…"
          class="field field-sm flex-1 min-w-0"
        />
        <button
          type="submit"
          :disabled="submitting || !draft.trim()"
          class="self-stretch rounded-lg bg-accent/15 text-accent hover:bg-accent/25 text-xs font-medium px-3 transition-colors disabled:opacity-40"
        >{{ submitting ? '…' : 'Post' }}</button>
      </form>
      <p v-if="submitError" class="text-xs text-red-400">{{ submitError }}</p>
      <p v-else-if="!me" class="text-xs text-zinc-600">
        <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink> to comment.
      </p>
    </div>
  </div>
</template>
