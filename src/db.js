const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'data', 'app.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS shops (
    shop TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    scope TEXT,
    installed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    shop TEXT PRIMARY KEY,
    image_quality INTEGER DEFAULT 82,
    large_image_threshold_kb INTEGER DEFAULT 400,
    auto_scan INTEGER DEFAULT 0,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (shop) REFERENCES shops(shop)
  );
`);

function upsertShop({ shop, accessToken, scope }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO shops (shop, access_token, scope, installed_at, updated_at)
    VALUES (@shop, @accessToken, @scope, @now, @now)
    ON CONFLICT(shop) DO UPDATE SET
      access_token = excluded.access_token,
      scope = excluded.scope,
      updated_at = excluded.updated_at
  `).run({ shop, accessToken, scope, now });
}

function getShop(shop) {
  return db.prepare(`SELECT * FROM shops WHERE shop = ?`).get(shop);
}

function getSettings(shop) {
  const row = db.prepare(`SELECT * FROM settings WHERE shop = ?`).get(shop);
  if (row) return row;

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO settings (shop, image_quality, large_image_threshold_kb, auto_scan, updated_at)
    VALUES (?, 82, 400, 0, ?)
  `).run(shop, now);

  return db.prepare(`SELECT * FROM settings WHERE shop = ?`).get(shop);
}

function upsertSettings({ shop, image_quality, large_image_threshold_kb, auto_scan }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO settings (shop, image_quality, large_image_threshold_kb, auto_scan, updated_at)
    VALUES (@shop, @image_quality, @large_image_threshold_kb, @auto_scan, @now)
    ON CONFLICT(shop) DO UPDATE SET
      image_quality = excluded.image_quality,
      large_image_threshold_kb = excluded.large_image_threshold_kb,
      auto_scan = excluded.auto_scan,
      updated_at = excluded.updated_at
  `).run({ shop, image_quality, large_image_threshold_kb, auto_scan, now });

  return getSettings(shop);
}

module.exports = {
  db,
  getShop,
  getSettings,
  upsertSettings,
  upsertShop,
};
