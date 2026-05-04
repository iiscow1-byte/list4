/**
 * The ALL-list position cutoff for the highest-demon face icon.
 *
 * Driven by Aredl: any ALL-list level with position ≤ this threshold is
 * considered "top extreme" because the level at Aredl rank 150 sits at this
 * position on the ALL list. SSR-shared via useState so the threshold isn't
 * fetched per-component on every page render.
 */
export function useAredlTopThreshold() {
  const threshold = useState<number>('aredl-top-threshold', () => 150)
  const fetched = useState<boolean>('aredl-top-threshold-fetched', () => false)

  if (!fetched.value) {
    fetched.value = true
    // Fire-and-forget; default of 150 holds until the response lands.
    $fetch<{ threshold: number }>('/api/aredl/top-threshold')
      .then((r) => { if (Number.isFinite(r.threshold)) threshold.value = r.threshold })
      .catch(() => { /* keep default */ })
  }

  return threshold
}
