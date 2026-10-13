<script setup lang="ts">
import { roleMeta } from '~/utils/role-styles'
import { timeAgo, absoluteTime } from '~/utils/relative-time'

/**
 * Accounts: who has which role, who is banned, and which players they claim.
 *
 * Each row used to carry six role buttons, a ban button and an always-open
 * claim box: nine controls a row, most of which an admin never touches. A row
 * is now the account, one role menu and one ban button. The claim box opens
 * on request, and every change asks first in a dialog that says what it does.
 */
const emit = defineEmits<{ (e: 'changed'): void; (e: 'navigate', id: string): void }>()

const { data: meRes } = useCurrentUser()
const toast = useAdminToast()
const { confirm, prompt } = useConfirmDialog()

type Role = 'user' | 'list_helper' | 'moderator' | 'admin' | 'owner' | 'developer'
type ClaimKind = 'aredl' | 'gdl' | 'pointercrate'
type AdminUser = {
  id: number; username: string; role: Role
  claimed_player: string | null; created_at: string
  banned_at: string | null; banned_reason: string | null
  claimed_aredl_uuid: string | null; claimed_aredl_name: string | null
  claimed_gdl_id: number | null; claimed_gdl_name: string | null
  claimed_pointercrate_id: number | null; claimed_pointercrate_name: string | null
  claimed_records: { aredl: number; gdl: number; pointercrate: number }
}

const users = ref<AdminUser[]>([])
const loading = ref(true)
const search = ref('')
const filter = ref<'all' | 'staff' | 'banned'>('all')
const filterModel = computed({ get: () => filter.value as string, set: (v: string) => { filter.value = v as typeof filter.value } })

async function load() {
  try {
    const query: Record<string, string> = {}
    if (search.value.trim()) query.search = search.value.trim()
    if (filter.value !== 'all') query.filter = filter.value
    users.value = (await $fetch<{ items: AdminUser[] }>('/api/admin/users', { query })).items
  } catch (e) {
    toast.fail(e, 'Could not load accounts.')
  } finally {
    loading.value = false
  }
}
onMounted(load)
let debounce: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(load, 200)
})
watch(filter, load)

/**
 * Must match `ROLE_RANK` in `server/api/admin/role.post.ts`, which is the one
 * that enforces it. This copy only decides which options are greyed out.
 */
const ROLE_RANK: Record<string, number> = { user: 0, list_helper: 1, moderator: 2, admin: 3, owner: 4, developer: 4 }
/** In rank order. Mirrors `ROLES` on the server. */
const ROLES: Role[] = ['user', 'list_helper', 'moderator', 'admin', 'owner', 'developer']
const myRank = computed(() => ROLE_RANK[meRes.value?.account?.role ?? 'user'] ?? 0)
const aboveMe = (role: string) => (ROLE_RANK[role] ?? 0) > myRank.value
const isMe = (u: AdminUser) => u.id === meRes.value?.account?.id

async function setRole(u: AdminUser, role: Role, el: HTMLSelectElement) {
  if (u.role === role) return
  const meta = roleMeta(role)
  const ok = await confirm({
    title: role === 'user' ? `Remove ${u.username}’s role?` : `Make ${u.username} ${/^[aeiou]/i.test(meta.label) ? 'an' : 'a'} ${meta.label.toLowerCase()}?`,
    message: role === 'user' ? `They become a regular account. They are ${roleMeta(u.role).label.toLowerCase()} now.` : meta.title,
    confirmLabel: role === 'user' ? 'Remove role' : `Make ${meta.label.toLowerCase()}`,
    tone: ROLE_RANK[role]! < ROLE_RANK[u.role]! ? 'danger' : 'primary',
  })
  if (!ok) { el.value = u.role; return }
  try {
    await $fetch('/api/admin/role', { method: 'POST', body: { username: u.username, role } })
    toast.ok(`${u.username} is now ${meta.label.toLowerCase()}.`)
    await load()
  } catch (e) {
    el.value = u.role
    toast.fail(e)
  }
}

