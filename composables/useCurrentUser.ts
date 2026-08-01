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
  banner_choice: 'hardest' | 'favorite' | 'level' | 'none'
  /** Free-choice header level, used when `banner_choice` is 'level'. */
  banner_level_id: number | null
}

/**
 * The site's access policy, decided server-side and sent with the session.
 *
 * `canAccess` is the server's verdict on *this* session, not a rule the client
 * re-evaluates — so the route middleware and the server middleware can't drift
 * apart on who is allowed in.
 */
export type SitePolicy = {
  /** Only staff may use the site. */
  adminOnly: boolean
  /** Registration is open. */
  signupsEnabled: boolean
  /** Whether the current session may use the site. */
  canAccess: boolean
}

export type MeResponse = { account: CurrentUser | null; site: SitePolicy }

/**
 * Shared, SSR-aware current-user fetch. Components that need the active session
 * call this; mutations refresh it via `refreshNuxtData('auth-me')`.
 */
export function useCurrentUser() {
  return useFetch<MeResponse>('/api/auth/me', {
    key: 'auth-me',
    headers: useRequestHeaders(['cookie']),
  })
}
