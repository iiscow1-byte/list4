import { getDb } from '~/server/db'
import { SHEET_BASE_URL, extractLinkHref, normHeader, parseTable } from '~/server/db/sheet-format'

/**
 * The About page's intro, FAQ and list of sources, read from the sheet's
 * landing tab — the curators' own words.
 *
 * Google answers this tab slowly (10 s+), so the page never waits on it: the
 * last good copy is served straight away and refreshed in the background once
 * it is an hour old. That copy is also kept in the database, so a restart
 * doesn't put the next visitor back behind Google.
 */
const LANDING_GID = '1565294080'
const MAX_AGE_MS = 60 * 60 * 1000
const SETTINGS_KEY = 'landing_cache'

type LandingPayload = {
  intro: string[]
  faq: string[]
  statsViewerFaq: string[]
  lists: { name: string; href: string | null }[]
}

const EMPTY: LandingPayload = { intro: [], faq: [], statsViewerFaq: [], lists: [] }

/** Section headings, by normalised text. A renamed heading costs that one section, not the page. */
const HEADINGS = {
  faq: ['faq', 'frequentlyaskedquestions', 'questions'],
  statsFaq: ['statsviewerfaq', 'statsfaq'],
  addStats: ['additionalstats', 'morestats'],
  lists: ['alldemonlistsused', 'demonlistsused', 'listsused', 'sources', 'listsources'],
}

let memory: { at: number; data: LandingPayload } | null = null
let refreshing: Promise<void> | null = null

function loadStored(): { at: number; data: LandingPayload } | null {
  try {
    const row = getDb().prepare(`SELECT value, updated_at FROM site_settings WHERE key = ?`).get(SETTINGS_KEY) as
      { value: string; updated_at: string } | undefined
    if (!row) return null
    return { at: Date.parse(`${row.updated_at.replace(' ', 'T')}Z`) || 0, data: JSON.parse(row.value) }
  } catch {
    return null
  }
}

function store(data: LandingPayload): void {
  getDb().prepare(
    `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(SETTINGS_KEY, JSON.stringify(data))
}

async function fetchLanding(): Promise<LandingPayload> {
  const res = await fetch(`${SHEET_BASE_URL}/pubhtml/sheet?headers=false&gid=${LANDING_GID}`, {
    headers: { 'User-Agent': 'all-levels-list/2.0' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const table = parseTable(await res.text())
  if (!table) throw new Error('no table in the landing tab')

  const rows = table.text.map((text, i) => ({ text, links: table.html[i]!.map((c) => extractLinkHref(c)) }))
  const findHeading = (names: string[]) => rows.findIndex((r) => r.text.some((t) => names.includes(normHeader(t))))
  const iFaq = findHeading(HEADINGS.faq)
  const iStatsFaq = findHeading(HEADINGS.statsFaq)
  const iAddStats = findHeading(HEADINGS.addStats)
  const iLists = findHeading(HEADINGS.lists)
  const ends = [iFaq, iStatsFaq, iAddStats, iLists].filter((i) => i >= 0)
  const nextAfter = (i: number) => Math.min(...ends.filter((e) => e > i), rows.length)

  const paragraphs = (from: number, to: number): string[] => {
    const out: string[] = []
    for (let i = from; i < to && i < rows.length; i++) {
      const r = rows[i]!
      const primary = r.text.find((t) => t) ?? ''
      if (!primary) continue
      const link = r.links.find((l, idx) => l && r.text[idx]?.startsWith('http'))
      out.push(link ? `${primary} ${link}` : primary)
    }
    return out
  }

  const lists: LandingPayload['lists'] = []
  if (iLists >= 0) {
    for (let i = iLists + 1; i < nextAfter(iLists); i++) {
      const r = rows[i]!
      let nameIdx = r.text.findIndex((t) => t && !/^https?:\/\//i.test(t))
      if (nameIdx === -1) nameIdx = r.text.findIndex((t) => t)
      if (nameIdx === -1) continue
      const href = r.links.slice(nameIdx + 1).find((l) => l) ?? r.links.find((l) => l) ?? null
      lists.push({ name: r.text[nameIdx]!, href })
    }
  }

  return {
    intro: paragraphs(1, ends.length ? Math.min(...ends) : 1),
    faq: iFaq >= 0 ? paragraphs(iFaq + 1, nextAfter(iFaq)) : [],
    statsViewerFaq: iStatsFaq >= 0 ? paragraphs(iStatsFaq + 1, nextAfter(iStatsFaq)) : [],
    lists,
  }
}

function refresh(): Promise<void> {
  refreshing ??= fetchLanding()
    .then((data) => {
      // A read that found nothing is a bad read, not a sheet with no FAQ.
      if (!data.intro.length && !data.faq.length && !data.lists.length) throw new Error('landing tab came back empty')
      memory = { at: Date.now(), data }
      store(data)
    })
    .catch((e) => console.warn('[landing] refresh failed, keeping the last copy:', (e as Error).message))
    .finally(() => { refreshing = null })
  return refreshing
}

export default defineEventHandler(async (event) => {
  memory ??= loadStored()
  if (!memory) {
    // Nothing yet at all: wait for the first read, but not forever.
    await Promise.race([refresh(), new Promise((r) => setTimeout(r, 8000))])
  } else if (Date.now() - memory.at > MAX_AGE_MS) {
    void refresh()
  }
  setHeader(event, 'cache-control', 'public, max-age=300')
  return memory?.data ?? EMPTY
})