async function toggleBan(u: AdminUser) {
  if (u.banned_at) {
    if (!(await confirm({ title: `Unban ${u.username}?`, message: 'They can sign in and post again.', confirmLabel: 'Unban' }))) return
    try {
      await $fetch('/api/admin/ban', { method: 'POST', body: { username: u.username, action: 'unban' } })
      toast.ok(`${u.username} is unbanned.`)
      await load()
    } catch (e) { toast.fail(e) }
    return
  }
  const reason = await prompt({
    title: `Ban ${u.username}?`,
    message: 'They are signed out and can’t sign back in.',
    inputLabel: 'Reason, shown to them when they try',
    placeholder: 'Optional',
    multiline: true,
    confirmLabel: 'Ban',
    tone: 'danger',
  })
  if (reason === null) return
  try {
    await $fetch('/api/admin/ban', { method: 'POST', body: { username: u.username, action: 'ban', reason: reason.trim() || undefined } })
    toast.ok(`${u.username} is banned.`)
    await load()
  } catch (e) { toast.fail(e) }
}

// ---- The ALL player claim, edited on request
const editing = ref<number | null>(null)
const claimDraft = ref('')
function editClaim(u: AdminUser) {
  editing.value = editing.value === u.id ? null : u.id
  claimDraft.value = u.claimed_player ?? ''
}
async function saveClaim(u: AdminUser, clear = false) {
  const player = clear ? '' : claimDraft.value.trim()
  try {
    await $fetch('/api/admin/set-claim', { method: 'POST', body: { username: u.username, player_name: player || null } })
    toast.ok(player ? `${u.username} now claims ${player}.` : `Cleared ${u.username}’s claim.`)
    editing.value = null
    emit('changed')
    await load()
  } catch (e) { toast.fail(e) }
}

/** The external claims a user holds, with what releasing each would cost them. */
const CLAIM_LABELS: Record<ClaimKind, string> = { aredl: 'AREDL', gdl: 'GDL', pointercrate: 'Pointercrate' }
function externalClaims(u: AdminUser): { kind: ClaimKind; name: string; records: number }[] {
  const out: { kind: ClaimKind; name: string; records: number }[] = []
  if (u.claimed_aredl_uuid) out.push({ kind: 'aredl', name: u.claimed_aredl_name ?? 'AREDL player', records: u.claimed_records?.aredl ?? 0 })
  if (u.claimed_pointercrate_id) out.push({ kind: 'pointercrate', name: u.claimed_pointercrate_name ?? 'Pointercrate player', records: u.claimed_records?.pointercrate ?? 0 })
  if (u.claimed_gdl_id) out.push({ kind: 'gdl', name: u.claimed_gdl_name ?? 'GDL player', records: u.claimed_records?.gdl ?? 0 })
  return out
}

async function unclaim(u: AdminUser, c: { kind: ClaimKind; name: string; records: number }) {
  const ok = await confirm({
    title: `Release ${u.username}’s ${CLAIM_LABELS[c.kind]} claim on ${c.name}?`,
    message: c.records
      ? `${c.records.toLocaleString()} ${c.records === 1 ? 'record comes' : 'records come'} off their ALL profile. The ${CLAIM_LABELS[c.kind]} records themselves are untouched.`
      : 'It brought no records with it.',
    confirmLabel: 'Release',
    tone: 'danger',
  })
  if (!ok) return
  try {
    const res = await $fetch<{ records_removed: number }>('/api/admin/set-claim', { method: 'POST', body: { username: u.username, unclaim: c.kind } })
    toast.ok(res.records_removed
      ? `Released. ${res.records_removed.toLocaleString()} records came off ${u.username}’s profile.`
      : `Released ${u.username}’s ${CLAIM_LABELS[c.kind]} claim.`)
    emit('changed')
    await load()
  } catch (e) { toast.fail(e) }
}
</script>

