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
memory and in `localStorage` (7-day TTL, capped at 4,000 keys, written behind a
1s debounce), so a level known to have no community thumbnail skips straight to
the video fallback on later renders instead of re-requesting a 404.

**Both** misses are memoised, which is newer: `lv:<gd id>` for the community
image and `yt:<video id>` for `maxresdefault`. The second matters more than it
looks. Most of this list was verified long before HD uploads were routine, so
that 404 is the common case rather than an edge one, and every large thumbnail
whose level has no community image was paying for it on every render of every
page. One request ever, now.

`sizes` is worth getting right at each call site, since it is what the browser
actually measures against. A showcase card 350 px wide asking for `100vw` is
told to fetch a full-width image for a third of the screen — which is what the
profile and account cards were doing with a `620px` claim and a `high` ceiling.

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
resolved from `levels` at read time, so a saved list follows the main list) or is
fully hand-entered (`level_id` NULL, client values kept). Guests build against
`localStorage`; saving requires an account and mints a random `public_id` used
for share URLs.

### A list is allowed to disagree with the ALL

`custom_list_items.ov_name` / `ov_creator` / `ov_difficulty` / `ov_gddl_tier` /
`ov_verification_url` are the list's own answers, read in preference to the
mirrored columns and never touched by a full save. NULL — the default, and what
every pre-existing row has — means "follow the main list".

They exist because "the ALL has the wrong video for this level" and "our
community verifies this differently" are real, and a linked row previously had
no way to say either: the fields were read-only, because a full save re-reads
them from `levels` and an edit would have looked like it worked and then
silently reverted.

`PATCH /api/custom-lists/:id/items/:item_id` routes a level field to its `ov_`
column on a linked row and to the column itself on a hand-entered one. A value
equal to what the ALL currently says **clears** the override rather than pinning
it — otherwise opening the editor and pressing Save would quietly freeze the row
against the main list forever. Unlinking folds any overrides down into the row's
own fields, since "override the ALL" stops meaning anything once the row no
longer points at it.

`loadList` returns the effective value under the ordinary key, the mirrored one
as `all_*`, and the raw override as `ov_*`, so the editor can show both answers
and offer to go back to the ALL's.

### Rank badge colours

`utils/custom-list-colors.ts`. By default a custom list marks itself against the
ALL: rows the main list carries take their tier's colour and the rest go grey,
which is right for a list read alongside it. `custom_lists.mark_off_all = 0`
switches to a scaled ramp — a row with no tier is coloured by the tier it *would*
have, interpolated from the rows around it that do (the same estimator the
placement guess uses), and a list with no tier information anywhere falls back to
a ramp across its own length. It never invents a tier *label*, only a colour.
The same setting hides the "On the ALL list" row on each level page.

### The list's own colour

`custom_lists.accent_color` is one hex, and `listAccentStyle` turns it into
`--c-accent` on the list's root element. Tailwind resolves `accent` through that
variable, so setting it re-themes every `text-accent` / `bg-accent` inside —
tabs, rank numbers, links, the like button — and nothing outside. Only a hex
literal is ever stored or applied, at both ends: the value lands in a style
attribute, so anything else is an injection vector rather than a colour.

It has to be applied by *both* list roots. It was on the level view only, so a
list with a colour reverted to the site's amber the moment you opened its
leaderboard — which reads as the colour not having saved. One helper, used by
`[[rank]].vue`, `CustomListShell` and the gallery card.

### Standalone links

`?standalone=1` on any custom-list URL drops the site header and footer, promotes
the list's own bar to being the page header, and leaves one button back to the
ALL. `composables/useStandaloneList.ts` owns it; every in-list link is built
through its `to()` so the flag survives navigation within the list, and links
that leave the list deliberately don't carry it. It's a property of how someone
arrived rather than a setting on the list, so the same list opened from the
gallery is still an ordinary page of this site.

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
**Packs**, **Submit Level**, **Submit Record**, and a **Queue** the owner
moderates. The two submission tabs are named for what they take: they were
"Suggest" and "Submit", sat next to each other, and the shorter word was the one
for levels. The routes keep their original names (`/suggest`, `/submit`) so
links already shared still resolve.

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
body, not-found and loading states) so each is just its own content. Anything
the bar shows has to be passed by *both* that shell and the list view, or it
appears on one tab and vanishes on the next — which is what happened to the
editor roster: present on the level view, absent everywhere else, reading as a
list that had lost its staff.

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

