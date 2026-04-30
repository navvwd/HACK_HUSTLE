-- ReturnGuard — SQLite Schema (all tables)

CREATE TABLE IF NOT EXISTS customers (
  id                TEXT PRIMARY KEY,
  name              TEXT DEFAULT '',
  email             TEXT DEFAULT '',
  created_at        TEXT DEFAULT (datetime('now')),
  return_count_30d  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  customer_id       TEXT REFERENCES customers(id),
  item_name         TEXT NOT NULL,
  product_category  TEXT DEFAULT '',
  value_inr         REAL NOT NULL,
  purchase_date     TEXT,
  delivered_at      TEXT,
  carrier           TEXT DEFAULT '',
  pincode           TEXT DEFAULT '',
  address           TEXT DEFAULT '',
  address_lat       REAL DEFAULT 0,
  address_lng       REAL DEFAULT 0,
  payment_method    TEXT DEFAULT 'upi',
  reason_code       TEXT DEFAULT '',
  listing_image_url TEXT DEFAULT '',
  created_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS device_fingerprints (
  fingerprint_hash  TEXT PRIMARY KEY,
  account_ids_json  TEXT NOT NULL DEFAULT '[]',
  first_seen_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS behavioral_profiles (
  account_id    TEXT PRIMARY KEY,
  baseline_json TEXT DEFAULT '{}',
  session_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id        TEXT PRIMARY KEY,
  account_id        TEXT,
  fingerprint_hash  TEXT,
  ip                TEXT,
  shipping_address  TEXT,
  order_id          TEXT,
  timestamp         TEXT DEFAULT (datetime('now')),
  risk_tier         TEXT DEFAULT 'green',
  carrier           TEXT DEFAULT '',
  pincode           TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS return_requests (
  request_id        TEXT PRIMARY KEY,
  order_id          TEXT,
  account_id        TEXT,
  reason            TEXT,
  description       TEXT DEFAULT '',
  combined_score    REAL DEFAULT 0,
  risk_tier         TEXT DEFAULT 'green',
  scorers_json      TEXT DEFAULT '{}',
  action            TEXT DEFAULT '',
  customer_message  TEXT DEFAULT '',
  corroboration_met INTEGER DEFAULT 0,
  fraud_context     TEXT DEFAULT 'default',
  capture_method    TEXT DEFAULT 'file_upload',
  timestamp         TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_queue (
  request_id    TEXT PRIMARY KEY,
  status        TEXT DEFAULT 'pending',
  reviewed_by   TEXT,
  reviewed_at   TEXT,
  data_json     TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS receipt_hashes (
  order_id    TEXT PRIMARY KEY,
  hash_sha256 TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_risk_profiles (
  customer_id            TEXT PRIMARY KEY REFERENCES customers(id),
  risk_tier              TEXT NOT NULL DEFAULT 'LOW',
  claim_count_180d       INTEGER DEFAULT 0,
  chargeback_count       INTEGER DEFAULT 0,
  last_chargeback_at     TEXT,
  largest_chargeback_inr REAL DEFAULT 0,
  preferred_payment      TEXT DEFAULT 'all',
  tier_set_at            TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chargeback_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id       TEXT REFERENCES customers(id),
  order_id          TEXT,
  payment_method    TEXT,
  amount_inr        REAL,
  chargeback_reason TEXT,
  filed_at          TEXT,
  resolved_at       TEXT,
  resolution        TEXT DEFAULT 'PENDING',
  created_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS return_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id       TEXT,
  order_id          TEXT,
  claim_id          TEXT,
  product_category  TEXT,
  order_value_inr   REAL,
  days_held         INTEGER,
  return_reason     TEXT,
  wardrobing_score  INTEGER DEFAULT 0,
  filed_at          TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rh_customer ON return_history(customer_id);
CREATE INDEX IF NOT EXISTS idx_rh_category ON return_history(product_category, customer_id);

CREATE TABLE IF NOT EXISTS category_return_baselines (
  category                TEXT PRIMARY KEY,
  median_return_gap_days  REAL,
  wardrobing_peak_months  TEXT DEFAULT '[]',
  restocking_threshold_days INTEGER,
  high_value_threshold_inr  REAL,
  updated_at              TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shipment_deliveries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        TEXT,
  customer_id     TEXT,
  carrier         TEXT,
  shipment_id     TEXT,
  delivered_at    TEXT,
  gps_lat         REAL,
  gps_lng         REAL,
  gps_accuracy_m  REAL,
  otp_confirmed   INTEGER DEFAULT 0,
  driver_photo_url TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS engagement_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   TEXT,
  order_id      TEXT,
  event_type    TEXT,
  occurred_at   TEXT,
  metadata_json TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_eng_order ON engagement_events(order_id);

CREATE TABLE IF NOT EXISTS pincode_intelligence (
  pincode        TEXT PRIMARY KEY,
  rto_rate       REAL,
  inr_rate       REAL,
  cod_allowed    INTEGER DEFAULT 1,
  tier           TEXT DEFAULT 'TIER2',
  last_refreshed TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_labels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id    TEXT,
  reviewer_id TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  confidence  INTEGER,
  notes       TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS damage_claims (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      TEXT,
  score         INTEGER,
  tier          TEXT,
  evidence_json TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);
