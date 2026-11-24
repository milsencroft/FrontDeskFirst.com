-- Small key/value store for runtime settings (e.g. the Gmail refresh token obtained via the OAuth callback).
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')));
-- One-time OAuth state values; each is valid for 24 hours and deleted when used.
CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')));
