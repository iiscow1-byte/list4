<script setup lang="ts">
import { timeAgo, absoluteTime } from '~/utils/relative-time'

/**
 * Discord webhooks: the channels the site posts to.
 *
 * What it answers that it didn't before:
 * - **Is it working?** Each webhook says when it last reached its channel, and
 *   a webhook Discord has deleted is paused by the site with the reason shown,
 *   instead of failing quietly every night.
 * - **What will it post?** "Preview" draws the next post from the same payload
 *   the site would send. For a digest that is everything waiting since its last
 *   post; "Post now" sends exactly that.
 * - **What did it post?** "History" lists its last sends and how each went.
 *
 * A broken webhook can be repaired in place with a new URL, which keeps its
 * settings and its place in the digest.
 */
type Kind = 'changes' | 'challenge_changes' | 'leaderboard' | 'level_status'
type Hook = {
  id: number
  url: string
  label: string | null
  active: 0 | 1
  tier_emoji: 0 | 1
  split_long: 0 | 1
  kind: Kind
  created_at: string
  created_by: string | null
  last_post_status: string | null
  last_posted_date: string | null
  posted_through: string | null
  mention_role_id: string | null
  discord_name: string | null
  channel_id: string | null
  guild_id: string | null
  paused_reason: string | null
  last_success_at: string | null
  failures_7d: number
  queued_changes: number | null
}
type Schedule = { enabled: boolean; reason: string | null; next_run_at: string }

/**
 * The four kinds, each with what it posts. One table, so the add form, the
 * section headings and the "move to" menu can't disagree about them.
 */
const KINDS: { id: Kind; label: string; blurb: string; digest: boolean }[] = [
  { id: 'changes', label: 'Daily changes', blurb: 'Every level added, moved or removed, once a day.', digest: true },
  { id: 'challenge_changes', label: 'Challenge changes', blurb: 'The same, for challenge levels, numbered by challenge rank.', digest: true },
  { id: 'leaderboard', label: 'Records', blurb: 'A post for every approved record.', digest: false },
  { id: 'level_status', label: 'Level status', blurb: 'A post when a level goes to Awaiting Placement or the void list.', digest: false },
]
const kindMeta = (k: string) => KINDS.find((x) => x.id === k)
const isDigest = (h: Hook) => !!kindMeta(h.kind)?.digest

const toast = useAdminToast()
const { confirm } = useConfirmDialog()

const hooks = ref<Hook[]>([])
const schedule = ref<Schedule | null>(null)
const siteUrlSet = ref(true)
const loading = ref(true)

