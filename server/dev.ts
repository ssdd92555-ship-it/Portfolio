import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { verifyPassword } from './password.ts';

/** أدوات المطور. كل دالة تتحقق أن المستخدم (بالبريد) يملك صلاحية dev.console وحسابه نشط. */
export function requireDeveloper(db: DatabaseSync, email: string): void {
  const ok = db.prepare('SELECT 1 AS ok FROM v_developer_access WHERE email = ?').get(email);
  if (!ok) throw new Error('developer access denied');
}

/** تسجيل في dev_logs. */
export function logDev(db: DatabaseSync, level: 'debug' | 'info' | 'warn' | 'error' | 'fatal', source: string, message: string, context: object = {}, stack?: string): void {
  db.prepare('INSERT INTO dev_logs (level, source, message, stack, context) VALUES (?,?,?,?,?)')
    .run(level, source, message, stack ?? null, JSON.stringify(context));
}

/** [D03] ينفّذ استعلاماً ويسجّله في slow_queries إن تجاوز العتبة (مللي ثانية). */
export function timed<T = any>(db: DatabaseSync, email: string, sql: string, params: any[] = [], thresholdMs = 50, caller = 'dev.timed'): { rows: T[]; ms: number } {
  requireDeveloper(db, email);
  const t0 = performance.now();
  const rows = db.prepare(sql).all(...params) as T[];
  const ms = performance.now() - t0;
  if (ms >= thresholdMs) db.prepare('INSERT INTO slow_queries (sql, duration_ms, caller) VALUES (?,?,?)').run(sql.slice(0, 2000), ms, caller);
  return { rows, ms };
}

/** [D05] نسخة احتياطية متسقة عبر VACUUM INTO مع sha256 وتسجيل في db_snapshots. */
export function snapshot(db: DatabaseSync, email: string, file: string, note?: string) {
  requireDeveloper(db, email);
  const path = resolve(file);
  mkdirSync(dirname(path), { recursive: true });
  db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
  const size = statSync(path).size;
  db.prepare('INSERT INTO db_snapshots (file_path, size_bytes, sha256, note) VALUES (?,?,?,?)').run(path, size, sha256, note ?? null);
  return { path, size, sha256 };
}

/** [D08] فحص سلامة شامل: سلامة الملف، المفاتيح الأجنبية، وضع WAL، وتطابق سجل الميزات. */
export function healthCheck(db: DatabaseSync, email: string) {
  requireDeveloper(db, email);
  const integrity = (db.prepare('PRAGMA integrity_check').all() as any[]).map(r => r.integrity_check);
  const fkViolations = db.prepare('PRAGMA foreign_key_check').all().length;
  const journal = (db.prepare('PRAGMA journal_mode').get() as any).journal_mode;
  const missing = (db.prepare('SELECT code, object_name FROM db_features WHERE object_name NOT LIKE \'fn:%\'').all() as any[])
    .filter(f => !db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(f.object_name)).map(f => f.code);
  return { ok: integrity.length === 1 && integrity[0] === 'ok' && fkViolations === 0 && missing.length === 0, integrity, fkViolations, journal, missingFeatures: missing };
}

/** [D09] مفتش القاعدة: عدد الصفوف لكل جدول، وخطة تنفيذ أي استعلام. */
export function rowCounts(db: DatabaseSync, email: string): Record<string, number> {
  requireDeveloper(db, email);
  const out: Record<string, number> = {};
  const tables = db.prepare("SELECT name FROM pragma_table_list WHERE schema='main' AND type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%\\_fts\\_%' ESCAPE '\\'").all() as { name: string }[];
  for (const { name } of tables) out[name] = Number((db.prepare(`SELECT COUNT(*) c FROM "${name.replace(/"/g, '""')}"`).get() as any).c);
  return out;
}
export function explain(db: DatabaseSync, email: string, sql: string): string[] {
  requireDeveloper(db, email);
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as any[]).map(r => r.detail);
}

/** [D10] بيانات تجريبية (آمنة للتكرار) — ترفض العمل في الإنتاج. لا تُنشئ مستخدمين. */
export function seedDemo(db: DatabaseSync, email: string): { projects: number } {
  requireDeveloper(db, email);
  if (process.env.NODE_ENV === 'production') throw new Error('seedDemo is disabled in production');
  db.exec(`
    INSERT OR IGNORE INTO tags (slug, name_ar, name_en) VALUES ('web','ويب','Web'),('design','تصميم','Design'),('3d','ثلاثي الأبعاد','3D');
    INSERT OR IGNORE INTO projects (slug, status, featured) VALUES ('demo-opera','published',1),('demo-store','draft',0);
    INSERT OR IGNORE INTO project_translations (project_id, locale, title, summary)
      SELECT id, 'ar', CASE slug WHEN 'demo-opera' THEN 'أوبرا التجريبي' ELSE 'متجر تجريبي' END, 'مشروع تجريبي' FROM projects WHERE slug LIKE 'demo-%';
    INSERT OR IGNORE INTO project_translations (project_id, locale, title, summary)
      SELECT id, 'en', CASE slug WHEN 'demo-opera' THEN 'Opera Demo' ELSE 'Demo Store' END, 'Demo project' FROM projects WHERE slug LIKE 'demo-%';
    INSERT OR IGNORE INTO project_tags (project_id, tag_id) SELECT p.id, t.id FROM projects p, tags t WHERE p.slug = 'demo-opera' AND t.slug IN ('web','3d');
    INSERT OR IGNORE INTO skills (slug, name_ar, name_en, category, level) VALUES ('typescript','تايبسكريبت','TypeScript','frontend',90),('sqlite','إس كيو لايت','SQLite','database',85);
  `);
  return { projects: Number((db.prepare("SELECT COUNT(*) c FROM projects WHERE slug LIKE 'demo-%'").get() as any).c) };
}

