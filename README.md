This project was vibecoded

# All Levels List
Pubert
An AREDL-style ranking site for the **All Levels List** — tens of thousands of levels pulled directly from the project's published Google Sheet. Inspired by [aredl.net](https://aredl.net) and the [All-Rated-Extreme-Demon-List](https://github.com/All-Rated-Extreme-Demon-List) project lineage.

- **Stack:** Nuxt 3 (Vue 3, server routes) · SQLite via Node's built-in `node:sqlite` (requires Node ≥ 22.5) · Tailwind CSS
- **Data source:** the published-to-the-web All Levels List Google Sheet, fetched as CSV per tab
- **Pages:**
  - `/levels/:position` — AREDL-style 3-panel layout (list nav · level details · records)
  - `/leaderboard` — players from the sheet's leaderboard tab
  - `/about`

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
pages/index.vue                         redirects → /levels/1
pages/levels/[position].vue             3-panel level page (uses LevelListNav, LevelDetail, LevelRecords)
pages/leaderboard.vue                   leaderboard
pages/about.vue                         about
components/SiteHeader.vue · SiteFooter.vue
components/LevelListNav.vue             left 1/5: searchable scrollable list nav
components/LevelDetail.vue              center 3/5: title, video link, tags, stats grid, metadata
components/LevelRecords.vue             right 1/5: records (empty for now)
server/api/levels.get.ts                paginated/searchable/difficulty-filterable list
server/api/levels/[position].get.ts     full level detail + its records
server/api/leaderboard.get.ts           reads players table directly
server/db/index.ts                      DB connection + schema
server/db/import.ts                     Google Sheet importer (CSV per tab)
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
