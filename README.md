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
  - `/changelog` — placements and movements, filterable by source (native vs imported AREDL history)
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

Keeping URLs on `position` means links survive a re-import even when the
curators renumber the sheet. `server/utils/changes.ts` maps historical
positions through to placements so the changelog speaks the same numbering as
the rest of the site.

## Level thumbnails

Level rows and the level-page hero use community thumbnails from the
[Level Thumbnails API](https://levelthumbs.prevter.me/swagger/), keyed on the
level's GD ID: `GET /thumbnail/{gd_id}/{high|medium|small}`. `components/LevelThumbBg.vue`
renders one as an absolutely-positioned backdrop and stays invisible until the
image actually loads, so the ~30% of levels with no thumbnail (the API 404s)
fall back to the plain background with no flash. List rows request `small`,
the level-page hero requests `high`.

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

## Submitting from a Geometry Dash search

`/levels/find` searches GD by name or ID through `GET /api/gd/search`, which
proxies gdbrowser's search endpoint — the same source `server/utils/gd-fetch.ts`
uses for per-level info. Results are annotated with whether the level is
already ranked, so the page offers "submit a record" for levels on the list and
"submit to the list" for levels that aren't, prefilling `/levels/submit` with
the ID and name.

## Moving levels

Moderators can move a level numerically, or open **Actions → Drag to place**
for a drag-and-drop editor (`components/PlacementEditor.vue`). It loads a
window of the list around the level via `/api/levels?fromPosition=…`, reorders
a local copy as you drag, and only writes when you hit Apply — which issues the
same single `POST /api/admin/levels/:position/move` the numeric control uses.

## Setup

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
from `api.aredl.net/v2`. It writes two tables:

- `aredl_position_history` — the complete raw trace, including the passive ±1
  shifts a level absorbs when *other* levels are placed or removed. ~190k rows.
  This is what the placement-over-time graph on the level page plots.
- `position_history` with `source = 'aredl'` — only the level's own moves
  (`Placed` / `MovedUp` / `MovedDown`), so the changelog shows deliberate
  placements rather than thousands of knock-on shifts. ~1.8k rows.

AREDL positions are converted to their equivalent **ALL** placements by linear
interpolation between the nearest anchors, where an anchor is any level whose
current AREDL *and* ALL positions we both know. The original AREDL numbers are
kept in `raw_from_position` / `raw_to_position`, which is what the "AREDL" badge
tooltip in the changelog shows.

Re-running is idempotent: each level's imported rows are deleted and rewritten,
so new history lands without duplicating old entries. Native admin moves
(`source = 'all'`) are never touched. The daily Discord digest filters to
`source = 'all'` so a backfill can't flood it.

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