### One move is one changelog entry

A move shifts every level it passes, and the list has to be told which of those
levels *moved* and which merely got out of the way. This has been wrong twice,
in the same place, for two different reasons.

Absolute position was the first answer and is useless: inserting one level at
the top changes every position below it, so a single new level would write
54,000 changelog entries. Rank *among the levels that were already on the list*
fixed that — insertions and removals leave it untouched.

But rank among survivors still changes for everything a moved level passes.
Promote one from #500 to #100 and its rank drops 400 while each of the 400 it
overtook gains one, so a single promotion wrote 401 entries: one up, four
hundred down. Nobody moved those four hundred levels.

The real question is which levels moved *relative to each other*, and the answer
is everything outside the **longest increasing subsequence** of the new order
read in the old order's sequence (`utils/lis.ts`, shared with imported
movements, which asks the same question of two different lists). That
subsequence is the largest group still in agreement — the list's backbone — and
what is left is the smallest set of movements that explains the difference. For
the promotion above it is one entry.

`survivorsThatMoved` is that decision with no database in it, so it can be
checked against a made-up before and after directly.

Manual moves never had the problem: `moveLevel` writes one history row for the
level it moved and nothing for the range it shifted. This was only ever the
sheet importer, which sees a whole new ordering and has to work out what changed.

### The tier goes with the slot

`server/utils/move-level.ts` rewrites the moved level's `gddl_tier` to whatever
its new neighbours are in. The list is ordered by difficulty, so the slot
already carries a tier — a level dragged from #40,000 to #1,500 has been judged
that much harder, and keeping the label it had at #40,000 contradicts the
position it was just given.

`tierForSlot` reads the nearest tiered level either side, ignoring the level
being moved. Both are consulted rather than one, because a slot between two
different tiers is a genuine boundary; there the nearer neighbour wins, and a
tie goes to the one *above* — the band the level was placed into. A slot with no
tiered level anywhere returns null and nothing is written.

Both move tools show the change before it happens (`PlacementEditor` computes
it live from the rows already on screen, mirroring the server rule) and offer
`keep_tier` for the deliberate outlier. Group moves do the same thing per level.
Restores and "reset to the sheet's order" do **not** — those are undoing moves,
and applying the destination's tier is exactly what they exist to reverse, which
is why placement snapshots carry `gddl_tier` too.

Custom lists have the equivalent, scoped to the list: editors toggle reorder
mode in the list nav and drag rows or type a rank, and each level page has an
inline editor. Those go through `POST /api/custom-lists/:id/move` and
`PATCH|DELETE /api/custom-lists/:id/items/:item_id`, which move or edit one row
and log one changelog entry — the builder's full `PATCH` reconciles every row
and is far more machinery than a single drag needs.

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

The wording lives in `utils/lockdown.ts` and is used by all four places that say
it — the closed page, the login form, the API's 403 and the signup refusal.
Four hand-written copies of the same sentence had already drifted into
disagreeing about who can get in and when it opens.

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

## Clans

Groups of players, ranked by what they have beaten between them
(`server/utils/clans.ts`). A clan stores **nothing** about completions: every
figure is read through `clan_members` into `records` at the moment you ask, so
a member joining lifts their clan's standing immediately and leaving takes it
with them, with no stored total to fall out of step.

The three numbers mean different things and the difference is the interesting
part:

- **levels** — `COUNT(DISTINCT r.level_id)`, the amount of the list the clan
  covers between them.
- **completions** — every member's records added up; two members with the same
  level is two completions and one level.
- **points** — each level counted **once**, however many members hold it. A
  clan climbs by covering more of the list, not by stacking the same level.

