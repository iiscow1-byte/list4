/**
 * One profanity list, two jobs.
 *
 * The site already had a *viewer* filter — a personal preference that masks
 * words in comments you're reading. This adds the other half: refusing the text
 * where it's written, for the places where it becomes part of the site rather
 * than one person's message. A username appears beside every record its owner
 * holds; a public list's title appears in the gallery. Neither is something a
 * reader can opt out of.
 *
 * Shared between both jobs so they can't drift into disagreeing about what a
 * word is.
 *
 * ## Why this isn't one regex
 *
 * `\bfuck\b` catches exactly one spelling. Anyone trying to slip a slur past a
 * filter writes `f u c k`, `sh1t`, `fuuuck` or `f-u-c-k`, so text is normalised
 * first — leetspeak folded, separators dropped, long runs of a letter
 * collapsed — and matched against that.
 *
 * Which creates the opposite problem, the one that makes naive filters
 * infamous: "Scunthorpe" contains a slur, "assassin" and "classic" contain
 * another, "cockpit", "analysis", "Uranus" and "document" each contain one
 * more. Two things keep that in check:
 *
 *   1. Only words with no plausible innocent embedding are matched as
 *      substrings. Everything shorter or more collision-prone has to appear as
 *      a whole word.
 *   2. Substring matches landing inside an ordinary word are ignored.
 *
 * A filter that rejects someone from Scunthorpe is worse than one that misses
 * a word, so where the two goals conflict this errs towards letting text
 * through.
 */

/**
 * Matched anywhere, even glued into other text. Every entry here is a string
 * with no innocent English embedding — or one whose embeddings are listed in
 * ALLOWED below.
 */
const SUBSTRING_WORDS = [
  'arsehole', 'ballsack', 'bastard', 'bitch', 'blowjob', 'bollocks',
  'cunt', 'dildo', 'faggot', 'fuck', 'handjob', 'jizz', 'kike', 'nigga',
  'nigger', 'pussy', 'rapist', 'retard', 'schlong', 'shit', 'slut', 'spastic',
  'titties', 'tranny', 'twat', 'vagina', 'wank', 'whore',
] as const

/**
 * Matched only as a whole word.
 *
 * Each of these is a substring of something ordinary — cum/document,
 * anal/analysis, cock/cockpit, coon/raccoon, rape/grape, anus/Uranus,
 * spic/spicy, paki/Pakistan, dyke/Van Dyke, chink/"a chink of light". Matching
 * them loosely would reject more real text than abuse.
 */
const WORD_ONLY = [
  'anal', 'anus', 'boner', 'chink', 'clit', 'cock', 'coon', 'cum', 'dick',
  'dyke', 'fag', 'kys', 'paki', 'pedo', 'penis', 'piss', 'porn', 'prick',
  'rape', 'semen', 'spic', 'tit', 'tits',
] as const

/**
 * Ordinary words that contain a SUBSTRING_WORDS entry. A match inside one of
 * these is not profanity.
 *
 * Every entry is a real false positive the list above would otherwise produce —
 * this is the difference between a usable filter and one that rejects
 * "Scunthorpe" and "classic".
 */
const ALLOWED = [
  'assassin', 'assess', 'asset', 'assign', 'assist', 'associate', 'bass',
  'class', 'classic', 'mass', 'pass', 'retardant', 'retardation', 'scunthorpe',
  'shiitake', 'shitake', 'shiite', 'therapist', 'titan', 'titanic', 'title',
  'titular',
] as const

/** Leet and lookalike substitutions, applied before matching. */
const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i', '|': 'i', '¡': 'i', '£': 'e',
}

/**
 * Runs of three or more of the same letter collapse to one; doubles are left
 * alone.
 *
 * The threshold is the whole trick. Collapsing every run would fold "nigger"
 * and "Niger" — a country — onto the same string, and any rule that then let
 * one through would let the other through too. Three is high enough to keep
 * real doubles ("assess", "bollocks") distinct and low enough to catch the
 * usual "fuuuuck". "fuuck" gets through; a word list was never going to stop
 * someone determined, and over-blocking is the worse failure.
 */
function foldRuns(chars: string[], keep: number[]): { out: string[]; map: number[] } {
  const out: string[] = []
  const map: number[] = []
  for (let i = 0; i < chars.length; i++) {
    let run = 1
    while (i + run < chars.length && chars[i + run] === chars[i]) run++
    const emit = run >= 3 ? 1 : run
    for (let k = 0; k < emit; k++) {
      out.push(chars[i]!)
      map.push(keep[i + k] ?? keep[i]!)
    }
    i += run - 1
  }
  return { out, map }
}

