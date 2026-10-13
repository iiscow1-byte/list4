/**
 * Scroll `box`, and only `box`, so that `el` is in view.
 *
 * `scrollIntoView` also scrolls every clipped container around the element,
 * which inside the split-pane layout nudged the whole page sideways.
 */
export function scrollWithin(
  box: HTMLElement | null | undefined,
  el: Element | null | undefined,
  mode: 'center' | 'nearest' = 'center',
): void {
  if (!el || !box) return
  const r = el.getBoundingClientRect()
  const b = box.getBoundingClientRect()
  if (mode === 'nearest') {
    if (r.top < b.top) box.scrollTop += r.top - b.top
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom
    return
  }
  box.scrollTop += r.top - b.top - (b.height - r.height) / 2
}
