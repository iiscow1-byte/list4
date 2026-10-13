<script setup lang="ts">
/** The dialog behind `useConfirmDialog()`. Rendered once, by the admin page. */
const { state, settle } = useConfirmDialog()

const input = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
const confirmBtn = ref<HTMLButtonElement | null>(null)

const s = computed(() => (state.value.open ? state.value : null))
const blocked = computed(() => !!s.value && s.value.mode === 'prompt' && !!s.value.required && !s.value.value.trim())

watch(() => state.value.open, async (open) => {
  if (!open) return
  await nextTick()
  if (input.value) input.value.focus()
  else confirmBtn.value?.focus()
})

function submit() {
  if (!s.value || blocked.value) return
  settle(s.value.mode === 'prompt' ? s.value.value : '')
}

function onKey(e: KeyboardEvent) {
  if (!s.value) return
  if (e.key === 'Escape') { e.preventDefault(); settle(null); return }
  if (e.key !== 'Enter') return
  // A focused button does what it says, so Enter on Cancel cancels. In a text
  // field Enter confirms, except in a multi-line box, where Ctrl+Enter does.
  const t = e.target
  if (t instanceof HTMLButtonElement) return
  if (t instanceof HTMLTextAreaElement && !(e.metaKey || e.ctrlKey)) return
  e.preventDefault()
  submit()
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="s"
        class="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-[2px]"
        @mousedown.self="settle(null)"
        @keydown="onKey"
      >
        <div
          class="modal-panel w-full max-w-md p-5"
          role="alertdialog"
          aria-modal="true"
          :aria-label="s.title"
        >
          <h2 class="section-title">{{ s.title }}</h2>
          <p v-if="s.message" class="mt-2 text-sm text-zinc-400 whitespace-pre-line leading-relaxed">{{ s.message }}</p>

          <label v-if="s.mode === 'prompt'" class="block mt-4">
            <span v-if="s.inputLabel" class="label">{{ s.inputLabel }}</span>
            <textarea
              v-if="s.multiline"
              ref="input"
              v-model="s.value"
              rows="3"
              maxlength="4000"
              :placeholder="s.placeholder"
              class="field field-md mt-1"
            />
            <input
              v-else
              ref="input"
              v-model="s.value"
              :placeholder="s.placeholder"
              class="field field-md mt-1"
            />
          </label>

          <div class="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button type="button" class="btn btn-md btn-ghost" @click="settle(null)">
              {{ s.cancelLabel ?? 'Cancel' }}
            </button>
            <button
              ref="confirmBtn"
              type="button"
              class="btn btn-md"
              :class="s.tone === 'danger' ? 'bg-red-600 text-white hover:bg-red-500' : 'btn-primary'"
              :disabled="blocked"
              @click="submit"
            >{{ s.confirmLabel ?? 'Confirm' }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
