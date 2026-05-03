<script setup lang="ts">
import { roleBadgeClass } from '~/utils/role-styles'

const props = defineProps<{
  kind: 'profile' | 'progress' | 'open_verification'
  targetId: number
}>()

type Comment = {
  id: number
  account_id: number
  username: string
  role: string
  has_avatar: boolean
  body: string
  created_at: string
}

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)
const canMod = computed(() => {
  const r = me.value?.role
  return r === 'moderator' || r === 'admin' || r === 'owner' || r === 'developer'
})

const { filter, enabled: filterEnabled } = useProfanityFilter()

const comments = ref<Comment[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const res = await $fetch<{ items: Comment[] }>('/api/comments', {
      query: { kind: props.kind, target_id: props.targetId },
    })
    comments.value = res.items
  } catch {
    comments.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

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
  return c.account_id === (me.value as any).id
}
</script>

<template>
  <div class="mt-2">
    <h3 class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-2 flex items-baseline gap-2">
      Comments
      <span class="text-zinc-700 normal-case tracking-normal">{{ comments.length }}</span>
    </h3>

    <div v-if="loading" class="text-xs text-zinc-600">Loading…</div>

    <ul v-else-if="comments.length" class="space-y-2 mb-3">
      <li
        v-for="c in comments"
        :key="c.id"
        class="text-sm rounded bg-zinc-900/60 border border-zinc-800/60 px-3 py-2"
      >
        <div class="flex items-baseline gap-2 flex-wrap mb-1">
          <NuxtLink :to="`/users/${c.username}`" class="font-medium text-zinc-200 hover:text-accent transition-colors text-xs">
            {{ c.username }}
          </NuxtLink>
          <span
            v-if="c.role !== 'user'"
            class="text-[9px] uppercase tracking-widest px-1 py-0.5 rounded"
            :class="roleBadgeClass(c.role)"
          >{{ c.role }}</span>
          <span class="text-[11px] text-zinc-600 tabular-nums ml-auto">{{ relative(c.created_at) }}</span>
          <button
            v-if="canDelete(c)"
            type="button"
            class="text-[11px] text-zinc-600 hover:text-red-400 transition-colors"
            @click="remove(c.id)"
          >Delete</button>
        </div>
        <p class="text-sm text-zinc-300 whitespace-pre-wrap break-words">{{ filter(c.body) }}</p>
      </li>
    </ul>
    <p v-else-if="!loading" class="text-xs text-zinc-600 mb-2">No comments yet.</p>

    <form v-if="me" class="flex gap-2" @submit.prevent="post">
      <textarea
        v-model="draft"
        rows="2"
        maxlength="1000"
        placeholder="Write a comment…"
        class="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-accent/50 resize-none"
      />
      <button
        type="submit"
        :disabled="submitting || !draft.trim()"
        class="self-end rounded bg-accent/15 text-accent hover:bg-accent/25 text-xs font-medium px-2.5 py-1.5 transition-colors disabled:opacity-40"
      >{{ submitting ? '…' : 'Post' }}</button>
    </form>
    <p v-if="submitError" class="text-xs text-red-400 mt-1">{{ submitError }}</p>
    <p v-else-if="!me" class="text-xs text-zinc-600">
      <NuxtLink to="/login" class="text-accent hover:underline">Log in</NuxtLink> to comment.
    </p>
  </div>
</template>
