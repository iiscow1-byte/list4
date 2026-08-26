/**
 * What an uploaded clip actually is, read from its bytes.
 *
 * The sibling of `image-type.ts`, and it exists for the same reason: the
 * `Content-Type` on a multipart part is written by whoever made the request. It
 * is a claim, not a fact. A file full of HTML labelled `video/mp4`, stored and
 * later served back from this origin under that label, is stored XSS on any
 * browser willing to sniff — which is exactly the hole the avatar upload was
 * fixed for. Clips are bigger, but the shape of the problem is identical.
 *
 * So the type is derived here and the claim is discarded. The derived value
 * also picks the file extension on disk, which is what makes the extension
 * trustworthy later: `[name].get.ts` maps it straight back to a `Content-Type`
 * without re-reading the file, and that mapping is only sound because nothing a
 * client said ever chose the extension.
 *
 * This is a *format* check, not a safety guarantee — a real MP4 can still carry
 * a payload for a decoder bug. It is one layer: the response also carries
 * `X-Content-Type-Options: nosniff` and `Content-Disposition: inline`.
 */
export type VideoType = 'video/mp4' | 'video/webm'

/** The on-disk extension for each accepted type. Server-chosen, never client. */
export const VIDEO_EXT: Record<VideoType, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

/** The reverse, for serving a file back under the type its extension implies. */
export const TYPE_BY_EXT: Record<string, VideoType> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
}

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false
  for (let i = 0; i < bytes.length; i++) if (buf[offset + i] !== bytes[i]) return false
  return true
}

function ascii(buf: Uint8Array, offset: number, len: number): string {
  let s = ''
  for (let i = offset; i < offset + len && i < buf.length; i++) s += String.fromCharCode(buf[i]!)
  return s
}

/**
 * ISO base-media brands that really are MP4.
 *
 * An `ftyp` box alone is not enough: the same container holds QuickTime
 * (`qt  `), 3GPP and HEIF stills, and serving any of those as `video/mp4` is
 * both wrong and the kind of mismatch `nosniff` then makes unplayable. The
 * brand list covers what the encoders people actually use here emit — phone
 * cameras, OBS, ffmpeg and Medal's own exporter.
 */
const MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso4', 'iso5', 'iso6', 'iso8', 'iso9',
  'mp41', 'mp42', 'mp71', 'avc1', 'avc3',
  'dash', 'cmfc', 'cmf2', 'mmp4', 'msnv', 'M4V ', 'm4v ',
])

/** The type, or null when the bytes are not one of the formats accepted. */
export function sniffVideoType(buf: Uint8Array): VideoType | null {
  /**
   * MP4 / ISO-BMFF: a 4-byte box size, then the literal `ftyp`.
   *
   * The brand at offset 8 is the major brand and everything from 16 up to the
   * end of the box is the compatible-brands list. Files whose major brand is
   * some exotic profile routinely list `isom` or `mp42` as compatible, so
   * checking the whole list rather than only the first entry is what stops a
   * legitimate clip being refused.
   */
  if (startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4)) {
    const boxSize = (buf[0]! << 24 | buf[1]! << 16 | buf[2]! << 8 | buf[3]!) >>> 0
    // Clamp: a corrupt or hostile size must not send this reading past the end
    // of the buffer, and no real ftyp box runs to hundreds of bytes.
    const end = Math.min(buf.length, boxSize > 8 ? boxSize : 8, 256)
    if (MP4_BRANDS.has(ascii(buf, 8, 4))) return 'video/mp4'
    for (let off = 16; off + 4 <= end; off += 4) {
      if (MP4_BRANDS.has(ascii(buf, off, 4))) return 'video/mp4'
    }
    return null
  }

  /**
   * WebM: the EBML magic, plus the `webm` DocType.
   *
   * Matroska (`.mkv`) opens with the identical magic and browsers will not play
   * it, so the DocType is what separates the two. It sits in the EBML header a
   * few bytes in; scanning the opening stretch for the literal finds it without
   * writing an EBML parser for one string.
   */
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) {
    const head = ascii(buf, 0, Math.min(buf.length, 64))
    if (head.includes('webm')) return 'video/webm'
    return null
  }

  return null
}
