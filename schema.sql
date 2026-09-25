CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  lat REAL,
  lng REAL,
  at INTEGER,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  exp INTEGER NOT NULL,
  FOREIGN KEY(uid) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(exp);
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
  created INTEGER NOT NULL,
  pin_hash TEXT,
  pin_by TEXT,
  pin_exp INTEGER,
  pin_tries INTEGER NOT NULL DEFAULT 0,
  pin_verified INTEGER NOT NULL DEFAULT 0,
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