The completions list is one row per *level* with the members who have it, which
is what a group's list of completions means; `GROUP_CONCAT` keeps it to one
query rather than one per level.

Membership is one clan per account, enforced by the primary key on
`clan_members.account_id`. An owner can't walk out of a clan that still has
people in it — they hand it over first — and the last member leaving disbands
it, because a clan with nobody in it is a row nobody can join or delete.

## Counting how much the site is read

Two numbers are worth having — how many pages were opened, and how many people
opened them — and the whole of `server/utils/analytics.ts` exists to produce
those two and nothing else. There is no per-request row, no address stored and
no account attached to a view, so there is nothing to drill into and the admin
tab says so rather than implying a detail it deliberately doesn't keep.

Three tables:

| table | one row per | holds |
|---|---|---|
| `page_views` | path *shape* per day | views |
| `visit_uniques` | visitor per day | nothing but an opaque hash |
| `level_views` / `profile_views` | level / account | a running total |

**Path shapes, not paths.** `/levels/4021` and `/levels/9` both count as
`/levels/:position`; keeping them apart would add a row per level per day for no
benefit, and would let a crawler inventing URLs grow the table without bound
(everything unrecognised collapses to `/other`). Per-level numbers are counted
separately against the level's **id** — a position moves the moment anything is
placed above it, so counting by position would follow the slot rather than the
level. Same reasoning for profiles and account ids.

**The visitor hash** is `sha256(day | per-install salt | address | user agent)`
truncated to 16 characters. The day is part of the input, so the same person
tomorrow is a different value and nothing here can follow anyone across days;
the salt lives in `site_meta` rather than in memory, because a restart would
otherwise re-salt everything and count every returning reader as new. It is
deliberately weak as an identifier and adequate as a counter. `visit_uniques` is
the only table with a row per person, so it is the only one that is pruned (400
days); the counts themselves are never dropped.

**Both halves of a visit.** The server middleware sees document requests — the
first page of a visit and a refresh — and nothing after it, because Nuxt renders
every subsequent page in the browser without asking the server for one. Reading
the middleware alone would report the first page of each visit as the whole
visit, so `plugins/analytics.client.ts` reports the rest, and `POST
/api/analytics/view` counts them exactly the same way. Bots that say what they
are, prefetches, and the server's own internal fetches are all skipped.

## Countries

`accounts.country` holds an **ISO 3166-1 alpha-2 code** — `US`, not "United
States" and not "usa". It was a text box, which is fine until you want to draw a
flag next to it or count how many players are from one place.

`utils/countries.ts` lists only the codes; the names come from
`Intl.DisplayNames`, so there are no 250 hand-typed strings to misspell and they
are not stuck in English forever. The list itself was generated by asking ICU
which two-letter codes it resolves and subtracting the deprecated and reserved
ones it still answers for — `SU` for the Soviet Union, `UK` which has never been
the code for the United Kingdom, the `XA`/`XB` testing codes. `XK` is kept
although it is user-assigned: Kosovo is where some players are from.

Reads go through `normalizeCountry`, which accepts a code *or* an English name,
so a "United States" typed while this was free text becomes `US` rather than
vanishing from the profile. The write path refuses anything that resolves to
neither, rather than storing it or silently clearing the field.

Flags are **images** (`flagcdn.com`), not emoji. Emoji flags are pairs of
regional-indicator letters and Windows ships no glyphs for them, so every flag
on the site would render as two boxed letters for a large share of readers. A
20-pixel PNG costs one cached request and looks the same everywhere.

## Profiles

`/users/:name` and `/account` are the same profile: one is read-only and the
other has the form under it. They are drawn by the same components —
`ProfileHeader`, `ProfileShowcase`, `ProfileSocialLinks` — because they were
two hand-written copies of the same markup that were *meant* to be identical
and weren't. The account page had lost the country flag, the banner level link,
the level points on a showcase card and half the social chips, and every
decoration added since had to be remembered in two places.

The account page passes the *form's* values to the header rather than the saved
row's, so choosing a country or pasting a Twitch link shows up in the thing you
are editing instead of after you press Save.

