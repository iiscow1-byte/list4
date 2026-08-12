<script setup lang="ts">

/**
 * The people behind a follower / following count.
 *
 * Both numbers were dead text, and the panels lower down the profile capped
 * their lists at 24 with no way to see the rest. Opening the full list from the
 * number itself is where anyone would click first.
 *
 * One component for both sides because the two lists are the same shape: a
 * name, optionally the account behind it. The distinction matters — you can
 * follow a leaderboard player who has never signed up, so a "following" row may
 * be a name with no profile picture and no account page, and it still belongs
 * in the list.
 */
export type FollowRow = {
  name: string
  username?: string | null
  role?: string | null
  clan?: { tag: string; name: string; color: string | null } | null
  has_avatar?: boolean
}

const props = defineProps<{
  open: boolean
  /** The profile whose list this is — its canonical follow name. */
  target: string
  mode: 'followers' | 'following'
  /** Shown in the heading before the list arrives. */
  count?: number
  /** Whose list it is, for the heading. */
  who?: string
}>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const rows = ref<FollowRow[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
/** Which (target, mode) pair `rows` currently holds, so reopening is free. */
let loadedKey = ''

async function load() {
  const key = `${props.mode}|${props.target}`
  if (key === loadedKey) return
  loading.value = true
  error.value = null
  try {
    const res = await $fetch<{ items: FollowRow[] }>(`/api/follows/${props.mode}`, {
      query: { target: props.target },
    })
    rows.value = res.items
    loadedKey = key
  } catch (e: any) {
    rows.value = []
    error.value = e?.data?.statusMessage ?? 'Could not load that list.'
  } finally {
    loading.value = false
  }
}

watch(() => [props.open, props.target, props.mode], ([open]) => {
  if (open) {
    search.value = ''
    load()
  }
}, { immediate: true })

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return rows.value
  return rows.value.filter((r) => r.name.toLowerCase().includes(q))
})

const heading = computed(() => (props.mode === 'followers' ? 'Followers' : 'Following'))
const emptyText = computed(() =>
  props.mode === 'followers' ? 'Nobody follows this profile yet.' : 'This profile doesn\'t follow anyone yet.')

/** Accounts get their own page; a bare leaderboard name gets the player one. */
function rowLink(r: FollowRow): string {
  return r.username
    ? `/users/${encodeURIComponent(r.username)}`
    : `/users/by-player/${encodeURIComponent(r.name)}`
}

function close() { emit('update:open', false) }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && props.open) close() }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh] bg-black/70 backdrop-blur-sm"
      @click.self="close"
    >
      <div
        role="dialog"
        aria-modal="true"
        :aria-label="heading"
        class="w-full max-w-md max-h-[75vh] modal-panel flex flex-col"
      >
        <div class="px-4 py-3 border-b border-zinc-800 flex items-center gap-3">
          <h2 class="text-sm font-semibold text-zinc-100">
            {{ heading }}
            <span v-if="who" class="text-zinc-500 font-normal">· {{ who }}</span>
          </h2>
          <span class="ml-auto text-[11px] tabular-nums text-zinc-600">
            {{ (loading ? count ?? 0 : rows.length).toLocaleString() }}
          </span>
          <button
            type="button"
            class="text-zinc-500 hover:text-zinc-200 transition-colors leading-none px-1"
            aria-label="Close"
            @click="close"
          >✕</button>
        </div>

        <div v-if="rows.length > 8" class="px-4 pt-3">
          <input
            v-model="search"
            type="search"
            placeholder="Search…"
            class="field field-md"
          />
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto px-2 py-2">
          <p v-if="loading" class="px-2 py-8 text-center text-sm text-zinc-500">Loading…</p>
          <p v-else-if="error" class="px-2 py-8 text-center text-sm text-red-400">{{ error }}</p>
          <p v-else-if="!rows.length" class="px-2 py-8 text-center text-sm text-zinc-600">{{ emptyText }}</p>
          <p v-else-if="!filtered.length" class="px-2 py-8 text-center text-sm text-zinc-600">
            No one here matches “{{ search }}”.
          </p>
          <ul v-else class="space-y-0.5">
            <li v-for="r in filtered" :key="`${r.username ?? ''}|${r.name}`">
              <NuxtLink
                :to="rowLink(r)"
                class="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-zinc-900 transition-colors group"
                @click="close"
              >
                <span class="w-7 h-7 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/50 shrink-0 flex items-center justify-center">
                  <img
                    v-if="r.has_avatar && r.username"
                    :src="`/api/users/${encodeURIComponent(r.username)}/avatar`"
                    class="w-full h-full object-cover" alt=""
                  />
                  <span v-else class="text-[10px] font-bold uppercase text-zinc-500">{{ r.name.charAt(0) }}</span>
                </span>
                <ClanTag v-if="r.clan" :tag="r.clan.tag" :name="r.clan.name" :color="r.clan.color" size="sm" :link="false" />
                <span class="flex-1 min-w-0 truncate text-sm text-zinc-200 group-hover:text-accent transition-colors">
                  {{ r.name }}
                </span>
                <RoleBadge :role="r.role" size="sm" />
                <!-- A followed name with no account behind it: still a real
                     follow, just not a member here. -->
                <span
                  v-if="!r.username"
                  class="shrink-0 text-[10px] text-zinc-600"
                >player</span>
              </NuxtLink>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </Teleport>
</template>
