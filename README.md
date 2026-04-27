# All Levels List

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

## Sheet limitations

The CSV export from Google Sheets exposes display text but **not** hyperlink targets. The "Verification Link" column on the sheet is rendered in Sheets as clickable text; in CSV it's just the link's title. The level page therefore shows the verification title and a "Search YouTube" button rather than embedding the video. Recovering real video URLs would require either a Sheets API credential or scraping the JS-rendered `pubhtml` view.

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

## Deploying

The default Nitro preset works on any long-running Node host (VPS, Fly.io, Railway, Render). **Do not deploy to a serverless edge target without changing the storage layer** — `node:sqlite` writes to a local file and won't work on read-only or per-request filesystems.

To swap to Postgres: replace `server/db/index.ts` with a `pg` setup; nothing else cares which engine is behind the queries.
