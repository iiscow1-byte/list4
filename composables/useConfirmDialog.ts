/**
 * Ask an admin to confirm something, in the site's own dialog.
 *
 * The panel used the browser's `confirm()` and `prompt()`: a grey system box
 * with "localhost says" across the top, no way to tell a ban from a test post,
 * and a single-line text box for a ban reason. This is the same promise-shaped
 * call with a dialog that says what is about to happen and colours the button
 * by what it does.
 *
 * `AdminConfirmDialog` renders it, once, in the admin page.
 */
export type ConfirmOptions = {
  title: string
  /** What happens, in a sentence or two. Line breaks are kept. */
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** `danger` for anything that deletes, bans or can't be undone. */
  tone?: 'primary' | 'danger'
}

export type PromptOptions = ConfirmOptions & {
  inputLabel?: string
  placeholder?: string
  initial?: string
  multiline?: boolean
  /** Refuse an empty answer. */
  required?: boolean
}

type DialogState = (PromptOptions & { open: true; mode: 'confirm' | 'prompt'; value: string }) | { open: false }

// The resolver is a function, so it lives outside `useState` (which must stay
// serialisable). Only one dialog is ever open.
let resolver: ((v: string | null) => void) | null = null

export function useConfirmDialog() {
  const state = useState<DialogState>('admin-confirm-dialog', () => ({ open: false }))

  function open(mode: 'confirm' | 'prompt', opts: PromptOptions): Promise<string | null> {
    resolver?.(null)
    state.value = { ...opts, open: true, mode, value: opts.initial ?? '' }
    return new Promise((resolve) => { resolver = resolve })
  }

  /** Resolve the open dialog: a string confirms (the text, for a prompt), null cancels. */
  function settle(value: string | null) {
    const r = resolver
    resolver = null
    state.value = { open: false }
    r?.(value)
  }

  return {
    state,
    settle,
    /** True when confirmed. */
    confirm: async (opts: ConfirmOptions) => (await open('confirm', opts)) !== null,
    /** The text entered, or null when cancelled. */
    prompt: (opts: PromptOptions) => open('prompt', opts),
  }
}
