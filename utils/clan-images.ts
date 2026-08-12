/**
 * Where a clan's icon and banner come from.
 *
 * There are two sources and they must be preferred in one order everywhere: an
 * **upload** beats a **linked URL**. An upload is a deliberate act that puts the
 * picture on this site's own storage; a URL is a pointer at somebody else's,
 * which is often stale. Written once because the clan page, the browse list,
 * the tag badge and the leaderboard all have to agree — and "which picture" is
 * exactly the kind of decision that drifts when it is made four times.
 *
 * `version` busts the cache after an upload without needing a long-lived
 * cache-control policy on the endpoint.
 */
export type ClanImageSource = {
  tag: string
  has_icon?: boolean | number | null
  has_banner?: boolean | number | null
  icon_url?: string | null
  banner_url?: string | null
}

export function clanIconUrl(clan: ClanImageSource | null | undefined, version = 0): string | null {
  if (!clan) return null
  if (clan.has_icon) return `/api/clans/${encodeURIComponent(clan.tag)}/image?kind=icon&v=${version}`
  return clan.icon_url || null
}

export function clanBannerUrl(clan: ClanImageSource | null | undefined, version = 0): string | null {
  if (!clan) return null
  if (clan.has_banner) return `/api/clans/${encodeURIComponent(clan.tag)}/image?kind=banner&v=${version}`
  return clan.banner_url || null
}
