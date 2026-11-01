-- IJ3C site: content + admin tables (Cloudflare D1 / SQLite)

-- Free-form site texts (headings, hero, contact details, ...). Keys are defined in src/settings.js.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- "Aims & Scopes" cards. `items` holds one bullet per line.
CREATE TABLE topics (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  sort  INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT ''
);

-- Published issues. The public URL is /volume/<volume>-<number>.
CREATE TABLE issues (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  volume       INTEGER NOT NULL CHECK (volume > 0),
  number       INTEGER NOT NULL CHECK (number > 0),
  pub_date     TEXT NOT NULL,
  description  TEXT NOT NULL,
  issn         TEXT NOT NULL,
  cover_pdf    TEXT,
  contents_pdf TEXT,
  published    INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  UNIQUE (volume, number)
);

CREATE TABLE papers (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
  sort     INTEGER NOT NULL DEFAULT 0,
  title    TEXT NOT NULL,
  authors  TEXT NOT NULL DEFAULT '',
  pdf      TEXT
);
CREATE INDEX idx_papers_issue ON papers (issue_id, sort);

-- Editorial board groups. `members` holds one person per line.
CREATE TABLE board_groups (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  sort    INTEGER NOT NULL DEFAULT 0,
  title   TEXT NOT NULL,
  members TEXT NOT NULL DEFAULT ''
);

CREATE TABLE downloads (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  sort  INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  href  TEXT NOT NULL
);

-- Back office
CREATE TABLE admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- `id` is the SHA-256 (hex) of the random cookie token; the token itself is never stored.
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

CREATE TABLE login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_login_attempts_ip ON login_attempts (ip, created_at);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  username   TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT ''
);
