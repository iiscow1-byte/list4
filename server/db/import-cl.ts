/**
 * Challenge List importer (https://challengelist.gd) — uses the same
 * Pointercrate API structure as import-pointercrate.ts.
 *
 * Fetches all demons, skips any with ❌ in their name (removed/dead levels),
 * and writes challenge_list_position onto matched levels rows.
 *
 * No player/record ingestion — position ranking only.
 */
import { getDb } from './index.ts'
import { spawn } from 'node:child_process'

const API_BASE = process.env.CL_API_BASE || 'https://challengelist.gd/api'
const REQ_DELAY_MS = Number(process.env.CL_REQ_DELAY_MS || 400)
const UA = process.env.CL_USER_AGENT
  || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

function curlOnce(url: string): Promise<{ status: number; body: string; headers: string }> {
  return new Promise((resolve, reject) => {
    const args = [
      '-sS', '-D', '-',
      '-A', UA,
      '-H', 'Accept: application/json',
      '-H', 'Accept-Language: en-US,en;q=0.9',
      '-H', `Referer: ${new URL(API_BASE).origin}/`,
      '--compressed',
      '-w', '\n__STATUS__%{http_code}\n',
      url,
    ]
    const proc = spawn('curl', args, { windowsHide: true })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('close', (code) => {
      if (code !== 0 && !out) return reject(new Error(`curl exit ${code}: ${err}`))
      const statusMatch = out.match(/\n__STATUS__(\d+)\s*$/)
      const status = statusMatch ? Number(statusMatch[1]) : 0
      const trimmed = statusMatch ? out.slice(0, statusMatch.index!) : out
      const blocks = trimmed.split(/\r?\n\r?\n/)
      const body = blocks.pop() ?? ''
      const headers = blocks.join('\n\n')
      resolve({ status, body: body.trimEnd(), headers })
    })
    proc.on('error', reject)
  })
}

async function fetchJsonWithLink<T>(url: string): Promise<{ data: T; nextUrl: string | null }> {
  if (REQ_DELAY_MS > 0) await new Promise((r) => setTimeout(r, REQ_DELAY_MS))
  const { status, body, headers } = await curlOnce(url)
  if (status < 200 || status >= 300) throw new Error(`HTTP ${status} ${url}`)
  const data = JSON.parse(body) as T
  const linkLine = headers.split(/\r?\n/).find((l) => /^links?:/i.test(l)) ?? ''
  const m = linkLine.match(/<([^>]+)>;\s*rel=next/i)
  let nextUrl: string | null = null
  if (m) {
    const u = m[1]!
    const origin = new URL(API_BASE).origin
    nextUrl = u.startsWith('http') ? u : `${origin}${u}`
  }
  return { data, nextUrl }
}

async function fetchAllPages<T>(startPath: string): Promise<T[]> {
  const out: T[] = []
  const origin = new URL(API_BASE).origin
  let url: string | null = startPath.startsWith('http') ? startPath : `${API_BASE}${startPath}`
  while (url) {
    const { data, nextUrl } = await fetchJsonWithLink<T[]>(url)
    out.push(...data)
    url = nextUrl
  }
  return out
}

type ClDemon = {
  id: number
  position: number
  name: string
  level_id: number | null
}

export async function importCl(): Promise<void> {
  const t0 = Date.now()
  const db = getDb()

  console.log('[cl] Fetching all demons…')
  const allDemons = await fetchAllPages<ClDemon>('/v1/demons/?limit=100')
  console.log(`[cl]   ${allDemons.length} demons total`)

  const updateLevel = db.prepare(`UPDATE levels SET challenge_list_position = ? WHERE gd_id = ?`)

  let updated = 0
  let skipped = 0
  db.exec('BEGIN')
  try {
    // Reset all positions so levels removed from the CL don't keep stale data.
    db.prepare(`UPDATE levels SET challenge_list_position = NULL WHERE challenge_list_position IS NOT NULL`).run()
    for (const d of allDemons) {
      // Levels marked with ❌ have been removed/voided — skip them.
      if (d.name.includes('❌')) { skipped++; continue }
      if (!d.level_id) continue
      const res = updateLevel.run(d.position, d.level_id)
      if (res.changes) updated++
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  console.log(`[cl]   ${updated} levels matched, ${skipped} ❌ entries skipped`)
  console.log(`[cl] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) &&
  process.argv[1] && /import-cl\.ts$/.test(process.argv[1])
if (isCli) {
  importCl().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
