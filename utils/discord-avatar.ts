/**
 * Discord's CDN URL for an avatar, from the two things AREDL mirrors about a
 * player: their Discord snowflake and their avatar *hash*.
 *
 * AREDL stores the hash rather than a URL (`ExtendedBaseUser.discord_avatar` in
 * their OpenAPI schema), which is the only sensible thing to store — the URL is
 * derived, and Discord has changed its shape before. This is that derivation,
 * written once so the leaderboard, the player pages and anything else that
 * grows a face later cannot disagree about it.
 *
 * ## Why this is the fallback and never the first choice
 *
 * A picture on a leaderboard row should be the one its owner chose *here*. An
 * account on this site has an avatar it uploaded and cropped; that always wins.
 * This is for the very large majority of ranked players who have never signed
 * up — rows that would otherwise be a grey circle with a letter in it — and it
 * is the picture they already chose, on the platform AREDL authenticates them
 * through.
 *
 * Returns null unless both parts are present and plausible, so a caller can
 * simply fall through to initials.
 */

/** Discord snowflakes are 17–20 digits; hashes are hex, optionally `a_`-prefixed for animated. */
const SNOWFLAKE = /^\d{17,20}$/
const AVATAR_HASH = /^(a_)?[0-9a-f]{32}$/i

/** Sizes Discord actually serves. Anything else is rounded up by the CDN. */
export type DiscordAvatarSize = 16 | 32 | 64 | 128 | 256 | 512

export function discordAvatarUrl(
  discordId: string | null | undefined,
  avatarHash: string | null | undefined,
  size: DiscordAvatarSize = 64,
): string | null {
  const id = String(discordId ?? '').trim()
  const hash = String(avatarHash ?? '').trim()
  if (!SNOWFLAKE.test(id) || !AVATAR_HASH.test(hash)) return null
  // `.png` rather than `.webp`: animated hashes (`a_…`) serve a still first
  // frame as PNG, and a row of looping GIFs is not what a leaderboard wants.
  return `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=${size}`
}
