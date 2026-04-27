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
      id              INTEGER PRIMARY KEY,
      position        INTEGER NOT NULL UNIQUE,
      name            TEXT    NOT NULL,
      creator         TEXT    NOT NULL,
      verifier        TEXT    NOT NULL,
      verification    TEXT,
      song            TEXT,
      gd_id           INTEGER,
      min_percent     INTEGER NOT NULL DEFAULT 100,
      tags            TEXT    NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_levels_name      ON levels(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_levels_creator   ON levels(creator COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_levels_position  ON levels(position);

    CREATE TABLE IF NOT EXISTS players (
      id        INTEGER PRIMARY KEY,
      name      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      country   TEXT
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
  `)
}

/**
 * AREDL-style points curve. Top of the list is worth the most; points
 * decay smoothly toward `tail` at `legacyAt`, then 0 beyond that.
 */
export function pointsForPosition(position: number, opts: { listSize: number; head?: number; tail?: number; legacyAt?: number }) {
  const head = opts.head ?? 500
  const tail = opts.tail ?? 1
  const legacyAt = opts.legacyAt ?? Math.min(opts.listSize, 2000)
  if (position < 1) return 0
  if (position > legacyAt) return 0
  const t = (position - 1) / Math.max(1, legacyAt - 1)
  const value = head * Math.pow(tail / head, t)
  return Math.round(value * 100) / 100
}
