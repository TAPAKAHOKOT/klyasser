// Кляссер — Cloudflare Worker. Тот же API, что у ../../server.js (пути, коды, JSON, куки),
// только данные в D1, а фото — в R2 (STORAGE="r2", по умолчанию) или прямо в D1 (STORAGE="d1").
//
// Привязки и переменные (см. wrangler.jsonc):
//   DB               — D1, таблицы из migrations/
//   PHOTOS           — R2-бакет (нужен только при STORAGE="r2")
//   ASSETS           — статика из ../public (index.html)
//   STORAGE          — "r2" | "d1"
//   KLYASSER_SECRET  — секрет для подписи входа (wrangler secret put / .dev.vars)
//   KLYASSER_INVITE  — необязательный код приглашения для создания аккаунтов

const MAX_BODY = 25 * 1024 * 1024;
const MAX_FILE_D1 = 1_900_000;          // в D1 строка/BLOB не больше ~2 000 000 байт
const ID_RE = /^[a-z0-9_-]{4,64}$/i;
const PIN_RE = /^\d{4,8}$/;
// scrypt не влезает в 10 мс CPU бесплатного тарифа; PBKDF2 нативный и быстрый.
// Перебор PIN на самом деле сдерживает блокировка после 5 ошибок.
const PBKDF2_ITER = 10_000;

// ---------- помощники ----------
class HttpError extends Error {
  constructor(status, message){ super(message); this.status = status; }
}
const httpError = (status, message) => new HttpError(status, message);

function send(status, body){
  return new Response(status === 204 || body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
// уже готовая JSON-строка (чтобы не гонять JSON.parse/stringify ради копирования)
const sendRaw = (status, json) => new Response(json, {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

async function readBody(req, limit = MAX_BODY, tooBig = 'файл слишком большой'){
  if (Number(req.headers.get('content-length')) > limit) throw httpError(413, tooBig);
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader(), chunks = [];
  let size = 0;
  for (;;){
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit){ reader.cancel().catch(() => {}); throw httpError(413, tooBig); }
    chunks.push(value);
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks){ out.set(c, off); off += c.byteLength; }
  return out;
}
const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });
async function readJson(req){
  const b = await readBody(req);
  try { return JSON.parse(utf8.decode(b) || '{}'); } catch { throw httpError(400, 'неверный JSON'); }
}

const cleanName = n => String(n || '').trim().replace(/^@+/, '').slice(0, 40);
const checkPid = pid => { if (!ID_RE.test(pid)) throw httpError(400, 'неверный id фото'); };

// ---------- крипто ----------
const enc = new TextEncoder();
const toHex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
const fromHex = s => Uint8Array.from(s.match(/../g) || [], h => parseInt(h, 16));
const randomHex = n => toHex(crypto.getRandomValues(new Uint8Array(n)));
const base64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// сравнение за постоянное время (длина, как и в server.js, не секрет)
function safeEqual(a, b){
  const A = enc.encode(String(a)), B = enc.encode(String(b));
  return A.byteLength === B.byteLength && crypto.subtle.timingSafeEqual(A, B);
}

async function hashPin(pin, saltHex){
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: PBKDF2_ITER }, key, 256);
  return toHex(bits);
}

let hmacCache = { secret: null, key: null };
function hmacKey(env){
  const secret = env.KLYASSER_SECRET;
  if (!secret) throw new Error('KLYASSER_SECRET не задан: wrangler secret put KLYASSER_SECRET (локально — в .dev.vars)');
  if (hmacCache.secret !== secret){
    hmacCache = { secret, key: crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) };
  }
  return hmacCache.key;
}
const token = async (env, acc) => base64url(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(`${acc.id}:${acc.pin_ver}`)));

// ---------- куки ----------
const cookieName = id => 'kl_' + id.replace(/[^a-z0-9_]/gi, '_');
function cookies(req){
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')){
    const i = part.indexOf('=');
    if (i > 0){
      const v = part.slice(i + 1).trim();
      try { out[part.slice(0, i).trim()] = decodeURIComponent(v); } catch { out[part.slice(0, i).trim()] = v; }
    }
  }
  return out;
}
async function authed(c, acc){
  const v = c.cookies[cookieName(acc.id)];
  return !!v && safeEqual(v, await token(c.env, acc));
}
async function setAuthCookie(c, acc){
  c.setCookie.push(`${cookieName(acc.id)}=${await token(c.env, acc)}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=31536000${c.secure ? '; Secure' : ''}`);
}
const clearAuthCookie = (c, id) => c.setCookie.push(`${cookieName(id)}=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0`);

