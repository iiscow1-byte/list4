import { getDb } from '~/server/db'

/**
 * Returns the ALL-list position of the level currently sitting at Aredl
 * position 150 — the cutoff for the "highest demon" face icon. ALL list rows
 * with position ≤ this threshold are considered "top extreme" and render with
 * the special icon. Falls back to the legacy 150 if no Aredl data is loaded.
 */
export default defineEventHandler(() => {
  const db = getDb()
  const row = db.prepare(`SELECT position FROM levels WHERE aredl_position = 150 LIMIT 1`)
    .get() as { position: number } | undefined
  return { threshold: row?.position ?? 150 }
})
