<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Inbox — All Levels List' })

type InboxItem = {
  id: number
  kind: string
  subject: string
  body: string | null
  related_kind: string | null
  related_id: number | null
  read_at: string | null
  created_at: string
  sent_by_username: string | null
}

const items = ref<InboxItem[]>([])
const unread = ref(0)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const res = await $fetch<{ items: InboxItem[]; unread: number }>('/api/account/inbox')
    items.value = res.items
    unread.value = res.unread
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function markRead(m: InboxItem) {
  if (m.read_at) return
  await $fetch(`/api/account/inbox/${m.id}`, { method: 'POST', body: { action: 'read' } })
  m.read_at = new Date().toISOString()
  unread.value = Math.max(0, unread.value - 1)
}
async function markUnread(m: InboxItem) {
  if (!m.read_at) return
  await $fetch(`/api/account/inbox/${m.id}`, { method: 'POST', body: { action: 'unread' } })
  m.read_at = null
  unread.value++
}
async function readAll() {
  if (unread.value === 0) return
  await $fetch('/api/account/inbox/read-all', { method: 'POST' })
  for (const m of items.value) if (!m.read_at) m.read_at = new Date().toISOString()
  unread.value = 0
}

function kindLabel(kind: string) {
  switch (kind) {
    case 'level_rejected': return 'Level rejected'
    case 'record_rejected': return 'Record rejected'
    case 'awaiting_removed': return 'Removed from awaiting'
    case 'role_changed': return 'Role changed'
    default: return kind
  }
}
</script>

<template>
  <div class="container-tight py-8 max-w-3xl">
    <header class="flex items-center justify-between gap-3 mb-6 flex-wrap">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight">Inbox</h1>
        <p class="text-sm text-zinc-400">
          Messages from moderators about your submissions.
          <span v-if="unread > 0" class="text-accent">{{ unread }} unread</span>
        </p>
      </div>
      <button
        v-if="unread > 0"
        type="button"
        class="rounded border border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:border-zinc-500 text-xs px-3 py-1.5 transition-colors"
        @click="readAll"
      >Mark all read</button>
    </header>

    <div v-if="loading && !items.length" class="text-sm text-zinc-500">Loading…</div>
    <div v-else-if="!items.length" class="rounded-md border border-zinc-800 bg-zinc-950/60 p-6 text-center text-sm text-zinc-500">
      Nothing here yet.
    </div>
    <ul v-else class="rounded-md border border-zinc-800 bg-zinc-950/60 divide-y divide-zinc-900">
      <li
        v-for="m in items"
        :key="m.id"
        class="px-4 py-3 transition-colors"
        :class="m.read_at ? 'text-zinc-400' : 'text-zinc-100 bg-accent/5'"
      >
        <div class="flex items-baseline gap-2 flex-wrap">
          <span
            class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border"
            :class="m.read_at
              ? 'border-zinc-800 text-zinc-500'
              : 'border-accent/40 text-accent'"
          >{{ kindLabel(m.kind) }}</span>
          <h2 class="text-sm font-medium flex-1 min-w-0 truncate">{{ m.subject }}</h2>
          <span class="text-[11px] text-zinc-500 tabular-nums shrink-0">{{ m.created_at }}</span>
        </div>
        <p v-if="m.body" class="text-sm mt-2 whitespace-pre-wrap leading-relaxed text-zinc-300">{{ m.body }}</p>
        <p v-else class="text-[11px] text-zinc-600 mt-2 italic">No reason given.</p>
        <div class="flex items-center gap-3 mt-2 text-[11px]">
          <span v-if="m.sent_by_username" class="text-zinc-500">From {{ m.sent_by_username }}</span>
          <button
            v-if="!m.read_at"
            type="button"
            class="ml-auto text-zinc-500 hover:text-accent transition-colors"
            @click="markRead(m)"
          >Mark read</button>
          <button
            v-else
            type="button"
            class="ml-auto text-zinc-500 hover:text-accent transition-colors"
            @click="markUnread(m)"
          >Mark unread</button>
        </div>
      </li>
    </ul>
  </div>
</template>