async function requireAcc(c, id, cols = 'id, name, pin_ver'){
  const acc = ID_RE.test(id) && await c.env.DB.prepare(`SELECT ${cols} FROM accounts WHERE id = ?`).bind(id).first();
  if (!acc) throw httpError(404, 'нет такого аккаунта');
  if (!await authed(c, acc)) throw httpError(401, 'нужен PIN');
  return acc;
}

// ---------- блокировка после неверных PIN ----------
// После каждых 5 неверных PIN подряд аккаунт закрывается на 1, 2, 4… минуты (до 32), как в server.js,
// но счётчик живёт в D1 (accounts.pin_fails / locked_until) и переживает перезапуски.
// Попытка засчитывается ДО проверки PIN одним атомарным UPDATE — параллельные запросы не обойдут лимит.
const tooMany = waitMs => httpError(429, `слишком много попыток, подожди ${Math.ceil(waitMs / 1000)} с`);
const SQL_TAKE_ATTEMPT = `
  UPDATE accounts SET
    pin_fails = pin_fails + 1,
    locked_until = CASE WHEN (pin_fails + 1) % 5 = 0
      THEN ?1 + 60000 * (1 << MIN(5, (pin_fails + 1) / 5 - 1))
      ELSE locked_until END
  WHERE id = ?2 AND locked_until <= ?1
  RETURNING pin_fails`;

// ---------- хранилище фото ----------
function storageMode(env){
  const m = String(env.STORAGE || 'r2').trim().toLowerCase();
  if (m !== 'r2' && m !== 'd1') throw new Error(`STORAGE должен быть "r2" или "d1", а не "${env.STORAGE}"`);
  if (m === 'r2' && !env.PHOTOS) throw new Error('STORAGE="r2", но нет привязки R2 PHOTOS в wrangler.jsonc');
  return m;
}
const r2Key = (acc, pid, kind) => `${acc}/${pid}.${kind}.jpg`;

