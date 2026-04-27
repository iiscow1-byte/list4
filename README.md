# All Levels List

An AREDL-style ranking site built for **tens of thousands of levels** instead of just extreme demons. Inspired by [aredl.net](https://aredl.net) and the [All-Rated-Extreme-Demon-List](https://github.com/All-Rated-Extreme-Demon-List) project lineage.

- **Stack:** Nuxt 3 (Vue 3, server routes) · SQLite via Node's built-in `node:sqlite` (requires Node 22.5+) · Tailwind CSS
- **Pages:** List · Leaderboard · About
- **API:** `GET /api/levels` (paginated, searchable) · `GET /api/levels/:id` · `GET /api/leaderboard`

## Setup

```bash
npm install
npm run seed     # populates data/list.db with ~500 demo levels + ~120 players
npm run dev      # http://localhost:3000
```

The first time the dev server hits the DB it will create `data/list.db` with the schema if it doesn't exist. The seed script is idempotent — it will refuse to re-seed an existing database. Delete `data/list.db` to start fresh.

## Schema

```
levels    (id, position, name, creator, verifier, verification, song, gd_id, min_percent, tags)
players   (id, name, country)
records   (id, level_id, player_id, percent, hz, video, verified)
```

`position` is the level's rank (1 = top of the list). The points curve is in `server/db/index.ts` (`pointsForPosition`) — tweak `head`, `tail`, and `legacyAt` there.

## Importing real data

For 60k+ levels, write a one-shot import script that calls `getDb()` and bulk-inserts. Wrap inserts in a single `db.transaction(() => { ... })` — SQLite handles 60k rows in a transaction in well under a second. Example:

```ts
// server/db/import.ts
import { getDb } from './index.ts'
import { readFileSync } from 'node:fs'

const db = getDb()
const data = JSON.parse(readFileSync('./your-export.json', 'utf8'))
const insert = db.prepare(`INSERT INTO levels (...) VALUES (...)`)
db.transaction(() => { for (const l of data) insert.run(l) })()
```

## Deploying

The default Nitro preset works on any long-running Node host (VPS, Fly.io, Railway, Render). **Don't deploy to a serverless edge target without changing the storage layer** — `better-sqlite3` writes to a local file and won't work on read-only or per-request filesystems.

To swap to Postgres later: replace `server/db/index.ts` with a `pg`/Drizzle setup; nothing else in the API or UI cares which engine is behind the queries.

## Project layout

```
app.vue                       root layout
pages/                        index (List), leaderboard, about
components/                   SiteHeader, SiteFooter
server/api/                   levels.get.ts, levels/[id].get.ts, leaderboard.get.ts
server/db/index.ts            DB connection, schema, points curve
server/db/seed.ts             demo seed data
assets/css/main.css           Tailwind base + small component classes
```
