import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const DB_PATH = process.env.LIST_DB_PATH || resolve(process.cwd(), 'data', 'list.db')

/**
 * Where the database lives, for the things that need to write next to it —
 * the automatic snapshot taken before a placement restore, most of all. Derived
 * rather than assumed, so a deployment pointing `LIST_DB_PATH` elsewhere keeps
 * its backups with its data instead of in whatever directory it was started in.
 */
export function dataDir(): string {
  return dirname(DB_PATH)
}

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (_db) return _db
  if (!existsSync(dirname(DB_PATH))) mkdirSync(dirname(DB_PATH), { recursive: true })
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  initSchema(db)
  _db = db
  return db
}

function initSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS levels (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      position          INTEGER NOT NULL UNIQUE,
      name              TEXT    NOT NULL,
      gd_id             INTEGER,
      gddl_tier         TEXT,
      rated             TEXT,
      difficulty        TEXT,
      placement_source  TEXT,
      points            REAL,
      main_skillset     TEXT,
      verify_date       TEXT,
      verification      TEXT,
      verification_url  TEXT,
      pov_placement     INTEGER,
      year_verified     INTEGER,
      category          TEXT NOT NULL DEFAULT 'classic',
      source_tab        TEXT,
      creator           TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_levels_name      ON levels(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_levels_position  ON levels(position);
    CREATE INDEX IF NOT EXISTS idx_levels_category  ON levels(category);
    CREATE INDEX IF NOT EXISTS idx_levels_difficulty ON levels(difficulty);
    -- idx_levels_creator is created in the migration block below, so it works
    -- on existing DBs that predate the creator column.

    CREATE TABLE IF NOT EXISTS players (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      country   TEXT,
      total_points REAL  NOT NULL DEFAULT 0,
      skill_points REAL  NOT NULL DEFAULT 0,
      hardest      TEXT,
      tier         TEXT
    );

    CREATE TABLE IF NOT EXISTS records (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      level_id        INTEGER NOT NULL REFERENCES levels(id)  ON DELETE CASCADE,
      player_id       INTEGER REFERENCES players(id)          ON DELETE SET NULL,
      player_name     TEXT    NOT NULL,
      percent         INTEGER NOT NULL DEFAULT 100,
      hz              INTEGER,
      video           TEXT,
      permanent       INTEGER NOT NULL DEFAULT 0,
      submitted_by    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      submitter_note  TEXT,
      submitted_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      decided_at      TEXT,
      decided_by      INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      is_verification_claim INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      username        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash   TEXT    NOT NULL,
      password_salt   TEXT    NOT NULL,
      role            TEXT    NOT NULL DEFAULT 'user' CHECK(role IN ('user','moderator','admin','owner','developer')),
      bio             TEXT,
      avatar_blob     BLOB,
      avatar_type     TEXT,
      country         TEXT,
      subdivision     TEXT,
      claimed_player  TEXT    COLLATE NOCASE,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_player ON accounts(claimed_player) WHERE claimed_player IS NOT NULL;

    CREATE TABLE IF NOT EXISTS sessions (
      token       TEXT    PRIMARY KEY,
      account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at  TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);

    CREATE TABLE IF NOT EXISTS claim_requests (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      player_name   TEXT    NOT NULL,
      status        TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      decided_at    TEXT,
      decided_by    INTEGER REFERENCES accounts(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_claims_account ON claim_requests(account_id);
    CREATE INDEX IF NOT EXISTS idx_claims_status  ON claim_requests(status);
  `)

  // Migrations: add columns to existing `levels` tables that predate them.
  // Each guarded by PRAGMA so re-runs are no-ops on already-migrated DBs.
  const cols = db.prepare(`PRAGMA table_info(levels)`).all() as { name: string }[]
  const has = (n: string) => cols.some((c) => c.name === n)
  if (!has('creator'))   db.exec(`ALTER TABLE levels ADD COLUMN creator TEXT`)
  if (!has('permanent')) db.exec(`ALTER TABLE levels ADD COLUMN permanent INTEGER NOT NULL DEFAULT 0`)
  if (!has('verifier'))  db.exec(`ALTER TABLE levels ADD COLUMN verifier TEXT`)
  if (!has('publisher')) db.exec(`ALTER TABLE levels ADD COLUMN publisher TEXT`)
  if (!has('enjoyment')) db.exec(`ALTER TABLE levels ADD COLUMN enjoyment REAL`)
  if (!has('description_override')) db.exec(`ALTER TABLE levels ADD COLUMN description_override TEXT`)
  // `same_as_above`: when 1, this level's points mirror the level immediately
  // above it (position - 1). Lets curators tag exact-difficulty ties without
  // overriding the auto-computed point value. Public UI labels this as
  // "Duplicate" — the column name predates the rename and is kept for
  // backwards compatibility.
  if (!has('same_as_above')) db.exec(`ALTER TABLE levels ADD COLUMN same_as_above INTEGER NOT NULL DEFAULT 0`)
  // `duplicate_of_id` / `is_alternate` / `alternate_of_id`: optional pointers
  // to the levels.id row that this level duplicates / is an alternate of.
  // `is_alternate` is the toggle that controls whether the "Alternate" tag
  // appears at all; `alternate_of_id` makes that tag link to the original.
  // For duplicates, `same_as_above` is the toggle and `duplicate_of_id` is
  // the optional link target. All three are nullable / default-0.
  if (!has('duplicate_of_id'))  db.exec(`ALTER TABLE levels ADD COLUMN duplicate_of_id  INTEGER`)
  if (!has('is_alternate'))     db.exec(`ALTER TABLE levels ADD COLUMN is_alternate     INTEGER NOT NULL DEFAULT 0`)
  if (!has('alternate_of_id'))  db.exec(`ALTER TABLE levels ADD COLUMN alternate_of_id  INTEGER`)
  // `submitted_by`: account that originally submitted the level (only set for
  // levels that came in through the submit flow, not sheet imports).
  if (!has('submitted_by')) {
    db.exec(`ALTER TABLE levels ADD COLUMN submitted_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL`)
  }
  if (!has('tentative_placement')) {
    db.exec(`ALTER TABLE levels ADD COLUMN tentative_placement INTEGER NOT NULL DEFAULT 0`)
  }
  // Sheet rows the ALL import read but did not turn into a level here —
  // levels that exist on the sheet and nowhere else. Rewritten wholesale by
  // each sheet import (see `recordSheetExclusives`), so it always describes the
  // most recent run rather than accumulating history.
  db.exec(`
    CREATE TABLE IF NOT EXISTS sheet_exclusive_levels (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      gd_id           INTEGER,
      name            TEXT    NOT NULL,
      sheet_placement INTEGER,
      gddl_tier       TEXT,
      difficulty      TEXT,
      verifier        TEXT,
      verify_date     TEXT,
      verification_url TEXT,
      source_tab      TEXT,
      placement_source TEXT,
      reason          TEXT    NOT NULL,
      imported_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // One-time rename: legacy "hand placed" source (case-insensitive) → the
  // new canonical "All Levels List" tag used for site-originated submissions.
  // Idempotent: no-op once every row is already migrated.
  db.exec(`UPDATE levels SET placement_source = 'All Levels List' WHERE LOWER(placement_source) = 'hand placed'`)

  // Accounts: banned_at = ISO timestamp when an admin banned the account.
  // NULL = active. Sessions for banned accounts are rejected at the auth layer.
  const accCols = db.prepare(`PRAGMA table_info(accounts)`).all() as { name: string }[]
  if (!accCols.some((c) => c.name === 'banned_at')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN banned_at TEXT`)
  }
  if (!accCols.some((c) => c.name === 'banned_reason')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN banned_reason TEXT`)
  }
  if (!accCols.some((c) => c.name === 'pronouns')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN pronouns TEXT`)
  }
  if (!accCols.some((c) => c.name === 'discord_handle')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN discord_handle TEXT`)
  }
  if (!accCols.some((c) => c.name === 'youtube_url')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN youtube_url TEXT`)
  }
  // The in-game name, which is what everyone here is actually known by. Stored
  // as the bare username rather than a URL: it is an identity, not a link, and
  // the gdbrowser address is derived from it (`utils/gd-links.ts`).
  if (!accCols.some((c) => c.name === 'gd_username')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN gd_username TEXT`)
  }
  /**
   * The rest of where somebody is.
   *
   * Columns rather than a JSON blob, matching `youtube_url` beside them: each
   * one is validated against the host it claims to be, which is only possible
   * when the site knows which service a value belongs to. Four is where this
   * stops — a profile is a list of places to find a person, not a link tree.
   */
  for (const col of ['twitch_url', 'twitter_url', 'bluesky_url']) {
    if (!accCols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE accounts ADD COLUMN ${col} TEXT`)
    }
  }
  if (!accCols.some((c) => c.name === 'favorite_level_id')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN favorite_level_id INTEGER REFERENCES levels(id) ON DELETE SET NULL`)
  }
  if (!accCols.some((c) => c.name === 'favorite_level_note')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN favorite_level_note TEXT`)
  }
  // The one completion a player wants their profile judged on. Points at a
  // record rather than a level so the percent and the proof video come with
  // it; ON DELETE SET NULL so retracting the record just clears the pick.
  if (!accCols.some((c) => c.name === 'hardest_record_id')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN hardest_record_id INTEGER REFERENCES records(id) ON DELETE SET NULL`)
  }
  // Which pick paints the profile header: 'hardest' | 'favorite' | 'level' |
  // 'none'. Stored rather than inferred so clearing a pick doesn't silently
  // switch the banner to the other one.
  if (!accCols.some((c) => c.name === 'banner_choice')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN banner_choice TEXT NOT NULL DEFAULT 'hardest'`)
  }
  // Any level at all as the header art, independent of the hardest/favourite
  // picks — those two carry meaning on the profile, and people want a backdrop
  // without claiming a completion or declaring a favourite to get one.
  if (!accCols.some((c) => c.name === 'banner_level_id')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN banner_level_id INTEGER REFERENCES levels(id) ON DELETE SET NULL`)
  }

  /**
   * Staff decorations on an account.
   *
   * All three are staff-only and all three are *presentation*: a custom cover
   * image instead of level art, and a short emoji plus a free-text badge beside
   * the name. Kept on `accounts` rather than in a side table because every one
   * of them is one value per account and every reader of a name already has the
   * account row in hand.
   *
   * `banner_image_url` is rendered as an <img src> on a public page, so the
   * write path enforces http(s) — a javascript: value here would be stored XSS.
   * `name_badge_color` is a hex literal interpolated into a style attribute and
   * is validated the same way the custom-list accent is.
   */
  if (!accCols.some((c) => c.name === 'banner_image_url')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN banner_image_url TEXT`)
  }
  if (!accCols.some((c) => c.name === 'name_emoji')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN name_emoji TEXT`)
  }
  if (!accCols.some((c) => c.name === 'name_badge')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN name_badge TEXT`)
  }
  if (!accCols.some((c) => c.name === 'name_badge_color')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN name_badge_color TEXT`)
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_levels_creator   ON levels(creator COLLATE NOCASE)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_levels_permanent ON levels(permanent)`)
  // gd_id is how every mirror (AREDL, GDL, CCL, …) is matched back to a level
  // here — the feed, the leaderboard and "create a list from CCL" all join on
  // it, and without this each of those is a full scan of `levels`.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_levels_gd_id     ON levels(gd_id)`)
  // Resolving a leaderboard/feed name to the account behind it looks at both
  // `username` and `claimed_player`; only the former was indexed.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_claimed ON accounts(claimed_player COLLATE NOCASE)`)

  // Pending level submissions — user-submitted new levels awaiting admin review.
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_levels (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      gd_id           INTEGER,
      name            TEXT,
      fps             TEXT,
      game_version    TEXT,
      verification    TEXT,
      verification_url TEXT,
      verifier        TEXT,
      verify_date     TEXT,
      gddl_tier       TEXT,
      difficulty      TEXT,
      enjoyment       REAL,
      main_skillset   TEXT,
      tags            TEXT,
      notes           TEXT,
      status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      submitted_by    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      submitted_at    TEXT NOT NULL DEFAULT (datetime('now')),
      decided_by      INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      decided_at      TEXT,
      placement       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_pending_levels_status    ON pending_levels(status);
    CREATE INDEX IF NOT EXISTS idx_pending_levels_submitter ON pending_levels(submitted_by);
  `)

  const pcols = db.prepare(`PRAGMA table_info(pending_levels)`).all() as { name: string }[]
  if (!pcols.some((c) => c.name === 'placement_estimate')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN placement_estimate INTEGER`)
  }
  if (!pcols.some((c) => c.name === 'comparison_level_id')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN comparison_level_id INTEGER`)
  }
  if (!pcols.some((c) => c.name === 'comparison_level_name')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN comparison_level_name TEXT`)
  }
  if (!pcols.some((c) => c.name === 'pov_placement')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN pov_placement INTEGER`)
  }
  if (!pcols.some((c) => c.name === 'placement_source')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN placement_source TEXT`)
  }
  // Verification-of-open-verification submissions: pending row carries a link
  // back to the open_verifications row so an admin approval can also remove it
  // from the open list when the verified copy lands on the main list.
  if (!pcols.some((c) => c.name === 'from_open_verification_id')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN from_open_verification_id INTEGER`)
  }
  // Submitter (or admin pre-approve) can flag a level as "same difficulty as
  // above" so on approval it inherits the previous level's points and gets the
  // "Duplicate" tag on the public list.
  if (!pcols.some((c) => c.name === 'same_as_above')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN same_as_above INTEGER NOT NULL DEFAULT 0`)
  }
  // Mirrors of the levels-table columns above for the duplicate / alternate
  // tag system. Carried through pending → awaiting → levels on approval.
  if (!pcols.some((c) => c.name === 'duplicate_of_id')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN duplicate_of_id INTEGER`)
  }
  if (!pcols.some((c) => c.name === 'is_alternate')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN is_alternate INTEGER NOT NULL DEFAULT 0`)
  }
  if (!pcols.some((c) => c.name === 'alternate_of_id')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN alternate_of_id INTEGER`)
  }
  // Void-level-to-pending submissions: pending row carries a link back to the
  // void_levels row so an admin approval can remove it from the void list.
  if (!pcols.some((c) => c.name === 'from_void_level_id')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN from_void_level_id INTEGER`)
  }
  if (!pcols.some((c) => c.name === 'rated')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN rated TEXT`)
  }
  if (!pcols.some((c) => c.name === 'tentative_placement')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN tentative_placement INTEGER NOT NULL DEFAULT 0`)
  }
  // GDL-imported pending rows: levels auto-pulled from the GDL API that aren't
  // on the ALL list yet. The unique index keeps the importer idempotent — a
  // re-run for the same gdl_id is a no-op even if the curator has edited the
  // row in the meantime.
  if (!pcols.some((c) => c.name === 'from_gdl_id')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN from_gdl_id INTEGER`)
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_levels_from_gdl
             ON pending_levels(from_gdl_id) WHERE from_gdl_id IS NOT NULL`)

  // Void list: levels with no difficulty opinion (gid=1630809094 of the source
  // sheet). Stored in a separate table from `levels` because positions are
  // list-local and the columns differ — no points / skillset / GDDL tier.
  // The earlier prototype used the pending-list gid and had a different column
  // set, so drop and recreate if those legacy columns are still around.
  const voidExists = (db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='void_levels'`,
  ).get() as { name: string } | undefined)
  if (voidExists) {
    const vc = db.prepare(`PRAGMA table_info(void_levels)`).all() as { name: string }[]
    const hasLegacy = vc.some((c) => c.name === 'difficulty_approximation' || c.name === 'general_idea' || c.name === 'gddl_tier')
    if (hasLegacy) db.exec(`DROP TABLE void_levels`)
  }
  // Awaiting placement: levels approved out of pending review but not yet
  // assigned a final position on the main / void list. Public-facing holding
  // area, ordered by approval time. Mirrors the metadata captured on the
  // pending submission so the public page can render full level details.
  db.exec(`
    CREATE TABLE IF NOT EXISTS awaiting_levels (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      gd_id            INTEGER,
      name             TEXT    NOT NULL,
      fps              TEXT,
      game_version     TEXT,
      verification     TEXT,
      verification_url TEXT,
      verifier         TEXT,
      verify_date      TEXT,
      gddl_tier        TEXT,
      difficulty       TEXT,
      enjoyment        REAL,
      main_skillset    TEXT,
      tags             TEXT,
      notes            TEXT,
      submitter        TEXT,
      pending_id       INTEGER,
      approved_by      INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      approved_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_awaiting_name        ON awaiting_levels(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_awaiting_approved_at ON awaiting_levels(approved_at);
  `)

  const acols = db.prepare(`PRAGMA table_info(awaiting_levels)`).all() as { name: string }[]
  if (!acols.some((c) => c.name === 'pov_placement')) {
    db.exec(`ALTER TABLE awaiting_levels ADD COLUMN pov_placement INTEGER`)
  }
  if (!acols.some((c) => c.name === 'placement_source')) {
    db.exec(`ALTER TABLE awaiting_levels ADD COLUMN placement_source TEXT`)
  }
  if (!acols.some((c) => c.name === 'same_as_above')) {
    db.exec(`ALTER TABLE awaiting_levels ADD COLUMN same_as_above INTEGER NOT NULL DEFAULT 0`)
  }
  if (!acols.some((c) => c.name === 'duplicate_of_id')) {
    db.exec(`ALTER TABLE awaiting_levels ADD COLUMN duplicate_of_id INTEGER`)
  }
  if (!acols.some((c) => c.name === 'is_alternate')) {
    db.exec(`ALTER TABLE awaiting_levels ADD COLUMN is_alternate INTEGER NOT NULL DEFAULT 0`)
  }
  if (!acols.some((c) => c.name === 'alternate_of_id')) {
    db.exec(`ALTER TABLE awaiting_levels ADD COLUMN alternate_of_id INTEGER`)
  }
  if (!acols.some((c) => c.name === 'placement_suggestion')) {
    db.exec(`ALTER TABLE awaiting_levels ADD COLUMN placement_suggestion INTEGER`)
  }
  if (!acols.some((c) => c.name === 'rated')) {
    db.exec(`ALTER TABLE awaiting_levels ADD COLUMN rated TEXT`)
  }
  if (!acols.some((c) => c.name === 'tentative_placement')) {
    db.exec(`ALTER TABLE awaiting_levels ADD COLUMN tentative_placement INTEGER NOT NULL DEFAULT 0`)
  }
  if (!acols.some((c) => c.name === 'admin_notes')) {
    db.exec(`ALTER TABLE awaiting_levels ADD COLUMN admin_notes TEXT`)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS void_levels (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      position         INTEGER NOT NULL UNIQUE,
      name             TEXT    NOT NULL,
      gd_id            INTEGER,
      verify_date      TEXT,
      days             INTEGER,
      demon_ranking    TEXT,
      placement_source TEXT,
      verification     TEXT,
      verification_url TEXT,
      added_on         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_void_position ON void_levels(position);
    CREATE INDEX IF NOT EXISTS idx_void_name     ON void_levels(name COLLATE NOCASE);
  `)

  // Records: add is_verification_claim column for submitters claiming the
  // record is the level's verification. On approval, an unset level.verifier
  // gets backfilled from this record's player_name.
  const recColsPre = db.prepare(`PRAGMA table_info(records)`).all() as { name: string }[]
  if (recColsPre.length && !recColsPre.some((c) => c.name === 'is_verification_claim')) {
    db.exec(`ALTER TABLE records ADD COLUMN is_verification_claim INTEGER NOT NULL DEFAULT 0`)
  }

  // Records: detect old schema (pre-submission system) and rebuild. The records
  // table is currently always empty in production (the sheet doesn't expose
  // per-level records), so dropping is safe. After rebuild, indexes are
  // (re)created idempotently for both fresh and migrated DBs.
  const recCols = db.prepare(`PRAGMA table_info(records)`).all() as { name: string }[]
  if (!recCols.some((c) => c.name === 'submitted_by')) {
    db.exec(`DROP TABLE IF EXISTS records`)
    db.exec(`
      CREATE TABLE records (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        level_id        INTEGER NOT NULL REFERENCES levels(id)  ON DELETE CASCADE,
        player_id       INTEGER REFERENCES players(id)          ON DELETE SET NULL,
        player_name     TEXT    NOT NULL,
        percent         INTEGER NOT NULL DEFAULT 100,
        hz              INTEGER,
        video           TEXT,
        permanent       INTEGER NOT NULL DEFAULT 0,
        submitted_by    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        submitter_note  TEXT,
        submitted_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        decided_at      TEXT,
        decided_by      INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        is_verification_claim INTEGER NOT NULL DEFAULT 0
      )
    `)
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_records_level     ON records(level_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_records_player    ON records(player_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_records_holder    ON records(player_name COLLATE NOCASE)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_records_permanent ON records(permanent)`)

  // Records a claim brought in. Claiming an AREDL/GDL/Pointercrate player copies
  // that player's mirrored records onto the account's ALL profile; these two
  // columns are how releasing the claim takes back exactly those rows and leaves
  // hand-submitted ones alone. See `server/utils/claim-records.ts`.
  const recCols2 = db.prepare(`PRAGMA table_info(records)`).all() as { name: string }[]
  if (!recCols2.some((c) => c.name === 'claim_source')) {
    db.exec(`ALTER TABLE records ADD COLUMN claim_source TEXT`)
  }
  if (!recCols2.some((c) => c.name === 'claim_account_id')) {
    db.exec(`ALTER TABLE records ADD COLUMN claim_account_id INTEGER`)
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_records_claim ON records(claim_account_id, claim_source)`,
  )
  // A column added by ALTER can't carry a foreign key in SQLite, so the cascade
  // is here instead: a deleted account's claimed records go with it, exactly as
  // releasing the claim would have done.
  db.exec(
    `DELETE FROM records
      WHERE claim_account_id IS NOT NULL
        AND claim_account_id NOT IN (SELECT id FROM accounts)`,
  )

  // Sheet records are now auto-accepted; promote any leftover from earlier
  // imports that were inserted as permanent = 0. Idempotent — does nothing once
  // every sheet record is already permanent = 1.
  db.exec(`UPDATE records SET permanent = 1 WHERE submitted_by IS NULL AND permanent = 0`)

  // Inbox: messages from moderators to users (e.g. denial reasons). The
  // related_kind/related_id pair is informational — the row stays around even
  // if the original submission/record is deleted.
  db.exec(`
    CREATE TABLE IF NOT EXISTS inbox_messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      kind         TEXT    NOT NULL,
      subject      TEXT    NOT NULL,
      body         TEXT,
      related_kind TEXT,
      related_id   INTEGER,
      sent_by      INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      read_at      TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_account ON inbox_messages(account_id, read_at);
    CREATE INDEX IF NOT EXISTS idx_inbox_created ON inbox_messages(created_at);
  `)

  // Per-admin "seen" baselines for the admin panel badge system. Each row
  // records the last-acknowledged count for one tab so badges survive reloads
  // and can be cleared from the inbox "mark all read" button.
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_seen_counts (
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      tab_id     TEXT    NOT NULL,
      seen       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, tab_id)
    );
  `)

  // Cache of GD level info fetched from Boomlings. Refreshed at most once per
  // hour per gd_id to stay well under Boomlings' rate limits.
  db.exec(`
    CREATE TABLE IF NOT EXISTS gd_info_cache (
      gd_id      INTEGER PRIMARY KEY,
      info_json  TEXT    NOT NULL,
      fetched_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // Position history: one row per admin position change. `from_position` is
  // NULL for the initial placement (we don't backfill prior moves on existing
  // DBs). Tied to levels.id so a renumbering doesn't orphan the history.
  db.exec(`
    CREATE TABLE IF NOT EXISTS position_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      level_id      INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
      from_position INTEGER,
      to_position   INTEGER NOT NULL,
      changed_by    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      changed_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_position_history_level   ON position_history(level_id, changed_at);
    CREATE INDEX IF NOT EXISTS idx_position_history_changed ON position_history(changed_at);
  `)

  /*
   * Levels taken off the list.
   *
   * Deliberately *not* a row in `position_history`. That table is keyed to
   * `levels(id) ON DELETE CASCADE` and the changelog reads it through a join
   * back to `levels`, so the moment a level is deleted its entire history goes
   * with it — which means a removal was the one change to the list that could
   * never appear in the list's changelog, and the level's own additions and
   * moves silently vanished from the historical record too. A reader saw a
   * level in the top 50 one day and no trace of it ever having existed the
   * next.
   *
   * So this table denormalises everything the changelog needs to draw a row.
   * There is nothing left to join to: the name, the placement it held and the
   * artwork are copied in at the moment of deletion, because a foreign key to
   * a row that is being deleted is exactly the thing that failed before.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS level_removals (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      level_id        INTEGER NOT NULL,
      name            TEXT    NOT NULL,
      gd_id           INTEGER,
      position        INTEGER NOT NULL,
      sheet_placement INTEGER,
      gddl_tier       TEXT,
      rated           TEXT,
      was_challenge   INTEGER NOT NULL DEFAULT 0,
      challenge_rank  INTEGER,
      reason          TEXT,
      removed_by      INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      removed_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_level_removals_at ON level_removals(removed_at);
  `)

  // Discord webhooks: admin-managed list of URLs that receive a daily summary
  // of level additions and movements. last_posted_date is the YYYY-MM-DD of
  // the most recently summarised day so the scheduler doesn't double-post.
  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_webhooks (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      url               TEXT    NOT NULL,
      label             TEXT,
      active            INTEGER NOT NULL DEFAULT 1,
      created_by        INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      last_posted_date  TEXT,
      last_post_status  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_discord_webhooks_active ON discord_webhooks(active);
  `)

  const dwCols = db.prepare(`PRAGMA table_info(discord_webhooks)`).all() as { name: string }[]
  if (!dwCols.some((c) => c.name === 'tier_emoji')) {
    db.exec(`ALTER TABLE discord_webhooks ADD COLUMN tier_emoji INTEGER NOT NULL DEFAULT 0`)
  }
  /**
   * Send the whole day, across as many messages as it takes.
   *
   * A Discord embed description stops at 4,096 characters, which a busy day
   * on a 54,000-level list passes easily — and what happened then was
   * "…(truncated)", with the rest of the day's changes simply never posted.
   * Off by default because it changes how much a channel receives, and that
   * is the owner's call rather than an upgrade's.
   */
  if (!dwCols.some((c) => c.name === 'split_long')) {
    db.exec(`ALTER TABLE discord_webhooks ADD COLUMN split_long INTEGER NOT NULL DEFAULT 0`)
  }
  if (!dwCols.some((c) => c.name === 'kind')) {
    db.exec(`ALTER TABLE discord_webhooks ADD COLUMN kind TEXT NOT NULL DEFAULT 'changes'`)
  }

  // Opinions: per-user difficulty / enjoyment ratings on a level. Approved
  // opinions feed the "community tier" tile + bar chart on the level page.
  // list_kind disambiguates main-list and void-list levels since their tables
  // are separate; level_id refers to whichever table list_kind names.
  db.exec(`
    CREATE TABLE IF NOT EXISTS opinions (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      list_kind             TEXT    NOT NULL DEFAULT 'main' CHECK(list_kind IN ('main','void')),
      level_id              INTEGER NOT NULL,
      submitted_by          INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      proof_url             TEXT    NOT NULL,
      gddl_tier             TEXT,
      difficulty            TEXT,
      enjoyment             REAL,
      notes                 TEXT,
      request_relocation    INTEGER NOT NULL DEFAULT 0,
      requested_position    INTEGER,
      comparison_level_id   INTEGER,
      comparison_level_name TEXT,
      status                TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      source_record_id      INTEGER REFERENCES records(id) ON DELETE SET NULL,
      submitted_at          TEXT    NOT NULL DEFAULT (datetime('now')),
      decided_at            TEXT,
      decided_by            INTEGER REFERENCES accounts(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_opinions_level   ON opinions(list_kind, level_id, status);
    CREATE INDEX IF NOT EXISTS idx_opinions_status  ON opinions(status);
    CREATE INDEX IF NOT EXISTS idx_opinions_record  ON opinions(source_record_id);
  `)

  // Follows: a follower account "follows" a profile identified by its
  // canonical name (claimed_player when set, else username for accounts;
  // the player name for unclaimed leaderboard entries). Storing the name
  // instead of an account id lets us follow profiles that don't have an
  // account yet — when the profile later claims an account, the follow
  // edge survives because the canonical name is preserved.
  db.exec(`
    CREATE TABLE IF NOT EXISTS follows (
      follower_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      target_name         TEXT    NOT NULL COLLATE NOCASE,
      created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (follower_account_id, target_name)
    );
    CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_account_id);
    CREATE INDEX IF NOT EXISTS idx_follows_target   ON follows(target_name);
  `)

  // Open verifications: user-submitted levels that have not been verified yet.
  // Entries enter as `status = 'pending'` and only show on the public list once
  // an admin approves them. `showcase_url` is an optional link (e.g. a layout
  // showcase) embedded in place of a verification video.
  db.exec(`
    CREATE TABLE IF NOT EXISTS open_verifications (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      gd_id            INTEGER,
      name             TEXT    NOT NULL,
      fps              TEXT,
      game_version     TEXT,
      showcase_url     TEXT,
      verifier         TEXT,
      gddl_tier        TEXT,
      difficulty       TEXT,
      enjoyment        REAL,
      main_skillset    TEXT,
      tags             TEXT,
      notes            TEXT,
      placement_source TEXT,
      status           TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      submitted_by     INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      submitted_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      decided_by       INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      decided_at       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_open_ver_status     ON open_verifications(status);
    CREATE INDEX IF NOT EXISTS idx_open_ver_submitted  ON open_verifications(submitted_at);
    CREATE INDEX IF NOT EXISTS idx_open_ver_name       ON open_verifications(name COLLATE NOCASE);
  `)

  // Roles: extend the role CHECK constraint to include 'owner' and 'developer'.
  // Both function identically to admin server-side; the labels just render
  // differently on profile/account UI. SQLite can't ALTER a CHECK constraint
  // in place, so rebuild the table when the existing constraint is the old
  // 3-role one. Detect via sqlite_master since PRAGMA table_info doesn't
  // expose CHECK clauses.
  const accSql = (db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts'`,
  ).get() as { sql: string } | undefined)?.sql ?? ''
  if (!accSql.includes("'owner'")) {
    // Many other tables FK-reference accounts(id). Follow SQLite's documented
    // procedure for swapping a table that has incoming FK references: turn
    // foreign_keys OFF, do the swap inside a transaction, then turn it back on.
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec('BEGIN')
    try {
      db.exec(`
        CREATE TABLE accounts__new (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          username        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
          password_hash   TEXT    NOT NULL,
          password_salt   TEXT    NOT NULL,
          role            TEXT    NOT NULL DEFAULT 'user' CHECK(role IN ('user','moderator','admin','owner','developer')),
          bio             TEXT,
          avatar_blob     BLOB,
          avatar_type     TEXT,
          country         TEXT,
          subdivision     TEXT,
          claimed_player  TEXT    COLLATE NOCASE,
          created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
          banned_at       TEXT,
          banned_reason   TEXT
        );
        INSERT INTO accounts__new
          (id, username, password_hash, password_salt, role, bio, avatar_blob, avatar_type,
           country, subdivision, claimed_player, created_at, banned_at, banned_reason)
        SELECT
           id, username, password_hash, password_salt, role, bio, avatar_blob, avatar_type,
           country, subdivision, claimed_player, created_at, banned_at, banned_reason
          FROM accounts;
        DROP TABLE accounts;
        ALTER TABLE accounts__new RENAME TO accounts;
        CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_player ON accounts(claimed_player) WHERE claimed_player IS NOT NULL;
      `)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      db.exec('PRAGMA foreign_keys = ON')
      throw e
    }
    db.exec('PRAGMA foreign_keys = ON')
  }

  // Progress posts: lightweight, unverified personal updates. They never
  // grant points or appear on level pages — they're profile-only and feed
  // the followed-activity sidebar. video_url is optional.
  db.exec(`
    CREATE TABLE IF NOT EXISTS progress_posts (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      level_id       INTEGER REFERENCES levels(id) ON DELETE SET NULL,
      level_name     TEXT    NOT NULL,
      level_position INTEGER,
      start_percent  INTEGER NOT NULL,
      end_percent    INTEGER NOT NULL,
      video_url      TEXT,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_progress_posts_account ON progress_posts(account_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_progress_posts_created ON progress_posts(created_at);
  `)

  // Comments: user-posted comments on profiles, progress posts, and open
  // verification levels. target_kind + target_id identify the parent:
  //   profile          → accounts.id of the profile owner
  //   progress         → progress_posts.id
  //   open_verification → open_verifications.id
  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      target_kind TEXT    NOT NULL CHECK(target_kind IN ('profile','progress','open_verification')),
      target_id   INTEGER NOT NULL,
      body        TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_comments_target  ON comments(target_kind, target_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_account ON comments(account_id);
  `)

  // --- External-list mirrors (currently only Aredl; designed so additional
  // sources can reuse the same shape later). Stored separately from the
  // legacy `players`/`records` tables so name collisions don't conflict and
  // a re-import never clobbers ALL-list data.
  db.exec(`
    CREATE TABLE IF NOT EXISTS aredl_players (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid               TEXT    NOT NULL UNIQUE,
      username           TEXT    NOT NULL COLLATE NOCASE,
      global_name        TEXT    NOT NULL COLLATE NOCASE,
      description        TEXT,
      country            INTEGER,
      discord_id         TEXT,
      placeholder        INTEGER NOT NULL DEFAULT 0,
      total_points       INTEGER NOT NULL DEFAULT 0,
      pack_points        INTEGER NOT NULL DEFAULT 0,
      extremes           INTEGER NOT NULL DEFAULT 0,
      rank               INTEGER,
      hardest_uuid       TEXT,
      hardest_name       TEXT,
      claimed_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      fetched_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aredl_players_global ON aredl_players(global_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_aredl_players_total  ON aredl_players(total_points DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_aredl_players_claim ON aredl_players(claimed_account_id) WHERE claimed_account_id IS NOT NULL;

    -- Aredl-only levels (i.e. levels not present on the ALL list yet).
    -- Levels that overlap with the ALL list are merged into the levels table
    -- instead; we only store the Aredl-side metadata for cross-list lookups
    -- (the aredl_position / tags / edel_enjoyment columns added on levels below).
    CREATE TABLE IF NOT EXISTS aredl_levels (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid            TEXT    NOT NULL UNIQUE,
      gd_id           INTEGER NOT NULL UNIQUE,
      position        INTEGER NOT NULL,
      name            TEXT    NOT NULL,
      points          INTEGER,
      legacy          INTEGER NOT NULL DEFAULT 0,
      two_player      INTEGER NOT NULL DEFAULT 0,
      tags            TEXT,
      description     TEXT,
      song            INTEGER,
      edel_enjoyment  REAL,
      is_edel_pending INTEGER NOT NULL DEFAULT 0,
      gddl_tier       REAL,
      nlw_tier        TEXT,
      publisher_uuid  TEXT,
      publisher_name  TEXT,
      verifier_name   TEXT,
      verification_url TEXT,
      creators_json   TEXT,
      promoted_to_position INTEGER,
      fetched_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aredl_levels_gd_id    ON aredl_levels(gd_id);
    CREATE INDEX IF NOT EXISTS idx_aredl_levels_position ON aredl_levels(position);
    CREATE INDEX IF NOT EXISTS idx_aredl_levels_promoted ON aredl_levels(promoted_to_position);

    CREATE TABLE IF NOT EXISTS aredl_records (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid            TEXT    NOT NULL UNIQUE,
      level_uuid      TEXT    NOT NULL,
      level_gd_id     INTEGER,
      player_uuid     TEXT    NOT NULL,
      player_name     TEXT    NOT NULL COLLATE NOCASE,
      mobile          INTEGER NOT NULL DEFAULT 0,
      video_url       TEXT,
      hide_video      INTEGER NOT NULL DEFAULT 0,
      is_verification INTEGER NOT NULL DEFAULT 0,
      achieved_at     TEXT,
      fetched_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aredl_records_level_gd ON aredl_records(level_gd_id);
    CREATE INDEX IF NOT EXISTS idx_aredl_records_level    ON aredl_records(level_uuid);
    CREATE INDEX IF NOT EXISTS idx_aredl_records_player   ON aredl_records(player_uuid);
    CREATE INDEX IF NOT EXISTS idx_aredl_records_name     ON aredl_records(player_name COLLATE NOCASE);
  `)

  // Cross-list metadata on `levels`: tracks where an ALL-list level appears on
  // other lists. `aredl_position` is the level's rank on Aredl (NULL if not on
  // Aredl); `aredl_tags` is the JSON array of Aredl-side tags so the level
  // page can merge them with the ALL list's existing tags; `edel_enjoyment`
  // is Aredl's community enjoyment score (separate from our `enjoyment`).
  if (!has('aredl_position'))  db.exec(`ALTER TABLE levels ADD COLUMN aredl_position INTEGER`)
  if (!has('aredl_tags'))      db.exec(`ALTER TABLE levels ADD COLUMN aredl_tags TEXT`)
  if (!has('edel_enjoyment'))  db.exec(`ALTER TABLE levels ADD COLUMN edel_enjoyment REAL`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_levels_aredl_position ON levels(aredl_position)`)

  // Allow account-level claims to specify which list source the claim is
  // against. NULL/'all' = legacy ALL-list player (the existing flow);
  // 'aredl' = an Aredl player. The `aredl_player_uuid` column on accounts
  // mirrors `claimed_player` for the new source.
  const accCols2 = db.prepare(`PRAGMA table_info(accounts)`).all() as { name: string }[]
  if (!accCols2.some((c) => c.name === 'claimed_aredl_uuid')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN claimed_aredl_uuid TEXT`)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_aredl_claim ON accounts(claimed_aredl_uuid) WHERE claimed_aredl_uuid IS NOT NULL`)
  }
  const claimCols = db.prepare(`PRAGMA table_info(claim_requests)`).all() as { name: string }[]
  if (!claimCols.some((c) => c.name === 'source')) {
    db.exec(`ALTER TABLE claim_requests ADD COLUMN source TEXT NOT NULL DEFAULT 'all' CHECK(source IN ('all','aredl'))`)
  }
  if (!claimCols.some((c) => c.name === 'aredl_player_uuid')) {
    db.exec(`ALTER TABLE claim_requests ADD COLUMN aredl_player_uuid TEXT`)
  }
  if (!claimCols.some((c) => c.name === 'pointercrate_player_id')) {
    db.exec(`ALTER TABLE claim_requests ADD COLUMN pointercrate_player_id INTEGER`)
  }

  // Allow 'pointercrate' as a third claim source. SQLite can't ALTER a CHECK
  // constraint in place; if the existing CHECK still only allows ('all','aredl')
  // we rebuild the table to widen it. Idempotent: no-op once 'pointercrate'
  // is already in the constraint definition.
  const claimSql = (db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='claim_requests'`,
  ).get() as { sql: string } | undefined)?.sql ?? ''
  if (!claimSql.includes("'pointercrate'")) {
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec('BEGIN')
    try {
      db.exec(`
        CREATE TABLE claim_requests__new (
          id                       INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id               INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          player_name              TEXT    NOT NULL,
          status                   TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
          created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
          decided_at               TEXT,
          decided_by               INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
          source                   TEXT    NOT NULL DEFAULT 'all' CHECK(source IN ('all','aredl','pointercrate')),
          aredl_player_uuid        TEXT,
          pointercrate_player_id   INTEGER
        );
        INSERT INTO claim_requests__new
          (id, account_id, player_name, status, created_at, decided_at, decided_by,
           source, aredl_player_uuid, pointercrate_player_id)
        SELECT
           id, account_id, player_name, status, created_at, decided_at, decided_by,
           source, aredl_player_uuid, pointercrate_player_id
          FROM claim_requests;
        DROP TABLE claim_requests;
        ALTER TABLE claim_requests__new RENAME TO claim_requests;
        CREATE INDEX IF NOT EXISTS idx_claims_account ON claim_requests(account_id);
        CREATE INDEX IF NOT EXISTS idx_claims_status  ON claim_requests(status);
      `)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      db.exec('PRAGMA foreign_keys = ON')
      throw e
    }
    db.exec('PRAGMA foreign_keys = ON')
  }

  // --- Pointercrate mirrors. Players-only (Pointercrate has no levels we
  // don't already have via Aredl). Records are deduped against records and
  // aredl_records on insert (player_name + gd_id, percent=100). Legacy demons
  // (position > extended_list_size) are tracked in pointercrate_legacy_imported
  // so their records are pulled exactly once and never re-fetched.
  db.exec(`
    CREATE TABLE IF NOT EXISTS pointercrate_players (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      pc_id              INTEGER NOT NULL UNIQUE,
      name               TEXT    NOT NULL COLLATE NOCASE,
      banned             INTEGER NOT NULL DEFAULT 0,
      nationality        TEXT,
      subdivision        TEXT,
      rank               INTEGER,
      score              REAL    NOT NULL DEFAULT 0,
      hardest_pc_id      INTEGER,
      hardest_name       TEXT,
      claimed_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      fetched_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pc_players_name  ON pointercrate_players(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_pc_players_score ON pointercrate_players(score DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pc_players_claim ON pointercrate_players(claimed_account_id) WHERE claimed_account_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS pointercrate_records (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      pc_id           INTEGER NOT NULL UNIQUE,
      demon_pc_id     INTEGER NOT NULL,
      demon_position  INTEGER,
      demon_name      TEXT,
      level_gd_id     INTEGER,
      player_pc_id    INTEGER NOT NULL,
      player_name     TEXT    NOT NULL COLLATE NOCASE,
      progress        INTEGER NOT NULL DEFAULT 100,
      video           TEXT,
      is_legacy       INTEGER NOT NULL DEFAULT 0,
      is_verification INTEGER NOT NULL DEFAULT 0,
      fetched_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pc_records_demon  ON pointercrate_records(demon_pc_id);
    CREATE INDEX IF NOT EXISTS idx_pc_records_player ON pointercrate_records(player_pc_id);
    CREATE INDEX IF NOT EXISTS idx_pc_records_level  ON pointercrate_records(level_gd_id);
    CREATE INDEX IF NOT EXISTS idx_pc_records_name   ON pointercrate_records(player_name COLLATE NOCASE);

    -- Per-demon flag: a Pointercrate legacy demon's records are pulled once
    -- (the user's design call — legacy entries are stable). On re-runs the
    -- importer skips any demon with a row here.
    CREATE TABLE IF NOT EXISTS pointercrate_legacy_imported (
      pc_demon_id INTEGER PRIMARY KEY,
      fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  if (!has('pointercrate_position')) db.exec(`ALTER TABLE levels ADD COLUMN pointercrate_position INTEGER`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_levels_pc_position ON levels(pointercrate_position)`)
  if (!has('challenge_list_position')) db.exec(`ALTER TABLE levels ADD COLUMN challenge_list_position INTEGER`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_levels_cl_position ON levels(challenge_list_position)`)
  // Remove any challenge_list_position values set by the name-based fallback (no matching gd_id in gdtpl_levels).
  // Guarded: on a brand-new DB this runs before gdtpl_levels is created below,
  // and the cleanup is only meaningful for pre-existing data anyway.
  const gdtplExists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='gdtpl_levels'`,
  ).get()
  if (gdtplExists) {
    db.exec(`
      UPDATE levels SET challenge_list_position = NULL
      WHERE challenge_list_position IS NOT NULL
        AND (gd_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM gdtpl_levels g WHERE g.list_slug = 'cl' AND g.gd_id = levels.gd_id
        ))
    `)
  }

  const accCols3 = db.prepare(`PRAGMA table_info(accounts)`).all() as { name: string }[]
  if (!accCols3.some((c) => c.name === 'claimed_pointercrate_id')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN claimed_pointercrate_id INTEGER`)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_pc_claim ON accounts(claimed_pointercrate_id) WHERE claimed_pointercrate_id IS NOT NULL`)
  }

  // --- GDL (Global Demonlist, https://demonlist.org / api.demonlist.org) ---
  // Same shape as the AREDL/PC mirrors. GDL has its own player IDs and level
  // IDs (distinct from gd_id). Levels overlapping the ALL list are merged via
  // `levels.gdl_position`; non-overlapping ones live in `gdl_levels`. Records
  // come per-level via /level/classic/record/list and are stored alongside
  // aredl/pc records — query-time dedup, never import-time.
  db.exec(`
    CREATE TABLE IF NOT EXISTS gdl_players (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      gdl_id             INTEGER NOT NULL UNIQUE,
      username           TEXT    NOT NULL COLLATE NOCASE,
      country            TEXT,
      badge              TEXT,
      is_banned          INTEGER NOT NULL DEFAULT 0,
      placement          INTEGER,
      points             REAL    NOT NULL DEFAULT 0,
      hardest_gdl_id     INTEGER,
      hardest_name       TEXT,
      claimed_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      fetched_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gdl_players_name   ON gdl_players(username COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_gdl_players_points ON gdl_players(points DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gdl_players_claim ON gdl_players(claimed_account_id) WHERE claimed_account_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS gdl_levels (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      gdl_id          INTEGER NOT NULL UNIQUE,
      gd_id           INTEGER NOT NULL UNIQUE,
      placement       INTEGER NOT NULL,
      name            TEXT    NOT NULL,
      points          REAL,
      list_percent    INTEGER,
      length          INTEGER,
      list_type       TEXT,
      holder_name     TEXT,
      verifier_gdl_id INTEGER,
      verifier_name   TEXT,
      verification_url TEXT,
      creator         TEXT,
      date_created    TEXT,
      promoted_to_position INTEGER,
      fetched_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gdl_levels_gd_id     ON gdl_levels(gd_id);
    CREATE INDEX IF NOT EXISTS idx_gdl_levels_placement ON gdl_levels(placement);
    CREATE INDEX IF NOT EXISTS idx_gdl_levels_promoted  ON gdl_levels(promoted_to_position);

    CREATE TABLE IF NOT EXISTS gdl_records (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      gdl_id          INTEGER NOT NULL UNIQUE,
      level_gdl_id    INTEGER NOT NULL,
      level_gd_id     INTEGER,
      player_gdl_id   INTEGER NOT NULL,
      player_name     TEXT    NOT NULL COLLATE NOCASE,
      percent         INTEGER NOT NULL DEFAULT 100,
      video_url       TEXT,
      is_verification INTEGER NOT NULL DEFAULT 0,
      fetched_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gdl_records_level_gd ON gdl_records(level_gd_id);
    CREATE INDEX IF NOT EXISTS idx_gdl_records_level    ON gdl_records(level_gdl_id);
    CREATE INDEX IF NOT EXISTS idx_gdl_records_player   ON gdl_records(player_gdl_id);
    CREATE INDEX IF NOT EXISTS idx_gdl_records_name     ON gdl_records(player_name COLLATE NOCASE);
  `)

  // --- MSCL (Mooncandy's Super Challenge List, https://mscl.dev) ---
  // Pointercrate-compatible API, so this mirrors the AREDL/GDL/PC mirrors:
  // overlapping levels get levels.mscl_position; the rest live here until a
  // curator promotes them.
  db.exec(`
    CREATE TABLE IF NOT EXISTS mscl_levels (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      mscl_id        INTEGER NOT NULL UNIQUE,
      gd_id          INTEGER,
      position       INTEGER NOT NULL,
      name           TEXT    NOT NULL,
      requirement    INTEGER,
      video          TEXT,
      thumbnail      TEXT,
      tier           INTEGER,
      fps            TEXT,
      publisher_name TEXT,
      verifier_name  TEXT,
      promoted_to_position INTEGER,
      fetched_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mscl_levels_gd_id    ON mscl_levels(gd_id);
    CREATE INDEX IF NOT EXISTS idx_mscl_levels_position ON mscl_levels(position);
  `)
  if (!has('mscl_position')) db.exec(`ALTER TABLE levels ADD COLUMN mscl_position INTEGER`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_levels_mscl_position ON levels(mscl_position)`)

  // --- ACS (the ALL CHALLENGES LIST sheet) ---
  //
  // Shipped for one version as `ccpl`, which was the wrong name twice over: it
  // is the project's own sheet, and CCPL is already a different list's name in
  // `utils/challenge-sources.ts`. Renamed in place rather than left to make a
  // second empty table beside the populated one.
  // Live PRAGMA reads, not the cached `has()` snapshot taken at the top of this
  // function: a rename here changes what the later ADD COLUMN guards see, and a
  // stale snapshot would have them try to add a column that now exists.
  const tableExists = (name: string) => !!db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
  ).get(name)
  const columnExists = (table: string, col: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
      .some((c) => c.name === col)

  if (tableExists('ccpl_levels') && !tableExists('acs_levels')) {
    db.exec(`ALTER TABLE ccpl_levels RENAME TO acs_levels`)
    if (columnExists('acs_levels', 'ccpl_tier')) {
      db.exec(`ALTER TABLE acs_levels RENAME COLUMN ccpl_tier TO acs_tier`)
    }
    console.log('[db] renamed ccpl_levels to acs_levels')
  }
  if (columnExists('levels', 'ccpl_position') && !columnExists('levels', 'acs_position')) {
    db.exec(`ALTER TABLE levels RENAME COLUMN ccpl_position TO acs_position`)
  }
  if (columnExists('pending_levels', 'from_ccpl_id') && !columnExists('pending_levels', 'from_acs_id')) {
    db.exec(`ALTER TABLE pending_levels RENAME COLUMN from_ccpl_id TO from_acs_id`)
    db.exec(`UPDATE pending_levels SET placement_source = 'ACS' WHERE placement_source = 'CCPL'`)
  }

  // A Google Sheet rather than an API, so `import-acs.ts` reads it as CSV per
  // tab. Keyed on (tab, position) because that is what the sheet actually
  // guarantees: over half its rows carry no level ID at all, so `gd_id` can be
  // neither the key nor required. Rows the ALL doesn't have live here until a
  // curator promotes them, the same as every other mirror.
  db.exec(`
    CREATE TABLE IF NOT EXISTS acs_levels (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tab            TEXT    NOT NULL,
      position       INTEGER NOT NULL,
      gd_id          INTEGER,
      name           TEXT    NOT NULL,
      acs_tier      TEXT,
      skillset       TEXT,
      comparable     TEXT,
      source         TEXT,
      aredl_note     TEXT,
      verification_url TEXT,
      promoted_to_position INTEGER,
      fetched_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tab, position)
    );
    CREATE INDEX IF NOT EXISTS idx_acs_levels_gd_id    ON acs_levels(gd_id);
    CREATE INDEX IF NOT EXISTS idx_acs_levels_position ON acs_levels(tab, position);
    CREATE INDEX IF NOT EXISTS idx_acs_levels_promoted ON acs_levels(promoted_to_position);
  `)
  if (!columnExists('levels', 'acs_position')) db.exec(`ALTER TABLE levels ADD COLUMN acs_position INTEGER`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_levels_acs_position ON levels(acs_position)`)
  // The verification video, taken from the hyperlink on the level's name — the
  // sheet keeps it there rather than in a column of its own, and no CSV export
  // of a Google Sheet carries a hyperlink. See `server/utils/xlsx.ts`.
  if (!columnExists('acs_levels', 'verification_url')) {
    db.exec(`ALTER TABLE acs_levels ADD COLUMN verification_url TEXT`)
  }

  /**
   * The two editorial overrides for "is this a challenge?".
   *
   * Whether a level is a challenge is otherwise *inferred* — from its placement
   * source, from `rated = 'Challenge'`, or from Geometry Dash's own metadata
   * (unrated, zero score, Tiny or Short). Inference has no way to be told it is
   * wrong in either direction, so a level the heuristic caught by accident had
   * no way off the challenge list, and one it missed had no way on.
   *
   * `not_challenge` takes a level off; `force_challenge` puts one on. Both are
   * site-owned: no importer writes them, which is what separates them from
   * `rated = 'Challenge'` — that one is sheet-owned, and an admin marking a
   * level with it would have the next import quietly undo the decision.
   *
   * They are written together by the one endpoint that sets them, so "both at
   * once" never occurs; if it somehow did, `not_challenge` wins, because taking
   * a level off a public list is the safer of the two to honour.
   */
  if (!has('not_challenge')) {
    db.exec(`ALTER TABLE levels ADD COLUMN not_challenge INTEGER NOT NULL DEFAULT 0`)
  }
  if (!columnExists('levels', 'force_challenge')) {
    db.exec(`ALTER TABLE levels ADD COLUMN force_challenge INTEGER NOT NULL DEFAULT 0`)
  }

  if (!has('gdl_position')) db.exec(`ALTER TABLE levels ADD COLUMN gdl_position INTEGER`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_levels_gdl_position ON levels(gdl_position)`)

  // --- GDListTemplate mirrors. Generic table that holds level rows for any
  // list built on the TheShittyList/GDListTemplate JSON format (one
  // `_list.json` of slugs + one `<slug>.json` per level). Each list is
  // identified by a short `list_slug` (e.g. 'tsl'); level rows are keyed by
  // (list_slug, level_slug) so adding a future GDListTemplate-based list is
  // one importer config away — no new tables or columns required.
  db.exec(`
    CREATE TABLE IF NOT EXISTS gdtpl_levels (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      list_slug            TEXT    NOT NULL,
      level_slug           TEXT    NOT NULL,
      position             INTEGER NOT NULL,
      gd_id                INTEGER,
      name                 TEXT,
      author               TEXT,
      creators_json        TEXT,
      verifier             TEXT,
      verification_url     TEXT,
      showcase_url         TEXT,
      percent_to_qualify   INTEGER,
      password             TEXT,
      promoted_to_position INTEGER,
      fetched_at           TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(list_slug, level_slug)
    );
    CREATE INDEX IF NOT EXISTS idx_gdtpl_levels_list  ON gdtpl_levels(list_slug, position);
    CREATE INDEX IF NOT EXISTS idx_gdtpl_levels_gd_id ON gdtpl_levels(gd_id);
    CREATE INDEX IF NOT EXISTS idx_gdtpl_levels_promoted ON gdtpl_levels(promoted_to_position);
  `)

  // pending_levels.from_gdtpl_id: link from a pending-review row back to the
  // gdtpl_levels row that produced it. Unique-when-not-null so a re-import is
  // idempotent — one pending row per imported gdtpl level.
  if (!pcols.some((c) => c.name === 'from_gdtpl_id')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN from_gdtpl_id INTEGER`)
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_levels_from_gdtpl
             ON pending_levels(from_gdtpl_id) WHERE from_gdtpl_id IS NOT NULL`)

  // Same idea for the ACS sheet: one pending row per sheet row, so re-running
  // the import refreshes estimates instead of queueing duplicates.
  if (!columnExists('pending_levels', 'from_acs_id')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN from_acs_id INTEGER`)
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_levels_from_acs
             ON pending_levels(from_acs_id) WHERE from_acs_id IS NOT NULL`)

  // Sheet-pending origin marker. Levels imported from the source sheet's
  // "Pending List" tab go through the same admin "Imported levels" review
  // queue as GDL/GDTPL imports — this flag distinguishes them from user
  // submissions and makes re-imports prunable.
  if (!pcols.some((c) => c.name === 'from_sheet_pending')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN from_sheet_pending INTEGER NOT NULL DEFAULT 0`)
  }
  // Marks pending rows whose gddl_tier was inferred by an importer (midpoint
  // of shared-list neighbours that are already on the ALL list) rather than
  // submitted by a human. Cleared when an admin edits the tier.
  if (!pcols.some((c) => c.name === 'gddl_tier_estimated')) {
    db.exec(`ALTER TABLE pending_levels ADD COLUMN gddl_tier_estimated INTEGER NOT NULL DEFAULT 0`)
  }

  const accCols4 = db.prepare(`PRAGMA table_info(accounts)`).all() as { name: string }[]
  if (!accCols4.some((c) => c.name === 'claimed_gdl_id')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN claimed_gdl_id INTEGER`)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_gdl_claim ON accounts(claimed_gdl_id) WHERE claimed_gdl_id IS NOT NULL`)
  }

  // Pending level-position movement requests. Any logged-in user can submit a
  // request to move a level to a different position; mods review and approve/reject.
  // level_gd_id is used at approval time to look up the level's current position
  // (which may differ from from_position if an admin already moved it).
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_movements (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      level_name    TEXT    NOT NULL,
      level_gd_id   INTEGER,
      from_position INTEGER NOT NULL,
      to_position   INTEGER NOT NULL,
      notes         TEXT,
      submitted_by  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      submitted_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      status        TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      decided_by    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      decided_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pending_movements_status ON pending_movements(status);
  `)

  // Widen claim_requests.source CHECK to include 'gdl'. Same rebuild dance as
  // when 'pointercrate' was added — SQLite can't ALTER a CHECK in place.
  const claimSql2 = (db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='claim_requests'`,
  ).get() as { sql: string } | undefined)?.sql ?? ''
  if (!claimSql2.includes("'gdl'")) {
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec('BEGIN')
    try {
      db.exec(`
        CREATE TABLE claim_requests__new (
          id                       INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id               INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          player_name              TEXT    NOT NULL,
          status                   TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
          created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
          decided_at               TEXT,
          decided_by               INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
          source                   TEXT    NOT NULL DEFAULT 'all' CHECK(source IN ('all','aredl','pointercrate','gdl')),
          aredl_player_uuid        TEXT,
          pointercrate_player_id   INTEGER,
          gdl_player_id            INTEGER
        );
        INSERT INTO claim_requests__new
          (id, account_id, player_name, status, created_at, decided_at, decided_by,
           source, aredl_player_uuid, pointercrate_player_id)
        SELECT
           id, account_id, player_name, status, created_at, decided_at, decided_by,
           source, aredl_player_uuid, pointercrate_player_id
          FROM claim_requests;
        DROP TABLE claim_requests;
        ALTER TABLE claim_requests__new RENAME TO claim_requests;
        CREATE INDEX IF NOT EXISTS idx_claims_account ON claim_requests(account_id);
        CREATE INDEX IF NOT EXISTS idx_claims_status  ON claim_requests(status);
      `)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      db.exec('PRAGMA foreign_keys = ON')
      throw e
    }
    db.exec('PRAGMA foreign_keys = ON')
  } else {
    const cr = db.prepare(`PRAGMA table_info(claim_requests)`).all() as { name: string }[]
    if (!cr.some((c) => c.name === 'gdl_player_id')) {
      db.exec(`ALTER TABLE claim_requests ADD COLUMN gdl_player_id INTEGER`)
    }
  }

  // `sheet_placement`: the level's placement number as printed in the source
  // Google Sheet. The sheet numbers levels continuously across its tabs
  // (Main 1…, then each tier tab picks up where the previous left off), so it
  // is a real global ranking — but it drifts from our `position` because
  // levels appearing on several tabs collapse to one row. `position` stays the
  // ordering + URL key; `sheet_placement` is what the UI displays.
  if (!has('sheet_placement')) db.exec(`ALTER TABLE levels ADD COLUMN sheet_placement INTEGER`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_levels_sheet_placement ON levels(sheet_placement)`)

  // `sheet_rank`: the same number the sheet gave this level, but never handed
  // back out to another row.
  //
  // `sheet_placement` can't answer "where does the sheet put this level?" once
  // anything has moved. A placement number belongs to the *slot*, so every move
  // redistributes the numbers across the affected range — correct for display,
  // and it means the sheet's own ordering is gone the moment a curator drags
  // something. Nothing recorded it, so "put the list back the way the sheet has
  // it" had no source to read.
  //
  // Backfilled from `sheet_placement`, which is exactly right immediately after
  // an import and off only by whatever moves have happened since; the next ALL
  // import writes the real values.
  if (!has('sheet_rank')) {
    db.exec(`ALTER TABLE levels ADD COLUMN sheet_rank INTEGER`)
    db.exec(`UPDATE levels SET sheet_rank = sheet_placement`)
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_levels_sheet_rank ON levels(sheet_rank)`)

  // `site_only`: 1 when the ALL sheet has no level with this level's ID.
  //
  // This used to be inferred from `sheet_placement IS NULL`, which is a
  // different question — that column is cleared for any row a sheet row didn't
  // claim this run, including levels the sheet merely *renamed* and Solo/2P
  // pairs whose shared ID stops the importer matching them. Those are still on
  // the sheet, so calling them site-only was wrong. Recomputed from the sheet's
  // full ID set on every ALL import; the backfill reproduces the old behaviour
  // until that first import runs.
  //
  // Sits below `sheet_placement` on purpose: the backfill reads that column, so
  // it has to run after the migration that adds it.
  if (!has('site_only')) {
    db.exec(`ALTER TABLE levels ADD COLUMN site_only INTEGER NOT NULL DEFAULT 0`)
    db.exec(`UPDATE levels SET site_only = 1 WHERE sheet_placement IS NULL`)
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_levels_site_only ON levels(site_only)`)

  // Level comments reuse the existing `comments` table via a new target_kind.
  // SQLite can't widen a CHECK in place, so rebuild when 'level' is missing.
  const commentsSql = (db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='comments'`,
  ).get() as { sql: string } | undefined)?.sql ?? ''
  if (commentsSql && !commentsSql.includes("'level'")) {
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec('BEGIN')
    try {
      db.exec(`
        CREATE TABLE comments__new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          target_kind TEXT    NOT NULL CHECK(target_kind IN ('profile','progress','open_verification','level','custom_list')),
          target_id   INTEGER NOT NULL,
          body        TEXT    NOT NULL,
          created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO comments__new (id, account_id, target_kind, target_id, body, created_at)
          SELECT id, account_id, target_kind, target_id, body, created_at FROM comments;
        DROP TABLE comments;
        ALTER TABLE comments__new RENAME TO comments;
        CREATE INDEX IF NOT EXISTS idx_comments_target  ON comments(target_kind, target_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_comments_account ON comments(account_id);
      `)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      db.exec('PRAGMA foreign_keys = ON')
      throw e
    }
    db.exec('PRAGMA foreign_keys = ON')
  }

  // --- AREDL placement history ---
  // position_history.source: which list the entry originated from. 'all' =
  // native admin move on this site (the default); 'aredl' = imported from
  // AREDL's per-level history, with from/to converted to their equivalent
  // ALL placements. raw_from/raw_to keep the original AREDL positions so
  // the UI can show "AREDL #3 → #5" alongside the converted numbers.
  const phCols = db.prepare(`PRAGMA table_info(position_history)`).all() as { name: string }[]
  if (!phCols.some((c) => c.name === 'source')) {
    db.exec(`ALTER TABLE position_history ADD COLUMN source TEXT NOT NULL DEFAULT 'all'`)
  }
  if (!phCols.some((c) => c.name === 'raw_from_position')) {
    db.exec(`ALTER TABLE position_history ADD COLUMN raw_from_position INTEGER`)
  }
  if (!phCols.some((c) => c.name === 'raw_to_position')) {
    db.exec(`ALTER TABLE position_history ADD COLUMN raw_to_position INTEGER`)
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_position_history_source ON position_history(source)`)

  // Imported AREDL moves are no longer part of this list's history.
  //
  // They were written here so the changelog could show them, and the effect was
  // that a changelog of 1,777 entries described 1,774 movements that happened on
  // another site. AREDL's ranking is its own; it belongs beside ours on the
  // level graph — which still has the full trace in `aredl_position_history` —
  // not in the record of what the ALL did. Cleared at boot rather than only on
  // the next AREDL import so the changelog is correct immediately.
  const strayAredl = (db.prepare(
    `SELECT COUNT(*) AS n FROM position_history WHERE source = 'aredl'`,
  ).get() as { n: number }).n
  if (strayAredl > 0) {
    db.exec(`DELETE FROM position_history WHERE source = 'aredl'`)
    console.log(`[db] removed ${strayAredl} imported AREDL entries from the changelog`)
  }

  // --- Imported movements: suggestions an admin has decided against ---
  //
  // The suggestions themselves are computed on demand from the imported lists,
  // so there is nothing to store about them — but "the ALL disagrees with CCL
  // here on purpose" is a real answer that has to survive, or the tab shows the
  // same rejected rows forever.
  //
  // `source_position` is part of the record, not just the key: a dismissal says
  // "we disagree with what that list says *now*". When the source list re-ranks
  // the level its claim is new, and the suggestion comes back.
  db.exec(`
    CREATE TABLE IF NOT EXISTS imported_movement_dismissals (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source          TEXT    NOT NULL,
      level_id        INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
      source_position INTEGER NOT NULL,
      dismissed_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      dismissed_by    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      UNIQUE(source, level_id)
    );
    CREATE INDEX IF NOT EXISTS idx_imd_source ON imported_movement_dismissals(source);
  `)

  // --- Custom user lists (the home-page list builder) ---
  // A list belongs to an account (guests build in localStorage and save once
  // they sign in). public_id is a short random token used in share URLs so
  // list URLs aren't enumerable. Items either reference an ALL level
  // (level_id set; name/gd_id snapshotted for resilience) or are fully
  // hand-entered custom levels (level_id NULL).
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_lists (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id        TEXT    NOT NULL UNIQUE,
      owner_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      title            TEXT    NOT NULL DEFAULT 'My list',
      description      TEXT,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      is_public        INTEGER NOT NULL DEFAULT 0,
      likes            INTEGER NOT NULL DEFAULT 0,
      copied_from_id   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_custom_lists_owner ON custom_lists(owner_account_id);

    CREATE TABLE IF NOT EXISTS custom_list_items (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id          INTEGER NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
      sort_order       INTEGER NOT NULL,
      level_id         INTEGER REFERENCES levels(id) ON DELETE SET NULL,
      name             TEXT    NOT NULL,
      gd_id            INTEGER,
      creator          TEXT,
      difficulty       TEXT,
      gddl_tier        TEXT,
      verification_url TEXT,
      notes            TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_custom_list_items_list ON custom_list_items(list_id, sort_order);
  `)

  // Social columns on custom_lists. Present in the CREATE above for fresh DBs;
  // these ALTERs migrate databases made by the first version of the builder.
  // `is_public` opts a list into the public gallery, `likes` is denormalised
  // from custom_list_likes so the gallery sorts without a join, and
  // `copied_from_id` credits the list a copy was forked from.
  const clCols = db.prepare(`PRAGMA table_info(custom_lists)`).all() as { name: string }[]
  if (!clCols.some((c) => c.name === 'is_public')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0`)
  }
  if (!clCols.some((c) => c.name === 'likes')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN likes INTEGER NOT NULL DEFAULT 0`)
  }
  if (!clCols.some((c) => c.name === 'copied_from_id')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN copied_from_id INTEGER`)
  }
  db.exec(`
    -- Named bands a custom list divides itself into.
    --
    -- A tier owns every rank from from_rank until the next tier starts, so
    -- inserting or removing a level re-bands the list automatically; storing a
    -- range per tier would need rewriting on every reorder. from_rank is unique
    -- per list so two tiers can't claim the same boundary.
    CREATE TABLE IF NOT EXISTS custom_list_tiers (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id    INTEGER NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      color      TEXT,
      from_rank  INTEGER NOT NULL,
      UNIQUE(list_id, from_rank)
    );
    CREATE INDEX IF NOT EXISTS idx_custom_list_tiers_list ON custom_list_tiers(list_id, from_rank);

    CREATE TABLE IF NOT EXISTS custom_list_likes (
      list_id    INTEGER NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id)     ON DELETE CASCADE,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (list_id, account_id)
    );
    CREATE INDEX IF NOT EXISTS idx_custom_list_likes_list ON custom_list_likes(list_id);
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_custom_lists_public ON custom_lists(is_public, likes DESC)`)

  // --- Custom lists as full list sites ---
  // A custom list can run like a real demonlist: it accepts record
  // submissions, scores them, and ranks players on its own leaderboard.
  // `accepts_records` lets an owner run a read-only ranking instead.
  // `max_points` is the score the #1 level is worth; the last level is worth
  // `min_points` (see server/utils/custom-list-scoring.ts).
  if (!clCols.some((c) => c.name === 'accepts_records')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN accepts_records INTEGER NOT NULL DEFAULT 1`)
  }
  if (!clCols.some((c) => c.name === 'max_points')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN max_points REAL NOT NULL DEFAULT 250`)
  }
  if (!clCols.some((c) => c.name === 'min_points')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN min_points REAL NOT NULL DEFAULT 50`)
  }
  // Levels past this rank are worth nothing (a "legacy" tail). 0 = no cutoff.
  if (!clCols.some((c) => c.name === 'scored_count')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN scored_count INTEGER NOT NULL DEFAULT 0`)
  }

  // Per-item list metadata, mirroring what a GDListTemplate level file holds:
  // who verified it, the percentage a record must reach to count, and the
  // FPS / game version the placement assumes.
  const cliCols = db.prepare(`PRAGMA table_info(custom_list_items)`).all() as { name: string }[]
  if (!cliCols.some((c) => c.name === 'verifier')) {
    db.exec(`ALTER TABLE custom_list_items ADD COLUMN verifier TEXT`)
  }
  if (!cliCols.some((c) => c.name === 'percent_to_qualify')) {
    db.exec(`ALTER TABLE custom_list_items ADD COLUMN percent_to_qualify INTEGER NOT NULL DEFAULT 100`)
  }
  if (!cliCols.some((c) => c.name === 'fps')) {
    db.exec(`ALTER TABLE custom_list_items ADD COLUMN fps TEXT`)
  }
  if (!cliCols.some((c) => c.name === 'game_version')) {
    db.exec(`ALTER TABLE custom_list_items ADD COLUMN game_version TEXT`)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_list_records (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id      INTEGER NOT NULL REFERENCES custom_lists(id)      ON DELETE CASCADE,
      item_id      INTEGER NOT NULL REFERENCES custom_list_items(id) ON DELETE CASCADE,
      player_name  TEXT    NOT NULL COLLATE NOCASE,
      percent      INTEGER NOT NULL DEFAULT 100,
      hz           INTEGER,
      video        TEXT,
      mobile       INTEGER NOT NULL DEFAULT 0,
      note         TEXT,
      status       TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      reject_reason TEXT,
      submitted_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      submitted_at TEXT    NOT NULL DEFAULT (datetime('now')),
      decided_by   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      decided_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_clr_list   ON custom_list_records(list_id, status);
    CREATE INDEX IF NOT EXISTS idx_clr_item   ON custom_list_records(item_id, status);
    CREATE INDEX IF NOT EXISTS idx_clr_player ON custom_list_records(player_name COLLATE NOCASE);
    -- One approved/pending record per player per level; a re-submission for
    -- the same level replaces the old row rather than stacking up.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clr_unique
      ON custom_list_records(item_id, player_name COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS custom_list_packs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id    INTEGER NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      color      TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_clp_list ON custom_list_packs(list_id, sort_order);

    CREATE TABLE IF NOT EXISTS custom_list_pack_items (
      pack_id INTEGER NOT NULL REFERENCES custom_list_packs(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES custom_list_items(id) ON DELETE CASCADE,
      PRIMARY KEY (pack_id, item_id)
    );

    -- Collaborators an owner has invited to help run their list. Editors can
    -- change the list and moderate its records, but not delete the list or
    -- manage the editor roster — those stay with the owner.
    CREATE TABLE IF NOT EXISTS custom_list_editors (
      list_id    INTEGER NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id)     ON DELETE CASCADE,
      added_by   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (list_id, account_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cle_account ON custom_list_editors(account_id);

    -- Changelog for a custom list. Written whenever the list's contents move,
    -- so a list that other people follow can show what changed and when.
    -- item_id is nullable so an entry survives the level being removed.
    CREATE TABLE IF NOT EXISTS custom_list_changes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id       INTEGER NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
      item_id       INTEGER REFERENCES custom_list_items(id) ON DELETE SET NULL,
      level_name    TEXT    NOT NULL,
      kind          TEXT    NOT NULL CHECK(kind IN ('add','move','remove')),
      from_rank     INTEGER,
      to_rank       INTEGER,
      changed_by    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      changed_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_clc_list ON custom_list_changes(list_id, changed_at DESC);

    -- Levels submitted to a custom list by the public, awaiting an editor's
    -- decision. Approving one appends it to the list; rejecting keeps the row
    -- so the submitter can see the outcome.
    CREATE TABLE IF NOT EXISTS custom_list_pending (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id        INTEGER NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
      level_id       INTEGER REFERENCES levels(id) ON DELETE SET NULL,
      name           TEXT    NOT NULL,
      gd_id          INTEGER,
      creator        TEXT,
      verifier       TEXT,
      verification_url TEXT,
      suggested_rank INTEGER,
      note           TEXT,
      status         TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      reject_reason  TEXT,
      submitted_by   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      submitted_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      decided_by     INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      decided_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_clp_list ON custom_list_pending(list_id, status);

    -- Per-list Discord webhooks. Separate from the site-wide discord_webhooks
    -- table: these belong to a list owner, fire on that list's own events, and
    -- must never be visible to anyone but the list's editors.
    CREATE TABLE IF NOT EXISTS custom_list_webhooks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id       INTEGER NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
      url           TEXT    NOT NULL,
      label         TEXT,
      active        INTEGER NOT NULL DEFAULT 1,
      on_changes    INTEGER NOT NULL DEFAULT 1,
      on_records    INTEGER NOT NULL DEFAULT 1,
      on_submissions INTEGER NOT NULL DEFAULT 0,
      created_by    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      last_status   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_clw_list ON custom_list_webhooks(list_id, active);
  `)

  // Per-list branding: links shown in the list's own header so a community can
  // point at its Discord / YouTube without leaving the list.
  const clCols2 = db.prepare(`PRAGMA table_info(custom_lists)`).all() as { name: string }[]
  if (!clCols2.some((c) => c.name === 'discord_url')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN discord_url TEXT`)
  }
  if (!clCols2.some((c) => c.name === 'youtube_url')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN youtube_url TEXT`)
  }
  if (!clCols2.some((c) => c.name === 'accepts_submissions')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN accepts_submissions INTEGER NOT NULL DEFAULT 0`)
  }
  /**
   * What shape this list is.
   *
   * `ranked` is every list that existed before this column: an ordered 1..N
   * where rank is the whole point, and tiers (`custom_list_tiers`) are bands
   * drawn across that order.
   *
   * `gdsr` is the other shape, after the GDSR sheets — levels are sorted into
   * named difficulty tiers (Bronze, Silver, Gold, …) and rank means nothing
   * inside one. Those tiers are `custom_list_packs`, which already group items
   * explicitly rather than by rank band; the only thing a pack was missing is
   * the clear requirement below.
   */
  if (!clCols2.some((c) => c.name === 'kind')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN kind TEXT NOT NULL DEFAULT 'ranked'`)
  }

  /**
   * A ranked list's companion GDSR, if it has one.
   *
   * The two describe the same levels differently — one in order, one sorted
   * into tiers — and a community that keeps both wants readers to move between
   * them. Held on the ranked list rather than duplicated on both sides, so
   * there is one row to change and no way for the pair to disagree about who
   * points at whom. `ON DELETE SET NULL` is done by hand below, since SQLite
   * cannot add a foreign key to an existing table.
   */
  if (!clCols2.some((c) => c.name === 'linked_gdsr_id')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN linked_gdsr_id INTEGER`)
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cl_linked_gdsr ON custom_lists(linked_gdsr_id)`)
  // A deleted GDSR must not leave ranked lists pointing at nothing.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_cl_unlink_gdsr
    AFTER DELETE ON custom_lists
    BEGIN
      UPDATE custom_lists SET linked_gdsr_id = NULL WHERE linked_gdsr_id = OLD.id;
    END;
  `)

  /**
   * GDSR tiers.
   *
   * These began as `custom_list_packs`, which was the right shape and the wrong
   * table: a pack is a curator's grouping *within* a ranked list, and any list
   * can have both packs and tiers without meaning the same thing by them. A
   * GDSR's tiers are the list's structure, not an annotation on it, and giving
   * them their own table is what lets a pack stay a pack — and lets a tier own
   * things a pack has no business carrying, starting with `require_count`.
   *
   * `require_count` is the GDSR sheets' "Clear Any 9". NULL asks for all of the
   * tier's levels.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS gdsr_tiers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id       INTEGER NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
      name          TEXT    NOT NULL,
      color         TEXT,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      require_count INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_gdsr_tiers_list ON gdsr_tiers(list_id, sort_order);

    CREATE TABLE IF NOT EXISTS gdsr_tier_items (
      tier_id INTEGER NOT NULL REFERENCES gdsr_tiers(id)        ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES custom_list_items(id) ON DELETE CASCADE,
      PRIMARY KEY (tier_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_gdsr_tier_items_item ON gdsr_tier_items(item_id);
  `)

  /**
   * One-time move of any GDSR that was built while tiers were packs. Runs only
   * for lists that have packs and no tiers yet, so it cannot re-import a tier an
   * author has since deleted, and it leaves the packs alone — a GDSR that also
   * wanted packs keeps them.
   */
  const packCols = db.prepare(`PRAGMA table_info(custom_list_packs)`).all() as { name: string }[]
  const hasPackRequire = packCols.some((c) => c.name === 'require_count')
  const strays = db.prepare(`
    SELECT DISTINCT p.list_id
      FROM custom_list_packs p
      JOIN custom_lists cl ON cl.id = p.list_id
     WHERE cl.kind = 'gdsr'
       AND NOT EXISTS (SELECT 1 FROM gdsr_tiers t WHERE t.list_id = p.list_id)
  `).all() as { list_id: number }[]
  if (strays.length) {
    const insTier = db.prepare(
      `INSERT INTO gdsr_tiers (list_id, name, color, sort_order, require_count) VALUES (?,?,?,?,?)`,
    )
    const insItem = db.prepare(`INSERT OR IGNORE INTO gdsr_tier_items (tier_id, item_id) VALUES (?,?)`)
    for (const { list_id } of strays) {
      const packs = db.prepare(
        `SELECT id, name, color, sort_order${hasPackRequire ? ', require_count' : ''}
           FROM custom_list_packs WHERE list_id = ? ORDER BY sort_order ASC, id ASC`,
      ).all(list_id) as { id: number; name: string; color: string | null; sort_order: number; require_count?: number | null }[]
      for (const pk of packs) {
        const tierId = Number(insTier.run(list_id, pk.name, pk.color, pk.sort_order, pk.require_count ?? null).lastInsertRowid)
        for (const it of db.prepare(
          `SELECT item_id FROM custom_list_pack_items WHERE pack_id = ?`,
        ).all(pk.id) as { item_id: number }[]) insItem.run(tierId, it.item_id)
      }
      db.prepare(`DELETE FROM custom_list_packs WHERE list_id = ?`).run(list_id)
    }
    console.log(`[db-init] moved ${strays.length} GDSR list(s) from packs to tiers`)
  }
  // Presentation: a list's own icon and accent colour, so a community's list
  // reads as theirs rather than as a generic entry in the gallery.
  if (!clCols2.some((c) => c.name === 'icon_url')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN icon_url TEXT`)
  }
  if (!clCols2.some((c) => c.name === 'accent_color')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN accent_color TEXT`)
  }
  if (!clCols2.some((c) => c.name === 'banner_url')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN banner_url TEXT`)
  }
  // When set, the list orders itself by its levels' ALL placements instead of
  // the order they were dragged into. Applied when the list is read, so it
  // tracks the ALL list continuously rather than snapshotting it. Off by
  // default: a custom list is normally somebody's own opinion about ordering.
  if (!clCols2.some((c) => c.name === 'follow_all_order')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN follow_all_order INTEGER NOT NULL DEFAULT 0`)
  }
  // Whether a record on this list has to link a video. On by default, because
  // proof is the norm — but a list run inside a community that already trusts
  // its members, or one tracking something a video can't show, shouldn't have
  // to reject every submission for a field it doesn't care about.
  if (!clCols2.some((c) => c.name === 'require_record_video')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN require_record_video INTEGER NOT NULL DEFAULT 1`)
  }
  // Whether the list says out loud which of its levels the ALL carries: those
  // get their tier colour, the rest go grey, and each level page prints an "on
  // the ALL list" row. On by default, because most custom lists are read
  // alongside the main one. A list that stands on its own turns it off and
  // every rank badge takes a colour from where it sits, exactly as the ALL's
  // own rows do — see `utils/custom-list-colors.ts`.
  if (!clCols2.some((c) => c.name === 'mark_off_all')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN mark_off_all INTEGER NOT NULL DEFAULT 1`)
  }

  /**
   * How the list draws itself.
   *
   * All default to what the list already looked like, so every existing list
   * renders identically until somebody changes something. They are stored on
   * the list rather than kept as a per-visitor preference because they are the
   * owner's presentation choices — a list built as a wall of level art should
   * look that way to everyone who opens the link.
   */
  for (const [col, def] of [
    // The banner image has been storable since 1.3 and was never rendered.
    ['show_banner', 1],
    ['show_thumbnails', 1],
    ['show_points', 1],
    ['show_records', 1],
    ['compact_rows', 0],
    // The editor roster, shown the way other list sites show their staff.
    ['show_editors', 1],
    /*
     * Three facts a list may not have an opinion about.
     *
     * The list UI was built assuming every list is a demon list — so it always
     * drew a GDDL tier, a difficulty and a link back to the level's placement
     * on the ALL. For a list of, say, someone's favourite platformers, or a
     * challenge list using its own tiering, those are not merely unwanted:
     * "Tier 14" and "Insane Demon" are *assertions*, and an empty tier chip on
     * every row is the list saying it failed to look something up rather than
     * that the question doesn't apply.
     */
    ['show_tier', 1],
    ['show_difficulty', 1],
    ['show_level_links', 1],
  ] as const) {
    if (!clCols2.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE custom_lists ADD COLUMN ${col} INTEGER NOT NULL DEFAULT ${def}`)
    }
  }

  /*
   * What a row does when the name doesn't fit.
   *
   * `truncate` is what every list has always done — one line, cut off with an
   * ellipsis — and it is the wrong default for a lot of lists without being the
   * wrong default for all of them. Level names in this game run long and are
   * routinely distinguished only at the end ("Cataclysm", "Cataclysm II",
   * "Nine Circles but it's actually good"), so a panel 16rem wide can show a
   * column of rows that are visibly different levels and identical text.
   *
   * `wrap` lets the name take a second line; `scale` keeps one line and drops
   * the type size for names that need it. Which is right depends on whether the
   * list would rather stay dense or stay legible, which is the owner's call.
   */
  if (!clCols2.some((c) => c.name === 'name_display')) {
    db.exec(`ALTER TABLE custom_lists ADD COLUMN name_display TEXT NOT NULL DEFAULT 'truncate'`)
  }

  // Per-row overrides of the fields a linked level otherwise mirrors from the
  // ALL. NULL means "follow the main list", which is what every existing row
  // does and stays doing. Kept in separate columns rather than written over the
  // mirrored ones so the two answers never get confused for each other: the
  // list can always say what the ALL thinks *and* what it thinks.
  const cliCols2 = db.prepare(`PRAGMA table_info(custom_list_items)`).all() as { name: string }[]
  for (const col of ['ov_name', 'ov_creator', 'ov_difficulty', 'ov_gddl_tier', 'ov_verification_url']) {
    if (!cliCols2.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE custom_list_items ADD COLUMN ${col} TEXT`)
    }
  }

  // Full raw AREDL per-level trace (every event, including passive ±1 shifts
  // caused by other levels being placed/removed). Powers the position-over-time
  // graph on the level page; the coarser self-move entries go into
  // position_history so they surface in the changelog.
  db.exec(`
    CREATE TABLE IF NOT EXISTS aredl_position_history (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      level_id       INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
      gd_id          INTEGER,
      event          TEXT    NOT NULL,
      aredl_position INTEGER,
      all_position   INTEGER,
      position_diff  INTEGER,
      legacy         INTEGER NOT NULL DEFAULT 0,
      cause_name     TEXT,
      action_at      TEXT    NOT NULL,
      fetched_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aredl_pos_hist_level ON aredl_position_history(level_id, action_at);
  `)

  /**
   * How much the site is read.
   *
   * Three tables, deliberately small, and none of them a log of who did what:
   *
   *   page_views     one row per path per day, counting views
   *   visit_uniques  one row per visitor per day, counting people
   *   level_views    one running total per level
   *
   * `path` is the *shape* of the URL — `/levels/:position`, not `/levels/4021`
   * — so a day of browsing is thirty rows rather than one per level visited.
   * Per-level numbers are the third table, keyed on the level's id: a level's
   * position moves every time something is placed above it, so counting by
   * position would follow the slot rather than the level.
   *
   * `visitor` is a salted daily hash of address and user agent (see
   * `server/utils/analytics.ts`). It cannot be turned back into either, it
   * changes every day, and it exists only so "views" and "people" can be
   * different numbers. Nothing here stores an address, a name or an account.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_views (
      day   TEXT    NOT NULL,
      path  TEXT    NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, path)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_page_views_day ON page_views(day);

    -- One row per person per day. The hours column is a 24-bit mask: bit 9 set
    -- means this reader was here some time between 09:00 and 10:00 UTC.
    --
    -- A mask rather than a table. "How many people were here at 3pm" is a
    -- question about people, so it cannot be answered by dividing the hourly
    -- view counts -- one person reading forty pages is forty views and one
    -- person, and the whole tab exists to keep those apart. The obvious shape
    -- is a row per person per hour, which is twenty-four times this table for
    -- one extra fact per row. An integer holds the same fact exactly, costs
    -- nothing per hour, and folds with OR, so concurrent writes cannot lose a
    -- bit the way a read-modify-write would.
    CREATE TABLE IF NOT EXISTS visit_uniques (
      day     TEXT NOT NULL,
      visitor TEXT NOT NULL,
      hours   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, visitor)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS level_views (
      level_id       INTEGER PRIMARY KEY REFERENCES levels(id) ON DELETE CASCADE,
      views          INTEGER NOT NULL DEFAULT 0,
      last_viewed_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_level_views_views ON level_views(views DESC);

    -- The same, for profiles. Counted against the account rather than the
    -- username so a rename keeps the number, and never incremented by the
    -- owner: a count that goes up every time you check your own page is a
    -- count of you.
    CREATE TABLE IF NOT EXISTS profile_views (
      account_id     INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      views          INTEGER NOT NULL DEFAULT 0,
      last_viewed_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Small key/value store for the things the site has to remember about
    -- itself. First use is the salt above, which has to survive a restart or
    -- every restart would start counting the same person as somebody new.
    CREATE TABLE IF NOT EXISTS site_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) WITHOUT ROWID;

    -- The same page views, split by hour of the day (UTC).
    --
    -- A day total says how much the site is read; the hours say *when*, which
    -- is the number that tells you when to post something and when a spike was
    -- one person refreshing at 3am. Twenty-four rows a day, so a year of this
    -- is under nine thousand rows.
    CREATE TABLE IF NOT EXISTS page_views_hourly (
      day   TEXT    NOT NULL,
      hour  INTEGER NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, hour)
    ) WITHOUT ROWID;

    -- Which accounts were here on a given day, and which of them actually
    -- signed in.
    --
    -- Two different questions and one table, because "logged in today" is
    -- almost never what someone wants: a session lasts weeks, so counting
    -- login *events* would report a handful of people on a busy day. The row
    -- existing means the account was here; the logins column counts the times
    -- it typed a password.
    CREATE TABLE IF NOT EXISTS account_days (
      day        TEXT    NOT NULL,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      logins     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, account_id)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_account_days_day ON account_days(day);

    -- Per-level views, by day.
    --
    -- level_views is the running total and answers "how many"; this answers
    -- "how many *lately*", which is the only way a most-viewed list can respect
    -- the date range shown above it. One row per level actually opened per day,
    -- so it grows with traffic rather than with the size of the list.
    CREATE TABLE IF NOT EXISTS level_view_days (
      day      TEXT    NOT NULL,
      level_id INTEGER NOT NULL,
      views    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, level_id)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_level_view_days_day ON level_view_days(day);

    -- The same pair for a custom list. Somebody who builds a list wants to know
    -- whether anybody read it, and until now the site could not say.
    CREATE TABLE IF NOT EXISTS custom_list_views (
      list_id        INTEGER PRIMARY KEY REFERENCES custom_lists(id) ON DELETE CASCADE,
      views          INTEGER NOT NULL DEFAULT 0,
      last_viewed_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS custom_list_view_days (
      day     TEXT    NOT NULL,
      list_id INTEGER NOT NULL,
      views   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, list_id)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_custom_list_view_days_day ON custom_list_view_days(day);
  `)

  // A database that predates the mask has rows without it. Zero is the honest
  // value for those days: it means "we were not recording the hour", and the
  // hourly figures divide by the days that actually carry data rather than by
  // the window, so an un-recorded day lowers nothing.
  const visitCols = db.prepare(`PRAGMA table_info(visit_uniques)`).all() as { name: string }[]
  if (!visitCols.some((c) => c.name === 'hours')) {
    db.exec(`ALTER TABLE visit_uniques ADD COLUMN hours INTEGER NOT NULL DEFAULT 0`)
  }

  /**
   * Clans — groups of players, ranked together.
   *
   * A clan's numbers are the *sum of its members'*, which is the whole point:
   * nothing is stored about a clan's completions, because a completion belongs
   * to a player and a player belongs to a clan. Everything the leaderboard
   * shows is derived from `records` through the membership table, so a member
   * joining or leaving moves the clan's standing without anything being
   * recalculated or copied.
   *
   * `tag` is the short name that appears beside a member's name — three to six
   * characters, unique, and case-insensitive so two clans can't take "TSK" and
   * "tsk". `owner_account_id` can appoint others; membership is one clan per
   * account, enforced by the primary key on `account_id`.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS clans (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tag         TEXT    NOT NULL COLLATE NOCASE,
      name        TEXT    NOT NULL,
      description TEXT,
      color       TEXT,
      icon_url    TEXT,
      banner_url  TEXT,
      discord_url TEXT,
      /** 0 = anyone can join, 1 = the owner adds people. */
      invite_only INTEGER NOT NULL DEFAULT 0,
      owner_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (tag)
    );

    CREATE TABLE IF NOT EXISTS clan_members (
      account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      clan_id    INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
      role       TEXT    NOT NULL DEFAULT 'member',
      joined_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_clan_members_clan ON clan_members(clan_id);

    -- Asking to join a clan that doesn't take walk-ins. Removed on accept or
    -- decline; a clan's owner sees them on the clan's page.
    CREATE TABLE IF NOT EXISTS clan_join_requests (
      clan_id    INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      message    TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (clan_id, account_id)
    );

    -- The other direction: a clan asking somebody in.
    --
    -- Deliberately its own table rather than a flag on the request above. The
    -- two look symmetrical and are not: a request is answered by the owner and
    -- an invite is answered by the person, so the same row would need to record
    -- who is allowed to accept it. Two tables say that by existing, and mean an
    -- invite and a request can be outstanding at once without one silently
    -- overwriting the other.
    --
    -- An account can hold invites from several clans at once; the primary key
    -- is the pair, not the account.
    CREATE TABLE IF NOT EXISTS clan_invites (
      clan_id    INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      invited_by INTEGER          REFERENCES accounts(id) ON DELETE SET NULL,
      message    TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (clan_id, account_id)
    );
    CREATE INDEX IF NOT EXISTS idx_clan_invites_account ON clan_invites(account_id);
  `)

  // --- A custom list can call one of its levels a challenge ---
  //
  // The ALL works this out for itself (see `server/utils/challenge-expr.ts`):
  // four inferences over the level's rating, length and source, with an
  // editorial override in each direction. None of that is available to a custom
  // list, whose rows may not be on the ALL at all — so here it is simply what
  // the list's editors say it is. A flag, not an expression.
  const cliChallengeCols = db.prepare(`PRAGMA table_info(custom_list_items)`).all() as { name: string }[]
  if (!cliChallengeCols.some((c) => c.name === 'is_challenge')) {
    db.exec(`ALTER TABLE custom_list_items ADD COLUMN is_challenge INTEGER NOT NULL DEFAULT 0`)
  }

  /**
   * A level nobody has verified yet.
   *
   * GDSR lists carry these routinely — a tier is drafted with the levels it
   * will contain before anyone has cleared them — and they are not the same as
   * a level with no record: the level itself is unbeaten, so it cannot be
   * cleared by anybody and must not count toward a tier's requirement or the
   * denominator of the leaderboard. A flag rather than an inference, because
   * "no records yet" and "unverified" look identical in the data and mean
   * opposite things to a player reading the list.
   */
  if (!cliChallengeCols.some((c) => c.name === 'unverified')) {
    db.exec(`ALTER TABLE custom_list_items ADD COLUMN unverified INTEGER NOT NULL DEFAULT 0`)
  }

  // AREDL mirrors each player's Discord avatar hash. Paired with `discord_id`
  // it is a CDN URL, which is the only picture the site can show for a player
  // who has never signed up here — see `utils/discord-avatar.ts`.
  const apCols = db.prepare(`PRAGMA table_info(aredl_players)`).all() as { name: string }[]
  if (!apCols.some((c) => c.name === 'discord_avatar')) {
    db.exec(`ALTER TABLE aredl_players ADD COLUMN discord_avatar TEXT`)
  }

  // Clan imagery, uploaded rather than linked.
  //
  // `icon_url` and `banner_url` already existed and stay: a clan that already
  // points at an image somewhere keeps working. These are the uploaded copy,
  // stored the way an account's avatar is, and they win over the URL when set —
  // an upload is a deliberate act and a stale URL is not.
  const clanCols = db.prepare(`PRAGMA table_info(clans)`).all() as { name: string }[]
  for (const [col, type] of [
    ['icon_blob', 'BLOB'], ['icon_type', 'TEXT'],
    ['banner_blob', 'BLOB'], ['banner_type', 'TEXT'],
  ] as const) {
    if (!clanCols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE clans ADD COLUMN ${col} ${type}`)
    }
  }

  // SQL `--` comments throughout the block below, and no backticks in them:
  // this is one template literal, and a backtick inside it ends the string.
  db.exec(`
    -- Friendship, in two tables.
    --
    -- A follow is one-sided and needs no consent; a friendship is mutual and
    -- does. They are kept apart rather than folded together because they answer
    -- different questions — "whose activity do I want to see" versus "who am I
    -- actually connected to" — and because collapsing them would mean either
    -- following somebody silently befriended them, or asking permission to
    -- read a public feed.
    --
    -- A request is one row from → to. Accepting it deletes the request and
    -- writes the pair into friends.
    CREATE TABLE IF NOT EXISTS friend_requests (
      from_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      to_account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      message         TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (from_account_id, to_account_id),
      CHECK (from_account_id <> to_account_id)
    );
    CREATE INDEX IF NOT EXISTS idx_friend_req_to   ON friend_requests(to_account_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_friend_req_from ON friend_requests(from_account_id, created_at DESC);

    -- Both directions of every friendship, as two rows.
    --
    -- The alternative — one row with the lower id first — makes "who are A's
    -- friends" a query with an OR across two columns and a CASE to work out
    -- which end is the other person. Two rows makes it a primary-key range
    -- scan, and every write goes through addFriendship in
    -- server/utils/friends.ts, which is what keeps the pair in step.
    CREATE TABLE IF NOT EXISTS friends (
      account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      friend_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, friend_id),
      CHECK (account_id <> friend_id)
    );
    CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend_id);

    -- The public forum.
    --
    -- A thread is a title plus a first post; replies are forum_posts rows
    -- pointing at it. level_id optionally ties a thread to a level, which is
    -- what makes "talk about levels" more than a free-text board — a level's
    -- own page can list the threads about it.
    --
    -- last_post_at is denormalised so the index can order the thread list
    -- without touching the posts table; reply_count likewise. Both are
    -- maintained by server/utils/forum.ts and by nothing else.
    CREATE TABLE IF NOT EXISTS forum_threads (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      category     TEXT    NOT NULL DEFAULT 'general'
                     CHECK(category IN ('general','levels','progress','help','offtopic')),
      title        TEXT    NOT NULL,
      body         TEXT    NOT NULL,
      author_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      level_id     INTEGER REFERENCES levels(id)   ON DELETE SET NULL,
      pinned       INTEGER NOT NULL DEFAULT 0,
      locked       INTEGER NOT NULL DEFAULT 0,
      reply_count  INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      last_post_at TEXT    NOT NULL DEFAULT (datetime('now')),
      edited_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_forum_threads_recent
      ON forum_threads(pinned DESC, last_post_at DESC);
    CREATE INDEX IF NOT EXISTS idx_forum_threads_cat
      ON forum_threads(category, pinned DESC, last_post_at DESC);
    CREATE INDEX IF NOT EXISTS idx_forum_threads_level ON forum_threads(level_id);
    CREATE INDEX IF NOT EXISTS idx_forum_threads_author ON forum_threads(author_id);

    CREATE TABLE IF NOT EXISTS forum_posts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id  INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
      author_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      body       TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      edited_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_forum_posts_thread ON forum_posts(thread_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_forum_posts_author ON forum_posts(author_id);

    -- One like per account per thread — the forum's only reaction.
    CREATE TABLE IF NOT EXISTS forum_thread_likes (
      thread_id  INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id)      ON DELETE CASCADE,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (thread_id, account_id)
    );
    CREATE INDEX IF NOT EXISTS idx_forum_likes_thread ON forum_thread_likes(thread_id);
  `)

  widenRoleCheck(db)

  /**
   * Email, and whether it has been proved.
   *
   * Added rather than made part of `accounts`' CREATE so existing databases
   * gain them without a rebuild. All three are nullable: every account that
   * existed before this shipped has no address, and forcing one on them
   * retroactively would lock out the whole site.
   *
   * `email_verified_at` is a timestamp, not a boolean, because "when" is a
   * question support actually gets asked and a boolean cannot answer it.
   */
  const emailCols = db.prepare(`PRAGMA table_info(accounts)`).all() as { name: string }[]
  for (const [col, type] of [
    ['email', 'TEXT'],
    ['email_verified_at', 'TEXT'],
    /** Set when a change of address is pending; the old one stays live until proved. */
    ['pending_email', 'TEXT'],
  ] as const) {
    if (!emailCols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE accounts ADD COLUMN ${col} ${type}`)
    }
  }
  /**
   * One account per address, case-insensitively, but only among *verified*
   * ones.
   *
   * A partial index rather than a plain unique constraint: an unverified
   * address is a claim, not a fact, and letting an unproved row reserve an
   * address would let anybody deny an address to its real owner by signing up
   * with it first. Two people may hold the same unverified address; the first
   * to prove it gets it, and the other's claim is cleared on verification.
   */
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email_verified
      ON accounts(email COLLATE NOCASE) WHERE email_verified_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email COLLATE NOCASE);

    /**
     * Tokens for anything sent to an address to be clicked.
     *
     * One table for verification and password reset: both are "prove you can
     * read this inbox", both expire, both must be single-use, and two tables
     * would be two chances to forget one of those properties.
     *
     * Only a *hash* of the token is stored. The token itself exists in the
     * email and nowhere else, so a copy of this table is not a set of working
     * links — the same reason password_hash exists rather than password.
     */
    CREATE TABLE IF NOT EXISTS email_tokens (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      kind       TEXT    NOT NULL CHECK(kind IN ('verify','reset')),
      token_hash TEXT    NOT NULL UNIQUE,
      /** The address it was sent to — a change of address must not be provable by an old link. */
      email      TEXT    NOT NULL,
      expires_at TEXT    NOT NULL,
      used_at    TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_email_tokens_account ON email_tokens(account_id, kind);
    CREATE INDEX IF NOT EXISTS idx_email_tokens_expiry  ON email_tokens(expires_at);

    /**
     * Rate limiting, kept in the database rather than in memory.
     *
     * In-memory counters are per process and reset on deploy, which makes them
     * a speed bump rather than a limit: restart the app and the budget is back.
     * These survive both. One row per (bucket, subject, window) — see
     * server/utils/rate-limit.ts.
     */
    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket     TEXT    NOT NULL,
      subject    TEXT    NOT NULL,
      window_start INTEGER NOT NULL,
      count      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (bucket, subject, window_start)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);
  `)

  db.exec(`
    /**
     * Everything that happens to the list, in one place.
     *
     * The admin panel could already answer "what is waiting for me?" — it had a
     * queue per kind of submission. It could not answer "what happened?", which
     * is the question you ask when something is wrong: who moved that level,
     * who approved that record, when did this account's role change. Each of
     * those facts existed, scattered across the table that stores the thing it
     * happened to, and several of them existed nowhere at all.
     *
     * One append-only row per action. 'kind' is a dotted path ('level.move',
     * 'record.approve', 'report.resolve') so a section of the log is a prefix
     * match rather than a list of every event it should contain, and adding an
     * event never means updating a filter to know about it.
     *
     * 'detail' is JSON and is for reading, not for querying — the columns
     * beside it carry anything the log is filtered or grouped by. Actor and
     * subject are both nullable: the importer has no actor, and a deleted level
     * still has a log entry describing its deletion.
     */
    CREATE TABLE IF NOT EXISTS activity_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      kind          TEXT    NOT NULL,
      /** Broad bucket, so the page's sections are one indexed comparison. */
      area          TEXT    NOT NULL
                      CHECK(area IN ('levels','records','accounts','reports','lists','moderation','system')),
      actor_id      INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      /** Denormalised: the log outlives the account, and must still name them. */
      actor_name    TEXT,
      actor_role    TEXT,
      subject_kind  TEXT,
      subject_id    INTEGER,
      /** Denormalised for the same reason as actor_name. */
      subject_label TEXT,
      summary       TEXT    NOT NULL,
      detail        TEXT,
      /** Set when an action needs a second pair of eyes — see reports. */
      severity      TEXT    NOT NULL DEFAULT 'info'
                      CHECK(severity IN ('info','notable','warning')),
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_activity_recent   ON activity_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_area     ON activity_log(area, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_actor    ON activity_log(actor_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_kind     ON activity_log(kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_subject  ON activity_log(subject_kind, subject_id);
    CREATE INDEX IF NOT EXISTS idx_activity_severity ON activity_log(severity, created_at DESC);
  `)

  /*
   * Undo, recorded on the entry that was undone.
   *
   * The log stays append-only: undoing something does not erase it, it performs
   * the inverse action and writes a *second* entry. These columns are the link
   * between the two, and the reason an entry can only be undone once — without
   * them, two admins looking at the same row both press Undo and the second one
   * reverses the first one's reversal.
   */
  const logCols = db.prepare(`PRAGMA table_info(activity_log)`).all() as { name: string }[]
  if (!logCols.some((c) => c.name === 'undone_at')) {
    db.exec(`ALTER TABLE activity_log ADD COLUMN undone_at TEXT`)
  }
  if (!logCols.some((c) => c.name === 'undone_by')) {
    db.exec(`ALTER TABLE activity_log ADD COLUMN undone_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL`)
  }
  if (!logCols.some((c) => c.name === 'undone_by_name')) {
    // Denormalised for the same reason `actor_name` is: the log outlives the
    // account, and "undone by someone" answers nothing.
    db.exec(`ALTER TABLE activity_log ADD COLUMN undone_by_name TEXT`)
  }

  db.exec(`
    /**
     * Reports, of anything.
     *
     * One table rather than one per kind: a report is the same object whatever
     * it points at — somebody said this is wrong, a moderator agreed or didn't
     * — and five tables would mean five queues, five endpoints and five places
     * to forget to check. 'target_kind' says what is being reported and
     * 'target_id' which one.
     *
     * 'reason' is a fixed vocabulary because a free-text-only report cannot be
     * triaged: "impossible" and "removal" are the two the list itself acts on,
     * and 'staff_abuse' is deliberately in the same list as the rest. A helper
     * or moderator who oversteps is exactly the case a reporting system has to
     * cover, and routing it somewhere separate would mean the people being
     * reported are the ones who see it first — see 'visibleToStaff' in
     * 'server/utils/reports.ts'.
     */
    CREATE TABLE IF NOT EXISTS reports (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      target_kind   TEXT    NOT NULL
                      CHECK(target_kind IN ('account','comment','custom_list','level','forum_thread','forum_post')),
      target_id     INTEGER NOT NULL,
      /** What the target was called when reported; it may be gone by review. */
      target_label  TEXT,
      reason        TEXT    NOT NULL
                      CHECK(reason IN (
                        'spam','abuse','impersonation','inappropriate',
                        'wrong_placement','impossible','removal_request',
                        'staff_abuse','other'
                      )),
      details       TEXT,
      reporter_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      reporter_name TEXT,
      status        TEXT    NOT NULL DEFAULT 'open'
                      CHECK(status IN ('open','actioned','dismissed')),
      resolution    TEXT,
      resolved_by   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      resolved_at   TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reports_open   ON reports(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_kind, target_id);
    CREATE INDEX IF NOT EXISTS idx_reports_reason ON reports(reason, status);
    /**
     * One open report per person per thing. A disagreement is not made truer by
     * being filed nine times, and without this the queue is trivially floodable.
     */
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_one_per_reporter
      ON reports(target_kind, target_id, reporter_id) WHERE status = 'open';

    /**
     * What a list helper has asked for.
     *
     * A helper places levels and accepts submissions directly — those are their
     * job. Moving a level that is already placed, and changing whether a level
     * counts as a challenge, are not: both rewrite what the list *says*, and
     * both are reversible only by someone noticing. So they become requests,
     * and an admin applies or refuses them.
     *
     * Deliberately its own table rather than a flag on 'pending_movements':
     * that queue is for movements imported from other lists and carries their
     * shape. This one carries who asked, what they asked for, and why.
     */
    CREATE TABLE IF NOT EXISTS helper_requests (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      kind          TEXT    NOT NULL CHECK(kind IN ('move','challenge','unchallenge','remove')),
      level_id      INTEGER REFERENCES levels(id) ON DELETE CASCADE,
      /** Kept so a request still reads sensibly if the level goes. */
      level_name    TEXT    NOT NULL,
      level_position INTEGER,
      /** Where the helper wants it. Only meaningful for a move request. */
      to_position   INTEGER,
      reason        TEXT,
      requested_by  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      requester_name TEXT,
      status        TEXT    NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending','applied','rejected')),
      decided_by    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      decided_at    TEXT,
      decision_note TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_helper_req_open ON helper_requests(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_helper_req_who  ON helper_requests(requested_by, created_at DESC);
  `)
}

/**
 * Let `accounts.role` hold 'list_helper'.
 *
 * The column carries a CHECK constraint listing every valid role, and SQLite
 * cannot alter one — the table has to be rebuilt. It has also gained around
 * twenty columns since the last time that was done by hand, and an enumerated
 * rebuild is a list that goes stale the moment somebody adds the twenty-first.
 *
 * So this rebuilds from what the database actually has: the table's own CREATE
 * statement with the role list rewritten, its real column list from
 * `table_info`, and its indexes replayed from `sqlite_master`. Adding a role
 * later means changing the literal below and nothing else.
 */
function widenRoleCheck(db: DatabaseSync) {
  const row = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounts'`,
  ).get() as { sql: string } | undefined
  const sql = row?.sql ?? ''
  if (!sql || sql.includes("'list_helper'")) return

  // The whole role list, replaced as one unit. Matching on the closing paren of
  // the IN(...) keeps this from touching anything else in the statement.
  const widened = sql.replace(
    /CHECK\s*\(\s*role\s+IN\s*\([^)]*\)\s*\)/i,
    `CHECK(role IN ('user','list_helper','moderator','admin','owner','developer'))`,
  )
  if (widened === sql) return // Shape not recognised — leave it alone rather than guess.

  const columns = (db.prepare(`PRAGMA table_info(accounts)`).all() as { name: string }[])
    .map((c) => `"${c.name}"`)
    .join(', ')
  const indexes = (db.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'accounts' AND sql IS NOT NULL`,
  ).all() as { sql: string }[]).map((i) => i.sql)

  // Many tables FK-reference accounts(id). SQLite's documented procedure for
  // swapping a table with incoming references: foreign keys off, swap inside a
  // transaction, back on.
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('BEGIN')
  try {
    db.exec(widened.replace(/^CREATE TABLE\s+"?accounts"?/i, 'CREATE TABLE accounts__new'))
    db.exec(`INSERT INTO accounts__new (${columns}) SELECT ${columns} FROM accounts`)
    db.exec(`DROP TABLE accounts`)
    db.exec(`ALTER TABLE accounts__new RENAME TO accounts`)
    for (const index of indexes) db.exec(index)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    db.exec('PRAGMA foreign_keys = ON')
    throw e
  }
  db.exec('PRAGMA foreign_keys = ON')
}
