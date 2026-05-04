export type CurrentUser = {
  id: number
  username: string
  role: 'user' | 'moderator' | 'admin' | 'owner' | 'developer'
  bio: string | null
  country: string | null
  subdivision: string | null
  claimed_player: string | null
  claimed_aredl_uuid: string | null
  has_avatar: boolean
  pronouns: string | null
  discord_handle: string | null
  youtube_url: string | null
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