Social links are columns rather than a free list, because each is validated
against the host it claims to be — a parsed host, not a substring, since
`https://evil.example/twitch.tv` contains the string and is not Twitch. That
check is what stops a profile pointing anywhere it likes under a trusted-looking
icon. `utils/social-links.ts` is one table of service, field, placeholder, host
list, icon and handle-extractor, so the settings form and the profile can't end
up knowing about different sets of them.

## Roles, and the badges for them

`utils/role-styles.ts` holds every role the site draws — the four site ones
(owner, developer, admin, moderator) and the two a person can hold on a custom
list — with its label, its colour and a sentence saying what it *is*. That last
one is not decoration: a visitor has no way to know whether "developer" outranks
"moderator", and the badge is the only place the site ever says.

`components/RoleBadge.vue` is the chip. There were seven copies of it — the
leaderboard, both follow lists, the admin user table, both profile headers, the
name component and the list roster — at three text sizes and four paddings, so
the same badge was a different shape depending on where you met it.

Two rules worth keeping:

- **`user` renders nothing.** Every call site was already guarding on
  `role !== 'user'`, and a badge reading "User" on a site where everyone is one
  carries no information. The admin user table is the deliberate exception: it
  is a *column* of roles, where a blank cell reads as missing data.
- **No site role may use `accent`.** Owner used `amber-500` and admin used
  `accent`, and the site's accent *is* `amber-500` — so the two most
  consequential roles were the same colour. Admin is violet now. The deeper
  reason is that every custom-list page sets `--c-accent` to that list's colour:
  a site badge painted with it would change colour depending on which page it
  was printed on. The one badge that *should* is the list's own owner, which is
  why `list-owner` keeps it.

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
records   (level_id, player_id, percent, hz, video, verified,
           claim_source, claim_account_id)
accounts  (username, role, claimed_player, claimed_aredl_uuid, claimed_gdl_id,
           claimed_pointercrate_id, bio, pronouns, discord_handle, youtube_url,
           gd_username, favorite_level_id, hardest_record_id, banner_choice)
