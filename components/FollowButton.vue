<script setup lang="ts">
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
      await $fetch('/api/follows', {
        method: 'DELETE',
        body: { target: props.target },
      })
      followed.value = false
      count.value = Math.max(0, count.value - 1)
    } else {
      await $fetch('/api/follows', {
        method: 'POST',
        body: { target: props.target },
      })
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
    <span class="text-xs text-zinc-500 tabular-nums">{{ count }} follower{{ count === 1 ? '' : 's' }}</span>
    <span v-if="error" class="text-xs text-red-400">{{ error }}</span>
  </div>
</template>
