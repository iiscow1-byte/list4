/**
 * Draft state for the home-page list builder.
 *
 * The draft lives in localStorage so a guest can build a list before signing
 * in and still have it when they come back. Saving to the server (which needs
 * an account) turns the draft into a `custom_lists` row; `publicId` then
 * points at it and subsequent saves PATCH in place.
 */
export type BuilderItem = {
  /** levels.id when dragged in from the ALL list; null for hand-entered rows. */
  level_id: number | null
  name: string
  gd_id: number | null
  creator: string | null
  difficulty: string | null
  gddl_tier: string | null
  verification_url: string | null
  notes: string | null
  /** Current ALL placement of the linked level — display only, not persisted. */
  position?: number | null
}

export type BuilderDraft = {
  publicId: string | null
  title: string
  description: string
  items: BuilderItem[]
}

const STORAGE_KEY = 'als:list-builder:v1'

function emptyDraft(): BuilderDraft {
  return { publicId: null, title: 'My list', description: '', items: [] }
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
  function loadFrom(list: { public_id: string; title: string; description: string | null; items: any[] }) {
    draft.value = {
      publicId: list.public_id,
      title: list.title,
      description: list.description ?? '',
      items: (list.items ?? []).map((i) => ({
        level_id: i.level_id ?? null,
        name: i.name,
        gd_id: i.gd_id ?? null,
        creator: i.creator ?? null,
        difficulty: i.difficulty ?? null,
        gddl_tier: i.gddl_tier ?? null,
        verification_url: i.verification_url ?? null,
        notes: i.notes ?? null,
        position: i.position ?? null,
      })),
    }
    persist()
  }

  return { draft, restore, persist, reset, loadFrom }
}
