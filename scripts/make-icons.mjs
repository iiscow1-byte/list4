/**
 * Cut the site's favicons from `public/logo.png`.
 *
 *   node scripts/make-icons.mjs
 *
 * The logo is a 512×512 artwork. Pointing a browser tab straight at it works,
 * but ships 350 KB to paint sixteen pixels — on a site that already sizes its
 * level thumbnails per screen and pre-compresses its assets, that is the wrong
 * kind of shortcut. This writes the two small cuts the head actually asks for
 * and leaves the original alone.
 *
 * Re-run it whenever the logo changes; the outputs are committed so a build
 * never depends on this having been run.
 *
 * ## Why it is written out longhand
 *
 * The project has no image dependency and does not need one for this. PNG is a
 * container around a zlib stream, and `node:zlib` is in the standard library —
 * so decoding, box-filtering and re-encoding is a hundred lines of arithmetic
 * with no install, no native build and no supply chain. It handles exactly the
 * shapes this one file can be in (8-bit RGB or RGBA, non-interlaced) and says
 * so plainly rather than pretending to be a general decoder.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync, deflateSync } from 'node:zlib'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(root, 'public/logo.png')

/**
 * What the site actually links to.
 *
 * 32 is the browser tab. 180 is the iOS home-screen icon *and* the logo in the
 * header and on the About page — 180 covers a 56px mark on a 3× screen, and
 * reusing one file there means the logo is already in cache by the time the
 * second page renders. See `components/AllLogo.vue`.
 */
const OUTPUTS = [
  { file: 'public/icon-32.png', size: 32 },
  { file: 'public/icon-180.png', size: 180 },
]

// ---------------------------------------------------------------- PNG chunks

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function* chunks(buf) {
  let pos = 8
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + length)
    yield { type, data }
    pos += 12 + length
  }
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

// --------------------------------------------------------------- Decoding

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** @returns {{ width: number, height: number, rgba: Buffer }} */
function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG.')

  let width = 0
  let height = 0
  let channels = 0
  const idat = []

  for (const { type, data } of chunks(buf)) {
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const bitDepth = data[8]
      const colorType = data[9]
      const interlace = data[12]
      if (bitDepth !== 8) throw new Error(`Expected an 8-bit PNG, got ${bitDepth}-bit.`)
      if (interlace !== 0) throw new Error('Interlaced PNGs are not supported.')
      if (colorType === 6) channels = 4
      else if (colorType === 2) channels = 3
      else throw new Error(`Expected RGB or RGBA, got colour type ${colorType}.`)
    } else if (type === 'IDAT') {
      idat.push(data)
    }
  }
  if (!width || !height) throw new Error('No IHDR.')

  const raw = inflateSync(Buffer.concat(idat))
  const rowBytes = width * channels
  const flat = Buffer.alloc(rowBytes * height)

  // Undo the per-scanline filter. Each row is one filter byte then its pixels,
  // and every filter refers to already-reconstructed bytes — left (a), above
  // (b) and above-left (c) — so this has to run in order.
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const rowStart = y * rowBytes
    const prevStart = rowStart - rowBytes
    for (let x = 0; x < rowBytes; x++) {
      const value = raw[pos + x]
      const a = x >= channels ? flat[rowStart + x - channels] : 0
      const b = y > 0 ? flat[prevStart + x] : 0
      const c = x >= channels && y > 0 ? flat[prevStart + x - channels] : 0
      let out
      switch (filter) {
        case 0: out = value; break
        case 1: out = value + a; break
        case 2: out = value + b; break
        case 3: out = value + ((a + b) >> 1); break
        case 4: out = value + paeth(a, b, c); break
        default: throw new Error(`Unknown row filter ${filter}.`)
      }
      flat[rowStart + x] = out & 0xff
    }
    pos += rowBytes
  }

  if (channels === 4) return { width, height, rgba: flat }

  // Widen RGB to RGBA so everything downstream has one shape to handle.
  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0, j = 0; i < flat.length; i += 3, j += 4) {
    rgba[j] = flat[i]
    rgba[j + 1] = flat[i + 1]
    rgba[j + 2] = flat[i + 2]
    rgba[j + 3] = 255
  }
  return { width, height, rgba }
}

// --------------------------------------------------------------- Resizing

/**
 * Box filter: every destination pixel is the average of the source pixels it
 * covers. For a large downscale that is the right choice — sampling one pixel
 * per destination (what a naive resize does) throws away 99% of a 512→32
 * reduction and aliases the fine detail in the artwork into noise.
 *
 * Colour is averaged premultiplied by alpha, so a transparent pixel cannot drag
 * its colour into the average and fringe the edges.
 */
function resize(src, srcW, srcH, size) {
  const out = Buffer.alloc(size * size * 4)
  const scaleX = srcW / size
  const scaleY = srcH / size

  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * scaleY)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scaleY))
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * scaleX)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scaleX))

      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let sy = y0; sy < y1 && sy < srcH; sy++) {
        for (let sx = x0; sx < x1 && sx < srcW; sx++) {
          const i = (sy * srcW + sx) * 4
          const alpha = src[i + 3] / 255
          r += src[i] * alpha
          g += src[i + 1] * alpha
          b += src[i + 2] * alpha
          a += src[i + 3]
          n++
        }
      }

      const o = (y * size + x) * 4
      if (!n) continue
      const meanAlpha = a / n
      // Undo the premultiplication. At fully transparent there is no colour to
      // recover and nothing to show, so leave it at zero.
      const k = meanAlpha > 0 ? 255 / meanAlpha : 0
      out[o] = Math.round(Math.min(255, (r / n) * k))
      out[o + 1] = Math.round(Math.min(255, (g / n) * k))
      out[o + 2] = Math.round(Math.min(255, (b / n) * k))
      out[o + 3] = Math.round(meanAlpha)
    }
  }
  return out
}

// --------------------------------------------------------------- Encoding

function encodePng(rgba, size) {
  const rowBytes = size * 4
  // Filter byte 0 (None) on every row. The alternatives buy a few percent on
  // an icon this small and cost the ability to read this function.
  const withFilters = Buffer.alloc((rowBytes + 1) * size)
  for (let y = 0; y < size; y++) {
    withFilters[y * (rowBytes + 1)] = 0
    rgba.copy(withFilters, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8    // bit depth
  ihdr[9] = 6    // colour type: RGBA
  ihdr[10] = 0   // compression: deflate
  ihdr[11] = 0   // filter method: adaptive
  ihdr[12] = 0   // interlace: none

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(withFilters, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --------------------------------------------------------------- Run

const source = decodePng(readFileSync(SOURCE))
console.log(`logo.png — ${source.width}×${source.height}`)

for (const { file, size } of OUTPUTS) {
  const png = encodePng(resize(source.rgba, source.width, source.height, size), size)
  writeFileSync(resolve(root, file), png)
  console.log(`  ${file} — ${size}×${size}, ${(png.length / 1024).toFixed(1)} KB`)
}
