<script setup lang="ts">
definePageMeta({ layout: 'level' })

const route = useRoute()
const router = useRouter()
const publicId = computed(() => String(route.params.public_id))
const {
  list, canEdit, canManage, editors, base, pendingCount, liked, toggleLike, refresh,
} = useCustomList(publicId)

const { loadFrom } = useListBuilder()

const notice = ref<string | null>(null)
const error = ref<string | null>(null)
const busy = ref(false)

// --- Editors ---
const roster = ref<{ id: number; username: string }[]>([])
watch(editors, (v) => { roster.value = [...v] }, { immediate: true })

const newEditor = ref('')
async function addEditor() {
  const username = newEditor.value.trim()
  if (!username || busy.value) return
  busy.value = true
  error.value = null
  try {
    const res = await $fetch<{ added: boolean; editors: { id: number; username: string }[] }>(
      `/api/custom-lists/${publicId.value}/editors`, { method: 'POST', body: { username } },
    )
    roster.value = res.editors
    notice.value = res.added ? `${username} can now edit this list.` : `${username} is already an editor.`
    newEditor.value = ''
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not add that editor.'
  } finally { busy.value = false }
}

async function removeEditor(id: number, username: string) {
  if (busy.value || !confirm(`Remove ${username} as an editor?`)) return
  busy.value = true
  error.value = null
  try {
    const res = await $fetch<{ editors: { id: number; username: string }[] }>(
      `/api/custom-lists/${publicId.value}/editors`, { method: 'DELETE', query: { account_id: id } },
    )
    roster.value = res.editors
    notice.value = `${username} removed.`
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not remove that editor.'
  } finally { busy.value = false }
}

// --- Visibility / records / scoring ---
async function patch(body: Record<string, unknown>, msg: string) {
  busy.value = true
  error.value = null
  try {
    await $fetch(`/api/custom-lists/${publicId.value}`, { method: 'PATCH', body })
    await refresh()
    notice.value = msg
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not save.'
  } finally { busy.value = false }
}

async function editInBuilder() {
  if (!list.value) return
  loadFrom(list.value as any)
  await router.push('/builder')
}

async function deleteList() {
  if (!list.value || !confirm(`Permanently delete "${list.value.title}"? Its records go too.`)) return
  try {
    await $fetch(`/api/custom-lists/${publicId.value}`, { method: 'DELETE' })
    await router.push('/lists')
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not delete.'
  }
}

useHead(() => ({ title: list.value ? `Settings — ${list.value.title}` : 'Settings' }))
</script>

<template>
  <CustomListShell :public-id="publicId">
    <template #default="{ list: l }">
      <div class="space-y-5">
        <p v-if="!canEdit" class="text-sm text-zinc-500 py-16 text-center">
          Only this list's owner and editors can change its settings.
        </p>

        <template v-else>
          <p v-if="notice" class="text-sm text-emerald-400">{{ notice }}</p>
          <p v-if="error" class="text-sm text-red-400">{{ error }}</p>

          <!-- Levels -->
          <section class="card p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold mb-2">Levels</h2>
            <p class="text-xs text-zinc-500 mb-3">
              Add, remove and reorder levels in the builder — it keeps every record attached as rows move.
            </p>
            <button
              type="button"
              class="rounded-lg bg-accent text-zinc-950 font-semibold text-xs px-3 py-1.5 hover:bg-accent/90 transition-colors"
              @click="editInBuilder"
            >Open in builder →</button>
          </section>

          <!-- Visibility -->
          <section class="card p-4 space-y-3">
            <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Visibility</h2>
            <label class="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                class="accent-accent"
                :checked="!!l.is_public"
                :disabled="busy"
                @change="patch({ is_public: ($event.target as HTMLInputElement).checked }, 'Visibility updated.')"
              />
              Public — show this list in the gallery and let anyone open the link
            </label>
            <label class="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                class="accent-accent"
                :checked="!!l.accepts_records"
                :disabled="busy"
                @change="patch({ accepts_records: ($event.target as HTMLInputElement).checked }, 'Record settings updated.')"
              />
              Accept record submissions and run a leaderboard
            </label>
          </section>

          <!-- Editors -->
          <section class="card p-4 space-y-3">
            <div>
              <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Editors</h2>
              <p class="text-xs text-zinc-500 mt-1">
                Editors can change the list's levels and settings and review records.
                Only you can delete the list or change this roster.
              </p>
            </div>

            <ul v-if="roster.length" class="divide-y divide-zinc-900/60 rounded-lg border border-zinc-800/70">
              <li v-for="e in roster" :key="e.id" class="px-3 py-2 flex items-center gap-2 text-sm">
                <NuxtLink :to="`/users/${encodeURIComponent(e.username)}`" class="flex-1 truncate text-zinc-200 hover:text-accent transition-colors">
                  {{ e.username }}
                </NuxtLink>
                <button
                  v-if="canManage"
                  type="button"
                  :disabled="busy"
                  class="text-[11px] text-zinc-600 hover:text-red-400 disabled:opacity-40 transition-colors"
                  @click="removeEditor(e.id, e.username)"
                >Remove</button>
              </li>
            </ul>
            <p v-else class="text-xs text-zinc-600">No editors yet — it's just you.</p>

            <form v-if="canManage" class="flex items-stretch gap-2" @submit.prevent="addEditor">
              <input
                v-model="newEditor"
                type="text"
                placeholder="Username to add…"
                class="flex-1 min-w-0 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                type="submit"
                :disabled="busy || !newEditor.trim()"
                class="shrink-0 rounded-lg border border-zinc-700 text-zinc-200 text-xs px-3 hover:border-accent/60 hover:text-accent disabled:opacity-40 transition-colors"
              >Add editor</button>
            </form>
          </section>

          <!-- Danger zone -->
          <section v-if="canManage" class="rounded-xl border border-red-950/70 bg-red-950/10 p-4">
            <h2 class="text-[10px] uppercase tracking-widest text-red-400 font-semibold mb-2">Delete list</h2>
            <p class="text-xs text-zinc-500 mb-3">
              Removes the list, its levels, and every record submitted to it. This can't be undone.
            </p>
            <button
              type="button"
              class="rounded-lg border border-red-900/60 text-red-400 text-xs px-3 py-1.5 hover:bg-red-950/40 transition-colors"
              @click="deleteList"
            >Delete "{{ l.title }}"</button>
          </section>
        </template>
      </div>
    </template>
  </CustomListShell>
</template>
