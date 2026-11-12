CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  subscription_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_device ON push_subscriptions(device_id);

CREATE TABLE IF NOT EXISTS partners (
  partner_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_partners_device ON partners(device_id);

CREATE TABLE IF NOT EXISTS sent_events (
  event_key TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL
);
