CREATE TABLE IF NOT EXISTS briefs (
  id TEXT PRIMARY KEY,
  request TEXT NOT NULL,
  events TEXT NOT NULL,
  mode TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
