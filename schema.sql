CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  lat REAL,
  lng REAL,
  at INTEGER,
  cell TEXT,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  exp INTEGER NOT NULL,
  FOREIGN KEY(uid) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(exp);
CREATE INDEX IF NOT EXISTS idx_users_cell_active ON users(cell, at);
CREATE INDEX IF NOT EXISTS idx_users_location_active ON users(at);
CREATE TABLE IF NOT EXISTS otps (
  phone TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  exp INTEGER NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('have','need')),
  amount INTEGER NOT NULL,
  exp INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  FOREIGN KEY(uid) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_listings_open ON listings(status, exp);
CREATE INDEX IF NOT EXISTS idx_listings_uid ON listings(uid);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  lid TEXT NOT NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  confirmed TEXT NOT NULL DEFAULT '[]',
  pin_hash TEXT,
  pin_verified INTEGER NOT NULL DEFAULT 0,
  pin_verified_by TEXT,
  pin_verified_at INTEGER,
  pin_attempts INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  FOREIGN KEY(a) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(b) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_threads_user_a ON threads(a, created);
CREATE INDEX IF NOT EXISTS idx_threads_user_b ON threads(b, created);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  tid TEXT NOT NULL,
  from_uid TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL,
  FOREIGN KEY(tid) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY(from_uid) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_tid ON messages(tid, at);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  by_uid TEXT NOT NULL,
  who_uid TEXT NOT NULL,
  tid TEXT NOT NULL,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL,
  last_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blocks (
  by_uid TEXT NOT NULL,
  who_uid TEXT NOT NULL,
  PRIMARY KEY(by_uid, who_uid)
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  ref TEXT,
  at INTEGER NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(uid) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_uid ON notifications(uid, at);

-- V16 backward-compatible additions
CREATE TABLE IF NOT EXISTS notification_preferences (
  uid TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  radius_m INTEGER NOT NULL DEFAULT 3000,
  want_have INTEGER NOT NULL DEFAULT 1,
  want_need INTEGER NOT NULL DEFAULT 1,
  cooldown_sec INTEGER NOT NULL DEFAULT 900,
  updated INTEGER NOT NULL,
  FOREIGN KEY(uid) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notification_dedupe (
  uid TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY(uid, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_notification_dedupe_uid_at ON notification_dedupe(uid, at);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created);
CREATE INDEX IF NOT EXISTS idx_threads_status_created ON threads(status, created);
INSERT OR IGNORE INTO notification_preferences(uid,updated)
SELECT id, strftime('%s','now')*1000 FROM users;
UPDATE threads SET status='matched' WHERE status='open';

-- Existing databases are migrated idempotently by src/index.js on Worker startup.
