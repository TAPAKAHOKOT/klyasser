#!/usr/bin/env node
// Кляссер — сервер. Без зависимостей, нужен Node 22.13+ (встроенный SQLite).
//
//   node server.js                          → http://localhost:4173
//   PORT=8080 HOST=0.0.0.0 node server.js   → доступ из локальной сети (например, с телефона)
//   KLYASSER_DATA=/путь/к/data              → где хранить базу и фото (по умолчанию ./data)
//   KLYASSER_INVITE=секрет                  → новый аккаунт можно создать только с этим кодом
//                                             (включи, если сервер смотрит в интернет)
//
// Сервер хранит аккаунты, PIN, состояние ленты и сами фото.
// Анализ фото и раскладка считаются в браузере — серверу это не нужно.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';
const DATA = path.resolve(process.env.KLYASSER_DATA || path.join(__dirname, 'data'));
const INVITE = process.env.KLYASSER_INVITE || '';
const MAX_BODY = 25 * 1024 * 1024;
const ID_RE = /^[a-z0-9_-]{4,64}$/i;
const PIN_RE = /^\d{4,8}$/;

fs.mkdirSync(path.join(DATA, 'photos'), { recursive: true });
const SECRET = (() => {
  if (process.env.KLYASSER_SECRET) return process.env.KLYASSER_SECRET;
  const f = path.join(DATA, 'secret.key');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
})();

