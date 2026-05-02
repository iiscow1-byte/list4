import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const DB_PATH = process.env.LIST_DB_PATH || resolve(process.cwd(), 'data', 'list.db')

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
      role            TEXT    NOT NULL DEFAULT 'user' CHECK(role IN ('user','moderator','admin')),
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
  // overriding the auto-computed point value.
  if (!has('same_as_above')) db.exec(`ALTER TABLE levels ADD COLUMN same_as_above INTEGER NOT NULL DEFAULT 0`)

  // Accounts: banned_at = ISO timestamp when an admin banned the account.
  // NULL = active. Sessions for banned accounts are rejected at the auth layer.
  const accCols = db.prepare(`PRAGMA table_info(accounts)`).all() as { name: string }[]
  if (!accCols.some((c) => c.name === 'banned_at')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN banned_at TEXT`)
  }
  if (!accCols.some((c) => c.name === 'banned_reason')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN banned_reason TEXT`)
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_levels_creator   ON levels(creator COLLATE NOCASE)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_levels_permanent ON levels(permanent)`)

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
    CREATE INDEX IF NOT EXISTS idx_position_history_level ON position_history(level_id, changed_at);
  `)

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
}
