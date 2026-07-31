/**
 * Level Thumbnails API (https://levelthumbs.prevter.me) — community-made
 * thumbnail images for GD levels, keyed by the level's GD ID.
 *
 *   GET /thumbnail/{id}/{res}  → image (302 to CDN), 404 when none exists
 *
 * Resolutions: 'high' (1920×1080), 'medium', 'small'. Rows in long lists use
 * 'small'; the level-page hero uses 'high'.
 */
export type ThumbRes = 'high' | 'medium' | 'small'

export function levelThumbUrl(gdId: number | null | undefined, res: ThumbRes = 'small'): string | null {
  if (!gdId || !Number.isFinite(Number(gdId))) return null
  return `https://levelthumbs.prevter.me/thumbnail/${gdId}/${res}`
}