// ---------- база ----------
const db = new DatabaseSync(path.join(DATA, 'klyasser.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pin_salt TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    pin_ver INTEGER NOT NULL DEFAULT 1,   -- меняется при смене PIN → старые входы на других устройствах слетают
    state TEXT,                            -- JSON: лента, буфер, настройки, ручная разметка
    rev INTEGER NOT NULL DEFAULT 0,        -- версия state для защиты от одновременной правки
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS photos (
    acc TEXT NOT NULL,
    id TEXT NOT NULL,
    meta TEXT NOT NULL,                    -- JSON: размеры, обрезка, автопризнаки
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (acc, id)
  );
`);
const q = {
  listAcc: db.prepare('SELECT * FROM accounts ORDER BY created_at'),
  getAcc: db.prepare('SELECT * FROM accounts WHERE id = ?'),
  insAcc: db.prepare('INSERT INTO accounts (id, name, pin_salt, pin_hash, created_at) VALUES (?, ?, ?, ?, ?)'),
  renameAcc: db.prepare('UPDATE accounts SET name = ? WHERE id = ?'),
  setPin: db.prepare('UPDATE accounts SET pin_salt = ?, pin_hash = ?, pin_ver = pin_ver + 1 WHERE id = ?'),
  setState: db.prepare('UPDATE accounts SET state = ?, rev = rev + 1 WHERE id = ? AND rev = ?'),
  delAcc: db.prepare('DELETE FROM accounts WHERE id = ?'),
  listPhotos: db.prepare('SELECT meta FROM photos WHERE acc = ?'),
  putPhoto: db.prepare(`INSERT INTO photos (acc, id, meta, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (acc, id) DO UPDATE SET meta = excluded.meta, updated_at = excluded.updated_at`),
  delPhoto: db.prepare('DELETE FROM photos WHERE acc = ? AND id = ?'),
  delPhotos: db.prepare('DELETE FROM photos WHERE acc = ?'),
};

// ---------- PIN и вход ----------
const hashPin = (pin, salt) => crypto.scryptSync(pin, salt, 32).toString('hex');
const safeEqual = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };
const token = acc => crypto.createHmac('sha256', SECRET).update(`${acc.id}:${acc.pin_ver}`).digest('base64url');
const cookieName = id => 'kl_' + id.replace(/[^a-z0-9_]/gi, '_');
function cookies(req){
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')){
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const authed = (req, acc) => { const c = cookies(req)[cookieName(acc.id)]; return !!c && safeEqual(c, token(acc)); };
function setAuthCookie(req, res, acc){
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${cookieName(acc.id)}=${token(acc)}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}`);
}
const clearAuthCookie = (res, id) => res.setHeader('Set-Cookie', `${cookieName(id)}=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0`);

// после каждых 5 неверных PIN аккаунт закрывается на 1, 2, 4… минуты (до 32)
const fails = new Map();
const lockedFor = id => { const f = fails.get(id); return f && f.until > Date.now() ? f.until - Date.now() : 0; };
function registerFail(id){
  const f = fails.get(id) || { n: 0, until: 0 };
  f.n++;
  if (f.n % 5 === 0) f.until = Date.now() + 60000 * Math.min(32, 2 ** (f.n / 5 - 1));
  fails.set(id, f);
}

// ---------- http-помощники ----------
const httpError = (status, message) => Object.assign(new Error(message), { status });
function send(res, status, body){
  const data = body == null ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' });
  res.end(status === 204 ? undefined : data);
}
function readBody(req){
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY){ reject(httpError(413, 'файл слишком большой')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req){
  const b = await readBody(req);
  try { return JSON.parse(b.toString('utf8') || '{}'); } catch { throw httpError(400, 'неверный JSON'); }
}
async function sendFile(res, file, type, cache){
  let st;
  try { st = await fsp.stat(file); } catch { return send(res, 404, { error: 'нет файла' }); }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}
const cleanName = n => String(n || '').trim().replace(/^@+/, '').slice(0, 40);
const photoDir = acc => path.join(DATA, 'photos', acc);
const photoFile = (acc, pid, kind) => path.join(photoDir(acc), `${pid}.${kind}.jpg`);
const checkPid = pid => { if (!ID_RE.test(pid)) throw httpError(400, 'неверный id фото'); };
function requireAcc(req, id){
  const acc = ID_RE.test(id) && q.getAcc.get(id);
  if (!acc) throw httpError(404, 'нет такого аккаунта');
  if (!authed(req, acc)) throw httpError(401, 'нужен PIN');
  return acc;
}

// ---------- API ----------
const ROUTES = [
  // список аккаунтов виден всем; unlocked — открыт ли он в этом браузере
  ['GET', /^\/api\/accounts$/, (req, res) => {
    send(res, 200, { accounts: q.listAcc.all().map(a => ({ id: a.id, name: a.name, unlocked: authed(req, a) })), inviteRequired: !!INVITE });
  }],
  ['POST', /^\/api\/accounts$/, async (req, res) => {
    const b = await readJson(req), name = cleanName(b.name), pin = String(b.pin || '').trim();
    if (!name) throw httpError(400, 'нужно название');
    if (!PIN_RE.test(pin)) throw httpError(400, 'PIN — это 4–8 цифр');
    if (INVITE && !safeEqual(b.invite || '', INVITE)) throw httpError(403, 'неверный код приглашения');
    const id = 'a' + crypto.randomBytes(6).toString('hex'), salt = crypto.randomBytes(16).toString('hex');
    q.insAcc.run(id, name, salt, hashPin(pin, salt), Date.now());
    setAuthCookie(req, res, q.getAcc.get(id));
    send(res, 201, { id, name });
  }],
  ['POST', /^\/api\/accounts\/([^/]+)\/unlock$/, async (req, res, [id]) => {
    const acc = ID_RE.test(id) && q.getAcc.get(id);
    if (!acc) throw httpError(404, 'нет такого аккаунта');
    const wait = lockedFor(id);
    if (wait) throw httpError(429, `слишком много попыток, подожди ${Math.ceil(wait / 1000)} с`);
    const b = await readJson(req);
    if (!safeEqual(hashPin(String(b.pin || '').trim(), acc.pin_salt), acc.pin_hash)){ registerFail(id); throw httpError(401, 'неверный PIN'); }
    fails.delete(id);
    setAuthCookie(req, res, acc);
    send(res, 200, { ok: true });
  }],
  ['POST', /^\/api\/accounts\/([^/]+)\/lock$/, (req, res, [id]) => { clearAuthCookie(res, id); send(res, 204); }],

  // дальше — только с открытым аккаунтом
  ['GET', /^\/api\/acc\/([^/]+)$/, (req, res, [id]) => {
    const acc = requireAcc(req, id);
    send(res, 200, {
      account: { id: acc.id, name: acc.name }, rev: acc.rev,
      state: acc.state ? JSON.parse(acc.state) : null,
      photos: q.listPhotos.all(id).map(r => JSON.parse(r.meta)),
    });
  }],
  ['PATCH', /^\/api\/acc\/([^/]+)$/, async (req, res, [id]) => {
    requireAcc(req, id);
    const b = await readJson(req);
    if (b.name !== undefined){ const name = cleanName(b.name); if (!name) throw httpError(400, 'нужно название'); q.renameAcc.run(name, id); }
    if (b.pin !== undefined){
      const pin = String(b.pin).trim();
      if (!PIN_RE.test(pin)) throw httpError(400, 'PIN — это 4–8 цифр');
      const salt = crypto.randomBytes(16).toString('hex');
      q.setPin.run(salt, hashPin(pin, salt), id);
      setAuthCookie(req, res, q.getAcc.get(id));   // это устройство остаётся внутри, остальные — по новому PIN
    }
    send(res, 200, { ok: true });
  }],
  ['DELETE', /^\/api\/acc\/([^/]+)$/, async (req, res, [id]) => {
    requireAcc(req, id);
    q.delPhotos.run(id); q.delAcc.run(id);
    await fsp.rm(photoDir(id), { recursive: true, force: true });
    clearAuthCookie(res, id);
    send(res, 204);
  }],
  ['PUT', /^\/api\/acc\/([^/]+)\/state$/, async (req, res, [id]) => {
    requireAcc(req, id);
    const b = await readJson(req);
    if (!b.state || typeof b.state !== 'object') throw httpError(400, 'нет состояния');
    const r = q.setState.run(JSON.stringify(b.state), id, Number(b.rev) || 0);
    const rev = q.getAcc.get(id).rev;
    if (!r.changes) return send(res, 409, { error: 'аккаунт изменили на другом устройстве', rev });
    send(res, 200, { rev });
  }],
  ['PUT', /^\/api\/acc\/([^/]+)\/photos\/([^/]+)\/meta$/, async (req, res, [id, pid]) => {
    requireAcc(req, id); checkPid(pid);
    const meta = await readJson(req);
    if (!meta || meta.id !== pid) throw httpError(400, 'неверные данные фото');
    delete meta.manual;
    q.putPhoto.run(id, pid, JSON.stringify(meta), Date.now());
    send(res, 204);
  }],
  ['PUT', /^\/api\/acc\/([^/]+)\/photos\/([^/]+)\/(src|thumb)$/, async (req, res, [id, pid, kind]) => {
    requireAcc(req, id); checkPid(pid);
    const buf = await readBody(req);
    if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) throw httpError(415, 'ожидается JPEG');
    await fsp.mkdir(photoDir(id), { recursive: true });
    const f = photoFile(id, pid, kind), tmp = `${f}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, f);
    send(res, 204);
  }],
  ['GET', /^\/api\/acc\/([^/]+)\/photos\/([^/]+)\/(src|thumb)$/, async (req, res, [id, pid, kind]) => {
    requireAcc(req, id); checkPid(pid);
    // превью меняется при обрезке — у него в адресе ?v=, поэтому кэшировать можно навсегда
    await sendFile(res, photoFile(id, pid, kind), 'image/jpeg', 'private, max-age=31536000, immutable');
  }],
  ['DELETE', /^\/api\/acc\/([^/]+)\/photos\/([^/]+)$/, async (req, res, [id, pid]) => {
    requireAcc(req, id); checkPid(pid);
    q.delPhoto.run(id, pid);
    await Promise.all(['src', 'thumb'].map(k => fsp.rm(photoFile(id, pid, k), { force: true })));
    send(res, 204);
  }],
];

const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://local').pathname;
  try {
    if (!p.startsWith('/api/')){
      if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'метод не поддерживается');
      if (p === '/' || p === '/index.html') return await sendFile(res, path.join(__dirname, 'public', 'index.html'), 'text/html; charset=utf-8', 'no-cache');
      throw httpError(404, 'не найдено');
    }
    for (const [method, re, handler] of ROUTES){
      if (req.method !== method) continue;
      const m = p.match(re);
      if (m) return await handler(req, res, m.slice(1).map(decodeURIComponent));
    }
    throw httpError(404, 'не найдено');
  } catch (e){
    if (!e.status) console.error(`${req.method} ${p}`, e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'ошибка сервера' });
    else res.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`кляссер: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`данные: ${DATA}${INVITE ? ' · новые аккаунты — по коду приглашения' : ''}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); db.close(); process.exit(0); });
