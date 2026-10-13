<script setup lang="ts">
/** The notices behind `useAdminToast()`, bottom right, above everything. */
const { toasts, dismiss } = useAdminToast()
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed z-[90] bottom-4 right-4 left-4 sm:left-auto sm:w-96 flex flex-col gap-2 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <TransitionGroup
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 translate-y-2"
        leave-active-class="transition duration-150 ease-in"
        leave-to-class="opacity-0"
      >
        <div
          v-for="t in toasts"
          :key="t.id"
          class="pointer-events-auto popover flex items-start gap-2.5 px-3.5 py-2.5 text-sm"
          :class="t.kind === 'err' ? 'border-red-900/70' : 'border-emerald-900/70'"
        >
          <span
            class="mt-1.5 w-2 h-2 rounded-full shrink-0"
            :class="t.kind === 'err' ? 'bg-red-400' : 'bg-emerald-400'"
            aria-hidden="true"
          />
          <span class="flex-1 min-w-0 break-words" :class="t.kind === 'err' ? 'text-red-200' : 'text-zinc-100'">{{ t.msg }}</span>
          <button
            type="button"
            class="shrink-0 -mr-1 p-0.5 rounded text-zinc-500 hover:text-zinc-200"
            aria-label="Dismiss"
            @click="dismiss(t.id)"
          >
            <NavIcon name="close" class="w-3.5 h-3.5" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
