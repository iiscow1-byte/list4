This project was vibecoded

# All Levels List
Pubert
An AREDL-style ranking site for the **All Levels List** — tens of thousands of levels pulled directly from the project's published Google Sheet. Inspired by [aredl.net](https://aredl.net) and the [All-Rated-Extreme-Demon-List](https://github.com/All-Rated-Extreme-Demon-List) project lineage.

- **Stack:** Nuxt 3 (Vue 3, server routes) · SQLite via Node's built-in `node:sqlite` (requires Node ≥ 22.5) · Tailwind CSS
- **Data source:** the published-to-the-web All Levels List Google Sheet, fetched as CSV per tab
- **Pages:**
  - `/` — the list (redirects to `/levels/1`)
  - `/levels/:position` — AREDL-style 3-panel layout (list nav · level details · records · discussion)
  - `/levels/find` — search Geometry Dash itself and submit a level / record straight from a result
  - `/builder` — the list builder: drag levels out of the ALL list (or type your own), then save and share
  - `/lists` — gallery of published lists; `/lists/:public_id` — one list
  - `/community` — activity from people you follow, newly ranked levels, latest records, fresh lists
  - `/changelog` — this list's own placements and movements
  - `/leaderboard` — players from the sheet's leaderboard tab
  - `/about` — intro, FAQ, stats, and the demonlists used

## Placements: sheet vs. position

Two numbers describe where a level sits, and they are deliberately different:

- **`levels.position`** — internal ordering, `1..N` with no gaps. It's the sort
  key, the URL key (`/levels/:position`), and what the admin move endpoints
  operate on. Never shown to readers.
- **`levels.sheet_placement`** — the placement printed in the source sheet.
  The sheet numbers levels continuously across its tabs (Main `1…13050`, then
  Tier 4 picks up at `13051`, and so on), so it is a genuine global ranking —
  but it drifts from `position` because levels appearing on several tabs
  collapse into one row. **This is the number the UI shows as "#N"**, and what
  the search box's `#N` shortcut resolves against, via
  `/api/levels/by-placement/:n`.

- **`levels.sheet_rank`** — the same number the sheet gave the level, but never
  handed back out to another row.

  A placement number belongs to the **slot**, not to the level in it, so every
  move redistributes `sheet_placement` across the range it touched
  (`resyncPlacements`). That is right for display and it means `sheet_placement`
  stops recording what the sheet said the moment anyone drags something —
  nothing recorded the sheet's own ordering, so "put the list back the way the
  sheet has it" had no source to read and was silently a no-op. `sheet_rank` is
  written by the importer and left alone by everything else.

Keeping URLs on `position` means links survive a re-import even when the
curators renumber the sheet. `server/utils/changes.ts` maps historical
positions through to placements so the changelog speaks the same numbering as
the rest of the site.

### Placement backups

**Admin → Imports → Placement backups** (`server/utils/placement-snapshot.ts`):

- `GET /api/admin/placements/export?format=json|csv` — every level and where it
  sits. JSON carries the ids that make a restore exact; CSV is for editing.
- `POST /api/admin/placements/restore` — the file is the request body, sniffed
  rather than declared. `?apply=1` writes; without it you get the same report as
  a preview, from the same code path.
- `POST /api/admin/placements/reset-to-sheet` — orders sheet-backed levels by
  `sheet_rank`, flowing around site-only and permanent rows, exactly as a full
  sheet import leaves things. Same preview/apply split.

A restore is **not** `SET position = whatever the file said`: positions are
`UNIQUE`, the file may be stale, and the list may have gained levels. The file
carries an *ordering*, so that is what is applied — rows it names are laid out in
its order, and rows it has never heard of stay directly after the neighbour they
currently follow rather than being swept to the bottom. Rows are matched by id
first, then `gd_id` + name, then either alone when unambiguous.

Both writes save the current placements to `data/backups/` first and refuse to
proceed if they can't.

- **`levels.site_only`** — 1 when the sheet carries no level with this level's
  ID. Recomputed from the sheet's full ID set on every ALL import
  (`markSiteOnly` in `server/db/import.ts`), and it is what the list's
  "Site-only levels" filter reads.

  This used to be inferred from `sheet_placement IS NULL`, which answers a
  different question: that column is cleared for any row no sheet row claimed on
  a given run, which includes levels the sheet merely renamed and Solo/2P pairs
  whose shared ID stops the importer matching them. Both are still on the sheet,
  so both were mislabelled.

