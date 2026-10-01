import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const MIGRATIONS = resolve(root, 'db/migrations');

/** يفتح القاعدة ويطبّق أي ترحيلات (migrations) لم تُطبَّق بعد. استخدم ':memory:' للاختبار. */
export function openDb(file: string = process.env.DB_FILE ?? resolve(root, 'db/opera.db')): DatabaseSync {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  migrate(db);
  return db;
}

/** كل ترحيل داخل معاملة واحدة: إما ينجح كاملاً أو لا يترك أثراً. */
export function migrate(db: DatabaseSync): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ) STRICT`);
  const done = new Set((db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map(r => r.version));
  const applied: string[] = [];
  for (const f of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(f);
      db.exec('COMMIT');
      applied.push(f);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
  return applied;
}

/** تنظيف دوري: جلسات ورموز منتهية ومحاولات قديمة. يرجع عدد الصفوف المحذوفة لكل جدول. */
export function purgeExpired(db: DatabaseSync, keepAttemptsDays = 30): Record<string, number> {
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  const q: Record<string, string> = {
    sessions:           `DELETE FROM sessions WHERE expires_at < ${now} OR revoked_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')`,
    password_resets:    `DELETE FROM password_resets WHERE expires_at < ${now}`,
    email_verifications:`DELETE FROM email_verifications WHERE expires_at < ${now}`,
    trusted_devices:    `DELETE FROM trusted_devices WHERE expires_at < ${now}`,
    ip_blocklist:       `DELETE FROM ip_blocklist WHERE expires_at IS NOT NULL AND expires_at < ${now}`,
    rate_limits:        `DELETE FROM rate_limits WHERE window_start < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')`,
    login_attempts:     `DELETE FROM login_attempts WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-${Math.floor(keepAttemptsDays)} days')`,
  };
  const out: Record<string, number> = {};
  for (const [t, sql] of Object.entries(q)) out[t] = Number(db.prepare(sql).run().changes);
  return out;
}

/** إحصاءات بنية القاعدة (للتقارير والتأكد من اكتمال الترحيل). */
export function schemaStats(db: DatabaseSync) {
  const n = (type: string) => Number((db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type=? AND name NOT LIKE 'sqlite_%'").get(type) as any).c);
  return { tables: n('table'), views: n('view'), triggers: n('trigger'), indexes: n('index') };
}

/** [F88] تطبيق سياسات الاحتفاظ (data_retention_policies). أسماء الجداول من قائمة بيضاء فقط. */
const RETENTION_TABLES = new Set(['page_views', 'search_log', 'dev_logs', 'slow_queries', 'email_outbox']);
export function applyRetention(db: DatabaseSync): Record<string, number> {
  const out: Record<string, number> = {};
  const rows = db.prepare('SELECT table_name, days FROM data_retention_policies WHERE enabled = 1').all() as { table_name: string; days: number }[];
  for (const { table_name, days } of rows) {
    if (!RETENTION_TABLES.has(table_name)) continue;
    out[table_name] = Number(db.prepare(`DELETE FROM ${table_name} WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`).run(`-${Math.floor(days)} days`).changes);
  }
  return out;
}
