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
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      level_id   INTEGER NOT NULL REFERENCES levels(id)  ON DELETE CASCADE,
      player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      percent    INTEGER NOT NULL,
      hz         INTEGER,
      video      TEXT,
      verified   INTEGER NOT NULL DEFAULT 1,
      UNIQUE(level_id, player_id)
    );
    CREATE INDEX IF NOT EXISTS idx_records_level    ON records(level_id);
    CREATE INDEX IF NOT EXISTS idx_records_player   ON records(player_id);

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

  db.exec(`CREATE INDEX IF NOT EXISTS idx_levels_creator   ON levels(creator COLLATE NOCASE)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_levels_permanent ON levels(permanent)`)
}