<template>
  <AdminSection title="Accounts" description="Roles, bans and player claims. The 200 newest that match are shown." width="lg">
    <template #actions>
      <button type="button" class="btn btn-sm btn-ghost" @click="emit('navigate', 'overview')">Registration and site access</button>
    </template>

    <div class="flex items-center gap-2 flex-wrap mb-4">
      <input
        v-model="search"
        type="search"
        placeholder="Find by username or player"
        class="field field-sm flex-1 min-w-[12rem] max-w-sm"
      />
      <SegmentedControl
        v-model="filterModel"
        aria-label="Which accounts"
        :options="[
          { value: 'all', label: 'Everyone' },
          { value: 'staff', label: 'Staff' },
          { value: 'banned', label: 'Banned' },
        ]"
      />
      <span class="ml-auto text-xs text-zinc-500 tabular-nums">{{ users.length.toLocaleString() }}{{ users.length === 200 ? '+' : '' }} shown</span>
    </div>

    <div v-if="loading" class="card divide-y divide-zinc-800/60">
      <div v-for="n in 6" :key="n" class="h-16 animate-pulse" />
    </div>
    <div v-else-if="!users.length" class="card px-4 py-10 text-center text-sm text-zinc-500">
      No accounts match.
    </div>
    <ul v-else class="card divide-y divide-zinc-800/60">
      <li v-for="u in users" :key="u.id" class="px-4 py-3" :class="{ 'bg-red-950/10': u.banned_at }">
        <div class="flex items-center gap-3 flex-wrap">
          <div class="flex-1 min-w-[12rem]">
            <div class="flex items-center gap-2 flex-wrap">
              <NuxtLink :to="`/users/${u.username}`" class="font-medium text-zinc-100 hover:text-accent">{{ u.username }}</NuxtLink>
              <!-- The one place a plain `user` badge is printed: a column of
                   roles, where a blank reads as missing data. -->
              <RoleBadge :role="u.role" size="sm" always />
              <Badge v-if="u.banned_at" tone="rose" size="sm" :title="u.banned_reason ?? 'Banned'">Banned</Badge>
              <span v-if="isMe(u)" class="text-[11px] text-zinc-500">you</span>
            </div>
            <div class="mt-0.5 text-xs text-zinc-500 flex flex-wrap gap-x-3 gap-y-0.5">
              <span :title="absoluteTime(u.created_at)">Joined {{ timeAgo(u.created_at) }}</span>
              <span v-if="u.claimed_player">Plays as <span class="text-zinc-300">{{ u.claimed_player }}</span></span>
              <span v-for="c in externalClaims(u)" :key="c.kind" class="inline-flex items-center gap-1">
                {{ CLAIM_LABELS[c.kind] }} <span class="text-zinc-300">{{ c.name }}</span>
                <span v-if="c.records" class="tabular-nums">· {{ c.records.toLocaleString() }} rec</span>
                <button type="button" class="text-zinc-500 hover:text-red-300 underline underline-offset-2" @click="unclaim(u, c)">release</button>
              </span>
            </div>
            <p v-if="u.banned_at && u.banned_reason" class="mt-0.5 text-xs text-red-300/80 truncate" :title="u.banned_reason">
              Reason: {{ u.banned_reason }}
            </p>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <!-- In rank order and labelled from the same table the badges use.
                 Roles above your own are listed but can't be picked. -->
            <select
              :value="u.role"
              class="field field-sm w-auto pr-8 text-xs"
              :disabled="aboveMe(u.role) || isMe(u)"
              :title="isMe(u) ? 'You can’t change your own role' : aboveMe(u.role) ? 'Outranks you' : 'Role'"
              aria-label="Role"
              @change="setRole(u, ($event.target as HTMLSelectElement).value as Role, $event.target as HTMLSelectElement)"
            >
              <option v-for="r in ROLES" :key="r" :value="r" :disabled="aboveMe(r)">{{ roleMeta(r).label }}</option>
            </select>
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              :class="editing === u.id ? 'border-accent/60 text-accent' : ''"
              @click="editClaim(u)"
            >Claim</button>
            <button
              type="button"
              class="btn btn-sm w-[4.5rem]"
              :class="u.banned_at ? 'btn-ghost text-emerald-300' : 'btn-danger'"
              :disabled="isMe(u) || aboveMe(u.role)"
              @click="toggleBan(u)"
            >{{ u.banned_at ? 'Unban' : 'Ban' }}</button>
          </div>
        </div>

        <form v-if="editing === u.id" class="mt-3 flex items-center gap-2 flex-wrap" @submit.prevent="saveClaim(u)">
          <label class="text-xs text-zinc-400" :for="`claim-${u.id}`">Player on the ALL list</label>
          <input
            :id="`claim-${u.id}`"
            v-model="claimDraft"
            placeholder="Player name"
            class="field field-sm w-56"
          />
          <button type="submit" class="btn btn-sm btn-primary">Save</button>
          <button v-if="u.claimed_player" type="button" class="btn btn-sm btn-ghost" @click="saveClaim(u, true)">Clear</button>
          <button type="button" class="btn btn-sm text-zinc-500 hover:text-zinc-200" @click="editing = null">Cancel</button>
        </form>
      </li>
    </ul>
  </AdminSection>
</template>
