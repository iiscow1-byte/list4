<script setup lang="ts">
import { standaloneUrl } from '~/composables/useStandaloneList'

definePageMeta({ layout: 'level' })

const route = useRoute()
const router = useRouter()
const publicId = computed(() => String(route.params.public_id))
const {
  req, list, canEdit, canManage, editors, base, pendingCount, liked, toggleLike, refresh,
} = useCustomList(publicId)

/**
 * Wait for the shared list fetch before the watchers below run.
 *
 * They are `{ immediate: true }`, which fires them during setup — before that
 * fetch has resolved — and a watcher does not run a second time inside SSR's
 * single render pass. Every field seeded that way therefore shipped blank from
 * the server and only filled in once the browser hydrated: the community links
 * and, once it existed, the whole tier editor.
 */
await req

const { loadFrom } = useListBuilder()

const notice = ref<string | null>(null)
const error = ref<string | null>(null)
const busy = ref(false)

// --- Editors ---
type StaffRow = { id: number; username: string; role: 'owner' | 'editor'; has_avatar: boolean }

/**
 * The roster, derived rather than copied.
 *
 * It used to be a `ref` seeded by an immediate watcher on `editors`. That fires
 * during setup — before the shared list fetch has resolved on the server — and
 * a watcher doesn't run a second time during SSR's single render pass, so the
 * server always shipped an empty roster and the names only appeared once the
 * browser hydrated. The override holds the fresher array an add/remove returns,
 * so those still land instantly without going back to the server.
 */
const rosterOverride = ref<StaffRow[] | null>(null)
const roster = computed<StaffRow[]>(() => rosterOverride.value ?? (editors.value as StaffRow[]))

