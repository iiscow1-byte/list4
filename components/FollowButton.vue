<script setup lang="ts">
import { roleBadgeClass } from '~/utils/role-styles'

const props = defineProps<{
  target: string
  initialFollowed: boolean
  canFollow: boolean
  isSelf: boolean
  followerCount: number
}>()

const emit = defineEmits<{ (e: 'changed', followed: boolean, count: number): void }>()

const followed = ref(props.initialFollowed)
const count = ref(props.followerCount)
const busy = ref(false)
const error = ref<string | null>(null)

watch(() => props.initialFollowed, (v) => { followed.value = v })
watch(() => props.followerCount, (v) => { count.value = v })

async function toggle() {
  if (busy.value || !props.canFollow) return
  busy.value = true
  error.value = null
  const wasFollowed = followed.value
  try {
    if (wasFollowed) {
      await $fetch('/api/follows', { method: 'DELETE', body: { target: props.target } })
      followed.value = false
      count.value = Math.max(0, count.value - 1)
    } else {
      await $fetch('/api/follows', { method: 'POST', body: { target: props.target } })
      followed.value = true
      count.value += 1
    }
    emit('changed', followed.value, count.value)
  } catch (e: any) {
    error.value = e?.statusMessage || e?.data?.statusMessage || 'Something went wrong.'
  } finally {
    busy.value = false
  }
}

// --- Followers list panel ---
type Follower = { username: string; role: string; has_avatar: boolean }
const showFollowers = ref(false)
const followers = ref<Follower[]>([])
const followersLoading = ref(false)

async function openFollowers() {
  showFollowers.value = true
  if (followers.value.length) return
  followersLoading.value = true
  try {
    const res = await $fetch<{ items: Follower[] }>('/api/follows/followers', {
      query: { target: props.target },
    })
    followers.value = res.items
  } catch {
    followers.value = []
  } finally {
    followersLoading.value = false
  }
}
</script>

<template>
  <div class="flex items-center gap-3 flex-wrap">
    <button
      v-if="canFollow"
      type="button"
      :disabled="busy"
      class="px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50"
      :class="followed
        ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
        : 'bg-accent text-zinc-950 hover:bg-accent/90'"
      @click="toggle"
    >{{ followed ? 'Following' : 'Follow' }}</button>
    <span v-else-if="isSelf" class="text-xs text-zinc-600">This is you.</span>

    <button
      type="button"
      class="text-xs text-zinc-400 hover:text-accent tabular-nums transition-colors"
      @click="openFollowers"
    >{{ count }} follower{{ count === 1 ? '' : 's' }}</button>

    <span v-if="error" class="text-xs text-red-400">{{ error }}</span>

    <!-- Followers panel -->
    <Teleport to="body">
      <div
        v-if="showFollowers"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        @click.self="showFollowers = false"
      >
        <div class="w-80 max-h-[70vh] flex flex-col rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
            <span class="text-sm font-medium text-zinc-100">Followers <span class="text-zinc-500 tabular-nums">{{ count }}</span></span>
            <button
              type="button"
              class="text-zinc-500 hover:text-zinc-200 transition-colors text-lg leading-none"
              @click="showFollowers = false"
            >×</button>
          </div>
          <div v-if="followersLoading" class="p-4 text-xs text-zinc-500 text-center">Loading…</div>
          <ul v-else-if="followers.length" class="overflow-y-auto divide-y divide-zinc-900">
            <li v-for="f in followers" :key="f.username">
              <NuxtLink
                :to="`/users/${f.username}`"
                class="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-900 transition-colors"
                @click="showFollowers = false"
              >
                <div class="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 overflow-hidden shrink-0 flex items-center justify-center text-xs font-bold text-zinc-500">
                  <img
                    v-if="f.has_avatar"
                    :src="`/api/users/${encodeURIComponent(f.username)}/avatar`"
                    class="w-full h-full object-cover"
                    alt=""
                  />
                  <span v-else>{{ f.username.charAt(0).toUpperCase() }}</span>
                </div>
                <span class="text-sm text-zinc-200 font-medium">{{ f.username }}</span>
                <span
                  v-if="f.role !== 'user'"
                  class="text-[9px] uppercase tracking-widest px-1 py-0.5 rounded ml-auto"
                  :class="roleBadgeClass(f.role)"
                >{{ f.role }}</span>
              </NuxtLink>
            </li>
          </ul>
          <p v-else class="p-4 text-xs text-zinc-600 text-center">No followers yet.</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>
