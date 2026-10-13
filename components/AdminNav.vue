<script setup lang="ts">
import { compactCount } from '~/utils/format-count'

/**
 * The admin panel's sections, as a list you can read at a glance.
 *
 * It was four dropdowns. That fixed a row of eleven buttons, but a dropdown
 * still hides what it holds: seeing whether anything was waiting in Moderation
 * meant opening it, and reaching any section took two clicks. A sidebar shows
 * every section and every count at once, and any section is one click away.
 *
 * Each row's number is how many are waiting there. It turns red when some of
 * them arrived since you last opened that section.
 *
 * `collapsed` shrinks it to icons for the review queues, which want the width.
 */
export type AdminNavItem = {
  id: string
  label: string
  icon: string
  /** Waiting there now; null for sections that aren't queues. */
  count?: number | null
  /** How many of those are new since this account last opened the section. */
  fresh?: number
}
export type AdminNavGroup = { key: string; label: string; items: AdminNavItem[] }

defineProps<{
  groups: AdminNavGroup[]
  active: string
  collapsed?: boolean
}>()
const emit = defineEmits<{ (e: 'select', id: string): void; (e: 'toggle'): void }>()
</script>

<template>
  <nav class="flex flex-col h-full min-h-0" aria-label="Admin sections">
    <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-2" :class="collapsed ? 'px-2' : 'px-3'">
      <div v-for="(g, gi) in groups" :key="g.key" :class="gi > 0 ? 'mt-3' : ''">
        <p
          v-if="g.label && !collapsed"
          class="px-2 mb-1 text-[11px] font-medium text-zinc-500"
        >{{ g.label }}</p>
        <div v-else-if="gi > 0" class="mx-2 mb-2 border-t border-zinc-800/80" aria-hidden="true" />
        <ul class="space-y-0.5">
          <li v-for="it in g.items" :key="it.id">
            <button
              type="button"
              class="group relative w-full flex items-center gap-2.5 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              :class="[
                collapsed ? 'justify-center h-8' : 'px-2 py-1',
                active === it.id
                  ? 'bg-accent/10 text-accent'
                  : 'text-zinc-300 hover:text-zinc-50 hover:bg-zinc-900',
              ]"
              :title="collapsed ? `${it.label}${it.count ? ` · ${it.count.toLocaleString()} waiting` : ''}` : undefined"
              :aria-current="active === it.id ? 'page' : undefined"
              @click="emit('select', it.id)"
            >
              <NavIcon :name="it.icon" class="w-4 h-4 shrink-0" :class="active === it.id ? '' : 'text-zinc-500 group-hover:text-zinc-300'" />
              <span v-if="!collapsed" class="flex-1 min-w-0 truncate text-left">{{ it.label }}</span>
              <template v-if="it.count">
                <span
                  v-if="!collapsed"
                  class="shrink-0 min-w-[1.5rem] h-5 px-1.5 rounded-full text-[11px] font-semibold tabular-nums flex items-center justify-center"
                  :class="it.fresh ? 'bg-red-500 text-white' : 'bg-zinc-800 text-zinc-300'"
                  :title="it.fresh ? `${it.fresh.toLocaleString()} new since you last looked` : `${it.count.toLocaleString()} waiting`"
                >{{ compactCount(it.count) }}</span>
                <span
                  v-else
                  class="absolute top-1 right-1 w-2 h-2 rounded-full"
                  :class="it.fresh ? 'bg-red-500' : 'bg-zinc-500'"
                  aria-hidden="true"
                />
              </template>
            </button>
          </li>
        </ul>
      </div>
    </div>

    <div class="shrink-0 border-t border-zinc-800/80 p-2 hidden lg:block">
      <button
        type="button"
        class="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
        :class="collapsed ? 'justify-center' : ''"
        :title="collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'"
        @click="emit('toggle')"
      >
        <NavIcon name="panel-left" class="w-4 h-4 shrink-0" />
        <span v-if="!collapsed">Collapse</span>
      </button>
    </div>
  </nav>
</template>
