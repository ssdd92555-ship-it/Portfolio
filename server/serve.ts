import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, purgeExpired } from './db.ts';
import { login, getSession, logout } from './auth.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 3000);
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const SECURE = process.env.NODE_ENV === 'production';
const db = openDb();
purgeExpired(db); setInterval(() => purgeExpired(db), 3600_000).unref();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};
const BLOCKED = ['/server', '/db', '/docs', '/src', '/config', '/node_modules', '/.git'];

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(body));
};
const cookieOf = (req: IncomingMessage, name: string) => req.headers.cookie?.split(/;\s*/).map(c => c.split('=')).find(([k]) => k === name)?.[1];
const clientIp = (req: IncomingMessage) => (TRUST_PROXY ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || undefined;
const sessionCookie = (v: string, maxAge: number) => `op_session=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${SECURE ? '; Secure' : ''}`;

function readBody(req: IncomingMessage, limit = 8192): Promise<any> {
  return new Promise((ok, no) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', c => { size += c.length; if (size > limit) { no(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { no(new Error('bad json')); } });
    req.on('error', no);
  });
}

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  // حماية CSRF: الطلبات المغيّرة يجب أن تأتي من نفس الأصل
  if (req.method !== 'GET') {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'forbidden' });
  }
  const token = cookieOf(req, 'op_session');
  if (path === '/api/auth/login' && req.method === 'POST') {
    let b: any; try { b = await readBody(req); } catch { return json(res, 400, { error: 'bad_request' }); }
    const r = login(db, { email: b.email, password: b.password, remember: !!b.remember, ip: clientIp(req), ua: req.headers['user-agent'] });
    if (!r.ok) return json(res, r.code === 'blocked' ? 429 : r.code === 'locked' ? 423 : 401, { error: r.code });
    return json(res, 200, { user: r.user, restored: r.restored ?? null }, { 'Set-Cookie': sessionCookie(r.token, r.maxAgeSec) });
  }
  if (path === '/api/auth/me' && req.method === 'GET') {
    const u = getSession(db, token);
    return u ? json(res, 200, { user: u }) : json(res, 401, { error: 'unauthenticated' });
  }
  if (path === '/api/auth/logout' && req.method === 'POST') {
    logout(db, token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }
  return json(res, 404, { error: 'not_found' });
}

async function staticFile(res: ServerResponse, urlPath: string) {
  let p = normalize(decodeURIComponent(urlPath)).replace(/\\/g, '/');
  if (p.endsWith('/')) p += 'index.html';
  const file = resolve(join(root, p));
  if (!file.startsWith(root + sep) || BLOCKED.some(b => p === b || p.startsWith(b + '/')) || /(^|\/)\./.test(p) || /^\/(package|vercel)\.json$/.test(p)) {
    res.writeHead(404); return res.end('Not found');
  }
  try {
    if (!(await stat(file)).isFile()) throw 0;
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(await readFile(join(root, 'pages/404.html')).catch(() => 'Not found'));
  }
}

createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path.startsWith('/api/')) return await api(req, res, path);
    return await staticFile(res, path);
  } catch (e) {
    console.error(e); if (!res.headersSent) json(res, 500, { error: 'server_error' }); else res.end();
  }
}).listen(PORT, () => console.log(`Opera: http://localhost:${PORT}`));
