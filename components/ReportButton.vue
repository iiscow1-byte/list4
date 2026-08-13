<script setup lang="ts">
/**
 * Report this thing.
 *
 * One component for every kind of report, because the dialog is the same
 * dialog: pick a reason, say what happened, send. The reasons it offers change
 * with the target — reporting a level for "impersonation" or an account for
 * "impossible" is a category error, and the server refuses both, so offering
 * them here would only produce a confusing failure.
 *
 * ## The two level reasons
 *
 * "Impossible" and "Should be removed" are separate on purpose. They lead to
 * different checks — one is a verification question, the other an editorial one
 * — and folding them into a single "wrong" would leave the queue impossible to
 * triage.
 *
 * ## Staff abuse
 *
 * Offered on accounts like any other reason, and routed away from the people it
 * might be about: only admins ever see one, and never one naming them. That
 * routing is entirely server-side (see `visibleReportsClause`), which is why
 * this component can afford to be naive about it — there is nothing here worth
 * bypassing.
 */
/**
 * ## Where it goes
 *
 * The trailing end of the header row of whatever is being reported — last
 * control, pushed right. It used to be placed by each caller: `ml-auto` on a
 * level, `ml-1` on a profile, `shrink-0` in a list bar, and on comments an
 * `opacity-0` that only appeared on hover. Five surfaces, four positions, and
 * on the busiest of them the control was invisible until the pointer happened
 * to cross it — so "where do I report this?" had a different answer on every
 * page and no answer at all on a touchscreen.
 *
 * The alignment still belongs to the caller — only the caller knows what row
 * this is going in — but it is the same `ml-auto shrink-0` everywhere now, and
 * nothing hides it.
 *
 * Attributes are forwarded by hand because the teleports below count as root
 * nodes, and Vue will not auto-inherit a class onto a fragment.
 */
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  target: 'account' | 'comment' | 'custom_list' | 'level' | 'forum_thread' | 'forum_post'
  targetId: number
  /** What is being reported, for the confirmation line. */
  label?: string | null
  /** `icon` is a bare flag for dense rows; `text` adds the word "Report". */
  variant?: 'icon' | 'text'
}>(), { label: null, variant: 'icon' })

const { data: meRes } = useCurrentUser()
const me = computed(() => meRes.value?.account ?? null)

/** Mirrors `REASONS_BY_TARGET` on the server — the server is the authority. */
const REASONS: Record<string, { value: string; label: string; hint?: string }[]> = {
  account: [
    { value: 'abuse', label: 'Abuse or harassment' },
    { value: 'impersonation', label: 'Impersonation' },
    { value: 'spam', label: 'Spam' },
    { value: 'inappropriate', label: 'Inappropriate content' },
    {
      value: 'staff_abuse',
      label: 'Abusing a staff role',
      hint: 'Goes to the site admins only. The person you name is never shown it.',
    },
    { value: 'other', label: 'Something else' },
  ],
  comment: [
    { value: 'abuse', label: 'Abuse or harassment' },
    { value: 'spam', label: 'Spam' },
    { value: 'inappropriate', label: 'Inappropriate content' },
    { value: 'other', label: 'Something else' },
  ],
  custom_list: [
    { value: 'inappropriate', label: 'Inappropriate content' },
    { value: 'spam', label: 'Spam' },
    { value: 'impersonation', label: 'Impersonating another list' },
    { value: 'other', label: 'Something else' },
  ],
  level: [
    {
      value: 'impossible',
      label: 'This level is impossible',
      hint: 'Nobody can complete it — a broken trigger, an unbeatable section, a faked verification.',
    },
    {
      value: 'removal_request',
      label: 'It should be removed from the list',
      hint: 'It belongs on the list no longer — deleted from the game, a duplicate entry, or never qualified.',
    },
    { value: 'wrong_placement', label: 'It is placed wrongly' },
    { value: 'inappropriate', label: 'Inappropriate content' },
    { value: 'other', label: 'Something else' },
  ],
  forum_thread: [
    { value: 'abuse', label: 'Abuse or harassment' },
    { value: 'spam', label: 'Spam' },
    { value: 'inappropriate', label: 'Inappropriate content' },
    { value: 'other', label: 'Something else' },
  ],
  forum_post: [
    { value: 'abuse', label: 'Abuse or harassment' },
    { value: 'spam', label: 'Spam' },
    { value: 'inappropriate', label: 'Inappropriate content' },
    { value: 'other', label: 'Something else' },
  ],
}

const reasons = computed(() => REASONS[props.target] ?? REASONS.other ?? [])

const open = ref(false)
const reason = ref('')
const details = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
const sent = ref<string | null>(null)