/** hash وهمي صالح لمعادلة زمن التحقق عندما لا يوجد حساب طوارئ بهذا البريد (يمنع كشف وجوده بالتوقيت). */
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

export interface RecoveryResult { userId: number; ownerEmail: string; restored: 'none' | 'reactivated' | 'recreated' }

/**
 * [D11] دخول حساب الطوارئ. عند النجاح يضمن وجود المالك نشطاً بدوري admin+developer (يعيد تفعيله أو إنشاءه)
 * ويرجع بياناته لتنشئ طبقة الدخول جلسة له. عند الفشل يرجع null دون أي تفصيل.
 * 5 محاولات فاشلة خلال 15 دقيقة لنفس البريد = رفض مؤقت.
 */
export function recoverOwner(db: DatabaseSync, email: string, password: string, ip?: string): RecoveryResult | null {
  email = String(email ?? '').trim(); password = String(password ?? '');
  const row = db.prepare('SELECT id, email, password_hash, owner_email FROM recovery_accounts WHERE email = ?').get(email) as
    { id: number; email: string; password_hash: string; owner_email: string } | undefined;
  const recent = Number((db.prepare(
    "SELECT COUNT(*) c FROM login_attempts WHERE email = ? AND success = 0 AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes')").get(email) as any).c);
  const good = verifyPassword(password, row?.password_hash ?? DUMMY_HASH) && !!row;
  if (!row || !good || recent >= 5) {
    if (row || email) try { db.prepare('INSERT INTO login_attempts (email, ip, success, reason) VALUES (?,?,0,?)').run(email.slice(0, 254), ip ?? null, 'recovery'); } catch { /* IP محظور */ }
    return null;
  }
  const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  db.exec('BEGIN');
  try {
    let restored: RecoveryResult['restored'] = 'none';
    let u = db.prepare('SELECT id, status, deleted_at, locked_until, failed_login_count FROM users WHERE email = ?').get(row.owner_email) as any;
    if (!u) {
      // المالك محذوف تماماً: يُعاد إنشاؤه بكلمة سر حساب الطوارئ ويُطلب منه تغييرها
      db.prepare(`INSERT INTO users (email, username, display_name, password_hash, status, email_verified_at, terms_accepted_at, password_changed_at, must_change_password)
                  VALUES (?, 'grykj', 'GRYKJ', ?, 'active', ${NOW}, ${NOW}, ${NOW}, 1)`).run(row.owner_email, row.password_hash);
      u = db.prepare('SELECT id FROM users WHERE email = ?').get(row.owner_email);
      restored = 'recreated';
    } else if (u.status !== 'active' || u.deleted_at || u.locked_until || u.failed_login_count) {
      db.prepare(`UPDATE users SET status = 'active', deleted_at = NULL, locked_until = NULL, failed_login_count = 0, updated_at = ${NOW} WHERE id = ?`).run(u.id);
      restored = u.status !== 'active' ? 'reactivated' : 'none';
    }
    // admin أولاً لأن مشغّل المطور يشترطه
    for (const role of ['admin', 'developer'])
      db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_by) SELECT ?, id, ? FROM roles WHERE name = ?').run(u.id, u.id, role);
    db.prepare(`UPDATE recovery_accounts SET uses = uses + 1, last_used_at = ${NOW} WHERE id = ?`).run(row.id);
    db.prepare('INSERT INTO audit_log (actor_user_id, actor_email, action, entity_type, entity_id, ip, metadata) VALUES (?,?,?,?,?,?,?)')
      .run(u.id, row.owner_email, 'recovery.login', 'recovery_account', String(row.id), ip ?? null, JSON.stringify({ restored }));
    db.exec('COMMIT');
    return { userId: Number(u.id), ownerEmail: row.owner_email, restored };
  } catch (e) {
    db.exec('ROLLBACK');
    logDev(db, 'error', 'dev.recoverOwner', (e as Error).message, {}, (e as Error).stack);
    return null;
  }
}
