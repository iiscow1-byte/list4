/**
 * Look up a level on the official Geometry Dash servers, with a 1-hour cache
 * in `gd_info_cache`. The actual HTTP pipeline lives in `~/server/utils/gd-fetch`
 * so the on-demand endpoint and the background cache warmer share it.
 */

import { getDb } from '~/server/db'
import { fetchFresh, type GdInfo } from '~/server/utils/gd-fetch'

const CACHE_TTL_SECONDS = 3600

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid level id' })
  }

  const db = getDb()
  const cached = db
    .prepare(
      `SELECT info_json, CAST(strftime('%s','now') - strftime('%s', fetched_at) AS INTEGER) AS age
       FROM gd_info_cache WHERE gd_id = ?`,
    )
    .get(id) as { info_json: string; age: number } | undefined

  if (cached && cached.age < CACHE_TTL_SECONDS) {
    setHeader(event, 'cache-control', 'public, max-age=300, s-maxage=300')
    return JSON.parse(cached.info_json) as GdInfo
  }

  let info: GdInfo
  try {
    info = await fetchFresh(id)
  } catch (e: any) {
    const msg = e?.message ?? 'unknown'
    if (msg === 'not_found') {
      throw createError({ statusCode: 404, statusMessage: 'Level not found on GD servers' })
    }
    // Both backends failed — serve stale cache if we have any, since stale data
    // is always better than a 502 for fields that change slowly.
    if (cached) {
      setHeader(event, 'cache-control', 'public, max-age=60')
      return JSON.parse(cached.info_json) as GdInfo
    }
    throw createError({
      statusCode: 502,
      statusMessage: `Geometry Dash servers unavailable (${msg})`,
    })
  }

  db.prepare(
    `INSERT INTO gd_info_cache (gd_id, info_json, fetched_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(gd_id) DO UPDATE SET info_json = excluded.info_json, fetched_at = excluded.fetched_at`,
  ).run(id, JSON.stringify(info))

  setHeader(event, 'cache-control', 'public, max-age=300, s-maxage=300')
  return info
})
