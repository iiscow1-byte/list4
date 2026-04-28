import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const me = requireAccount(event)
  const body = await readBody(event)

  const position = Number(body?.position)
  const holder = String(body?.player_name ?? '').trim()
  const video = String(body?.video ?? '').trim()
  const noteRaw = body?.note == null ? null : String(body.note).trim()
  const note = noteRaw ? noteRaw.slice(0, 2000) : null

  if (!Number.isFinite(position)) {
    throw createError({ statusCode: 400, statusMessage: 'Pick a level.' })
  }
  if (!holder) {
    throw createError({ statusCode: 400, statusMessage: 'Record holder is required.' })
  }
  if (!/^https?:\/\/\S+$/i.test(video)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid video URL is required.' })
  }

  const db = getDb()
  const level = db.prepare(`SELECT id FROM levels WHERE position = ?`).get(position) as { id: number } | undefined
  if (!level) throw createError({ statusCode: 404, statusMessage: 'No such level.' })

  // Resolve to a leaderboard player if we can; not required — record holders
  // may not be on the leaderboard yet, and the players table can be wiped on
  // re-import anyway, so the canonical reference is the denormalized name.
  const player = db.prepare(`SELECT id FROM players WHERE name = ? COLLATE NOCASE`).get(holder) as { id: number } | undefined

  db.prepare(
    `INSERT INTO records (level_id, player_id, player_name, video, submitted_by, submitter_note)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(level.id, player?.id ?? null, holder, video, me.id, note)

  return { ok: true }
})
