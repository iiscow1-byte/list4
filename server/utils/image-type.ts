/**
 * What an uploaded file actually is, read from its bytes.
 *
 * The `Content-Type` on a multipart part is supplied by whoever made the
 * request. It is a claim, not a fact, and treating it as a fact is how a file
 * containing `<script>` gets stored as `image/png` and later served back from
 * this origin — which, on a browser willing to sniff, is stored XSS with the
 * site's own cookies attached.
 *
 * So the type is derived here and the claim is discarded. Every format the site
 * accepts has a fixed signature in its first bytes; anything that matches none
 * of them is refused rather than guessed at.
 *
 * This is a *format* check, not a safety guarantee — a real PNG can still carry
 * a malicious payload for a decoder bug. It is one layer of several: the
 * response also carries `X-Content-Type-Options: nosniff`, and the served
 * `Content-Type` is this derived value rather than anything a client said.
 */
export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false
  for (let i = 0; i < bytes.length; i++) if (buf[offset + i] !== bytes[i]) return false
  return true
}

/** The type, or null when the bytes are not one of the formats accepted. */
export function sniffImageType(buf: Uint8Array): ImageType | null {
  // PNG: \x89PNG\r\n\x1a\n
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'

  // JPEG: FF D8 FF. Every variant (JFIF, Exif, raw) shares it.
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg'

  // GIF87a / GIF89a
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'

  /**
   * WebP: 'RIFF' …4 bytes of length… 'WEBP'.
   *
   * The length in between is why this is two checks rather than one: RIFF is a
   * container used by several formats, and only the tag at offset 8 says which.
   */
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp'
  }

  return null
}
