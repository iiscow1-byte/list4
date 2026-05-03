import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

type Body = {
  level_position?: number | string
  level_name?: string
  start_percent?: number | string
  end_percent?: number | string
  video_url?: string
}

function clampPercent(v: unknown): number | null {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const i = Math.round(n)
  if (i < 0 || i > 100) return null
  return i
}

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const body = await readBody<Body>(event)

  const start = clampPercent(body?.start_percent)
  const end = clampPercent(body?.end_percent)
  if (start === null || end === null) {
    throw createError({ statusCode: 400, statusMessage: 'start_percent and end_percent must be 0–100.' })
  }
  if (end < start) {
    throw createError({ statusCode: 400, statusMessage: 'end_percent must be >= start_percent.' })
  }

  const db = getDb()

  // The level reference can be either a position (preferred — links the post
  // to a canonical level page) or a free-text name (for levels not on the
  // list yet, e.g. unrated).
  let levelId: number | null = null
  let levelPosition: number | null = null
  let levelName = (body?.level_name ?? '').toString().trim()

  if (body?.level_position != null && body.level_position !== '') {
    const pos = Number(body.level_position)
    if (!Number.isFinite(pos) || pos <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid level_position.' })
    }
    const lvl = db.prepare(
      `SELECT id, name, position FROM levels WHERE position = ?`,
    ).get(Math.round(pos)) as { id: number; name: string; position: number } | undefined
    if (!lvl) throw createError({ statusCode: 404, statusMessage: 'Level not found.' })
    levelId = lvl.id
    levelPosition = lvl.position
    if (!levelName) levelName = lvl.name
  }

  if (!levelName) {
    throw createError({ statusCode: 400, statusMessage: 'level_name or level_position is required.' })
  }

  let videoUrl: string | null = null
  const rawUrl = (body?.video_url ?? '').toString().trim()
  if (rawUrl) {
    try {
      const u = new URL(rawUrl)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new Error('bad protocol')
      }
      videoUrl = u.toString()
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'video_url must be a valid http(s) URL.' })
    }
  }

  const result = db.prepare(
    `INSERT INTO progress_posts
       (account_id, level_id, level_name, level_position, start_percent, end_percent, video_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(me.id, levelId, levelName, levelPosition, start, end, videoUrl)

  return { ok: true, id: Number(result.lastInsertRowid) }
})
