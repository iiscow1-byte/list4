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

// --- Community links ---
const discordUrl = ref('')
const youtubeUrl = ref('')
watch(list, (l) => {
  if (!l) return
  discordUrl.value = l.discord_url ?? ''
  youtubeUrl.value = l.youtube_url ?? ''
}, { immediate: true })

// --- Discord webhooks ---
type Hook = {
  id: number; url: string; label: string | null; active: number
  on_changes: number; on_records: number; on_submissions: number; last_status: string | null
}
const webhooks = ref<Hook[]>([])
const newHookUrl = ref('')
const newHookLabel = ref('')

async function loadWebhooks() {
  if (!canEdit.value) { webhooks.value = []; return }
  try {
    const res = await $fetch<{ webhooks: Hook[] }>(`/api/custom-lists/${publicId.value}/webhooks`)
    webhooks.value = res.webhooks
  } catch { webhooks.value = [] }
}
watch(canEdit, (v) => { if (v) loadWebhooks() }, { immediate: true })

async function addWebhook() {
  if (busy.value || !newHookUrl.value.trim()) return
  busy.value = true
  error.value = null
  try {
    await $fetch(`/api/custom-lists/${publicId.value}/webhooks`, {
      method: 'POST',
      body: { action: 'create', url: newHookUrl.value.trim(), label: newHookLabel.value.trim() },
    })
    newHookUrl.value = ''; newHookLabel.value = ''
    notice.value = 'Webhook added.'
    await loadWebhooks()
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not add that webhook.'
  } finally { busy.value = false }
}

async function webhookAction(action: 'update' | 'delete' | 'test', id: number, extra: Record<string, unknown> = {}) {
  if (busy.value) return
  if (action === 'delete' && !confirm('Remove this webhook?')) return
  busy.value = true
  error.value = null
  try {
    await $fetch(`/api/custom-lists/${publicId.value}/webhooks`, {
      method: 'POST', body: { action, id, ...extra },
    })
    notice.value = action === 'test' ? 'Test message sent.' : action === 'delete' ? 'Webhook removed.' : 'Saved.'
    await loadWebhooks()
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'That did not work.'
    await loadWebhooks()
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
            <label class="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                class="accent-accent"
                :checked="!!l.accepts_submissions"
                :disabled="busy"
                @change="patch({ accepts_submissions: ($event.target as HTMLInputElement).checked }, 'Suggestion settings updated.')"
              />
              Let anyone suggest levels for this list
            </label>
          </section>

          <!-- Community links -->
          <section class="card p-4 space-y-3">
            <div>
              <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Community links</h2>
              <p class="text-xs text-zinc-500 mt-1">Shown as icons in this list's header.</p>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="block">
                <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Discord invite</span>
                <input
                  v-model="discordUrl" type="url" placeholder="https://discord.gg/…"
                  class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>
              <label class="block">
                <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">YouTube channel</span>
                <input
                  v-model="youtubeUrl" type="url" placeholder="https://youtube.com/@…"
                  class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>
            </div>
            <button
              type="button" :disabled="busy"
              class="rounded-lg border border-zinc-700 text-zinc-200 text-xs px-3 py-1.5 hover:border-accent/60 hover:text-accent disabled:opacity-40 transition-colors"
              @click="patch({ discord_url: discordUrl, youtube_url: youtubeUrl }, 'Links saved.')"
            >Save links</button>
          </section>

          <!-- Discord webhooks -->
          <section class="card p-4 space-y-3">
            <div>
              <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Discord webhooks</h2>
              <p class="text-xs text-zinc-500 mt-1">
                Post this list's activity to a Discord channel. URLs are stored write-only —
                once saved, only the webhook's id is shown back.
              </p>
            </div>

            <ul v-if="webhooks.length" class="divide-y divide-zinc-900/60 rounded-lg border border-zinc-800/70">
              <li v-for="w in webhooks" :key="w.id" class="px-3 py-2.5 space-y-2">
                <div class="flex items-center gap-2 text-sm">
                  <span class="flex-1 min-w-0">
                    <span class="block truncate text-zinc-200">{{ w.label || 'Webhook' }}</span>
                    <span class="block truncate text-[10px] text-zinc-600">{{ w.url }}</span>
                  </span>
                  <span
                    v-if="w.last_status"
                    class="shrink-0 text-[10px] px-1.5 py-0.5 rounded"
                    :class="w.last_status === 'ok' ? 'bg-emerald-950/60 text-emerald-300' : 'bg-red-950/60 text-red-300'"
                  >{{ w.last_status }}</span>
                  <button type="button" :disabled="busy" class="shrink-0 text-[11px] text-zinc-500 hover:text-accent disabled:opacity-40" @click="webhookAction('test', w.id)">Test</button>
                  <button type="button" :disabled="busy" class="shrink-0 text-[11px] text-zinc-600 hover:text-red-400 disabled:opacity-40" @click="webhookAction('delete', w.id)">Remove</button>
                </div>
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <label
                    v-for="ev in ([
                      ['on_changes', 'Level changes'],
                      ['on_records', 'Records'],
                      ['on_submissions', 'Suggestions'],
                    ] as const)"
                    :key="ev[0]"
                    class="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none"
                  >
                    <input
                      type="checkbox" class="accent-accent" :checked="!!w[ev[0]]" :disabled="busy"
                      @change="webhookAction('update', w.id, { [ev[0]]: ($event.target as HTMLInputElement).checked })"
                    />
                    {{ ev[1] }}
                  </label>
                  <label class="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none ml-auto">
                    <input
                      type="checkbox" class="accent-accent" :checked="!!w.active" :disabled="busy"
                      @change="webhookAction('update', w.id, { active: ($event.target as HTMLInputElement).checked })"
                    />
                    Active
                  </label>
                </div>
              </li>
            </ul>
            <p v-else class="text-xs text-zinc-600">No webhooks yet.</p>

            <form class="flex flex-wrap items-stretch gap-2" @submit.prevent="addWebhook">
              <input
                v-model="newHookUrl" type="url" placeholder="https://discord.com/api/webhooks/…"
                class="flex-1 min-w-[14rem] rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <input
                v-model="newHookLabel" type="text" placeholder="Label"
                class="w-32 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                type="submit" :disabled="busy || !newHookUrl.trim()"
                class="shrink-0 rounded-lg border border-zinc-700 text-zinc-200 text-xs px-3 hover:border-accent/60 hover:text-accent disabled:opacity-40 transition-colors"
              >Add webhook</button>
            </form>
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
