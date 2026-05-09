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
  if (!accCols.some((c) => c.name === 'favorite_level_id')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN favorite_level_id INTEGER REFERENCES levels(id) ON DELETE SET NULL`)
  }
  if (!accCols.some((c) => c.name === 'favorite_level_note')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN favorite_level_note TEXT`)
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
}
