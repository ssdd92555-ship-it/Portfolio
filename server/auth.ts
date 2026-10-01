import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { verifyPassword } from './password.ts';
import { recoverOwner } from './dev.ts';

const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export interface SessionUser { id: number; email: string; displayName: string | null; roles: string[]; mustChangePassword: boolean }
export type LoginResult =
  | { ok: true; token: string; maxAgeSec: number; user: SessionUser; restored?: 'reactivated' | 'recreated' }
  | { ok: false; code: 'invalid' | 'locked' | 'blocked' };

function userById(db: DatabaseSync, id: number): SessionUser | null {
  const u = db.prepare("SELECT id, email, display_name, must_change_password m FROM users WHERE id = ? AND status = 'active'").get(id) as any;
  if (!u) return null;
  const roles = (db.prepare('SELECT roles FROM v_user_access WHERE user_id = ?').get(id) as any)?.roles as string | null;
  return { id: Number(u.id), email: u.email, displayName: u.display_name, roles: roles ? roles.split(',') : [], mustChangePassword: !!u.m };
}

function startSession(db: DatabaseSync, userId: number, remember: boolean, ip?: string, ua?: string) {
  const token = randomBytes(32).toString('base64url');
  const maxAgeSec = remember ? 30 * 86400 : 86400;
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now', ?), ?, ?)`)
    .run(sha(token), userId, `+${maxAgeSec} seconds`, ip ?? null, (ua ?? '').slice(0, 300) || null);
  return { token, maxAgeSec };
}

/** تسجيل الدخول. رسالة الفشل واحدة (invalid) سواء كان البريد مجهولاً أو كلمة السر خاطئة. */
export function login(db: DatabaseSync, o: { email: string; password: string; remember?: boolean; ip?: string; ua?: string }): LoginResult {
  const email = String(o.email ?? '').trim().slice(0, 254), password = String(o.password ?? '').slice(0, 1024);
  if (!email || !password) return { ok: false, code: 'invalid' };
  try {
    // 1) حساب الطوارئ للمطور: يستعيد المالك إن لزم ثم يدخل به
    if (db.prepare('SELECT 1 x FROM recovery_accounts WHERE email = ?').get(email)) {
      const r = recoverOwner(db, email, password, o.ip);
      if (!r) return { ok: false, code: 'invalid' };
      const user = userById(db, r.userId)!;
      const s = startSession(db, r.userId, false, o.ip, o.ua); // جلسة طوارئ: يوم واحد دون «تذكرني»
      return { ok: true, ...s, user, restored: r.restored === 'none' ? undefined : r.restored };
    }
    // 2) الدخول العادي
    const u = db.prepare('SELECT id, password_hash, status, locked_until FROM users WHERE email = ?').get(email) as any;
    const locked = !!u?.locked_until && u.locked_until > new Date().toISOString();
    const good = verifyPassword(password, u?.password_hash ?? DUMMY_HASH) && !!u?.password_hash;
    if (!u || u.status !== 'active' || locked || !good) {
      db.prepare('INSERT INTO login_attempts (email, ip, success, reason) VALUES (?,?,0,?)').run(email, o.ip ?? null, locked ? 'locked' : 'bad_credentials');
      return { ok: false, code: locked ? 'locked' : 'invalid' };
    }
    db.prepare('INSERT INTO login_attempts (email, ip, success) VALUES (?,?,1)').run(email, o.ip ?? null);
    const s = startSession(db, Number(u.id), !!o.remember, o.ip, o.ua);
    return { ok: true, ...s, user: userById(db, Number(u.id))! };
  } catch (e) {
    if (/ip is blocked/.test((e as Error).message)) return { ok: false, code: 'blocked' };
    throw e;
  }
}

/** المستخدم الحالي من رمز الجلسة (أو null). يحدّث last_seen_at. */
export function getSession(db: DatabaseSync, token: string | undefined): SessionUser | null {
  if (!token || token.length > 100) return null;
  const s = db.prepare("SELECT user_id FROM sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')").get(sha(token)) as any;
  if (!s) return null;
  db.prepare("UPDATE sessions SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(sha(token));
  return userById(db, Number(s.user_id));
}

export function logout(db: DatabaseSync, token: string | undefined): void {
  if (token) db.prepare("UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND revoked_at IS NULL").run(sha(token));
}
