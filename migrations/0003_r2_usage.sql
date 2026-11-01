-- R2 usage guard (see src/limits.js): inventory of uploaded files and monthly operation counters.

-- Every file the back office put into R2. Only listed files are ever read from R2.
CREATE TABLE stored_files (
  path       TEXT PRIMARY KEY, -- site-relative, e.g. paperfile/14-1/paper-1a2b3c4d.pdf (R2 key: volume/<path>)
  size       INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- R2 bills per operation: Class A = writes/lists, Class B = reads. One row per UTC month.
CREATE TABLE r2_usage (
  month   TEXT PRIMARY KEY, -- YYYY-MM
  class_a INTEGER NOT NULL DEFAULT 0,
  class_b INTEGER NOT NULL DEFAULT 0
);
