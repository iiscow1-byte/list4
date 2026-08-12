/**
 * Draft state for the home-page list builder.
 *
 * The draft lives in localStorage so a guest can build a list before signing
 * in and still have it when they come back. Saving to the server (which needs
 * an account) turns the draft into a `custom_lists` row; `publicId` then
 * points at it and subsequent saves PATCH in place.
 */
export type BuilderItem = {
  /** custom_list_items.id once saved. Sent back so the server updates the
   *  existing row instead of recreating it — records hang off this id. */
  id?: number | null
  /** levels.id when dragged in from the ALL list; null for hand-entered rows. */
  level_id: number | null
  name: string
  gd_id: number | null
  creator: string | null
  difficulty: string | null
  gddl_tier: string | null
  verification_url: string | null
  notes: string | null
  verifier?: string | null
  percent_to_qualify?: number | null
  fps?: string | null
  game_version?: string | null
  /**
   * Whether this list calls the level a challenge.
   *
   * The list's own answer, not the ALL's. A linked row does not inherit the
   * main list's verdict: a list built to rank challenges by its own rules would
   * have that overwritten on every save if it did.
   */
  is_challenge?: boolean | null
  /** Current ALL placement of the linked level — display only, not persisted. */
  position?: number | null
  /** Sheet placement of the linked level — the number shown as "#N". */
  sheet_placement?: number | null
}

export type BuilderDraft = {
  publicId: string | null
  title: string
  description: string
  /** Published to the public gallery. Only meaningful once saved. */
  isPublic: boolean
  /** Whether players can submit records and appear on this list's leaderboard. */
  acceptsRecords: boolean
  /** Score curve: points at rank 1, points at the last scored rank. */
  maxPoints: number
  minPoints: number
  /** Ranks past this are worth nothing. 0 = every level scores. */
  scoredCount: number
  items: BuilderItem[]
}

const STORAGE_KEY = 'als:list-builder:v1'

function emptyDraft(): BuilderDraft {
  return {
    publicId: null, title: 'My list', description: '', isPublic: false,
    acceptsRecords: true, maxPoints: 250, minPoints: 50, scoredCount: 0, items: [],
  }
}

export function useListBuilder() {
  const draft = useState<BuilderDraft>('list-builder-draft', emptyDraft)
  const loaded = useState<boolean>('list-builder-loaded', () => false)

  /** Hydrate from localStorage. Client-only; safe to call repeatedly. */
  function restore() {
    if (loaded.value || !import.meta.client) return
    loaded.value = true
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<BuilderDraft>
      if (parsed && Array.isArray(parsed.items)) {
        draft.value = {
          publicId: typeof parsed.publicId === 'string' ? parsed.publicId : null,
          title: typeof parsed.title === 'string' ? parsed.title : 'My list',
          description: typeof parsed.description === 'string' ? parsed.description : '',
          isPublic: !!parsed.isPublic,
          acceptsRecords: parsed.acceptsRecords !== false,
          maxPoints: Number(parsed.maxPoints) || 250,
          minPoints: Number.isFinite(Number(parsed.minPoints)) ? Number(parsed.minPoints) : 50,
          scoredCount: Number(parsed.scoredCount) || 0,
          items: parsed.items as BuilderItem[],
        }
      }
    } catch { /* corrupt draft — start fresh */ }
  }

  function persist() {
    if (!import.meta.client) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft.value))
    } catch { /* quota / private mode — the draft just won't survive a reload */ }
  }

  function reset() {
    draft.value = emptyDraft()
    persist()
  }

  /** Load a saved list into the builder for editing. */
  function loadFrom(list: { public_id: string; title: string; description: string | null; is_public?: number | boolean; accepts_records?: number; max_points?: number; min_points?: number; scored_count?: number; items: any[] }) {
    draft.value = {
      publicId: list.public_id,
      title: list.title,
      description: list.description ?? '',
      isPublic: !!list.is_public,
      acceptsRecords: list.accepts_records !== 0,
      maxPoints: Number(list.max_points) || 250,
      minPoints: Number.isFinite(Number(list.min_points)) ? Number(list.min_points) : 50,
      scoredCount: Number(list.scored_count) || 0,
      items: (list.items ?? []).map((i) => ({
        id: i.id ?? null,
        level_id: i.level_id ?? null,
        name: i.name,
        gd_id: i.gd_id ?? null,
        creator: i.creator ?? null,
        difficulty: i.difficulty ?? null,
        gddl_tier: i.gddl_tier ?? null,
        verification_url: i.verification_url ?? null,
        notes: i.notes ?? null,
        verifier: i.verifier ?? null,
        percent_to_qualify: i.percent_to_qualify ?? 100,
        fps: i.fps ?? null,
        game_version: i.game_version ?? null,
        is_challenge: !!i.is_challenge,
        position: i.position ?? null,
        sheet_placement: i.sheet_placement ?? null,
      })),
    }
    persist()
  }

  return { draft, restore, persist, reset, loadFrom }
}
