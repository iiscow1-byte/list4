<script setup lang="ts">
/**
 * The friend control, in all five of its states.
 *
 * One button rather than a set of them, because the states are mutually
 * exclusive and which one you are in decides what there is to do:
 *
 *   none      → Add friend
 *   outgoing  → Requested (press again to take it back)
 *   incoming  → Accept / Decline, because they asked first
 *   friends   → Friends (press to remove, with a confirm)
 *   self      → nothing
 *
 * The state is decided server-side and returned by every action, so the button
 * redraws from the truth rather than from a guess about what its own click did.
 * That is what stops it offering to add somebody who has already asked you.
 */
type FriendState = 'self' | 'friends' | 'incoming' | 'outgoing' | 'none'

const props = defineProps<{
  username: string
  initialState: FriendState
  canFriend: boolean
  /** Compact styling for a search result row rather than a profile header. */
  small?: boolean
}>()

const emit = defineEmits<{ (e: 'changed', state: FriendState): void }>()

const state = ref<FriendState>(props.initialState)
const busy = ref(false)
const error = ref<string | null>(null)
/** The note that travels with a request. Only ever shown before sending one. */
const noteOpen = ref(false)
const note = ref('')

watch(() => props.initialState, (v) => { state.value = v })

async function act(action: 'request' | 'accept' | 'decline' | 'cancel' | 'remove') {
  if (busy.value) return
  if (action === 'remove' && !confirm(`Remove ${props.username} from your friends?`)) return
  busy.value = true
  error.value = null
  try {
    const res = await $fetch<{ state: FriendState }>('/api/friends', {
      method: 'POST',
      body: {
        username: props.username,
        action,
        message: action === 'request' ? (note.value.trim() || undefined) : undefined,
      },
    })
    state.value = res.state
    noteOpen.value = false
    note.value = ''
    emit('changed', res.state)
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? 'That didn\'t work.'
  } finally {
    busy.value = false
  }
}

/** Small opens no note field — there is nowhere sensible to put one in a row. */
function onAdd() {
  if (props.small) { act('request'); return }
  noteOpen.value = !noteOpen.value
}

const base = computed(() =>
  props.small
    ? 'rounded-lg border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60'
    : 'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60',
)
</script>

<template>
  <div v-if="canFriend && state !== 'self'" class="inline-flex flex-col items-stretch gap-1.5">
    <div class="inline-flex items-center gap-1.5 flex-wrap">
      <!-- They asked first. Answering is the only thing that makes sense here,
           and offering "Add friend" instead — which is what a state-blind
           button does — would send a second request nobody sees. -->
      <template v-if="state === 'incoming'">
        <button
          type="button"
          :disabled="busy"
          :class="[base, 'border-accent bg-accent text-zinc-950 hover:bg-accent/90']"
          @click="act('accept')"
        >Accept</button>
        <button
          type="button"
          :disabled="busy"
          :class="[base, 'border-zinc-800 text-zinc-400 hover:border-red-800 hover:text-red-300']"
          @click="act('decline')"
        >Decline</button>
      </template>

      <button
        v-else-if="state === 'friends'"
        type="button"
        :disabled="busy"
        :class="[base, 'border-zinc-700 bg-zinc-800/70 text-zinc-200 hover:border-red-800 hover:text-red-300']"
        title="Remove from your friends"
        @click="act('remove')"
      >Friends ✓</button>

      <button
        v-else-if="state === 'outgoing'"
        type="button"
        :disabled="busy"
        :class="[base, 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200']"
        title="Take the request back"
        @click="act('cancel')"
      >Requested</button>

      <button
        v-else
        type="button"
        :disabled="busy"
        :class="[base, 'border-accent/60 text-accent hover:bg-accent/10']"
        @click="onAdd"
      >{{ busy ? '…' : 'Add friend' }}</button>
    </div>

    <!-- A note, before sending. Optional and short: it exists so a request from
         a name somebody doesn't recognise can say who you are. -->
    <div v-if="noteOpen && state === 'none'" class="flex items-center gap-1.5">
      <input
        v-model="note"
        maxlength="300"
        placeholder="Say hello, optional"
        class="field field-sm text-xs w-52"
        @keydown.enter.prevent="act('request')"
      />
      <button
        type="button"
        :disabled="busy"
        class="btn btn-sm btn-primary"
        @click="act('request')"
      >{{ busy ? 'Sending…' : 'Send' }}</button>
      <button
        type="button"
        class="text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
        @click="noteOpen = false"
      >Cancel</button>
    </div>

    <p v-if="error" class="text-[11px] text-red-400">{{ error }}</p>
  </div>
</template>