```

`position` is the global rank in the sheet. URLs are keyed on `position` so re-imports don't break links.

`accounts.gd_username` is the in-game name, stored bare rather than as a URL: it
is an identity, not a link, and the gdbrowser address is derived from it.
`utils/gd-links.ts` owns both that and the level links — one place, because a
level ID should go to the same destination from every one of the eight or so
spots that render one, and two of them used to go nowhere at all.

## The challenges sheet (ACS)

`server/db/import-acs.ts` reads the project's own **ALL CHALLENGES LIST**
sheet, the only Google Sheet the site reads besides the main one. `ACS` is
registered in `utils/challenge-sources.ts`, so a level promoted from it is
classified as a challenge by placement source alone. It shipped for one version
as `ccpl` — the wrong name twice over, since CCPL is already a different list on
that same list of sources; `server/db/index.ts` renames the table, the columns
and the stored `placement_source` in place.

Two things about the sheet shape the importer:

**The tabs disagree with themselves.** EXTREME CHALLENGES puts the name at
column 2, the level ID at 6 and the placement at 23; INSANE CHALLENGES puts them
at 1, 5 and 15. Worse, EXTREME's header row labels only *some* of its columns —
the ID and placement sit under blank ones. So labelled columns are found by name
and those two are found by **shape**: a level ID column is overwhelmingly 5–11
digit integers, and the placement column is the one whose values best match 1,
2, 3, … Both are printed on every run, so a layout change shows up as a
different mapping in the log rather than as silently empty data.

**Over half the rows have no level ID** (520 of 940). `gd_id` therefore can't be
the key or a requirement; `acs_levels` is keyed on `(tab, position)`.

### The verification videos are hyperlinks, so the sheet is read twice

Each level's video is the **link on its name**, not a cell. No text export of a
Google Sheet carries a hyperlink — not `gviz` CSV, not TSV, not the JSON
endpoint — and `pubhtml` needs the document to be published, which this one
isn't. The workbook export does carry them, so the importer fetches
`export?format=xlsx` as well and reads the links off the name column with
`server/utils/xlsx.ts`: a zip reader and three regexes, no dependency.

The two exports are joined on **row number and cell text**. Row number alone is
a guess that happens to be right until someone inserts a row between the two
requests; so the workbook's own text for that cell comes back with the link, and
a URL is only taken when it matches the name the CSV already read. A mismatch
costs one video — the last run reported exactly that, `928 verification videos
from linked names (1 skipped)` — where a wrong match would credit a level with
someone else's verification.

Two things in that reader are worth not re-deriving. Cell values arrive three
ways (shared-string index, inline string, literal) and a level name can be any
of them. And the attribute run in `<c …>` must be matched **lazily**: greedy, it
eats the `/` of a self-closing `<c r="D5"/>`, matches the `>` branch instead, and
swallows every cell up to the next `</c>` — which on this sheet meant every
level name, since each is preceded by an empty spacer column.

Rows are upserted and stale ones removed afterwards by `fetched_at`, *not*
cleared first. `pending_levels.from_acs_id` points at these ids: wiping the
table gave every surviving row a new id, the pending rows' conflict target
stopped matching, and a second import queued all 262 of them a second time.
Three consecutive runs now hold at 940 rows / 258 merged / 262 pending.

### Every importer needs a marker in both branches

`/api/admin/levels/pending` splits one table into two queues: `gdl_import` is
"came from an importer", `submitted` is everything else. Both are built from the
same list of marker columns, in one place, because they are complements — when
ACS was missing from it, its 262 rows vanished from the imported queue *and*
turned up in the user-submissions queue, since "not from any importer" is how
that side is defined.

## What makes the list page fast

`/api/levels` answers a page of the list in **6 ms**. It used to take 131 ms,
and the difference was one line: it rebuilt the *entire* challenge ranking on
every request — a scan of all 54,000 levels evaluating the challenge expression
per row, sorted — to attach a rank to the fifty rows being returned.

`server/utils/challenge-rank.ts` caches that map against a stamp built from the
list's shape (row count, newest id, highest position). Anything that adds,
removes or renumbers a level moves the stamp, so the map can't outlive the list
it describes. Marking a level as a challenge by hand changes the *ranking*
without changing the shape, so that one endpoint drops the cache itself.

The other cost was self-inflicted and worth recording. `challengeSourceSqlExpr`
was rewritten to support multi-source values (`AREDL|ACS`) as eleven
`REPLACE(UPPER(…)) LIKE` tests per row — **126 ms per evaluation** against 9.8 ms
for the `IN` it replaced, and it runs twice per request plus once inside the
effective-rating CASE. It now tries the single-source `IN` first and only falls
through to the LIKE chain for values that actually contain a pipe: 10.6 ms, and
a test drives both forms over the same rows to prove they still answer
identically. That test caught a real difference on the first run — the slow form
tolerated `" ACS "` with stray spaces and the fast one didn't, so the fast path
trims.

Both numbers above are measured on the real list, not estimated.

## Challenges, and marking one either way

Whether a level is a challenge is **inferred** three ways — see
`server/utils/challenge-expr.ts`, which is the single definition all of them
share. It appeared in five places across four files before that, each with its
own table aliases, and the copy in `/api/stats` had already lost the "Tier 1+"
clause the others carry.

Two columns override those rules: `levels.not_challenge` takes a level off the
challenge list and `levels.force_challenge` puts one on. Both directions are
needed because the third rule is a heuristic — unrated, zero score, Tiny or
Short, tiered — which catches ordinary levels by accident *and* misses any
challenge that doesn't fit the shape. `not_challenge` wins a contradiction; the
one endpoint that writes them writes both every time, so a contradiction never
arises from the UI.

They have their own endpoint rather than a field on the metadata PATCH, because
that endpoint refuses any level that isn't `permanent` — correct for sheet-owned
metadata the next import would overwrite, wrong for an editorial decision no
importer touches. Routing them there would have forced an admin to freeze a
level against all future imports just to correct which list it appears on.

Marking deliberately does **not** go through `rated = 'Challenge'`, which is the
obvious-looking way to do it. That column is imported from the sheet, and
`applyRatedFromSheet` clears any 'Challenge' the sheet doesn't also say, so an
admin's decision would have held until the next import and then quietly undone
itself.

Two traps worth knowing:

- `rated = 'Challenge'` is a **pin**, not a rating. It is an *input* to the
  expression above, so the "fall back to the stored rating" branch has to
  exclude it — otherwise an unmarked level's stored word comes back as the
  answer and it stays on the challenge list, in the filters and in the stats,
  which is exactly what happened.
- The client must not re-derive any of this. `LevelDetail` had its own copy of
  the first three rules for the rating tile and the chip beside the title, knew
  about neither override, and so contradicted the list it was describing. The
  server sends `challenge_rank`, computed with the one expression; that is the
  answer.

## Where else a level is ranked

`server/utils/other-lists.ts` answers "what else carries this level, and at what
number". Four lists have a dedicated column on `levels` — GDL, AREDL,
Pointercrate and the Challenge List — and everything imported through
GDListTemplate (CCL, EDI, TSL, …) lives in `gdtpl_levels` keyed by `gd_id`. Only
the first four were ever surfaced, so the rest were present in the database and
invisible on the page.

The order is deliberate and is the order the badges appear in: GDL and AREDL
first, because those are the two lists a reader of the ALL is most likely to be
cross-referencing, then Pointercrate, then the challenge lists. The level page
shows the first two beside the title, a `+N` chip when there are more, and the
whole set in "Rankings on other lists" — a level carried by six lists would
otherwise push its tier and difficulty off the row they share.

The badges are two-tone (list name, then the number) rather than plain chips:
they say two things at once, and a single-tone pill made `AREDL #4` read as one
opaque token beside `Extreme Demon`. Short names are `badge`, full ones `list`;
the Challenge List's is **CH**, not CL, because the chip it most often sits
beside is CCL and one character of difference doesn't read at a glance.