const chosen = computed(() => reasons.value.find((r) => r.value === reason.value) ?? null)
/** The two open-ended reasons are useless to a reviewer without a description. */
const needsDetails = computed(() => reason.value === 'other' || reason.value === 'staff_abuse')
const canSend = computed(() =>
  !!reason.value && (!needsDetails.value || details.value.trim().length > 2),
)

function close() {
  open.value = false
  reason.value = ''
  details.value = ''
  error.value = null
}

async function send() {
  if (busy.value || !canSend.value) return
  busy.value = true
  error.value = null
  try {
    const res = await $fetch<{ duplicate: boolean; message?: string }>('/api/reports', {
      method: 'POST',
      body: {
        target: props.target,
        target_id: props.targetId,
        reason: reason.value,
        details: details.value.trim() || null,
      },
    })
    sent.value = res.duplicate
      ? (res.message ?? 'You have already reported this.')
      : 'Sent. A moderator will look at it.'
    close()
    setTimeout(() => { sent.value = null }, 6000)
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not send that.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <!-- Signed out: no control at all. An anonymous report cannot be followed
       up or weighed against a history, so the server refuses it, and a button
       that always errors is worse than no button. -->
  <button
    v-if="me"
    type="button"
    v-bind="$attrs"
    class="inline-flex items-center gap-1 rounded-lg p-1 -m-1 text-[11px] text-zinc-600 hover:text-red-400 hover:bg-red-950/30 transition-colors"
    :class="variant === 'text' ? 'px-1.5 -mx-1.5' : ''"
    :title="label ? `Report ${label}` : 'Report this'"
    :aria-label="label ? `Report ${label}` : 'Report this'"
    @click="open = true"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 shrink-0" aria-hidden="true">
      <path d="M4 21V4M4 4h11l-1.5 3.5L15 11H4" />
    </svg>
    <span v-if="variant === 'text'">Report</span>
  </button>

  <!--
    The confirmation is a toast, not a sibling of the button.

    It used to render inline beside it, which meant a sentence roughly forty
    characters long appeared inside whatever row the button was in — a comment
    header, a level's chip row — and shoved everything on that row sideways for
    six seconds. On a phone it wrapped the row onto a second line. The message
    is about the action, not about the thing, so it belongs off to one side of
    the page rather than in the middle of the content.
  -->
  <Teleport to="body">
    <div
      v-if="sent"
      role="status"
      aria-live="polite"
      class="fixed z-[60] bottom-4 left-1/2 -translate-x-1/2 max-w-[calc(100vw-2rem)] rounded-lg border border-emerald-900/60 bg-emerald-950/90 backdrop-blur px-3.5 py-2 text-xs text-emerald-300 shadow-xl"
    >{{ sent }}</div>
  </Teleport>

  <Teleport to="body">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
        @click.self="close"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Report"
          class="modal-panel w-full max-w-md p-5 space-y-4"
        >
          <div>
            <h2 class="text-sm font-semibold text-zinc-100">Report this</h2>
            <p v-if="label" class="text-[11px] text-zinc-500 mt-0.5 truncate">{{ label }}</p>
          </div>

          <div class="space-y-1.5">
            <label
              v-for="r in reasons"
              :key="r.value"
              class="flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer select-none transition-colors"
              :class="reason === r.value
                ? 'border-accent/60 bg-accent/10'
                : 'border-zinc-800 hover:border-zinc-700'"
            >
              <input v-model="reason" type="radio" :value="r.value" class="mt-0.5 accent-accent shrink-0" />
              <span class="min-w-0">
                <span class="block text-xs" :class="reason === r.value ? 'text-accent' : 'text-zinc-200'">{{ r.label }}</span>
                <span v-if="r.hint" class="block text-[10px] text-zinc-500 leading-snug mt-0.5">{{ r.hint }}</span>
              </span>
            </label>
          </div>

          <label class="block">
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">
              What happened
              <span v-if="needsDetails" class="text-amber-400/90 normal-case tracking-normal">required</span>
              <span v-else class="text-zinc-600 normal-case tracking-normal">optional</span>
            </span>
            <textarea
              v-model="details"
              rows="3"
              maxlength="2000"
              :placeholder="chosen?.value === 'impossible'
                ? 'Where does it become impossible?'
                : 'Anything a moderator would need to know.'"
              class="field field-md mt-1 text-xs"
            />
          </label>

          <p v-if="error" class="text-xs text-red-400">{{ error }}</p>

          <div class="flex gap-2">
            <button
              type="button"
              :disabled="busy || !canSend"
              class="btn btn-md btn-primary flex-1"
              @click="send"
            >{{ busy ? 'Sending…' : 'Send report' }}</button>
            <button type="button" class="btn btn-md btn-ghost" @click="close">Cancel</button>
          </div>
        </div>
      </div>
    </Teleport>
</template>
