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
CREATE TABLE IF NOT EXISTS abuse_limits (
  uid TEXT NOT NULL,
  action TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(uid, action, window_start),
  FOREIGN KEY(uid) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_abuse_limits_uid ON abuse_limits(uid, action, window_start);

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

CREATE TABLE IF NOT EXISTS observability_events (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  route TEXT NOT NULL,
  status INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_observability_at ON observability_events(at);
CREATE INDEX IF NOT EXISTS idx_observability_kind_at ON observability_events(kind, at);


CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  event TEXT NOT NULL,
  client_id TEXT NOT NULL,
  screen TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_analytics_at ON analytics_events(at);
CREATE INDEX IF NOT EXISTS idx_analytics_event_at ON analytics_events(event, at);

CREATE INDEX IF NOT EXISTS idx_users_at ON users(at);
CREATE INDEX IF NOT EXISTS idx_listings_exp_status ON listings(status, exp);
CREATE INDEX IF NOT EXISTS idx_threads_status_created ON threads(status, created);
CREATE INDEX IF NOT EXISTS idx_notifications_uid_read_at ON notifications(uid, read, at);
CREATE INDEX IF NOT EXISTS idx_reports_by_tid_at ON reports(by_uid, tid, at);