The Challenge List is read from `levels.challenge_list_position` and excluded
from the `gdtpl_levels` query, because the CL importer writes both and the
column is the cleaned one. Miss that and the level is listed twice.

The **ACS is deliberately not here**, though `levels.acs_position` is imported
and used everywhere else. This panel answers "where else is this level ranked",
and the ACS is not somewhere else: it is this project's own working sheet, where
challenges are staged before they land on the ALL. Listing it beside GDL and
AREDL presented the ALL citing itself as an independent second opinion.

Measured over the whole list: 3,041 levels are on exactly one other list, 952 on
two, 146 on three — including 206 that two GDListTemplate lists both carry
(`CCL #2 · SFL #1`, `EDI #711 · TSL #1`). The panel's existing rule that a
GDL/AREDL rank only shows on an Extreme Demon suppresses nothing in practice,
which is worth knowing before anyone removes it.

## Tiers

`utils/tier-ordinal.ts` owns the scale. Subtier 0–5 then Tier 1–`TIER_MAX_NUMBER`
map onto one continuous ordinal 0–`TIER_MAX_ORD`, which is what sliders,
estimates and medians work in. The ceiling is a constant: every tier dropdown,
filter slider, colour and point value is derived from it, so raising it is a
one-line change plus colours and point values for the new tiers.