async function load() {
  try {
    const res = await $fetch<{ items: Hook[]; schedule: Schedule; site_url_set: boolean }>('/api/admin/discord-webhooks')
    hooks.value = res.items
    schedule.value = res.schedule
    siteUrlSet.value = res.site_url_set
  } catch (e) {
    toast.fail(e, 'Could not load webhooks.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const byKind = computed(() => KINDS.map((k) => ({ ...k, hooks: hooks.value.filter((h) => h.kind === k.id) })))
/** Stored under a kind this build doesn't know. Shown, because invisible rows still fire. */
const stray = computed(() => hooks.value.filter((h) => !kindMeta(h.kind)))

// ---------------------------------------------------------------- health
type Health = { tone: 'ok' | 'warn' | 'bad' | 'off'; text: string }
function health(h: Hook): Health {
  if (h.paused_reason) return { tone: 'bad', text: h.paused_reason }
  if (!h.active) return { tone: 'off', text: 'Paused. Nothing posts until it is switched back on.' }
  const s = h.last_post_status ?? ''
  if (/^(failed|will retry|sent \d+ of|HTTP|error)/.test(s) || s.startsWith('test: HTTP') || s.startsWith('test: error')) {
    return { tone: 'warn', text: `Last post failed: ${s.replace(/^test: /, '')}` }
  }
  if (h.last_success_at) return { tone: 'ok', text: `Last posted ${timeAgo(h.last_success_at)}` }
  // Webhooks from before sends were timed only know the day their last digest covered.
  if (h.last_posted_date) return { tone: 'ok', text: `Last digest covered ${h.last_posted_date}` }
  if (s === 'test: ok') return { tone: 'ok', text: 'The last test went through.' }
  return { tone: 'ok', text: 'Nothing posted yet.' }
}
const DOT: Record<Health['tone'], string> = { ok: 'bg-emerald-400', warn: 'bg-amber-400', bad: 'bg-red-500', off: 'bg-zinc-600' }
const TEXT: Record<Health['tone'], string> = { ok: 'text-zinc-500', warn: 'text-amber-300', bad: 'text-red-300', off: 'text-zinc-500' }

const channelUrl = (h: Hook) => (h.guild_id && h.channel_id ? `https://discord.com/channels/${h.guild_id}/${h.channel_id}` : null)

const nextDigest = computed(() => {
  if (!schedule.value) return ''
  const ms = Date.parse(schedule.value.next_run_at) - Date.now()
  if (ms <= 0) return 'any minute now'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h ? `in ${h}h ${m}m` : `in ${m}m`
})

// ---------------------------------------------------------------- adding
const adding = ref(false)
const addBusy = ref(false)
const draft = reactive({ url: '', label: '', kind: 'changes' as Kind, role: '', tier_emoji: false, split_long: false })
const draftKind = computed({ get: () => draft.kind as string, set: (v: string) => { draft.kind = v as Kind } })

function openAdd() {
  adding.value = !adding.value
}

async function add() {
  if (addBusy.value || !draft.url.trim()) return
  addBusy.value = true
  try {
    const res = await $fetch<{ id: number; verified: boolean; discord_name: string | null }>('/api/admin/discord-webhooks', {
      method: 'POST',
      body: {
        url: draft.url.trim(),
        label: draft.label.trim() || null,
        kind: draft.kind,
        mention_role_id: draft.role.trim() || null,
        tier_emoji: draft.tier_emoji,
        split_long: draft.split_long,
      },
    })
    toast.ok(res.verified
      ? `Added${res.discord_name ? ` “${res.discord_name}”` : ''}. Send a test to check the channel.`
      : 'Added, but Discord couldn’t be reached to check it. Send a test to make sure it works.')
    Object.assign(draft, { url: '', label: '', kind: 'changes', role: '', tier_emoji: false, split_long: false })
    adding.value = false
    await load()
  } catch (e) {
    toast.fail(e, 'Could not add that webhook.')
  } finally {
    addBusy.value = false
  }
}

// ---------------------------------------------------------------- changing
const busy = reactive<Record<number, string | null>>({})

async function patch(h: Hook, body: Record<string, unknown>, okMsg?: string): Promise<boolean> {
  busy[h.id] = 'save'
  try {
    await $fetch(`/api/admin/discord-webhooks/${h.id}`, { method: 'PATCH', body })
    if (okMsg) toast.ok(okMsg)
    await load()
    return true
  } catch (e) {
    toast.fail(e)
    return false
  } finally {
    busy[h.id] = null
  }
}

const setActive = (h: Hook, on: boolean) =>
  patch(h, { active: on }, on ? `${h.label || 'Webhook'} is on. It posts what happens from now.` : `${h.label || 'Webhook'} is paused.`)

async function remove(h: Hook) {
  if (!(await confirm({
    title: `Remove ${h.label || 'this webhook'}?`,
    message: 'The site stops posting to that channel. The webhook itself stays in Discord.',
    confirmLabel: 'Remove',
    tone: 'danger',
  }))) return
  try {
    await $fetch(`/api/admin/discord-webhooks/${h.id}`, { method: 'DELETE' })
    toast.ok('Removed.')
    await load()
  } catch (e) { toast.fail(e) }
}

async function test(h: Hook) {
  busy[h.id] = 'test'
  try {
    await $fetch(`/api/admin/discord-webhooks/${h.id}/test`, { method: 'POST' })
    toast.ok(`Test sent to ${h.label || 'the channel'}.`)
  } catch (e) {
    toast.fail(e, 'The test didn’t go through.')
  } finally {
    busy[h.id] = null
    await load()
  }
}

type PostResult = { posted: { webhookId: number; window: string; status: string }[] }
function summarise(res: PostResult, none: string) {
  const errors = res.posted.filter((p) => !p.status.startsWith('ok') && p.status !== 'no changes' && !p.status.startsWith('skipped'))
  const sent = res.posted.filter((p) => p.status.startsWith('ok'))
  if (errors.length) toast.err(`Didn’t go through: ${errors[0]!.status}`)
  else if (sent.length) toast.ok(`Posted ${sent.length === 1 ? 'one digest' : `${sent.length} digests`}.`)
  else toast.ok(none)
}

async function postNow(h: Hook) {
  busy[h.id] = 'post'
  try {
    const res = await $fetch<PostResult>('/api/admin/discord-webhooks/post-now', { method: 'POST', body: { id: h.id } })
    summarise(res, 'Nothing new to post.')
    preview.value = null
  } catch (e) {
    toast.fail(e)
  } finally {
    busy[h.id] = null
    await load()
  }
}

const globalBusy = ref<'now' | 'missed' | null>(null)
async function postAll(mode: 'now' | 'missed') {
  if (globalBusy.value) return
  globalBusy.value = mode
  try {
    const res = await $fetch<PostResult>(
      mode === 'now' ? '/api/admin/discord-webhooks/post-now' : '/api/admin/discord-webhooks/post-yesterday',
      { method: 'POST' },
    )
    summarise(res, mode === 'now' ? 'Nothing new to post.' : 'No missed days to send.')
  } catch (e) {
    toast.fail(e)
  } finally {
    globalBusy.value = null
    await load()
  }
}

// ---------------------------------------------------------------- editing
const editing = ref<number | null>(null)
const edit = reactive({ label: '', role: '', url: '', kind: 'changes' as Kind })
const urlInput = ref<HTMLInputElement[] | null>(null)

async function openEdit(h: Hook, focusUrl = false) {
  if (editing.value === h.id && !focusUrl) { editing.value = null; return }
  editing.value = h.id
  history.value = null
  Object.assign(edit, { label: h.label ?? '', role: h.mention_role_id ?? '', url: '', kind: kindMeta(h.kind) ? h.kind : 'changes' })
  if (focusUrl) { await nextTick(); urlInput.value?.[0]?.focus() }
}

async function saveEdit(h: Hook) {
  const body: Record<string, unknown> = {
    label: edit.label.trim() || null,
    mention_role_id: edit.role.trim() || null,
  }
  if (edit.url.trim()) body.url = edit.url.trim()
  if (edit.kind !== h.kind) {
    if (!(await confirm({
      title: `Move to ${kindMeta(edit.kind)?.label}?`,
      message: `This channel stops getting ${kindMeta(h.kind)?.label.toLowerCase() ?? h.kind} and gets ${kindMeta(edit.kind)?.label.toLowerCase()} from now on.`,
      confirmLabel: 'Move',
    }))) return
    body.kind = edit.kind
  }
  if (await patch(h, body, 'Saved.')) editing.value = null
}

// ---------------------------------------------------------------- history
type Delivery = { id: number; at: string; what: string; ok: 0 | 1; status: string; messages: number }
const history = ref<{ id: number; items: Delivery[] | null } | null>(null)
async function toggleHistory(h: Hook) {
  if (history.value?.id === h.id) { history.value = null; return }
  editing.value = null
  history.value = { id: h.id, items: null }
  try {
    const res = await $fetch<{ items: Delivery[] }>(`/api/admin/discord-webhooks/${h.id}/deliveries`)
    if (history.value?.id === h.id) history.value.items = res.items
  } catch (e) {
    toast.fail(e)
    history.value = null
  }
}

// ---------------------------------------------------------------- preview
type Preview = { hook: Hook; basis: string; changes: number | null; payloads: any[] }
const preview = ref<Preview | null>(null)
async function openPreview(h: Hook) {
  busy[h.id] = 'preview'
  try {
    const res = await $fetch<Omit<Preview, 'hook'>>(`/api/admin/discord-webhooks/${h.id}/preview`)
    preview.value = { hook: h, ...res }
  } catch (e) {
    toast.fail(e)
  } finally {
    busy[h.id] = null
  }
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && preview.value) preview.value = null
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <AdminSection title="Discord" description="The channels the site posts to, and what each one gets.">
    <template #actions>
      <button type="button" class="btn btn-sm btn-primary" @click="openAdd">
        {{ adding ? 'Close' : 'Add a webhook' }}
      </button>
    </template>

    <!-- The schedule, and anything that stops posts working at all. -->
    <div class="card p-4 mb-5 flex items-start gap-4 flex-wrap">
      <div class="flex-1 min-w-[14rem]">
        <p class="text-sm font-medium text-zinc-100">Daily digest</p>
        <p v-if="!schedule" class="text-xs text-zinc-500 mt-0.5">Checking…</p>
        <p v-else-if="schedule.enabled" class="text-xs text-zinc-500 mt-0.5">
          Goes out just after midnight UTC, next {{ nextDigest }}. Each channel gets what happened since its own last post.
        </p>
        <p v-else class="text-xs text-amber-300 mt-0.5">{{ schedule.reason }} You can still post by hand.</p>
        <p v-if="!siteUrlSet" class="text-xs text-amber-300 mt-1">
          <code class="text-amber-200">SITE_URL</code> isn’t set on this server, so posts have no links or pictures.
        </p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          :disabled="!!globalBusy"
          title="Send finished days that haven't gone out yet, the same as the nightly run"
          @click="postAll('missed')"
        >{{ globalBusy === 'missed' ? 'Sending…' : 'Send missed days' }}</button>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          :disabled="!!globalBusy"
          title="Send everything waiting to every digest channel, including today so far"
          @click="postAll('now')"
        >{{ globalBusy === 'now' ? 'Posting…' : 'Post everything now' }}</button>
      </div>
    </div>

    <!-- Add -->
    <form v-if="adding" class="card p-4 mb-6 space-y-4" @submit.prevent="add">
      <div class="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <label class="block">
          <span class="label">Webhook URL</span>
          <input
            v-model="draft.url"
            type="url"
            required
            placeholder="https://discord.com/api/webhooks/…"
            class="field field-sm mt-1"
          />
          <span class="block text-[11px] text-zinc-500 mt-1">Channel settings → Integrations → Webhooks → Copy Webhook URL.</span>
        </label>
        <label class="block">
          <span class="label">Name here</span>
          <input v-model="draft.label" placeholder="Optional" class="field field-sm mt-1" />
          <span class="block text-[11px] text-zinc-500 mt-1">Leave it empty to use the webhook’s name in Discord.</span>
        </label>
      </div>

      <fieldset>
        <legend class="label mb-1.5">What it posts</legend>
        <div class="grid gap-2 sm:grid-cols-2">
          <label
            v-for="k in KINDS"
            :key="k.id"
            class="flex items-start gap-2.5 rounded-md border px-3 py-2.5 cursor-pointer transition-colors"
            :class="draft.kind === k.id ? 'border-accent/60 bg-accent/5' : 'border-zinc-800 hover:border-zinc-700'"
          >
            <input v-model="draftKind" type="radio" :value="k.id" class="mt-0.5 accent-accent" />
            <span>
              <span class="block text-sm font-medium text-zinc-100">{{ k.label }}</span>
              <span class="block text-xs text-zinc-500">{{ k.blurb }}</span>
            </span>
          </label>
        </div>
      </fieldset>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="label">Role to ping</span>
          <input v-model="draft.role" placeholder="Optional role ID" inputmode="numeric" class="field field-sm mt-1" />
          <span class="block text-[11px] text-zinc-500 mt-1">Right-click the role in Discord → Copy Role ID. Only that role is pinged.</span>
        </label>
        <div v-if="kindMeta(draft.kind)?.digest" class="space-y-2 pt-5">
          <label class="flex items-center gap-2.5 text-sm text-zinc-300">
            <ToggleSwitch v-model="draft.tier_emoji" aria-label="Tier emoji" />
            <span>Tier emoji <span class="text-xs text-zinc-500">(the server needs them)</span></span>
          </label>
          <label class="flex items-center gap-2.5 text-sm text-zinc-300">
            <ToggleSwitch v-model="draft.split_long" aria-label="Send every change" />
            <span>Send every change <span class="text-xs text-zinc-500">(not just the first 12 of each kind)</span></span>
          </label>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2">
        <button type="button" class="btn btn-sm btn-ghost" @click="adding = false">Cancel</button>
        <button type="submit" class="btn btn-sm btn-primary" :disabled="addBusy || !draft.url.trim()">
          {{ addBusy ? 'Checking with Discord…' : 'Add webhook' }}
        </button>
      </div>
    </form>

    <div v-if="loading" class="space-y-3">
      <div v-for="n in 2" :key="n" class="card h-28 animate-pulse" />
    </div>

    <!-- One section per kind -->
    <template v-else>
      <section v-for="k in byKind" :key="k.id" class="mb-6">
        <header class="flex flex-col sm:flex-row sm:items-baseline gap-x-2 gap-y-0.5 mb-2">
          <h2 class="section-title text-sm shrink-0">{{ k.label }}</h2>
          <span class="text-xs text-zinc-500 sm:truncate">{{ k.blurb }}</span>
        </header>

        <p v-if="!k.hooks.length" class="card px-4 py-3 text-xs text-zinc-500">
          No channel gets these.
          <button type="button" class="link" @click="adding = true; draft.kind = k.id">Add one</button>
        </p>

        <ul v-else class="space-y-2">
          <li v-for="h in k.hooks" :key="h.id" class="card" :class="h.paused_reason ? 'border-red-900/60' : ''">
            <div class="p-4">
              <div class="flex items-start gap-3">
                <span class="mt-1.5 w-2 h-2 rounded-full shrink-0" :class="DOT[health(h).tone]" aria-hidden="true" />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-medium text-zinc-100 truncate">{{ h.label || 'Unnamed webhook' }}</span>
                    <span v-if="h.mention_role_id" class="text-[11px] rounded px-1 bg-indigo-500/20 text-indigo-200" :title="`Pings role ${h.mention_role_id}`">@role</span>
                    <a
                      v-if="channelUrl(h)"
                      :href="channelUrl(h)!"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-xs text-zinc-500 hover:text-accent"
                    >Open channel ↗</a>
                  </div>
                  <p class="text-xs mt-0.5" :class="TEXT[health(h).tone]">{{ health(h).text }}</p>
                  <p class="text-[11px] text-zinc-600 mt-0.5 truncate">
                    <template v-if="h.discord_name">Posts as “{{ h.discord_name }}” · </template>
                    <span class="font-mono">{{ h.url }}</span>
                    · added <span :title="absoluteTime(h.created_at)">{{ timeAgo(h.created_at) }}</span><template v-if="h.created_by"> by {{ h.created_by }}</template>
                  </p>
                </div>
                <label class="flex items-center gap-2 shrink-0 text-xs text-zinc-400">
                  <span class="hidden sm:inline">{{ h.active ? 'On' : 'Off' }}</span>
                  <ToggleSwitch
                    :model-value="!!h.active"
                    :aria-label="`${h.label || 'Webhook'} is on`"
                    :class="{ 'opacity-50 pointer-events-none': busy[h.id] }"
                    @update:model-value="setActive(h, $event)"
                  />
                </label>
              </div>

              <!-- Digest options and what is waiting -->
              <div v-if="isDigest(h)" class="mt-3 ml-5 flex items-center gap-x-5 gap-y-2 flex-wrap text-xs">
                <span class="tabular-nums" :class="h.queued_changes ? 'text-zinc-200' : 'text-zinc-500'">
                  {{ (h.queued_changes ?? 0).toLocaleString() }} {{ h.queued_changes === 1 ? 'change' : 'changes' }} waiting
                </span>
                <label class="flex items-center gap-2 text-zinc-400">
                  <ToggleSwitch :model-value="!!h.tier_emoji" aria-label="Tier emoji" @update:model-value="patch(h, { tier_emoji: $event })" />
                  Tier emoji
                </label>
                <label class="flex items-center gap-2 text-zinc-400" title="Otherwise each section stops after 12 and links to the changelog">
                  <ToggleSwitch :model-value="!!h.split_long" aria-label="Send every change" @update:model-value="patch(h, { split_long: $event })" />
                  Send every change
                </label>
              </div>

              <!-- Actions -->
              <div class="mt-3 ml-5 flex items-center gap-1.5 flex-wrap">
                <button v-if="h.paused_reason" type="button" class="btn btn-sm btn-primary" @click="openEdit(h, true)">Paste a new URL</button>
                <button type="button" class="btn btn-sm btn-ghost" :disabled="!!busy[h.id]" @click="openPreview(h)">
                  {{ busy[h.id] === 'preview' ? 'Loading…' : 'Preview' }}
                </button>
                <button
                  v-if="isDigest(h)"
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :disabled="!!busy[h.id] || !h.queued_changes"
                  :title="h.queued_changes ? 'Send what is waiting now, instead of tonight' : 'Nothing waiting'"
                  @click="postNow(h)"
                >{{ busy[h.id] === 'post' ? 'Posting…' : 'Post now' }}</button>
                <button type="button" class="btn btn-sm btn-ghost" :disabled="!!busy[h.id]" @click="test(h)">
                  {{ busy[h.id] === 'test' ? 'Sending…' : 'Send a test' }}
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :class="history?.id === h.id ? 'border-accent/60 text-accent' : ''"
                  @click="toggleHistory(h)"
                >History<span v-if="h.failures_7d" class="text-red-300 tabular-nums">· {{ h.failures_7d }} failed</span></button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :class="editing === h.id ? 'border-accent/60 text-accent' : ''"
                  @click="openEdit(h)"
                >Edit</button>
                <button type="button" class="btn btn-sm text-zinc-500 hover:text-red-300 ml-auto" @click="remove(h)">Remove</button>
              </div>
            </div>

            <!-- Edit -->
            <form v-if="editing === h.id" class="border-t border-zinc-800 p-4 grid gap-3 sm:grid-cols-2" @submit.prevent="saveEdit(h)">
              <label class="block">
                <span class="label">Name here</span>
                <input v-model="edit.label" :placeholder="h.discord_name ?? 'Unnamed webhook'" class="field field-sm mt-1" />
              </label>
              <label class="block">
                <span class="label">Role to ping</span>
                <input v-model="edit.role" placeholder="None" inputmode="numeric" class="field field-sm mt-1" />
              </label>
              <label class="block">
                <span class="label">Posts</span>
                <select v-model="edit.kind" class="field field-sm mt-1">
                  <option v-for="k2 in KINDS" :key="k2.id" :value="k2.id">{{ k2.label }}</option>
                </select>
              </label>
              <label class="block">
                <span class="label">New URL</span>
                <input
                  ref="urlInput"
                  v-model="edit.url"
                  type="url"
                  placeholder="Only to replace it"
                  class="field field-sm mt-1"
                />
                <span class="block text-[11px] text-zinc-500 mt-1">Keeps this webhook’s settings and history.</span>
              </label>
              <div class="sm:col-span-2 flex justify-end gap-2">
                <button type="button" class="btn btn-sm btn-ghost" @click="editing = null">Cancel</button>
                <button type="submit" class="btn btn-sm btn-primary" :disabled="!!busy[h.id]">{{ busy[h.id] === 'save' ? 'Checking…' : 'Save' }}</button>
              </div>
            </form>

            <!-- History -->
            <div v-if="history?.id === h.id" class="border-t border-zinc-800 px-4 py-3">
              <p v-if="history.items === null" class="text-xs text-zinc-500">Loading…</p>
              <p v-else-if="!history.items.length" class="text-xs text-zinc-500">Nothing sent since history started being kept.</p>
              <ul v-else class="space-y-1.5 max-h-64 overflow-y-auto">
                <li v-for="d in history.items" :key="d.id" class="flex items-baseline gap-2.5 text-xs">
                  <span class="w-1.5 h-1.5 rounded-full shrink-0 translate-y-[-1px]" :class="d.ok ? 'bg-emerald-400' : 'bg-red-400'" aria-hidden="true" />
                  <span class="text-zinc-500 tabular-nums w-16 shrink-0" :title="absoluteTime(d.at)">{{ timeAgo(d.at) }}</span>
                  <span class="text-zinc-200 truncate flex-1 min-w-0">{{ d.what }}</span>
                  <span class="shrink-0 truncate max-w-[45%]" :class="d.ok ? 'text-zinc-500' : 'text-red-300'" :title="d.status">
                    {{ d.ok ? (d.messages > 1 ? `${d.messages} messages` : 'sent') : d.status }}
                  </span>
                </li>
              </ul>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="stray.length" class="card border-red-900/60 p-4">
        <h2 class="text-sm font-semibold text-red-300">Unknown kind</h2>
        <p class="text-xs text-zinc-500 mt-0.5">Stored under a kind this version doesn’t recognise. Move them or remove them.</p>
        <ul class="mt-3 divide-y divide-zinc-800/60">
          <li v-for="h in stray" :key="h.id" class="py-2 flex items-center gap-3">
            <span class="flex-1 min-w-0">
              <span class="block text-sm text-zinc-200 truncate">{{ h.label || 'Unnamed webhook' }}</span>
              <span class="block text-[11px] text-zinc-600 font-mono truncate">{{ h.kind }} · {{ h.url }}</span>
            </span>
            <button type="button" class="btn btn-sm btn-ghost" @click="openEdit(h)">Edit</button>
            <button type="button" class="btn btn-sm btn-danger" @click="remove(h)">Remove</button>
          </li>
        </ul>
      </section>
    </template>

    <!-- Preview -->
    <Teleport to="body">
      <div
        v-if="preview"
        class="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/60"
        @mousedown.self="preview = null"
      >
        <div class="modal-panel w-full max-w-2xl max-h-[85vh] flex flex-col" role="dialog" aria-modal="true" aria-label="Post preview">
          <header class="px-5 py-4 border-b border-zinc-800 flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <h2 class="section-title">Preview: {{ preview.hook.label || 'Unnamed webhook' }}</h2>
              <p class="text-xs text-zinc-500 mt-0.5">{{ preview.basis }}</p>
            </div>
            <button type="button" class="p-1 rounded text-zinc-500 hover:text-zinc-200" aria-label="Close" @click="preview = null">
              <NavIcon name="close" class="w-4 h-4" />
            </button>
          </header>
          <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 bg-[#313338]/40">
            <DiscordPreview v-if="preview.payloads.length" :payloads="preview.payloads" :name="preview.hook.discord_name ?? undefined" />
            <p v-else class="text-sm text-zinc-500 py-8 text-center">
              {{ isDigest(preview.hook) ? 'Nothing is waiting. Whatever changes from now goes in the next post.' : 'Nothing to build a sample from yet.' }}
            </p>
          </div>
          <footer v-if="isDigest(preview.hook)" class="px-5 py-3 border-t border-zinc-800 flex items-center justify-between gap-3">
            <span class="text-xs text-zinc-500 tabular-nums">{{ (preview.changes ?? 0).toLocaleString() }} {{ preview.changes === 1 ? 'change' : 'changes' }}</span>
            <button
              type="button"
              class="btn btn-sm btn-primary"
              :disabled="!preview.payloads.length || !!busy[preview.hook.id]"
              @click="postNow(preview.hook)"
            >{{ busy[preview.hook.id] === 'post' ? 'Posting…' : 'Post this now' }}</button>
          </footer>
        </div>
      </div>
    </Teleport>
  </AdminSection>
</template>