async function putFile(env, acc, pid, kind, bytes){
  if (storageMode(env) === 'r2') return void await env.PHOTOS.put(r2Key(acc, pid, kind), bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  await env.DB.prepare(`INSERT INTO photo_files (acc, id, kind, data) VALUES (?, ?, ?, ?)
    ON CONFLICT (acc, id, kind) DO UPDATE SET data = excluded.data`).bind(acc, pid, kind, bytes).run();
}
// → тело ответа (поток или байты) или null
async function getFile(env, acc, pid, kind){
  if (storageMode(env) === 'r2'){
    const obj = await env.PHOTOS.get(r2Key(acc, pid, kind));
    return obj && obj.body;
  }
  const row = await env.DB.prepare('SELECT data FROM photo_files WHERE acc = ? AND id = ? AND kind = ?').bind(acc, pid, kind).first();
  return row && new Uint8Array(row.data);   // D1 отдаёт BLOB массивом чисел
}
// оба вида (src и thumb) одного фото
async function deleteFile(env, acc, pid){
  if (storageMode(env) === 'r2') return void await env.PHOTOS.delete(['src', 'thumb'].map(k => r2Key(acc, pid, k)));
  await env.DB.prepare('DELETE FROM photo_files WHERE acc = ? AND id = ?').bind(acc, pid).run();
}
async function deleteAccountFiles(env, acc){
  if (storageMode(env) === 'r2'){
    // удаляем то, что вернул list, и просим список заново — пока не опустеет (по 1000 ключей за раз)
    for (let i = 0; i < 100; i++){
      const list = await env.PHOTOS.list({ prefix: `${acc}/`, limit: 1000 });
      if (list.objects.length) await env.PHOTOS.delete(list.objects.map(o => o.key));
      if (!list.truncated) return;
    }
    return;
  }
  await env.DB.prepare('DELETE FROM photo_files WHERE acc = ?').bind(acc).run();   // один запрос — лимит 50 запросов не страшен
}

// ---------- API ----------
const ROUTES = [
  // список аккаунтов виден всем; unlocked — открыт ли он в этом браузере
  ['GET', /^\/api\/accounts$/, async c => {
    const { results } = await c.env.DB.prepare('SELECT id, name, pin_ver FROM accounts ORDER BY created_at').all();
    const accounts = await Promise.all(results.map(async a => ({ id: a.id, name: a.name, unlocked: await authed(c, a) })));
    return send(200, { accounts, inviteRequired: !!c.env.KLYASSER_INVITE });
  }],
  ['POST', /^\/api\/accounts$/, async c => {
    const b = await readJson(c.req), name = cleanName(b.name), pin = String(b.pin || '').trim();
    if (!name) throw httpError(400, 'нужно название');
    if (!PIN_RE.test(pin)) throw httpError(400, 'PIN — это 4–8 цифр');
    const invite = c.env.KLYASSER_INVITE || '';
    if (invite && !safeEqual(b.invite || '', invite)) throw httpError(403, 'неверный код приглашения');
    const id = 'a' + randomHex(6), salt = randomHex(16);
    await c.env.DB.prepare('INSERT INTO accounts (id, name, pin_salt, pin_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, name, salt, await hashPin(pin, salt), Date.now()).run();
    await setAuthCookie(c, { id, pin_ver: 1 });
    return send(201, { id, name });
  }],
  ['POST', /^\/api\/accounts\/([^/]+)\/unlock$/, async (c, id) => {
    const db = c.env.DB;
    const acc = ID_RE.test(id) && await db.prepare('SELECT id, pin_salt, pin_hash, pin_ver, locked_until FROM accounts WHERE id = ?').bind(id).first();
    if (!acc) throw httpError(404, 'нет такого аккаунта');
    const now = Date.now();
    if (acc.locked_until > now) throw tooMany(acc.locked_until - now);
    const b = await readJson(c.req);
    const pin = String(b.pin || '').trim();
    if (!await db.prepare(SQL_TAKE_ATTEMPT).bind(now, id).first()){
      // закрыли параллельным запросом (или аккаунт удалили)
      const cur = await db.prepare('SELECT locked_until FROM accounts WHERE id = ?').bind(id).first();
      if (!cur) throw httpError(404, 'нет такого аккаунта');
      throw tooMany(Math.max(1, cur.locked_until - now));
    }
    // PIN в базе всегда 4–8 цифр, так что строку другого вида можно не хешировать
    if (!PIN_RE.test(pin) || !safeEqual(await hashPin(pin, acc.pin_salt), acc.pin_hash)) throw httpError(401, 'неверный PIN');
    await db.prepare('UPDATE accounts SET pin_fails = 0, locked_until = 0 WHERE id = ?').bind(id).run();
    await setAuthCookie(c, acc);
    return send(200, { ok: true });
  }],
  ['POST', /^\/api\/accounts\/([^/]+)\/lock$/, async (c, id) => { clearAuthCookie(c, id); return send(204); }],

  // дальше — только с открытым аккаунтом
  ['GET', /^\/api\/acc\/([^/]+)$/, async (c, id) => {
    const acc = await requireAcc(c, id, 'id, name, pin_ver, rev, state');
    const { results } = await c.env.DB.prepare('SELECT meta FROM photos WHERE acc = ?').bind(id).all();
    // state и meta уже лежат как JSON.stringify(...) — склеиваем строки, не разбирая (экономим CPU)
    return sendRaw(200, `{"account":${JSON.stringify({ id: acc.id, name: acc.name })},"rev":${acc.rev},`
      + `"state":${acc.state || 'null'},"photos":[${results.map(r => r.meta).join(',')}]}`);
  }],
  ['PATCH', /^\/api\/acc\/([^/]+)$/, async (c, id) => {
    await requireAcc(c, id);
    const b = await readJson(c.req), db = c.env.DB;
    if (b.name !== undefined){
      const name = cleanName(b.name);
      if (!name) throw httpError(400, 'нужно название');
      await db.prepare('UPDATE accounts SET name = ? WHERE id = ?').bind(name, id).run();
    }
    if (b.pin !== undefined){
      const pin = String(b.pin).trim();
      if (!PIN_RE.test(pin)) throw httpError(400, 'PIN — это 4–8 цифр');
      const salt = randomHex(16);
      const acc = await db.prepare('UPDATE accounts SET pin_salt = ?, pin_hash = ?, pin_ver = pin_ver + 1 WHERE id = ? RETURNING id, pin_ver')
        .bind(salt, await hashPin(pin, salt), id).first();
      if (acc) await setAuthCookie(c, acc);   // это устройство остаётся внутри, остальные — по новому PIN
    }
    return send(200, { ok: true });
  }],
  ['DELETE', /^\/api\/acc\/([^/]+)$/, async (c, id) => {
    await requireAcc(c, id);
    const db = c.env.DB;
    await db.batch([
      db.prepare('DELETE FROM photos WHERE acc = ?').bind(id),
      db.prepare('DELETE FROM accounts WHERE id = ?').bind(id),
    ]);
    await deleteAccountFiles(c.env, id);
    clearAuthCookie(c, id);
    return send(204);
  }],
  ['PUT', /^\/api\/acc\/([^/]+)\/state$/, async (c, id) => {
    await requireAcc(c, id);
    const b = await readJson(c.req), db = c.env.DB;
    if (!b.state || typeof b.state !== 'object') throw httpError(400, 'нет состояния');
    const json = JSON.stringify(b.state);
    if (enc.encode(json).byteLength > MAX_FILE_D1) throw httpError(413, 'состояние слишком большое');   // строка D1 ≤ 2 МБ
    const ok = await db.prepare('UPDATE accounts SET state = ?, rev = rev + 1 WHERE id = ? AND rev = ? RETURNING rev')
      .bind(json, id, Number(b.rev) || 0).first();
    if (ok) return send(200, { rev: ok.rev });
    const cur = await db.prepare('SELECT rev FROM accounts WHERE id = ?').bind(id).first();
    if (!cur) throw httpError(404, 'нет такого аккаунта');
    return send(409, { error: 'аккаунт изменили на другом устройстве', rev: cur.rev });
  }],
  ['PUT', /^\/api\/acc\/([^/]+)\/photos\/([^/]+)\/meta$/, async (c, id, pid) => {
    await requireAcc(c, id); checkPid(pid);
    const meta = await readJson(c.req);
    if (!meta || meta.id !== pid) throw httpError(400, 'неверные данные фото');
    delete meta.manual;
    await c.env.DB.prepare(`INSERT INTO photos (acc, id, meta, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (acc, id) DO UPDATE SET meta = excluded.meta, updated_at = excluded.updated_at`)
      .bind(id, pid, JSON.stringify(meta), Date.now()).run();
    return send(204);
  }],
  ['PUT', /^\/api\/acc\/([^/]+)\/photos\/([^/]+)\/(src|thumb)$/, async (c, id, pid, kind) => {
    await requireAcc(c, id); checkPid(pid);
    const buf = storageMode(c.env) === 'd1'
      ? await readBody(c.req, MAX_FILE_D1, 'файл слишком большой: при хранении фото в D1 — не больше 1,9 МБ')
      : await readBody(c.req);
    if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) throw httpError(415, 'ожидается JPEG');
    await putFile(c.env, id, pid, kind, buf);
    return send(204);
  }],
  ['GET', /^\/api\/acc\/([^/]+)\/photos\/([^/]+)\/(src|thumb)$/, async (c, id, pid, kind) => {
    await requireAcc(c, id); checkPid(pid);
    const body = await getFile(c.env, id, pid, kind);
    if (!body) return send(404, { error: 'нет файла' });
    // превью меняется при обрезке — у него в адресе ?v=, поэтому кэшировать можно навсегда
    return new Response(body, { headers: {
      'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
    } });
  }],
  ['DELETE', /^\/api\/acc\/([^/]+)\/photos\/([^/]+)$/, async (c, id, pid) => {
    await requireAcc(c, id); checkPid(pid);
    await c.env.DB.prepare('DELETE FROM photos WHERE acc = ? AND id = ?').bind(id, pid).run();
    await deleteFile(c.env, id, pid);
    return send(204);
  }],
];

async function handle(req, env, p){
  if (!p.startsWith('/api/')){
    if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'метод не поддерживается');
    // "/" и "/index.html" идут через воркер (run_worker_first), чтобы отдать index.html с Cache-Control: no-cache
    if ((p === '/' || p === '/index.html') && env.ASSETS){
      const r = await env.ASSETS.fetch(new Request(new URL('/', req.url), req));
      if (r.status === 404) throw httpError(404, 'нет файла');
      const res = new Response(r.body, r);
      if (r.ok || r.status === 304) res.headers.set('Cache-Control', 'no-cache');
      return res;
    }
    throw httpError(404, 'не найдено');
  }
  const c = {
    req, env,
    secure: new URL(req.url).protocol === 'https:',
    cookies: cookies(req),
    setCookie: [],
  };
  for (const [method, re, handler] of ROUTES){
    if (req.method !== method) continue;
    const m = p.match(re);
    if (m){
      hmacKey(env);   // нет секрета — сразу 500 с понятной записью в логе
      const res = await handler(c, ...m.slice(1).map(decodeURIComponent));
      for (const v of c.setCookie) res.headers.append('Set-Cookie', v);
      return res;
    }
  }
  throw httpError(404, 'не найдено');
}

export default {
  async fetch(req, env){
    const p = new URL(req.url).pathname;
    try {
      return await handle(req, env, p);
    } catch (e){
      if (!e.status) console.error(`${req.method} ${p}`, e && e.stack || e);
      return send(e.status || 500, { error: e.status ? e.message : 'ошибка сервера' });
    }
  },
};