/** Letters only, leet folded, long runs collapsed — plus offsets back. */
function squash(text: string): { folded: string; map: number[] } {
  const chars: string[] = []
  const at: number[] = []
  for (let i = 0; i < text.length; i++) {
    const raw = text[i]!.toLowerCase()
    const ch = LEET[raw] ?? raw
    if (ch < 'a' || ch > 'z') continue
    chars.push(ch)
    at.push(i)
  }
  const { out, map } = foldRuns(chars, at)
  return { folded: out.join(''), map }
}

/** The same folding, but split into words on anything that isn't a letter. */
function foldedTokens(text: string): { token: string; start: number; end: number }[] {
  const out: { token: string; start: number; end: number }[] = []
  let chars: string[] = []
  let at: number[] = []
  const flush = () => {
    if (!chars.length) return
    const { out: folded, map } = foldRuns(chars, at)
    out.push({ token: folded.join(''), start: map[0]!, end: map[map.length - 1]! + 1 })
    chars = []
    at = []
  }
  for (let i = 0; i < text.length; i++) {
    const raw = text[i]!.toLowerCase()
    const ch = LEET[raw] ?? raw
    if (ch < 'a' || ch > 'z') { flush(); continue }
    chars.push(ch)
    at.push(i)
  }
  flush()
  return out
}

const ALLOWED_FOLDED = ALLOWED.map((w) => squash(w).folded).filter(Boolean)
// Longest first, so "faggot" is reported rather than the "fag" inside it.
const SUBSTRING_FOLDED = SUBSTRING_WORDS
  .map((w) => ({ word: w, folded: squash(w).folded }))
  .sort((a, b) => b.folded.length - a.folded.length)
const WORD_ONLY_FOLDED = new Map(WORD_ONLY.map((w) => [squash(w).folded, w]))

/** Every span of `folded` covered by an ordinary word. */
function allowedSpans(folded: string): [number, number][] {
  const spans: [number, number][] = []
  for (const safe of ALLOWED_FOLDED) {
    let from = 0
    for (;;) {
      const at = folded.indexOf(safe, from)
      if (at === -1) break
      spans.push([at, at + safe.length])
      from = at + 1
    }
  }
  return spans
}

export type ProfanityHit = {
  /** The list word that matched. */
  word: string
  /** Range within the *original* text, so a mask replaces what was typed. */
  start: number
  end: number
}

/** Every hit in `text`. */
export function findProfanity(text: string): ProfanityHit[] {
  if (!text) return []
  const hits: ProfanityHit[] = []

  const { folded, map } = squash(text)
  if (folded) {
    const safe = allowedSpans(folded)
    const claimed: [number, number][] = []
    for (const { word, folded: needle } of SUBSTRING_FOLDED) {
      let from = 0
      for (;;) {
        const at = folded.indexOf(needle, from)
        if (at === -1) break
        const end = at + needle.length
        from = at + 1
        // Inside an ordinary word, or inside a longer hit already found.
        if (safe.some(([s, e]) => at >= s && end <= e)) continue
        if (claimed.some(([s, e]) => at >= s && end <= e)) continue
        claimed.push([at, end])
        hits.push({ word, start: map[at]!, end: map[end - 1]! + 1 })
      }
    }
  }

  for (const t of foldedTokens(text)) {
    const word = WORD_ONLY_FOLDED.get(t.token)
    if (!word) continue
    // A whole-word hit inside a span an earlier substring hit already covers
    // would double-report the same characters.
    if (hits.some((h) => t.start >= h.start && t.end <= h.end)) continue
    hits.push({ word, start: t.start, end: t.end })
  }

  return hits.sort((a, b) => a.start - b.start || b.end - a.end)
}

/** The first word that would be rejected, or null. */
export function firstProfanity(text: string | null | undefined): string | null {
  return text ? findProfanity(text)[0]?.word ?? null : null
}

export function containsProfanity(text: string | null | undefined): boolean {
  return !!text && findProfanity(text).length > 0
}

/** Replace every hit with asterisks, for the viewer-side filter. */
export function maskProfanity(text: string): string {
  const hits = findProfanity(text)
  if (!hits.length) return text
  let out = ''
  let at = 0
  for (const hit of hits) {
    if (hit.start < at) continue
    out += text.slice(at, hit.start) + '*'.repeat(hit.end - hit.start)
    at = hit.end
  }
  return out + text.slice(at)
}
