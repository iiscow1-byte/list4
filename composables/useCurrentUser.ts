export type CurrentUser = {
  id: number
  username: string
  role: 'user' | 'moderator' | 'admin' | 'owner' | 'developer'
  bio: string | null
  country: string | null
  subdivision: string | null
  claimed_player: string | null
  claimed_aredl_uuid: string | null
  claimed_pointercrate_id: number | null
  claimed_gdl_id: number | null
  has_avatar: boolean
  pronouns: string | null
  discord_handle: string | null
  youtube_url: string | null
  favorite_level_id: number | null
  favorite_level_note: string | null
  /** The record pinned to the profile as this player's hardest completion. */
  hardest_record_id: number | null
  /** Which pick paints the profile header. */
  banner_choice: 'hardest' | 'favorite' | 'none'
}

/**
 * Shared, SSR-aware current-user fetch. Components that need the active session
 * call this; mutations refresh it via `refreshNuxtData('auth-me')`.
 */
export function useCurrentUser() {
  return useFetch<{ account: CurrentUser | null }>('/api/auth/me', {
    key: 'auth-me',
    headers: useRequestHeaders(['cookie']),
  })
}