`tierToOrd` **parses** — it reads whatever a mirror or a spreadsheet cell
offers, and returns null for anything off the scale (`Subtier 6` especially: 6 is
Tier 1's ordinal, so a lenient parse would silently call it that). `isValidTier`
**guards writes** and is stricter still: it requires the canonical spelling,
because `tier 3 ` in the database is a value no `gddl_tier = 'Tier 3'` filter,
sort or group-by ever matches again.

The sheet's own palette stops at Tier 40. Tiers 41–45 are this site's; they
bottom out once more and then climb back through deep blue, because the red→black
ramp has already run out of darkness and five more shades of black would be five
tiers nobody could tell apart.

### The tier curve

Tier is a function of *where a level lands*, and that function is nowhere near a
straight line. Measured off the real list:

| Tier | Median placement | Tier | Median placement |
| --- | --- | --- | --- |
| 40 | #2 | 25 | #3,234 |
| 35 | #281 | 20 | #7,011 |
| 30 | #1,690 | 10 | #10,025 |
| | | 1 | #17,620 |

The top five tiers fit inside 300 placements; the bottom fifteen share ten
thousand. Estimates used to space rows evenly between their anchors, so a custom
list anchored at #50 (Tier 37) and #30,000 (Tier 1) gave the row halfway between
them Tier 18 — the placement halfway between them is #15,000, where the list has
Tier 1. Measured against the real curve, the worst row in that gap was **13
tiers** out and the average was 4.6.

`server/utils/tier-curve.ts` reads the curve out of the database — one point per
tier at that tier's median placement — and `estimateAt` uses it as the *shape* of
the interpolation while the anchors stay the endpoints. A list that sits
systematically harder or easier than the ALL therefore keeps its offset instead
of being flattened onto the ALL's numbers. Worst case is now 2 tiers, mean 0.89.

It is measured rather than assumed for both the obvious reasons: no closed form
was going to fit that shape, and it moves as the list grows. Tiers with fewer
than five levels are dropped (two levels say more about those two than about the
tier), and points that don't descend are dropped too — interpolating across one
produces an estimate that gets *harder* further down the list.

`/api/levels/tier-curve` serves it to the browser, cached both ends; the
importers read it straight from the database. Absent, every caller falls back to
the old row-spaced answer rather than to no answer.

That fallback is also how the two sides drifted apart. `useTierCurve` used to
copy the fetch into `useState` from a `{ immediate: true }` watcher — which runs
during setup, before the fetch resolves, and does not run again inside SSR's
single render pass. So the server rendered every estimate on every custom-list
page with an *empty* curve while the importers, reading the same numbers out of
the database, used the real one: one formula, two answers, decided by which side
of the wire it ran on. On a list anchored at #50 and #30,000 the row in the wide
gap came out **Tier 11 instead of Tier 1**.

It is a `computed` over the fetch now, so the value is in the server-rendered
payload. A page that *snapshots* an estimate into an editable field — `to-all`
builds one draft per level — must additionally `await` the curve, because a
snapshot is taken once and keeps whatever the curve said at that instant;
`useTierCurve().ready` is that promise. Anything that merely *reads* the curve in
a `computed` needs nothing.

## Records a claim brings with it

Claiming an AREDL, GDL or Pointercrate player copies that player's mirrored
records onto the account's ALL profile (`server/utils/claim-records.ts`). The
site already knew everything the player had beaten and showed the profile as
empty anyway, because a record only counts here as a row in `records` under your
name.

They are marked, not merged: `claim_source` says which claim produced a row and
`claim_account_id` says whose, so releasing the claim takes back exactly what the
claim gave. Records submitted here by hand are untouched, and so is the mirror —
"removed from your profile but they still exist" has to mean the AREDL record
survives, because it was never ours to delete.

A GD id that resolves to more than one ALL level (Solo/2P, Old/Unnerfed) is
skipped rather than guessed at: a record filed against the wrong variant is worse
than a missing one. Adoption is idempotent, so `POST /api/account/claim/records`
doubles as a refresh when the mirror picks up new completions.

`server/utils/unclaim.ts` is the release, shared between the account owner's own
button and the admin one — they differ only in who is allowed to ask. It clears
the account column, frees the mirrored player's back-reference, and deletes the
claim's records; leaving any one of those would refuse the next claim of that
player with a row nobody can see.

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
- Which lists appear comes from `LIST_SOURCES`, but the rows come from
  `sharedWithAll`, and a source in the first without a branch in the second is
  simply absent from the tab with nothing to say so. That is what had happened to
  the ACS: 258 levels shared with the ALL, 93 of them ordered differently, and no
  way to see any of it. Its branch reads the ranked tab only — the importer parks
  unranked rows past 100,000, and a parked row has no ordering to disagree with.
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
server/utils/xlsx.ts                    minimal .xlsx reader — hyperlinks a CSV export drops
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
