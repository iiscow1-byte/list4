import { getDb } from '~/server/db'
import { requireAccount } from '~/server/utils/auth'
import { isValidTier } from '~/utils/tier-ordinal'
import { uploadDatesForUrls, isYoutubeConfigured } from '~/server/utils/youtube-dates'

/**
 * Submit several of a custom list's levels to the ALL list in one go.
 *
 * A list that has been curated for a while accumulates levels the ALL doesn't
 * carry yet; walking them through the single submit form one at a time is the
 * slowest possible path. This takes the rows, applies the same rules as
 * `/api/levels/submit`, and reports each one's outcome rather than failing the
 * whole batch on the first bad row — with twenty levels in flight, "one of
 * these is already pending" should not throw away the other nineteen.
 *
 * Anyone who can see the list may submit from it; these are proposals for
 * moderators to review, exactly like a normal submission.
 */
const MAX_BATCH = 50

type Row = {
  item_id?: number
  gd_id?: number | string | null
  name?: string | null
  verifier?: string | null
  verify_date?: string | null
  verification_url?: string | null
  gddl_tier?: string | null
  difficulty?: string | null
  placement_estimate?: number | string | null
  notes?: string | null
}

type Outcome = {
  item_id: number | null
  name: string
  status: 'submitted' | 'skipped'
  reason?: string
  pending_id?: number
}

const ALLOWED_DIFFICULTIES = new Set([
  'Auto', 'Easy', 'Normal', 'Hard', 'Harder', 'Insane',
  'Easy Demon', 'Medium Demon', 'Hard Demon', 'Insane Demon', 'Extreme Demon',
])

function strOrNull(v: unknown, max = 1000): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  return s.slice(0, max)
}

export default defineEventHandler(async (event) => {
  const account = requireAccount(event)
  const publicId = String(getRouterParam(event, 'public_id') ?? '')
  const body = await readBody<{ items?: Row[] }>(event) ?? {}

  const db = getDb()
  const list = db.prepare(
    `SELECT id, title, is_public, owner_account_id FROM custom_lists WHERE public_id = ?`,
  ).get(publicId) as { id: number; title: string; is_public: number; owner_account_id: number } | undefined
  if (!list) throw createError({ statusCode: 404, statusMessage: 'List not found' })
  if (!list.is_public && account.id !== list.owner_account_id) {
    throw createError({ statusCode: 403, statusMessage: 'This list is private.' })
  }

  const rows = Array.isArray(body.items) ? body.items.slice(0, MAX_BATCH) : []
  if (!rows.length) throw createError({ statusCode: 400, statusMessage: 'Nothing to submit.' })

  /**
   * Fill in the verification dates nobody typed, from the videos.
   *
   * This used to be the browser's job alone, and a row that arrived without a
   * date was rejected with "Needs a verification date" — while carrying a
   * YouTube link whose upload date is exactly that date. The client still fills
   * them in as you edit (so you can see and correct them before submitting);
   * this is the backstop for every way that can fail to happen: the lookup was
   * still in flight when Submit was pressed, the page was opened on a slow
   * connection, a link was pasted a moment before submitting, or the request
   * simply errored.
   *
   * One batched call for the whole submission, before the transaction opens —
   * a `fetch` inside an open SQLite transaction would hold a write lock across
   * a third-party round trip.
   *
   * The video's upload date is not *always* the verification date, which is why
   * a typed value always wins and is never overwritten. But for a level being
   * carried over from a curated list it is right far more often than blank is,
   * and a moderator reviews every row of this anyway.
   */
  const needDates = rows.filter((r) => !strOrNull(r.verify_date, 32) && strOrNull(r.verification_url, 500))
  const resolvedDates = needDates.length
    ? await uploadDatesForUrls(needDates.map((r) => strOrNull(r.verification_url, 500)))
    : new Map<string, string>()
  let autoDated = 0

  const placementSource = list.title.slice(0, 100)
  const insert = db.prepare(
    `INSERT INTO pending_levels
       (gd_id, name, fps, game_version, verification_url, verifier, verify_date,
        gddl_tier, difficulty, notes, submitted_by, placement_estimate, placement_source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const onAllList = db.prepare(`SELECT position FROM levels WHERE gd_id = ?`)
  const alreadyPending = db.prepare(`SELECT id FROM pending_levels WHERE gd_id = ? AND status = 'pending'`)

  const results: Outcome[] = []
  // Guards against the same id appearing twice in one batch, which the
  // per-row "already pending" check can't catch — nothing is committed until
  // the loop ends.
  const seen = new Set<number>()

  db.exec('BEGIN')
  try {
    for (const r of rows) {
      const itemId = Number.isInteger(Number(r.item_id)) ? Number(r.item_id) : null
      const name = strOrNull(r.name, 200)
      const push = (reason: string) =>
        results.push({ item_id: itemId, name: name ?? '(unnamed)', status: 'skipped', reason })

      if (!name) { push('No level name.'); continue }
      if (name.includes(',')) { push('Level names cannot contain commas.'); continue }

      const gdId = r.gd_id != null && r.gd_id !== '' ? Number(r.gd_id) : null
      if (gdId == null || !Number.isInteger(gdId) || gdId <= 0) { push('Needs a Geometry Dash level ID.'); continue }
      if (seen.has(gdId)) { push('Listed twice in this batch.'); continue }

      const existing = onAllList.get(gdId) as { position: number } | undefined
      if (existing) { push(`Already on the ALL at #${existing.position}.`); continue }
      if (alreadyPending.get(gdId)) { push('Already waiting for review.'); continue }

      const verifier = strOrNull(r.verifier, 100)
      if (!verifier) { push('Needs a verifier.'); continue }
      const verificationUrl = strOrNull(r.verification_url, 500)
      if (!verificationUrl) { push('Needs a verification video link.'); continue }

      // Typed wins; otherwise the video's upload date, resolved above.
      let verifyDate = strOrNull(r.verify_date, 32)
      if (!verifyDate) {
        const fromVideo = resolvedDates.get(verificationUrl)
        if (fromVideo) { verifyDate = fromVideo; autoDated++ }
      }
      if (!verifyDate) {
        push(isYoutubeConfigured()
          ? "Needs a verification date — couldn't read one from the video."
          : 'Needs a verification date.')
        continue
      }

      const gddlTier = strOrNull(r.gddl_tier, 32)
      if (gddlTier && !isValidTier(gddlTier)) {
        push('Tier must look like "Tier 5" or "Subtier 3".'); continue
      }
      const difficulty = strOrNull(r.difficulty, 32)
      if (difficulty && !ALLOWED_DIFFICULTIES.has(difficulty)) { push('Unknown difficulty.'); continue }

      let placement: number | null = null
      if (r.placement_estimate != null && r.placement_estimate !== '') {
        const n = Number(r.placement_estimate)
        if (!Number.isInteger(n) || n <= 0) { push('Placement estimate must be a positive whole number.'); continue }
        placement = n
      }

      const info = insert.run(
        gdId, name, 'any', 'any', verificationUrl, verifier, verifyDate,
        gddlTier, difficulty, strOrNull(r.notes, 4000), account.id, placement, placementSource,
      )
      seen.add(gdId)
      results.push({ item_id: itemId, name, status: 'submitted', pending_id: Number(info.lastInsertRowid) })
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return {
    ok: true,
    submitted: results.filter((r) => r.status === 'submitted').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    /** How many dates the server read off the videos, so the page can say so. */
    autoDated,
    results,
  }
})
