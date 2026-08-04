import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { canEditList } from '~/server/utils/custom-list-perms'
import { assertClean } from '~/server/utils/profanity-guard'
import { loadList, replaceItems, MAX_ITEMS, type CustomListItemInput } from '~/server/utils/custom-lists'

/**
 * Presentation flags on `custom_lists`. A fixed allow-list, because these names
 * are interpolated straight into the UPDATE.
 */
const DISPLAY_FLAGS = [
  'show_banner', 'show_thumbnails', 'show_points', 'show_records',
  'compact_rows', 'show_editors',
] as const

/** Owner-only update. Any provided field replaces the stored one wholesale. */
export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const body = await readBody<{
    title?: string
    description?: string
    items?: CustomListItemInput[]
    is_public?: boolean
    accepts_records?: boolean
    follow_all_order?: boolean
    icon_url?: string
    accent_color?: string
    banner_url?: string
    accepts_submissions?: boolean
    require_record_video?: boolean
    mark_off_all?: boolean
    discord_url?: string
    youtube_url?: string
    max_points?: number
    min_points?: number
    scored_count?: number
    packs?: { name?: string; color?: string; item_ids?: number[] }[]
    tiers?: { name?: string; color?: string; from_rank?: number }[]
  }>(event)

  const db = getDb()
  const row = db.prepare(
    `SELECT id, owner_account_id FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; owner_account_id: number } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  if (!canEditList(db, row, account)) {
    throw createError({ statusCode: 403, statusMessage: 'Not your list' })
  }

  db.exec('BEGIN')
  try {
    if (typeof body?.title === 'string') {
      assertClean(body.title, 'List titles')
      db.prepare(`UPDATE custom_lists SET title = ? WHERE id = ?`)
        .run(body.title.trim().slice(0, 120) || 'My list', row.id)
    }
    if (typeof body?.description === 'string') {
      assertClean(body.description, 'List descriptions')
      db.prepare(`UPDATE custom_lists SET description = ? WHERE id = ?`)
        .run(body.description.trim().slice(0, 2000) || null, row.id)
    }
    if (typeof body?.is_public === 'boolean') {
      db.prepare(`UPDATE custom_lists SET is_public = ? WHERE id = ?`)
        .run(body.is_public ? 1 : 0, row.id)
    }
    // Presentation images. Rendered as an <img src> on a public page, so the
    // same http(s)-only rule as the social links applies — a javascript: value
    // stored here would be a stored XSS. Empty string clears.
    for (const key of ['icon_url', 'banner_url'] as const) {
      const v = (body as any)?.[key]
      if (typeof v !== 'string') continue
      const url = v.trim().slice(0, 500)
      if (url && !/^https?:\/\//i.test(url)) {
        throw createError({ statusCode: 400, statusMessage: 'Image links must start with http:// or https://' })
      }
      db.prepare(`UPDATE custom_lists SET ${key} = ? WHERE id = ?`).run(url || null, row.id)
    }
    if (typeof body?.accent_color === 'string') {
      // Only accept a hex colour, so the value can be interpolated into a
      // style attribute without becoming an injection vector.
      const hex = body.accent_color.trim()
      const ok = /^#[0-9a-fA-F]{6}$/.test(hex)
      db.prepare(`UPDATE custom_lists SET accent_color = ? WHERE id = ?`)
        .run(ok ? hex : null, row.id)
    }
    if (typeof body?.follow_all_order === 'boolean') {
      db.prepare(`UPDATE custom_lists SET follow_all_order = ? WHERE id = ?`)
        .run(body.follow_all_order ? 1 : 0, row.id)
    }
    if (typeof body?.accepts_records === 'boolean') {
      db.prepare(`UPDATE custom_lists SET accepts_records = ? WHERE id = ?`)
        .run(body.accepts_records ? 1 : 0, row.id)
    }
    if (typeof body?.accepts_submissions === 'boolean') {
      db.prepare(`UPDATE custom_lists SET accepts_submissions = ? WHERE id = ?`)
        .run(body.accepts_submissions ? 1 : 0, row.id)
    }
    if (typeof body?.require_record_video === 'boolean') {
      db.prepare(`UPDATE custom_lists SET require_record_video = ? WHERE id = ?`)
        .run(body.require_record_video ? 1 : 0, row.id)
    }
    if (typeof body?.mark_off_all === 'boolean') {
      db.prepare(`UPDATE custom_lists SET mark_off_all = ? WHERE id = ?`)
        .run(body.mark_off_all ? 1 : 0, row.id)
    }
    // How the list draws itself. All plain booleans with no interaction between
    // them, so one loop rather than six near-identical blocks — the column name
    // comes from this fixed list and never from the body.
    for (const col of DISPLAY_FLAGS) {
      const v = (body as any)?.[col]
      if (typeof v !== 'boolean') continue
      db.prepare(`UPDATE custom_lists SET ${col} = ? WHERE id = ?`).run(v ? 1 : 0, row.id)
    }
    // Social links are rendered as anchors on a public page, so only http(s)
    // URLs are stored — a javascript: value here would be a stored XSS.
    for (const [key, col] of [['discord_url', 'discord_url'], ['youtube_url', 'youtube_url']] as const) {
      const raw = (body as any)?.[key]
      if (typeof raw !== 'string') continue
      const url = raw.trim().slice(0, 300)
      if (url && !/^https?:\/\//i.test(url)) {
        throw createError({ statusCode: 400, statusMessage: 'Links must start with http:// or https://' })
      }
      db.prepare(`UPDATE custom_lists SET ${col} = ? WHERE id = ?`).run(url || null, row.id)
    }
    // Scoring knobs. max is clamped above min so the decay curve can't invert.
    const maxPts = Number(body?.max_points)
    const minPts = Number(body?.min_points)
    if (Number.isFinite(maxPts)) {
      db.prepare(`UPDATE custom_lists SET max_points = ? WHERE id = ?`)
        .run(Math.max(1, Math.min(10_000, maxPts)), row.id)
    }
    if (Number.isFinite(minPts)) {
      const cap = (db.prepare(`SELECT max_points FROM custom_lists WHERE id = ?`)
        .get(row.id) as { max_points: number }).max_points
      db.prepare(`UPDATE custom_lists SET min_points = ? WHERE id = ?`)
        .run(Math.max(0, Math.min(cap, minPts)), row.id)
    }
    const scored = Number(body?.scored_count)
    if (Number.isFinite(scored)) {
      db.prepare(`UPDATE custom_lists SET scored_count = ? WHERE id = ?`)
        .run(Math.max(0, Math.min(10_000, Math.round(scored))), row.id)
    }

    if (Array.isArray(body?.items)) replaceItems(db, row.id, body.items, account.id)

    /**
     * Tiers, replaced wholesale like packs.
     *
     * De-duplicated on `from_rank` before insert rather than left to the UNIQUE
     * constraint: two tiers claiming rank 1 is a plausible thing to type, and
     * failing the whole save over it would lose the rest of the edit. The first
     * one wins, which is the one nearer the top of the editor.
     */
    if (Array.isArray(body?.tiers)) {
      db.prepare(`DELETE FROM custom_list_tiers WHERE list_id = ?`).run(row.id)
      const insTier = db.prepare(
        `INSERT INTO custom_list_tiers (list_id, name, color, from_rank) VALUES (?,?,?,?)`,
      )
      const seen = new Set<number>()
      for (const t of body.tiers.slice(0, 40)) {
        const name = String(t?.name ?? '').trim().slice(0, 40)
        if (!name) continue
        assertClean(name, 'Tier names')
        const rank = Math.max(1, Math.min(MAX_ITEMS, Math.round(Number(t?.from_rank))))
        if (!Number.isFinite(rank) || seen.has(rank)) continue
        seen.add(rank)
        const raw = String(t?.color ?? '').trim()
        const color = /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : null
        insTier.run(row.id, name, color, rank)
      }
    }

    // Packs are replaced wholesale; item ids are filtered to this list so a
    // stale client can't attach someone else's rows.
    if (Array.isArray(body?.packs)) {
      db.prepare(`DELETE FROM custom_list_packs WHERE list_id = ?`).run(row.id)
      const insPack = db.prepare(
        `INSERT INTO custom_list_packs (list_id, name, color, sort_order) VALUES (?,?,?,?)`,
      )
      const insPackItem = db.prepare(
        `INSERT OR IGNORE INTO custom_list_pack_items (pack_id, item_id) VALUES (?,?)`,
      )
      const ownItems = new Set(
        (db.prepare(`SELECT id FROM custom_list_items WHERE list_id = ?`).all(row.id) as { id: number }[])
          .map((r) => r.id),
      )
      body.packs.slice(0, 50).forEach((p, i) => {
        const name = String(p?.name ?? '').trim().slice(0, 80)
        if (!name) return
        assertClean(name, 'Pack names')
        const color = String(p?.color ?? '').trim().slice(0, 20) || null
        const packId = Number(insPack.run(row.id, name, color, i).lastInsertRowid)
        for (const rawId of (p?.item_ids ?? []).slice(0, MAX_ITEMS)) {
          const itemId = Number(rawId)
          if (ownItems.has(itemId)) insPackItem.run(packId, itemId)
        }
      })
    }
    db.prepare(`UPDATE custom_lists SET updated_at = datetime('now') WHERE id = ?`).run(row.id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return { ok: true, list: loadList(db, row.id) }
})