const newEditor = ref('')
async function addEditor() {
  const username = newEditor.value.trim()
  if (!username || busy.value) return
  busy.value = true
  error.value = null
  try {
    const res = await $fetch<{ added: boolean; editors: StaffRow[] }>(
      `/api/custom-lists/${publicId.value}/editors`, { method: 'POST', body: { username } },
    )
    rosterOverride.value = res.editors
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
    const res = await $fetch<{ editors: StaffRow[] }>(
      `/api/custom-lists/${publicId.value}/editors`, { method: 'DELETE', query: { account_id: id } },
    )
    rosterOverride.value = res.editors
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

// --- Standalone link ---
// Built from the browser's own origin so it's the URL people will actually
// open; server-side there is no request origin to speak for, and this box is
// only useful once it's on screen anyway.
const origin = ref('')
onMounted(() => { origin.value = window.location.origin })
const standaloneLink = computed(() => standaloneUrl(origin.value, publicId.value))
const standaloneCopied = ref(false)
async function copyStandalone() {
  try {
    await navigator.clipboard.writeText(standaloneLink.value)
    standaloneCopied.value = true
    setTimeout(() => { standaloneCopied.value = false }, 1500)
  } catch {
    // Clipboard denied — the field is selectable, which is the fallback.
  }
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

/**
 * Settings, in panes.
 *
 * Eight sections in one column meant scrolling past webhook configuration to
 * reach a checkbox about level art. They group cleanly: what the list *is*,
 * how it *looks*, who it's *shared* with, who *runs* it, and what it talks to.
 */
type SettingsTab = 'list' | 'appearance' | 'sharing' | 'people' | 'integrations'
const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'sharing', label: 'Sharing' },
  { id: 'people', label: 'People' },
  { id: 'integrations', label: 'Integrations' },
]
const settingsTab = ref<SettingsTab>(
  SETTINGS_TABS.some((t) => t.id === route.query.s) ? (route.query.s as SettingsTab) : 'list',
)
watch(settingsTab, (v) => {
  router.replace({ query: { ...route.query, s: v === 'list' ? undefined : v } })
})

/**
 * The presentation flags, as one table.
 *
 * Six near-identical checkbox blocks in the template is six places to get the
 * inverted-checkbox pattern wrong; the two that already existed are inverted in
 * opposite directions. `invert` says which way round the stored column runs, so
 * the label can always read as the thing being turned on.
 */
const DISPLAY_SETTINGS: {
  key: string; label: string; hint: string; invert?: boolean
}[] = [
  { key: 'show_banner', label: 'Show the banner image', hint: 'A wide image across the top of the list. Set one under Appearance.' },
  { key: 'show_thumbnails', label: 'Level art on each row', hint: 'The level’s thumbnail behind its row in the list panel.' },
  { key: 'show_points', label: 'Points on each row', hint: 'What a record on that level is worth.' },
  { key: 'show_records', label: 'Record counts on each row', hint: 'How many approved records each level has.' },
  { key: 'compact_rows', label: 'Compact rows', hint: 'Tighter rows without the creator line — more levels on screen at once.' },
  { key: 'show_editors', label: 'Show the list’s editors', hint: 'Who runs the list, in the header and beside the records.' },
]

/**
 * The list's own tiers.
 *
 * Each owns every rank from its start until the next one begins, so the only
 * thing to edit is a name, a colour and where it starts — the bands follow the
 * list as levels move rather than needing to be redrawn.
 */
type TierDraft = { name: string; color: string; from_rank: number }
const tierDrafts = ref<TierDraft[]>([])
watch(list, (l) => {
  tierDrafts.value = ((l as any)?.tiers ?? []).map((t: any) => ({
    name: t.name, color: t.color ?? '#f4c430', from_rank: t.from_rank,
  }))
}, { immediate: true })

function addTier() {
  const last = tierDrafts.value[tierDrafts.value.length - 1]
  // A new tier starts after the previous one so two never collide on save.
  tierDrafts.value.push({
    name: '', color: '#f4c430',
    from_rank: last ? last.from_rank + 1 : 1,
  })
}
function removeTier(i: number) {
  tierDrafts.value.splice(i, 1)
}
async function saveTiers() {
  const tiers = tierDrafts.value
    .filter((t) => t.name.trim())
    .map((t) => ({ name: t.name.trim(), color: t.color, from_rank: Number(t.from_rank) || 1 }))
    .sort((a, b) => a.from_rank - b.from_rank)
  await patch({ tiers }, tiers.length ? 'Tiers saved.' : 'Tiers cleared.')
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
          <nav class="flex items-center gap-0.5 overflow-x-auto border-b border-zinc-800/80 -mx-1 px-1 pb-2">
            <button
              v-for="t in SETTINGS_TABS"
              :key="t.id"
              type="button"
              class="whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              :class="settingsTab === t.id
                ? 'text-accent bg-accent/10 ring-1 ring-inset ring-accent/25'
                : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900'"
              @click="settingsTab = t.id"
            >{{ t.label }}</button>
          </nav>

          <p v-if="notice" class="text-sm text-emerald-400">{{ notice }}</p>
          <p v-if="error" class="text-sm text-red-400">{{ error }}</p>

          <!-- Levels -->
          <section v-show="settingsTab === 'list'" class="card p-4">
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

          <!-- Appearance -->
          <section v-show="settingsTab === 'appearance'" class="card p-4 space-y-3">
            <div>
              <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Appearance</h2>
              <p class="text-xs text-zinc-500 mt-1">
                An icon and colour so the list reads as yours. Paste a direct image link.
              </p>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="block">
                <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Icon URL</span>
                <input
                  type="url"
                  :value="l.icon_url ?? ''"
                  :disabled="busy"
                  placeholder="https://…/icon.png"
                  class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  @change="patch({ icon_url: ($event.target as HTMLInputElement).value }, 'Icon updated.')"
                />
              </label>
              <label class="block">
                <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Accent colour</span>
                <div class="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    :value="l.accent_color || '#f4c430'"
                    :disabled="busy"
                    class="h-8 w-12 rounded border border-zinc-800 bg-zinc-900 cursor-pointer"
                    @change="patch({ accent_color: ($event.target as HTMLInputElement).value }, 'Accent colour updated.')"
                  />
                  <button
                    type="button"
                    class="text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors"
                    :disabled="busy"
                    @click="patch({ accent_color: '' }, 'Accent colour cleared.')"
                  >Reset</button>
                </div>
              </label>
            </div>
            <label class="block">
              <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Banner URL</span>
              <input
                type="url"
                :value="l.banner_url ?? ''"
                :disabled="busy"
                placeholder="https://…/banner.png"
                class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                @change="patch({ banner_url: ($event.target as HTMLInputElement).value }, 'Banner updated.')"
              />
              <span class="block text-[11px] text-zinc-600 mt-1">
                A wide image across the top of the list. Something around 1500×300 works best.
              </span>
            </label>

            <div v-if="l.icon_url || l.banner_url" class="space-y-2 pt-1">
              <span class="block text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Preview</span>
              <div v-if="l.banner_url" class="relative h-16 rounded-lg overflow-hidden border border-zinc-800">
                <img :src="l.banner_url" alt="" referrerpolicy="no-referrer" class="w-full h-full object-cover" />
                <div class="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent" aria-hidden="true" />
              </div>
              <div v-if="l.icon_url" class="flex items-center gap-2">
                <img :src="l.icon_url" alt="" referrerpolicy="no-referrer" class="w-8 h-8 rounded-lg object-cover border border-zinc-800 bg-zinc-900" />
                <span class="text-[11px] text-zinc-600">Icon</span>
              </div>
            </div>
          </section>

          <!-- What the list shows -->
          <section v-show="settingsTab === 'appearance'" class="card p-4 space-y-3">
            <div>
              <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">What the list shows</h2>
              <p class="text-xs text-zinc-500 mt-1">
                How the list draws itself for everyone who opens it. Each is on unless you turn it off.
              </p>
            </div>
            <label
              v-for="d in DISPLAY_SETTINGS"
              :key="d.key"
              class="flex items-start gap-2 text-sm text-zinc-300 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                class="accent-accent mt-1"
                :checked="d.invert ? !(l as any)[d.key] : ((l as any)[d.key] ?? 1) !== 0"
                :disabled="busy"
                @change="patch(
                  { [d.key]: d.invert
                      ? !($event.target as HTMLInputElement).checked
                      : ($event.target as HTMLInputElement).checked },
                  'Presentation updated.',
                )"
              />
              <span>
                {{ d.label }}
                <span class="block text-[11px] text-zinc-500 leading-snug mt-0.5">{{ d.hint }}</span>
              </span>
            </label>
          </section>

          <!-- Tiers -->
          <section v-show="settingsTab === 'appearance'" class="card p-4 space-y-3">
            <div>
              <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Tiers</h2>
              <p class="text-xs text-zinc-500 mt-1">
                Split the list into named bands. A tier runs from its starting rank until the
                next one begins, so they follow the list as levels move. Leave this empty for
                a plain ranking.
              </p>
            </div>

            <ul v-if="tierDrafts.length" class="space-y-2">
              <li v-for="(t, i) in tierDrafts" :key="i" class="flex items-end gap-2 flex-wrap">
                <label class="block flex-1 min-w-[9rem]">
                  <span class="text-[10px] uppercase tracking-widest text-zinc-600">Name</span>
                  <input
                    v-model="t.name"
                    maxlength="40"
                    placeholder="Extreme"
                    class="mt-0.5 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <label class="block w-24">
                  <span class="text-[10px] uppercase tracking-widest text-zinc-600">From rank</span>
                  <input
                    v-model.number="t.from_rank"
                    type="number"
                    min="1"
                    class="mt-0.5 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm tabular-nums focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <label class="block">
                  <span class="text-[10px] uppercase tracking-widest text-zinc-600">Colour</span>
                  <input
                    v-model="t.color"
                    type="color"
                    class="mt-0.5 h-[34px] w-14 rounded border border-zinc-800 bg-zinc-900 cursor-pointer"
                  />
                </label>
                <button
                  type="button"
                  class="rounded-lg border border-zinc-800 text-zinc-600 text-[11px] px-2 py-1.5 hover:border-red-900 hover:text-red-400 transition-colors"
                  @click="removeTier(i)"
                >Remove</button>
              </li>
            </ul>
            <p v-else class="text-xs text-zinc-600">No tiers — the list is one plain ranking.</p>

            <div class="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                class="rounded-lg border border-zinc-700 text-zinc-200 text-xs px-3 py-1.5 hover:border-accent/60 hover:text-accent transition-colors"
                @click="addTier"
              >Add a tier</button>
              <button
                type="button"
                :disabled="busy"
                class="rounded-lg bg-accent text-zinc-950 font-semibold text-xs px-3 py-1.5 hover:bg-accent/90 disabled:opacity-50 transition-colors"
                @click="saveTiers"
              >{{ busy ? 'Saving…' : 'Save tiers' }}</button>
              <span class="text-[11px] text-zinc-600">
                Two tiers can't start at the same rank — the first one wins.
              </span>
            </div>
          </section>

          <!-- Visibility -->
          <section v-show="settingsTab === 'list'" class="card p-4 space-y-3">
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
            <label
              v-if="l.accepts_records"
              class="flex items-start gap-2 text-sm text-zinc-300 cursor-pointer select-none pl-6"
            >
              <input
                type="checkbox"
                class="accent-accent mt-1"
                :checked="!l.require_record_video"
                :disabled="busy"
                @change="patch({ require_record_video: !($event.target as HTMLInputElement).checked }, 'Record settings updated.')"
              />
              <span>
                Records don't need a video link
                <span class="block text-[11px] text-zinc-500 leading-snug mt-0.5">
                  Off by default — proof is the norm. Turn it on for a list whose community
                  already trusts its members, or one tracking something a video can't show.
                </span>
              </span>
            </label>
            <label class="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                class="accent-accent"
                :checked="!!l.accepts_submissions"
                :disabled="busy"
                @change="patch({ accepts_submissions: ($event.target as HTMLInputElement).checked }, 'Submission settings updated.')"
              />
              Let anyone submit levels to this list
            </label>
            <label class="flex items-start gap-2 text-sm text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                class="accent-accent mt-1"
                :checked="!l.mark_off_all"
                :disabled="busy"
                @change="patch({ mark_off_all: !($event.target as HTMLInputElement).checked }, 'Presentation updated.')"
              />
              <span>
                Treat this list as its own ranking
                <span class="block text-[11px] text-zinc-500 leading-snug mt-0.5">
                  Off by default, where levels the ALL hasn't ranked show a grey rank badge and each
                  level page prints its ALL placement. Turn it on and every rank gets a colour scaled
                  to where it sits — read off the levels around it that do have a tier — and the
                  list stops printing "On the ALL list". Nothing about the levels changes.
                </span>
              </span>
            </label>
            <label class="flex items-start gap-2 text-sm text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                class="accent-accent mt-1"
                :checked="!!l.follow_all_order"
                :disabled="busy"
                @change="patch({ follow_all_order: ($event.target as HTMLInputElement).checked }, 'Ordering updated.')"
              />
              <span>
                Order this list by ALL placements
                <span class="block text-[11px] text-zinc-500 leading-snug mt-0.5">
                  Levels sort themselves by where they sit on the ALL list, and keep up as it
                  changes. Levels the ALL doesn't have stay in your order at the bottom. Turn it
                  off to go back to arranging the list by hand — your order is kept either way.
                </span>
              </span>
            </label>
          </section>

          <!-- Standalone link -->
          <section v-show="settingsTab === 'sharing'" class="card p-4 space-y-3">
            <div>
              <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Standalone link</h2>
              <p class="text-xs text-zinc-500 mt-1">
                The same list, opened as its own site: no ALL header or footer, this list's bar at the
                top, and one button back to the main list. For pinning in a Discord or linking from a
                video description, where the list is the destination rather than a page of this site.
              </p>
            </div>
            <div class="flex flex-wrap items-stretch gap-2">
              <input
                :value="standaloneLink"
                readonly
                class="flex-1 min-w-[16rem] rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-300 focus:border-accent focus:outline-none"
                @focus="($event.target as HTMLInputElement).select()"
              />
              <button
                type="button"
                class="shrink-0 rounded-lg border border-zinc-700 text-zinc-200 text-xs px-3 hover:border-accent/60 hover:text-accent transition-colors"
                @click="copyStandalone"
              >{{ standaloneCopied ? 'Copied' : 'Copy' }}</button>
              <a
                :href="standaloneLink"
                target="_blank"
                rel="noopener"
                class="shrink-0 inline-flex items-center rounded-lg border border-zinc-700 text-zinc-200 text-xs px-3 hover:border-accent/60 hover:text-accent transition-colors"
              >Preview ↗</a>
            </div>
          </section>

          <!-- Community links -->
          <section v-show="settingsTab === 'sharing'" class="card p-4 space-y-3">
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
          <section v-show="settingsTab === 'integrations'" class="card p-4 space-y-3">
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
                      ['on_submissions', 'Level submissions'],
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
          <section v-show="settingsTab === 'people'" class="card p-4 space-y-3">
            <div>
              <h2 class="text-[10px] uppercase tracking-widest text-accent font-semibold">Editors</h2>
              <p class="text-xs text-zinc-500 mt-1">
                Editors can change the list's levels and settings and review records.
                Only you can delete the list or change this roster.
              </p>
            </div>

            <!-- The roster now includes the owner, so it reads as the staff
                 list readers see. Only editors can be removed — there is no
                 such thing as a list without its owner. -->
            <ul v-if="roster.length" class="divide-y divide-zinc-900/60 rounded-lg border border-zinc-800/70">
              <li v-for="e in roster" :key="e.id" class="px-3 py-2 flex items-center gap-2.5 text-sm">
                <span class="w-7 h-7 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/50 shrink-0 flex items-center justify-center">
                  <img
                    v-if="e.has_avatar"
                    :src="`/api/users/${encodeURIComponent(e.username)}/avatar`"
                    class="w-full h-full object-cover" alt="" loading="lazy"
                  />
                  <span v-else class="text-[10px] font-bold uppercase text-zinc-500">{{ e.username.charAt(0) }}</span>
                </span>
                <NuxtLink :to="`/users/${encodeURIComponent(e.username)}`" class="flex-1 truncate text-zinc-200 hover:text-accent transition-colors">
                  {{ e.username }}
                </NuxtLink>
                <span
                  class="shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border"
                  :class="e.role === 'owner'
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400'"
                >{{ e.role === 'owner' ? 'Owner' : 'Editor' }}</span>
                <button
                  v-if="canManage && e.role !== 'owner'"
                  type="button"
                  :disabled="busy"
                  class="shrink-0 text-[11px] text-zinc-600 hover:text-red-400 disabled:opacity-40 transition-colors"
                  @click="removeEditor(e.id, e.username)"
                >Remove</button>
              </li>
            </ul>
            <p v-if="roster.length < 2" class="text-xs text-zinc-600">No other editors yet — it's just you.</p>

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
          <section v-if="canManage && settingsTab === 'list'" class="rounded-xl border border-red-950/70 bg-red-950/10 p-4">
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