**Admin → Imports → Sheet vs. site report** (`/api/admin/sheet-report`) dumps
the disagreements. The useful section is `offset_runs` / `drift_points`: because
the two numberings diverge cumulatively, one extra sheet row near the top makes
every level below it "mismatch" by the same amount — 53,000 rows all saying one
thing. Collapsing equal offsets into runs turns that into the handful of levels
where the numbering actually moved. `?full=1` returns the per-level list anyway.

## Level thumbnails

Level rows and the level-page hero use community thumbnails from the
[Level Thumbnails API](https://levelthumbs.prevter.me/swagger/), keyed on the
level's GD ID: `GET /thumbnail/{gd_id}/{high|medium|small}`.

Measured, because the names don't tell you and the numbers drive everything
below:

| name | size | weight |
|---|---|---|
| `small` | 640×360 | ~200–290 kB |
| `medium` | 1280×720 | ~545–840 kB |
| `high` | 1920×1080 | ~860 kB–1.35 MB |

Those are heavy files for a decorative background, which is why `res` on
`LevelThumbBg` is a **ceiling** rather than a choice: every size up to it goes
into a `srcset`, and the browser picks using `sizes` and the device pixel ratio.
A fixed size is wrong in both directions — a phone downloading 1.35 MB to paint
a 390 px header, and a HiDPI desktop stretching a 640 px image across 1400 px —
and this fixes both at once, so quality goes up on large screens while bytes go
*down* on small ones. The ceiling is what keeps a 500-row list page from ever
reaching for the big files: those rows are 64 px tall behind a gradient at 12 %
opacity, so `small` is already more than they can show.

Backgrounds load `lazy` at `fetchpriority="low"`; the one hero a page opens on
passes `priority` for `eager` / `high`. Both CDNs are `preconnect`ed in
`nuxt.config.ts` so the first image doesn't pay for DNS and TLS.

Roughly a third of levels have no entry there. Those fall back to the thumbnail
of the level's verification video, which YouTube serves at a predictable URL —
`maxresdefault` (1280×720) first in large contexts, then `hqdefault` (480×360),
which exists for every public video. `maxresdefault` 404s for anything not
uploaded in HD, so it is never the only fallback and is never requested from a
dense row, where the extra round trip would be paid 500 times for a difference
nobody can see. `components/LevelThumbBg.vue` renders whichever succeeds as an
absolutely-positioned backdrop and stays invisible until an image actually
loads, so a level with neither keeps the plain background instead of flashing a
broken image.

Both sources are plain `<img>` loads straight from a CDN — the server never
proxies an image, so none of this costs request time. Misses are memoised in
memory and in `localStorage` (7-day TTL, capped at 4,000 ids, written behind a
1s debounce), so a level known to have no community thumbnail skips straight to
the video fallback on later renders instead of re-requesting a 404.

## Profanity

Two jobs, one word list (`utils/profanity.ts`):

- **`useProfanityFilter`** — a *reading* preference that masks words in text you
  are shown. Personal, and can be turned off.
- **`assertClean`** (`server/utils/profanity-guard.ts`) — refuses the text where
  it is written, for the surfaces nobody can opt out of seeing: usernames,
  custom-list titles and descriptions, pack names, level notes, record player
  names and notes, and comments. Server-side, because every one of those
  endpoints is one `curl` away.

Level **names** are deliberately exempt: they are real level names, and one of
the lists this site mirrors is called *The Shitty List*.

Matching folds leetspeak, drops separators (`f.u.c.k`) and collapses runs of
**three or more** of a letter (`fuuuck`). Three, not two — collapsing every run
folds `nigger` and `Niger`, a country, onto the same string, and any rule that
then let one through would let the other through too. `fuuck` gets past; a word
list was never going to stop someone determined, and over-blocking is the worse
failure.

The list is split by how safely a word can be matched. Words with no innocent
embedding are found anywhere in the text; short or collision-prone ones
(`cum`/document, `anal`/analysis, `cock`/cockpit, `anus`/Uranus, `rape`/grape,
`coon`/raccoon, `spic`/spicy) only count as whole words. On top of that, a
substring match landing inside an ordinary word — Scunthorpe, assassin, classic,
therapist, retardant, Titanic — is ignored.

## Custom lists

`custom_lists` / `custom_list_items` back the builder. An item either points at
an ALL level (`level_id` set — its display fields and current placement are
resolved from `levels` at read time, so a saved list can never disagree with
the list about a level it points at) or is fully hand-entered (`level_id`
NULL, client values kept). Guests build against `localStorage`; saving requires
an account and mints a random `public_id` used for share URLs.

Setting `is_public` publishes a list to the `/lists` gallery, where others can
like it (`custom_list_likes`, with the count denormalised onto
`custom_lists.likes`) or fork it into their own (`copied_from_id` credits the
original).

### Scheduled sheet refresh

`server/plugins/sheet-refresh.ts` re-runs the sheet importer every
`LIST_SHEET_REFRESH_HOURS` hours (default 6), so placements follow the
curators' edits without anyone running a command. Set
`LIST_SKIP_SHEET_REFRESH=1` to disable it — worth doing in development, where a
~90s import competing for the SQLite write lock is just noise.

Re-imports never duplicate levels: sheet rows are matched to existing levels on
`(gd_id, lower(name))`, so a re-run repositions rows rather than inserting new
ones, and `cleanupDuplicateLevels` sweeps up anything earlier imports left
behind (it reports `0 duplicated` on a clean database).

Refreshes write to the changelog through `recordSheetMovements`. Every level's
*absolute* position shifts whenever rows are inserted above it, so absolute
position is useless as a "did this move?" signal — one new level at the top
would otherwise generate 54,000 entries. What gets logged instead is a change
to a level's rank **among the levels already on the list**, which insertions and
removals leave untouched. A re-import of an unchanged sheet logs nothing.

### Sandwiched tier repair

`server/utils/tier-repair.ts` corrects tiers that disagree with both
neighbours — Tier 31, **Tier 30**, Tier 31 becomes three Tier 31s. It runs on
every import, before points are derived from those tiers. It only fires when
both neighbours carry the *same* tier and are position-adjacent, so genuine
difficulty bands and rows either side of a gap are left alone.

### Custom lists are full list sites

A published list runs like a real demonlist rather than a static ranking.
`/lists/:public_id` is a tabbed site: **List** (ranked levels with points,
records, and an expandable per-level panel showing the verification embed,
level ID, percent to qualify, FPS and game version), **Leaderboard**,
**Packs**, **Submit a record**, and a **Queue** the owner moderates.

- **Records** (`custom_list_records`) are submitted by any logged-in user and
  land as `pending` for the list owner to accept or reject — inbox messages go
  out both ways. The owner's own submissions auto-approve, since there's nobody
  else to review them. A `UNIQUE(item_id, player_name)` index means
  re-submitting for a level replaces the earlier attempt, which is what someone
  upgrading a 62% to 100% expects.
- **Points** decay exponentially with rank: the #1 level is worth
  `max_points`, the last scored level `min_points`, anchored to the list's own
  length so short and long lists both use the full range. `scored_count` caps
  how far down points are awarded. A 100% record earns a level's full value; a
  qualifying partial earns it scaled by percent. See
  `server/utils/custom-list-scoring.ts`.
- **The leaderboard** is derived at read time from approved records and the
  levels' current ranks — nothing is denormalised, so reordering the list
  immediately reshuffles standings.
- **Packs** (`custom_list_packs`) group levels under a name and colour.

A custom list is laid out like the main list rather than as a single scrolling
page: `pages/lists/[public_id]/[[rank]].vue` is a full-viewport three-panel
view — searchable level nav with thumbnails on the left, the selected level in
the middle, its records on the right — with the list's own tab bar for
Leaderboard, Packs, Submit, Queue and Settings.

`rank` is an *optional* route param, so one page serves both `/lists/:id` and
`/lists/:id/7`. An earlier version had a separate index page that redirected to
`/1`, which rendered "this list has no levels yet" on the bare URL: the
redirect decision ran during setup, before `useFetch` resolved, so it saw an
empty list and fell through. Serving both from one route removes the window in
which that can happen.

The secondary pages share `components/CustomListShell.vue` (list bar, scrolling
body, not-found and loading states) so each is just its own content.

- **Editors.** Owners can appoint collaborators from **Settings → Editors**.
  Editors change the list's levels and settings and moderate its records;
  deleting the list and changing the editor roster stay with the owner.
  `server/utils/custom-list-perms.ts` is the single source of truth for this —
  scattering `owner_account_id === account.id` checks is how a collaborator
  ends up able to accept records but not reorder the list they're accepting
  them for.

Owners configure the rest from the builder's **List settings** row, and
per-level fields from the `⋯` button on each row.

Because records hang off `custom_list_items.id` with `ON DELETE CASCADE`,
`replaceItems` *reconciles* rather than deleting and re-inserting — it matches
incoming rows to existing ones (by id, then linked level, then name + GD ID)
and updates them in place. A delete-and-reinsert would wipe every record on the
list each time someone dragged a row.

## Submitting from a Geometry Dash search

`/levels/find` searches GD by name or ID through `GET /api/gd/search`, which
proxies gdbrowser's search endpoint — the same source `server/utils/gd-fetch.ts`
uses for per-level info. Results are annotated with whether the level is
already ranked, so the page offers "submit a record" for levels on the list and
"submit to the list" for levels that aren't, prefilling `/levels/submit` with
the ID and name.

## Moving levels

Moderators get four ways to reposition a level, all landing on the same
`POST /api/admin/levels/:position/move`:

- **Type a placement** in the edit form. The field speaks *sheet placements*,
  the numbers the site displays, so `to_placement` is resolved server-side to
  whichever level currently sits there.
- **Nudge buttons** (±1 / ±5 / ±10) next to it, for the small moves that make
  up most curation.
- **Drag to place** (`components/PlacementEditor.vue`) loads a window of the
  list around the level via `/api/levels?fromPosition=…`, reorders a local copy
  as you drag, and only writes on Apply.
- **Move below…** turns the left nav into a picker: click a level and this one
  lands directly under it.

**Move now** applies just the placement change and skips the metadata PATCH, so
a reorder doesn't have to carry a whole form save with it.

Custom lists have the equivalent, scoped to the list: editors toggle reorder
mode in the list nav and drag rows or type a rank, and each level page has an
inline editor. Those go through `POST /api/custom-lists/:id/move` and
`PATCH|DELETE /api/custom-lists/:id/items/:item_id`, which move or edit one row
and log one changelog entry — the builder's full `PATCH` reconciles every row
and is far more machinery than a single drag needs. On a linked row (one
pointing at an ALL level) the name, creator, ID and video are read-only: a full
save re-reads them from `levels`, so letting them be edited here would look
like it worked and then silently revert.

## Building a custom list from an imported list

`components/AdminCustomLists.vue` can seed a custom list out of **any** list the
site mirrors, not just the ALL — pick the source in the toggle and every
GDListTemplate list (CCL, TSL, EDI, …), AREDL, GDL or MSCL becomes available.
`server/utils/list-sources.ts` holds the per-source queries;
`utils/list-source-catalog.ts` holds the catalogue itself, shared so the picker
and the server validate against the same list. Rows whose `gd_id` also exists on
the ALL list are linked to it, so the copy keeps following the ALL list for
names and metadata; the rest are stored as hand-entered items. Tier and rating
filters are disabled for mirrors, which carry no ALL tier data.

## Website updates and version

`utils/site-updates.ts` is the site's own changelog — distinct from `/changelog`,
which tracks level placements. Add an entry when you ship and everything else
follows from it: `/updates` renders the timeline, the footer chip shows
`SITE_VERSION` (the newest entry's version), and the header's Community menu
grows a dot until the visitor opens the page. Nothing else needs updating.

## Access control (alpha lockdown)

The site is currently closed: only staff can use it, and nobody can register.
Both switches live in `server/utils/site-access.ts` and both default to the
closed position, so a deployment that sets nothing is locked rather than open.

| Env var | Default | Effect |
| --- | --- | --- |
| `PUBLIC_SITE=1` | unset | Re-opens the site to everyone. |
| `ALLOW_SIGNUPS=1` | unset | Re-opens registration. |
| `LOCKDOWN_ALLOW_MODERATORS=1` | unset | Lets moderators in too (staff is `admin`/`owner`/`developer` otherwise). |

The two are independent: opening the site does **not** re-open sign-ups.

Enforcement is `server/middleware/00.lockdown.ts`. It has to be server-side —
a route middleware only guards navigation in the browser, so without it every
`/api/**` endpoint still answers to anyone with `curl` and the whole list,
every profile and the leaderboard are readable. `middleware/lockdown.global.ts`
exists only to stop a soft navigation rendering a page the server would refuse.
The client never re-derives the rule: `/api/auth/me` returns `site.canAccess`,
the server's verdict on that session, so the two halves cannot disagree.

**The internal-request token.** While rendering a page, Nuxt calls its own API
with `$fetch`, and server-side `$fetch` does not forward the browser's cookies —
so those calls look anonymous and every server-rendered page 403s for the admins
the lockdown is meant to admit. `server/plugins/00.internal-fetch.ts` stamps
same-server requests with a per-process secret (`server/utils/internal-token.ts`)
that the middleware accepts. Recognising internal calls by their *shape* instead
(no user-agent, empty `remoteAddress`) is a guess about transport: behind a proxy
on a Unix socket real external requests look identical and the site silently
opens. The token is attached only to relative URLs, so it never reaches the
Google Sheet, the GD API or YouTube.

### Accounts, with sign-ups closed

```bash
npm run make-admin -- --list                                  # who can get in
npm run make-admin -- --username Gerg --password '<password>' # create
npm run make-admin -- --username Gerg --role owner            # promote
```

This is the only way an account is created while sign-ups are off, and the way
back in if the last admin is ever lost. It's a local CLI on purpose — an HTTP
endpoint that mints admins is a back door however it's guarded.

```bash
npm run purge-accounts                        # dry run (default cutoff 2026-07-30)
npm run purge-accounts -- --apply             # delete
npm run purge-accounts -- --cutoff=2026-07-30 --include-staff --apply
```

Dry run by default: deleting an account takes its custom lists, progress posts,
comments, follows and inbox with it, and the dry run prints that blast radius
read from the live schema rather than from a hardcoded list. `--apply` writes a
`VACUUM INTO` snapshot to `data/backups/` first (a plain file copy can miss
writes still sitting in the WAL). Staff are kept unless `--include-staff`, and
it refuses outright to leave zero admins — with sign-ups closed that would lock
everyone out of the site permanently.

## Setup

Requires **Node ≥ 22.5** — `node:sqlite` needs 22.5, and the Nuxt 3.21 / Vite 7
toolchain needs `^20.19.0 || >=22.12.0`. On an older Node the build fails during
CSS processing with `Cannot use 'import.meta' outside a module`, which looks
like a stylesheet problem but is the version gap.


```bash
npm install
npm run import   # fetches the Google Sheet, populates data/list.db (~70s, ~52k levels)
npm run dev      # http://localhost:3000
```

Re-running `npm run import` is idempotent — it upserts on `position`. Delete `data/list.db` to start completely fresh.

## Schema

```
levels    (position, name, gd_id, gddl_tier, rated, difficulty, placement_source,
           points, main_skillset, verify_date, verification, pov_placement,
           year_verified, category, source_tab)
players   (name, country, total_points, skill_points, hardest, tier)
records   (level_id, player_id, percent, hz, video, verified)
```

`position` is the global rank in the sheet. URLs are keyed on `position` so re-imports don't break links.

## AREDL placement history

`npm run import:aredl-history` (admin panel: Imports → **AREDL history**) walks every
ALL level that is also ranked on AREDL and pulls `GET /levels/{gd_id}/history`
from `api.aredl.net/v2`. It writes **one** table:

- `aredl_position_history` — the complete raw trace, including the passive ±1
  shifts a level absorbs when *other* levels are placed or removed. ~190k rows.
  This is what the placement-over-time graph on the level page plots, and the
  only place imported AREDL history is allowed to live.

It used to also write the level's own moves into `position_history` with
`source = 'aredl'`, converted into equivalent ALL placements, so they appeared
in the changelog. The result was a changelog where **1,774 of 1,777 entries
described movements on another site** — the ALL looked like it was reordering
itself constantly when nobody had moved anything. Those rows are deleted at boot
(`initSchema`), `loadChanges` excludes the source outright, and the importer no
longer writes them. A level on this list moves when someone moves it here.

The comparison is still available where it belongs: the level page graph draws
AREDL's ranks and the ALL's placements as two series **on separate axes** —
AREDL runs 1…150ish and the ALL 1…54,000, so one shared axis rendered both
useless. `aredl_position_history.all_position` keeps AREDL ranks converted to
their ALL equivalent for reference, but nothing plots or places by it: the
conversion uses *today's* anchor mapping, so an old AREDL rank would be drawn at
a placement that list never had.

Re-running is idempotent: each level's imported rows are deleted and rewritten,
so new history lands without duplicating old entries. Native admin moves
(`source = 'all'`) are never touched.

## Handing a level back to the sheet

A level is here in one of two ways. Most are the sheet's — the importer owns the
row and renumbers it on every run. Some are the site's: promoted submissions,
AREDL promotions, hand-placed additions, carrying `permanent = 1` (the importer
skips them) or `site_only = 1` (no sheet row has their ID).

The second kind is meant to be temporary, and `sheet_exclusive_levels` has been
reporting the moment it stops being true — "the sheet describes this level and
nothing here represents it" — with nowhere to act on it. **Admin → Imports →
Levels stored here, not on the sheet** (`server/utils/sheet-handover.ts`) is that
place: it takes the sheet's data, clears both ownership flags, and drops the
sheet-exclusive record.

The sheet's number goes into `sheet_rank`, **not** `sheet_placement`. Placement
is what the slot prints and has to climb as you read down the list; writing the
sheet's 12,345 onto a level currently at position 300 would put a `#12345`
between `#299` and `#301`. Rank is the sheet's opinion of where it belongs, which
is what the next import — or "Reset to the sheet's order" — reads to actually
move it.

The reverse is deliberately not offered: turning a sheet row into a site-owned
one is what `permanent` already means, and doing it by hand would silently freeze
a level against every future import.

## Import progress

Importers take an optional `ProgressReporter` (`server/utils/imports-state.ts`)
and the admin panel renders it as a bar. Passed in rather than looked up: several
sources can import at once, and a module-level "current import" would attribute
one's progress to another. Optional everywhere, because the same importers run
standalone from the CLI where nobody is watching.

`total: null` means the phase can't count itself yet — a fetch that hasn't
returned. The bar goes indeterminate rather than inventing a percentage.

## Imported movements

Importing another list surfaces the levels the ALL is *missing* (as pending
rows). **Admin → Imported moves** is the other half: the levels both lists carry
and rank differently, in `server/utils/imported-movements.ts`.

Every pair the two lists order differently is a disagreement, which on a list
sharing 3,900 levels with the ALL is tens of thousands of pairs describing a few
dozen real problems. What the tab shows instead is the *smallest set of levels
that would have to move for the two orderings to agree* — everything outside the
**longest increasing subsequence** of ALL positions read in source-list order.
That backbone doubles as the anchor set, and each row's target is the **smallest**
move that satisfies it: land the level immediately on the far side of the anchor
it has to cross, and no further.

That replaced a midpoint interpolation, which was wrong for the case the tab
exists to serve — a level the imported list has *rearranged* since it was placed
here. If that list now puts it directly after some level and the ALL happens to
carry forty levels between that one and the next shared level, the imported list
has no opinion about those forty; dropping it in the middle of them invents a
claim it never made and moves the level further than anything asked for. Rows
carry a `confidence` (`exact` / `bracketed` / `open`) and are sorted by it, so
the ones whose new neighbours are known come first whether they moved four places
or four thousand.

- Computed on request (cached 60 s for the badge), never stored — the answer
  changes every time a level moves or a list is re-imported.
- "Keep" records a deliberate disagreement in `imported_movement_dismissals`,
  against the rank that list gives the level *now*. If the source list re-ranks
  it, the suggestion comes back.
- Applying re-derives each target immediately before moving, because every move
  shifts everything it passes and a batch of stale targets would land wrong.

The `records` table is currently empty — the sheet does not expose per-level records. The schema and right-panel UI are in place so a future submissions flow can populate them.

## Where verification URLs come from

The CSV export of a published Google Sheet strips hyperlink targets, but the internal endpoint Google Sheets' own viewer JS uses for table rendering — `https://docs.google.com/spreadsheets/d/e/{token}/pubhtml/sheet?headers=false&gid={gid}` — returns the full HTML `<table>` with anchors intact, wrapped in `https://www.google.com/url?q=...&sa=D...` redirects. The importer fetches that endpoint instead of CSV and unwraps the `q=` parameter to recover the real YouTube URL.

URLs are only recorded in the Main (Extreme Demons) tab; the lower-tier tabs don't track per-level verifications in the source sheet, so the level page falls back to a "Search YouTube" link card for those.

## Position collisions

Position numbers overlap across some tabs (e.g. Main has 1–11594, Tier 4 starts at 10001). The importer uses `INSERT OR IGNORE` so the first tab to claim a position wins — the tab order in `TABS` is set so the higher-tier ranking takes precedence on conflict (~1600 lower-tier rows are dropped this way).

## Tabs imported

| gid | label |
| --- | --- |
| 0 | Main (Extreme Demons) |
| 1036115495 | Tier 4 Demons |
| 1989779679 | Subtier 5 Harder |
| 516171001 | Subtier 4 Harder |
| 1985672631 | Subtier 3 Hard |
| 1875166663 | Subtier 1 Easy |
| 280339977 | Player Leaderboard |

Tabs are configured in `server/db/import.ts`. Add or remove rows there to change what's imported.

## Project layout

```
app.vue                                 root layout shell (delegates to layouts)
layouts/default.vue                     header + main + footer (about, leaderboard)
layouts/level.vue                       full-viewport layout for the 3-panel level page
pages/index.vue                         home — hero + list builder + latest movement
pages/lists/[public_id].vue             a saved custom list, by share token
pages/levels/[position].vue             3-panel level page (uses LevelListNav, LevelDetail, LevelRecords)
pages/changelog.vue                     full changelog, filterable by source / range
pages/leaderboard.vue                   leaderboard
pages/about.vue                         intro, FAQ, stats, demonlists used
components/SiteHeader.vue · SiteFooter.vue
components/ListBuilder.vue              drag-and-drop custom list builder
components/LevelThumbBg.vue             thumbnail backdrop for rows / heroes
components/PositionHistoryChart.vue     placement-over-time step chart (inverted Y)
components/LevelListNav.vue             left 1/5: searchable scrollable list nav
components/LevelDetail.vue              center 3/5: title, video link, tags, stats grid, metadata
components/LevelRecords.vue             right 1/5: records
composables/useListBuilder.ts           builder draft state (localStorage-backed)
server/api/levels.get.ts                paginated/searchable/difficulty-filterable list
server/api/levels/[position].get.ts     full level detail + records + placement history
server/api/custom-lists/                custom list CRUD (owner-scoped writes, public reads)
server/api/changes/recent.get.ts        changelog feed (days / limit / source)
server/api/leaderboard.get.ts           reads players table directly
server/db/index.ts                      DB connection + schema
server/db/import.ts                     Google Sheet importer (CSV per tab)
server/db/import-aredl-history.ts       AREDL placement history → converted ALL placements
```

## Deploying to Railway

The repo is set up to deploy to [Railway](https://railway.com/) directly from GitHub. Build/start commands and a healthcheck are in [`railway.json`](railway.json).

**One-time setup:**

1. Create a new project on Railway → "Deploy from GitHub repo" → pick this repo.
2. Add a **Volume** to the service:
   - Mount path: `/data`
   - Any size (a 1 GB volume is plenty — the SQLite DB after a full import is ~30 MB).
3. Add this **service variable**:
   - `LIST_DB_PATH=/data/list.db`
4. Generate a public domain on the service (Settings → Networking → Generate Domain).

**That's it.** Railway will build with `npm ci && npm run build` and start with `npm start`. On first boot the app sees an empty DB and **kicks off a background import of the Google Sheet automatically** (~2 min). The site is reachable immediately — the level list is empty until the import finishes, then it appears.

**To refresh data later** (the sheet changes; you want updated rankings):

```bash
railway run npm run import
```

This runs the importer against the production volume from your local terminal. Re-import is idempotent — it upserts on `position` so links stay stable.

**To force a fresh re-import:** delete the file at `/data/list.db` (e.g. via `railway shell`), then restart the service. The auto-import will fire again.

**Other hosts:** anywhere that runs a long-lived Node ≥ 22.5 process with a persistent disk works (Fly.io, Render, a VPS). Just point `LIST_DB_PATH` at a writable persistent path. **Do not** deploy to serverless edge — `node:sqlite` writes to a local file and won't survive ephemeral filesystems.

To swap to Postgres later: replace `server/db/index.ts` with a `pg` setup; nothing else cares which engine is behind the queries.
