/**
 * The admin panel's notices.
 *
 * Every section used to keep its own `banner` ref: a strip pushed in above the
 * content, which shoved the page down by a line, and which each section drew in
 * its own place, so a result appeared at the top of one tab and at the bottom of
 * the next. One stack, in one corner, for the whole panel.
 */
export type AdminToast = { id: number; kind: 'ok' | 'err'; msg: string }

let nextId = 1

export function useAdminToast() {
  const toasts = useState<AdminToast[]>('admin-toasts', () => [])

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function push(kind: AdminToast['kind'], msg: string) {
    const id = nextId++
    // Newest at the bottom; four is plenty to read before they go.
    toasts.value = [...toasts.value.slice(-3), { id, kind, msg }]
    // Errors stay longer: they are the ones somebody needs to read twice.
    if (import.meta.client) setTimeout(() => dismiss(id), kind === 'err' ? 7000 : 3500)
  }

  return {
    toasts,
    dismiss,
    ok: (msg: string) => push('ok', msg),
    err: (msg: string) => push('err', msg),
    /** The message from a failed `$fetch`, or `fallback`. */
    fail: (e: any, fallback = 'Something went wrong.') => push('err', apiError(e, fallback)),
  }
}

/** What the server said went wrong, or `fallback`. */
export function apiError(e: any, fallback = 'Something went wrong.'): string {
  return e?.data?.statusMessage ?? e?.statusMessage ?? fallback
}
