import { openSync, readSync, closeSync, statSync } from 'node:fs'

/**
 * When an MP4 says it was made.
 *
 * A clip uploaded as proof already carries the date it was recorded, in the
 * `mvhd` box every MP4 has — so asking the submitter to type it is asking for
 * something the file already knows. This reads it, and the submit form fills
 * the verification date in the same way it does for a YouTube link.
 *
 * ## Reading it without loading the file
 *
 * ISO base-media files are a tree of boxes, each `[4-byte size][4-byte type]`.
 * `moov` holds the metadata and `mvhd` sits directly inside it. Crucially,
 * `moov` may be at the *end*: only files written for streaming ("faststart")
 * move it to the front, and a screen recorder writing straight to disk usually
 * doesn't. So this walks the top-level boxes by seeking — reading 8 bytes per
 * box and skipping over its contents — rather than reading the file in. A
 * gigabyte clip costs a handful of small reads either way.
 *
 * Timestamps are seconds since 1904-01-01 UTC, which is the Mac epoch and 66
 * years before the Unix one.
 */
const MAC_EPOCH_OFFSET_SEC = 2_082_844_800

/** Boxes worth descending into. Everything else is skipped whole. */
const CONTAINERS = new Set(['moov'])

/** A creation time this far out is a wrong read or an unset clock, not a date. */
const EARLIEST = Date.UTC(2005, 0, 1)

function readBoxHeader(fd: number, at: number, fileSize: number): { size: number; type: string; headerLen: number } | null {
  if (at + 8 > fileSize) return null
  const buf = Buffer.alloc(16)
  const got = readSync(fd, buf, 0, Math.min(16, fileSize - at), at)
  if (got < 8) return null

  let size = buf.readUInt32BE(0)
  const type = buf.toString('latin1', 4, 8)
  let headerLen = 8

  if (size === 1) {
    // 64-bit size, carried in the eight bytes after the type.
    if (got < 16) return null
    const hi = buf.readUInt32BE(8)
    const lo = buf.readUInt32BE(12)
    size = hi * 2 ** 32 + lo
    headerLen = 16
  } else if (size === 0) {
    // "Runs to the end of the file" — legal for the last box.
    size = fileSize - at
  }

  if (size < headerLen) return null
  return { size, type, headerLen }
}

/**
 * The `mvhd` payload: version byte, three flag bytes, then the timestamps.
 * Version 1 widens creation and modification time to 64 bits.
 */
function parseMvhd(fd: number, at: number, size: number): number | null {
  const want = Math.min(size, 32)
  const buf = Buffer.alloc(want)
  if (readSync(fd, buf, 0, want, at) < 12) return null

  const version = buf.readUInt8(0)
  let seconds: number
  if (version === 1) {
    if (want < 20) return null
    // JS numbers hold this exactly — the value is far below 2^53.
    seconds = buf.readUInt32BE(4) * 2 ** 32 + buf.readUInt32BE(8)
  } else {
    if (want < 8) return null
    seconds = buf.readUInt32BE(4)
  }
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return (seconds - MAC_EPOCH_OFFSET_SEC) * 1000
}

function findMvhd(fd: number, start: number, end: number, fileSize: number, depth = 0): number | null {
  if (depth > 4) return null
  let at = start
  while (at < end) {
    const box = readBoxHeader(fd, at, fileSize)
    if (!box) return null
    if (box.type === 'mvhd') return parseMvhd(fd, at + box.headerLen, box.size - box.headerLen)
    if (CONTAINERS.has(box.type)) {
      const hit = findMvhd(fd, at + box.headerLen, Math.min(at + box.size, end), fileSize, depth + 1)
      if (hit != null) return hit
    }
    at += box.size
  }
  return null
}

/**
 * The file's creation date as `YYYY-MM-DD`, or null when it hasn't got a usable
 * one.
 *
 * Null rather than a guess in every doubtful case: a file with no `mvhd`, a
 * zero timestamp (which many encoders write when the clock is unset), or a date
 * before the game existed. A blank field the submitter fills in is a much
 * smaller problem than a confident wrong date on a record.
 */
export function readMp4CreationDate(path: string): string | null {
  let fd: number | null = null
  try {
    const fileSize = statSync(path).size
    if (fileSize < 16) return null
    fd = openSync(path, 'r')

    let at = 0
    while (at < fileSize) {
      const box = readBoxHeader(fd, at, fileSize)
      if (!box) break
      if (box.type === 'moov') {
        const ms = findMvhd(fd, at + box.headerLen, at + box.size, fileSize)
        if (ms == null) break
        if (!Number.isFinite(ms) || ms < EARLIEST || ms > Date.now() + 86_400_000) return null
        return new Date(ms).toISOString().slice(0, 10)
      }
      at += box.size
    }
    return null
  } catch {
    return null
  } finally {
    if (fd != null) { try { closeSync(fd) } catch { /* already closed */ } }
  }
}
