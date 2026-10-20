// Федерация серверов: люди с разных серверов пишут друг другу в личные чаты. Группы с людьми с других серверов — в fedgroups.js.
//
// Устройство:
//  • У каждого сервера есть идентификатор, имя, пара ключей ed25519 и (необязательно) публичный адрес.
//  • Серверы связываются одноразовым ключом активации. Одна сторона (создала ключ) доступна снаружи, другая
//    (ввела ключ) сама открывает исходящее WebSocket-соединение на /fed и держит его. Все события идут по этому
//    одному соединению в обе стороны, поэтому серверу за NAT открытый адрес не нужен.
//  • Соединение шифруется своим туннелем, независимо от TLS на прокси: при подключении стороны подписывают
//    обмен временными ключами X25519 своими постоянными ключами (так подмена невозможна), из общего секрета
//    получают отдельные ключи для каждого направления, и каждый кадр идёт зашифрованным и подтверждённым
//    ChaCha20-Poly1305 со строго возрастающим счётчиком: подсмотреть, подделать, переставить или повторить
//    кадр нельзя. Секрет живёт только в одной сессии, поэтому украденный позже ключ старые записи не откроет.
//    Подключившийся сервер управлять чужим не может, у соединения нет ни одной административной команды.
//  • События, которым нужна надёжность (сообщения, правки, прочтение, контакты), лежат в очереди fed_outbox
//    до подтверждения (ack) и повторяются при переподключении. Эфемерные (набор текста, присутствие) не хранятся.
//  • Человек с другого сервера у нас — «теневой» пользователь (users.is_bot = 2). Личный чат с ним — обычный
//    direct-чат, а сообщения, правки, реакции и статусы в нём зеркалятся событиями.
//  • Файлы и аватарки скачиваем по тому же соединению и храним у себя; лимиты размера и форматы берём из
//    настроек СВОЕГО сервера, а не сервера отправителя.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const db = require('./db');
const spaces = require('./spaces');
const gifLib = require('./gif');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'chat_db', 'chat.db');
const FILES_DIR = path.join(path.dirname(DB_PATH), 'files');
const AVATAR_DIR = path.join(path.dirname(DB_PATH), 'avatar');

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const CHUNK = 192 * 1024;
const MAX_FRAME = 1024 * 1024;
const OUTBOX_KEEP_DAYS = 14;

// Ленивые зависимости: ws.js и routes/upload.js сами тянут этот модуль
const wsm = () => require('./ws');
const groups = () => require('./fedgroups');
const uploadCfg = () => require('./routes/upload').getUploadSettings();

// ─────────────────────────── настройки и ключи ───────────────────────────
const getS = (k, d = '') => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? d;
const setS = (k, v) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, String(v));

let _priv = null;
const _pubCache = new Map();
function ensureKeys() {
  if (getS('fed_priv') && getS('fed_pub')) return;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  setS('fed_pub', publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
  setS('fed_priv', privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'));
}
function priv() {
  if (!_priv) { ensureKeys(); _priv = crypto.createPrivateKey({ key: Buffer.from(getS('fed_priv'), 'base64'), format: 'der', type: 'pkcs8' }); }
  return _priv;
}
const sign = str => crypto.sign(null, Buffer.from(str), priv()).toString('base64');
function pubObj(b64) {
  let k = _pubCache.get(b64);
  if (!k) { k = crypto.createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' }); _pubCache.set(b64, k); }
  return k;
}
function verify(pubB64, str, sig) {
  try { return crypto.verify(null, Buffer.from(str), pubObj(pubB64), Buffer.from(String(sig), 'base64')); } catch { return false; }
}
// Короткий отпечаток для сверки по телефону: 4 группы по 4 символа
function fingerprint(pubB64) {
  const h = crypto.createHash('sha256').update(Buffer.from(pubB64, 'base64')).digest('hex').toUpperCase();
  return [0, 4, 8, 12].map(i => h.slice(i, i + 4)).join(' · ');
}
function validPub(b64) {
  try { const k = pubObj(String(b64)); return k.asymmetricKeyType === 'ed25519'; } catch { return false; }
}

function normalizeUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  let x; try { x = new URL(s); } catch { return null; }
  if (x.protocol !== 'http:' && x.protocol !== 'https:') return null;
  return x.origin + (x.pathname !== '/' ? x.pathname.replace(/\/+$/, '') : '');
}

// Своя личность. Идентификатор задаётся один раз (пока нет соединений) и дальше не меняется: он входит в адреса людей
function identity() {
  const id = getS('fed_id');
  if (!id) return { configured: false, id: '', name: getS('fed_name'), url: getS('fed_url') };
  ensureKeys();
  const pub = getS('fed_pub');
  return { configured: true, id, name: getS('fed_name') || id, url: getS('fed_url'), pub, fp: fingerprint(pub) };
}
function setIdentity({ id, name, url }) {
  const cur = getS('fed_id');
  if (id !== undefined && String(id) !== cur) {
    if (cur) return { error: 'Идентификатор после задания не меняется' };
    const v = String(id).trim().toLowerCase();
    if (!ID_RE.test(v)) return { error: 'Идентификатор: 2–32 символа, латиница, цифры, точка, дефис, подчёркивание' };
    setS('fed_id', v);
    ensureKeys();
  }
  if (name !== undefined) {
    const n = String(name).trim().replace(/\s+/g, ' ');
    if (!n || n.length > 60) return { error: 'Имя системы: от 1 до 60 символов' };
    setS('fed_name', n);
  }
  if (url !== undefined) {
    const u = normalizeUrl(url);
    if (u === null) return { error: 'Адрес должен начинаться с http:// или https://' };
    setS('fed_url', u);
  }
  return { ok: true };
}

// ─────────────────────────── счётчики ───────────────────────────
// Копим в памяти и раз в 15 секунд сбрасываем в fed_stats по часам: на каждый кадр писать в базу незачем
const statAcc = new Map();
function stat(peerId, field, n = 1) {
  const b = Math.floor(Date.now() / 3600000) * 3600, k = b + ':' + peerId;
  let o = statAcc.get(k);
  if (!o) { o = { b, peerId }; statAcc.set(k, o); }
  o[field] = (o[field] || 0) + n;
}
const STAT_FIELDS = ['bytes_out', 'bytes_in', 'rej_limit', 'rej_rate', 'rej_blocked', 'rej_other', 'reconnects'];
function flushStats() {
  if (!statAcc.size) return;
  const rows = [...statAcc.values()]; statAcc.clear();
  const cols = STAT_FIELDS.join(', '), ph = STAT_FIELDS.map(() => '?').join(', ');
  const upd = STAT_FIELDS.map(f => `${f} = ${f} + excluded.${f}`).join(', ');
  const st = db.prepare(`INSERT INTO fed_stats (bucket, peer_id, ${cols}) VALUES (?, ?, ${ph}) ON CONFLICT(bucket, peer_id) DO UPDATE SET ${upd}`);
  db.transaction(() => rows.forEach(o => { if (db.prepare('SELECT 1 FROM fed_peers WHERE id = ?').get(o.peerId)) st.run(o.b, o.peerId, ...STAT_FIELDS.map(f => o[f] || 0)); }))();
}
setInterval(() => { try { flushStats(); } catch (e) { console.warn('[Fed] счётчики:', e.message); } }, 15000).unref();

// ─────────────────────────── соединения ───────────────────────────
const peerRow = id => db.prepare('SELECT * FROM fed_peers WHERE id = ?').get(id);
const peerByInstance = inst => db.prepare('SELECT * FROM fed_peers WHERE instance_id = ?').get(String(inst));
const sessions = new Map();   // peer.id → сессия (аутентифицированное соединение)
const dialers = new Map();    // peer.id → { timer, ws, backoff, stopped } (исходящие соединения)
const pending = new Map();    // rid → ожидающий ответа запрос
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });

function isOnline(peerId) { const s = sessions.get(peerId); return !!(s && s.ws.readyState === 1); }

// ── Шифрованный туннель ──
// X25519: временная пара ключей на сессию. Публичная часть передаётся «сырыми» 32 байтами (base64)
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
function newEphemeral() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return { priv: privateKey, pub: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64') };
}
function ephShared(privKey, theirPubB64) {
  const raw = Buffer.from(String(theirPubB64), 'base64');
  if (raw.length !== 32) throw new Error('bad epk');
  const pub = crypto.createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
  return crypto.diffieHellman({ privateKey: privKey, publicKey: pub });
}
// Ключи по направлениям: клиент → сервер и сервер → клиент. nonce выдаёт принимающая сторона, он же «соль»
function deriveKeys(shared, nonce, isServer) {
  const k = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from(nonce), Buffer.from('fed-v1'), 64));
  const c2s = k.subarray(0, 32), s2c = k.subarray(32, 64);
  return isServer ? { sendKey: s2c, recvKey: c2s } : { sendKey: c2s, recvKey: s2c };
}
// Что именно подписывают стороны: оба временных ключа и nonce, чтобы подписи нельзя было перенести в другую сессию
const hsBody = (role, id, nonce, sEpk, cEpk) => `${role}|${id}|${nonce}|${sEpk}|${cEpk}`;
const ctrNonce = n => { const b = Buffer.alloc(12); b.writeBigUInt64BE(BigInt(n), 4); return b; };

// Кадр на проводе: 8 байт счётчика + шифртекст + 16 байт метки подлинности (бинарное сообщение WebSocket)
function wire(sess, obj) {
  const ctr = sess.sendCtr++;
  const c = crypto.createCipheriv('chacha20-poly1305', sess.sendKey, ctrNonce(ctr), { authTagLength: 16 });
  const head = Buffer.alloc(8); head.writeBigUInt64BE(BigInt(ctr));
  c.setAAD(head);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([head, ct, c.getAuthTag()]);
}
function sendFrame(sess, obj) {
  if (!sess || sess.ws.readyState !== 1) return false;
  try { const w = wire(sess, obj); sess.ws.send(w, { binary: true }); stat(sess.peerId, 'bytes_out', w.length); return true; } catch { return false; }
}
// null — кадр поддельный, повторный, переставленный или не расшифровался: соединение надо закрыть
function readFrame(sess, raw, isBinary) {
  if (!isBinary || !Buffer.isBuffer(raw) || raw.length < 8 + 16) return null;
  const head = raw.subarray(0, 8), ctr = Number(head.readBigUInt64BE());
  if (ctr !== sess.recvCtr) return null;
  try {
    const d = crypto.createDecipheriv('chacha20-poly1305', sess.recvKey, ctrNonce(ctr), { authTagLength: 16 });
    d.setAAD(head); d.setAuthTag(raw.subarray(raw.length - 16));
    const plain = Buffer.concat([d.update(raw.subarray(8, raw.length - 16)), d.final()]).toString('utf8');
    sess.recvCtr++;
    return JSON.parse(plain);
  } catch { return null; }
}

// Входящее соединение (подключился сервер, который получил от нас ключ)
function handleUpgrade(req, socket, head) {
  wss.handleUpgrade(req, socket, head, ws => onInbound(ws));
}
function onInbound(ws) {
  const me = identity();
  if (!me.configured) { ws.close(4003, 'not configured'); return; }
  const nonce = crypto.randomBytes(24).toString('base64url');
  const eph = newEphemeral();
  const timer = setTimeout(() => { try { ws.close(4008, 'timeout'); } catch {} }, 10000);
  ws.once('message', raw => {
    clearTimeout(timer);
    let m; try { m = JSON.parse(raw); } catch { ws.close(4003, 'bad'); return; }
    const peer = m?.t === 'hello' ? peerByInstance(m.id) : null;
    if (!peer || peer.role !== 'in' || peer.status !== 'active' || typeof m.epk !== 'string'
        || !verify(peer.pub, hsBody('hello', m.id, nonce, eph.pub, m.epk), m.sig)) { ws.close(4003, 'denied'); return; }
    let keys;
    try { keys = deriveKeys(ephShared(eph.priv, m.epk), nonce, true); } catch { ws.close(4003, 'denied'); return; }
    ws.send(JSON.stringify({ t: 'welcome', id: me.id, sig: sign(hsBody('welcome', me.id, nonce, eph.pub, m.epk)) }));
    attach(peer, { ws, nonce, ...keys });
  });
  ws.send(JSON.stringify({ t: 'challenge', nonce, epk: eph.pub }));
}

// Исходящее соединение: мы подключаемся к серверу, чей ключ ввели
function startDialer(peer) {
  if (peer.role !== 'out' || peer.status !== 'active' || !peer.url) return;
  const old = dialers.get(peer.id);
  if (old && !old.stopped) return;
  const d = { timer: null, ws: null, backoff: 2000, stopped: false };
  dialers.set(peer.id, d);
  const dial = () => {
    if (d.stopped) return;
    const cur = peerRow(peer.id);
    if (!cur || cur.status !== 'active') { d.stopped = true; dialers.delete(peer.id); return; }
    const me = identity();
    let ws;
    try { ws = new WebSocket(cur.url.replace(/^http/i, 'ws') + '/fed', { handshakeTimeout: 10000, maxPayload: MAX_FRAME }); }
    catch { schedule(); return; }
    d.ws = ws;
    let nonce = null, state = 'challenge', sEpk = null, eph = null;
    ws.on('message', raw => {
      if (state === 'ready') return;   // дальше сообщения читает attach()
      let m; try { m = JSON.parse(raw); } catch { ws.close(); return; }
      if (state === 'challenge' && m.t === 'challenge' && typeof m.nonce === 'string' && typeof m.epk === 'string') {
        nonce = m.nonce; sEpk = m.epk; eph = newEphemeral(); state = 'welcome';
        ws.send(JSON.stringify({ t: 'hello', id: me.id, epk: eph.pub, sig: sign(hsBody('hello', me.id, nonce, sEpk, eph.pub)) }));
      } else if (state === 'welcome' && m.t === 'welcome' && m.id === cur.instance_id && verify(cur.pub, hsBody('welcome', m.id, nonce, sEpk, eph.pub), m.sig)) {
        let keys;
        try { keys = deriveKeys(ephShared(eph.priv, sEpk), nonce, false); } catch { ws.close(); return; }
        state = 'ready'; d.backoff = 2000;
        ws.removeAllListeners('message');
        attach(cur, { ws, nonce, ...keys });
      } else ws.close();
    });
    ws.on('error', () => {});
    ws.on('close', () => { if (d.ws === ws) d.ws = null; schedule(); });
  };
  const schedule = () => {
    if (d.stopped) return;
    clearTimeout(d.timer);
    d.timer = setTimeout(dial, d.backoff);
    d.backoff = Math.min(d.backoff * 2, 60000);
  };
  dial();
}
function stopDialer(peerId) {
  const d = dialers.get(peerId);
  if (!d) return;
  d.stopped = true; clearTimeout(d.timer);
  try { d.ws?.close(); } catch {}
  dialers.delete(peerId);
}

// Соединение установлено и проверено с обеих сторон
function attach(peer, { ws, nonce, sendKey, recvKey }) {
  const old = sessions.get(peer.id);
  if (old && old.ws !== ws) { try { old.ws.close(4000, 'replaced'); } catch {} }
  const sess = { ws, nonce, sendKey, recvKey, sendCtr: 0, recvCtr: 0, peerId: peer.id, sentMax: 0, chain: Promise.resolve(), alive: true };
  sessions.set(peer.id, sess);
  stat(peer.id, 'reconnects');
  db.prepare('UPDATE fed_peers SET last_contact_at = unixepoch() WHERE id = ?').run(peer.id);
  ws.on('pong', () => { sess.alive = true; });
  sess.ping = setInterval(() => {
    if (!sess.alive) { try { ws.terminate(); } catch {} return; }
    sess.alive = false; try { ws.ping(); } catch {}
  }, 25000);
  ws.on('message', (raw, isBinary) => onFrame(sess, raw, isBinary));
  ws.on('close', () => {
    clearInterval(sess.ping);
    if (sessions.get(peer.id) === sess) { sessions.delete(peer.id); onOffline(peer.id); }
    for (const [rid, p] of pending) if (p.peerId === peer.id) { pending.delete(rid); clearTimeout(p.timer); p.fail(new Error('offline')); }
  });
  ws.on('error', () => {});
  flush(peer.id);
  syncPresence(peer.id);
  groups().sendCaps(peer.id);
  groups().onLink(peer, true);
}

// Связь пропала: статусы людей оттуда неизвестны, показываем «не в сети» (время последнего визита остаётся прежним)
function onOffline(peerId) {
  const peer = peerRow(peerId);
  if (!peer) return;
  db.prepare('SELECT id FROM users WHERE is_bot = 2 AND fed_instance = ?').all(peer.instance_id)
    .forEach(u => { try { wsm().setRemoteStatus(u.id, 'offline', 0); } catch {} });
  try { groups().onLink(peer, false); } catch (e) { console.warn('[Fed] группы:', e.message); }
}

function onFrame(sess, raw, isBinary) {
  const peer = peerRow(sess.peerId);
  if (!peer || peer.status !== 'active') { try { sess.ws.close(4003, 'denied'); } catch {} return; }
  if (raw?.length) stat(peer.id, 'bytes_in', raw.length);
  const f = readFrame(sess, raw, isBinary);
  if (!f) { try { sess.ws.close(4004, 'bad frame'); } catch {} return; }
  switch (f.t) {
    case 'ev': {
      if (!f.seq) { handleEvent(peer, f.ev).catch(e => console.warn('[Fed] событие:', e.message)); return; }
      const ack = () => sendFrame(sess, { t: 'ack', seq: f.seq });
      if (f.seq <= peer.last_in_seq) { ack(); return; }
      sess.chain = sess.chain.then(async () => {
        try { await handleEvent(peer, f.ev); } catch (e) { console.warn('[Fed] событие', f.ev?.k, e.message); }
        db.prepare('UPDATE fed_peers SET last_in_seq = MAX(last_in_seq, ?), last_contact_at = unixepoch() WHERE id = ?').run(f.seq, peer.id);
        ack();
      });
      return;
    }
    case 'ack':
      db.prepare('DELETE FROM fed_outbox WHERE peer_id = ? AND id <= ?').run(peer.id, Number(f.seq) || 0);
      return;
    case 'req': handleReq(peer, sess, f).catch(e => sendFrame(sess, { t: 'res', rid: f.rid, ok: false, err: e.message || 'error' })); return;
    case 'res': case 'chunk': case 'end': onReply(f); return;
  }
}

// ─────────────────────────── очередь ───────────────────────────
function enqueue(peerId, ev) {
  db.prepare('INSERT INTO fed_outbox (peer_id, ev) VALUES (?, ?)').run(peerId, JSON.stringify(ev));
  flush(peerId);
}
function flush(peerId) {
  const sess = sessions.get(peerId);
  if (!sess || sess.ws.readyState !== 1) return;
  const rows = db.prepare('SELECT id, ev FROM fed_outbox WHERE peer_id = ? AND id > ? ORDER BY id LIMIT 500').all(peerId, sess.sentMax);
  for (const r of rows) {
    if (!sendFrame(sess, { t: 'ev', seq: r.id, ev: JSON.parse(r.ev) })) return;
    sess.sentMax = r.id;
  }
  if (rows.length === 500) setImmediate(() => flush(peerId));
}
// Эфемерное событие: не хранится, уходит только если связь есть
function sendLive(peerId, ev) { return sendFrame(sessions.get(peerId), { t: 'ev', seq: 0, ev }); }
function queueSize(peerId) { return db.prepare('SELECT COUNT(*) c FROM fed_outbox WHERE peer_id = ?').get(peerId).c; }

// ─────────────────────────── запросы «вопрос-ответ» ───────────────────────────
function rpc(peerId, op, params, { timeout = 15000 } = {}) {
  const sess = sessions.get(peerId);
  if (!sess || sess.ws.readyState !== 1) return Promise.reject(new Error('offline'));
  return new Promise((resolve, reject) => {
    const rid = crypto.randomBytes(9).toString('base64url');
    const p = { peerId, fail: reject, resolve, timeoutMs: timeout, timer: null };
    const arm = () => { clearTimeout(p.timer); p.timer = setTimeout(() => { pending.delete(rid); reject(new Error('timeout')); }, p.timeoutMs); };
    p.arm = arm; arm();
    pending.set(rid, p);
    sendFrame(sess, { t: 'req', rid, op, ...params });
  });
}
function onReply(f) {
  const p = pending.get(f.rid);
  if (!p) return;
  p.arm?.();
  if (f.t === 'res') {
    if (!f.ok) { pending.delete(f.rid); clearTimeout(p.timer); p.sink?.destroy(); p.fail(new Error(f.err || 'error')); return; }
    if (p.sink) { p.meta = f; return; }
    pending.delete(f.rid); clearTimeout(p.timer); p.resolve(f.data);
  } else if (f.t === 'chunk' && p.sink) {
    const buf = Buffer.from(String(f.d), 'base64');
    p.size += buf.length;
    if (p.size > p.max) { pending.delete(f.rid); clearTimeout(p.timer); p.sink.destroy(); p.fail(new Error('too_big')); return; }
    p.sink.write(buf);
  } else if (f.t === 'end' && p.sink) {
    pending.delete(f.rid); clearTimeout(p.timer);
    p.sink.end(() => p.resolve({ size: p.size, meta: p.meta }));
  }
}
// Скачать файл на диск. max — предельный размер в байтах: больше не принимаем
function fetchFile(peerId, params, dest, max) {
  const sess = sessions.get(peerId);
  if (!sess || sess.ws.readyState !== 1) return Promise.reject(new Error('offline'));
  return new Promise((resolve, reject) => {
    const rid = crypto.randomBytes(9).toString('base64url');
    const sink = fs.createWriteStream(dest);
    const fail = e => { try { fs.unlinkSync(dest); } catch {} reject(e); };
    const p = { peerId, fail, resolve, sink, size: 0, max, meta: null, timeoutMs: 30000, timer: null };
    p.arm = () => { clearTimeout(p.timer); p.timer = setTimeout(() => { pending.delete(rid); sink.destroy(); fail(new Error('timeout')); }, p.timeoutMs); };
    p.arm();
    pending.set(rid, p);
    sendFrame(sess, { t: 'req', rid, op: 'file', ...params });   // params.op перекрывает операцию (например, 'avatar')
  });
}
async function sendFileFrames(sess, rid, filePath) {
  const st = fs.statSync(filePath);
  sendFrame(sess, { t: 'res', rid, ok: true, size: st.size });
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    for (let n = 0; ; n++) {
      const { bytesRead } = await fd.read(buf, 0, CHUNK, null);
      if (!bytesRead) break;
      while (sess.ws.readyState === 1 && sess.ws.bufferedAmount > 4 * 1024 * 1024) await new Promise(r => setTimeout(r, 20));
      if (!sendFrame(sess, { t: 'chunk', rid, n, d: buf.subarray(0, bytesRead).toString('base64') })) return;
    }
    sendFrame(sess, { t: 'end', rid });
  } finally { await fd.close(); }
}

// Вопросы второго сервера к нам
async function handleReq(peer, sess, f) {
  const reply = (data) => sendFrame(sess, { t: 'res', rid: f.rid, ok: true, data });
  const fail = (err) => sendFrame(sess, { t: 'res', rid: f.rid, ok: false, err });
  if (f.op === 'lookup') {
    const u = findLocalUser(String(f.login || ''));
    if (!u) return fail('not_found');
    return reply({ login: u.username, name: u.display_name, av: avatarVersion(u.id) });
  }
  if (f.op === 'gavatar') {
    const file = groups().chatAvatarFile(peer, f.gid);
    return file ? sendFileFrames(sess, f.rid, file) : fail('not_found');
  }
  if (f.op && f.op[0] === 'g') {
    return groups().handleReq(peer, f).then(reply, e => fail(e.message || 'error'));
  }
  if (f.op === 'avatar' && f.inst && f.inst !== identity().id) {
    // Человек с третьего сервера, которого гость знает через нас: отдаём, если он состоит в чате с людьми гостя
    const sh = shadowRow(String(f.inst), String(f.login || ''));
    const file = sh && path.join(AVATAR_DIR, `${sh.id}.jpg`);
    const shares = sh && db.prepare(`SELECT 1 FROM chat_members a JOIN chat_members b ON b.chat_id = a.chat_id JOIN users s ON s.id = b.user_id
      WHERE a.user_id = ? AND s.is_bot = 2 AND s.fed_instance = ? LIMIT 1`).get(sh.id, peer.instance_id);
    if (!sh || !shares || !fs.existsSync(file)) return fail('not_found');
    return sendFileFrames(sess, f.rid, file);
  }
  if (f.op === 'avatar') {
    const u = findLocalUser(String(f.login || ''));
    const file = u && path.join(AVATAR_DIR, `${u.id}.jpg`);
    if (!u || !isRelated(u.id, peer) || !fs.existsSync(file)) return fail('not_found');
    return sendFileFrames(sess, f.rid, file);
  }
  if (f.op === 'file') {
    const m = db.prepare('SELECT m.*, c.type FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.fed_uid = ? AND m.deleted = 0').get(String(f.uid || ''));
    const sender = m && db.prepare('SELECT id, is_bot FROM users WHERE id = ?').get(m.sender_id);
    // Отдаём только то, что мы сами отправили этому серверу; в группах — любое вложение чата, к которому сервер причастен
    const grp = m && (m.type === 'group' || m.type === 'room') && (() => {
      const c = db.prepare('SELECT fed_instance FROM chats WHERE id = ?').get(m.chat_id);
      return c.fed_instance ? c.fed_instance === peer.instance_id : chatWithPeer(m.chat_id, peer);
    })();
    if (!m || !sender || !(grp || (m.type === 'direct' && sender.is_bot !== spaces.FED && chatWithPeer(m.chat_id, peer)))) return fail('not_found');
    let att; try { att = JSON.parse(m.attachment); } catch { att = null; }
    const url = f.which === 'thumb' ? att?.thumb : att?.url;
    const file = url && path.join(FILES_DIR, path.basename(url));
    if (!file || !fs.existsSync(file)) return fail('gone');
    return sendFileFrames(sess, f.rid, file);
  }
  fail('unknown');
}

// ─────────────────────────── люди и чаты ───────────────────────────
const addrOf = u => `${u.fed_instance}@${u.fed_login}`;
function findLocalUser(login) {
  const l = String(login).trim().replace(/^@/, '');
  if (!l) return null;
  const q = 'SELECT id, username, display_name, banned FROM users WHERE COALESCE(is_bot, 0) = 0 AND COALESCE(banned, 0) = 0 AND ';
  return db.prepare(q + 'username = ?').get(l) || db.prepare(q + 'LOWER(username) = LOWER(?)').get(l) || null;
}
function avatarVersion(userId) {
  try { return String(Math.floor(fs.statSync(path.join(AVATAR_DIR, `${userId}.jpg`)).mtimeMs)); } catch { return ''; }
}
const shadowRow = (inst, login) => db.prepare('SELECT * FROM users WHERE is_bot = 2 AND fed_instance = ? AND fed_login = ?').get(inst, login);
// Чат между нами и людьми этого сервера?
function chatWithPeer(chatId, peer) {
  return !!db.prepare(`SELECT 1 FROM chat_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.chat_id = ? AND u.is_bot = 2 AND u.fed_instance = ?`).get(chatId, peer.instance_id);
}
// Знает ли сервер этого человека: контакт в любую сторону или общий личный чат
function isRelated(localId, peer) {
  return !!db.prepare(`SELECT 1 FROM users s WHERE s.is_bot = 2 AND s.fed_instance = ? AND (
      EXISTS (SELECT 1 FROM contacts WHERE owner_id = s.id AND contact_id = ?)
      OR EXISTS (SELECT 1 FROM contacts WHERE owner_id = ? AND contact_id = s.id)
      OR EXISTS (SELECT 1 FROM chat_members a JOIN chat_members b ON b.chat_id = a.chat_id AND b.user_id = ? WHERE a.user_id = s.id))
    LIMIT 1`).get(peer.instance_id, localId, localId, localId);
}
function peerOfUser(userId) {
  const u = db.prepare('SELECT is_bot, fed_instance FROM users WHERE id = ?').get(userId);
  return u?.is_bot === 2 ? peerByInstance(u.fed_instance) || null : null;
}
function relatedPeers(localId) {
  return db.prepare(`SELECT DISTINCT p.* FROM fed_peers p JOIN users s ON s.fed_instance = p.instance_id AND s.is_bot = 2
    WHERE p.status = 'active' AND (
      EXISTS (SELECT 1 FROM contacts WHERE owner_id = s.id AND contact_id = ?)
      OR EXISTS (SELECT 1 FROM contacts WHERE owner_id = ? AND contact_id = s.id)
      OR EXISTS (SELECT 1 FROM chat_members a JOIN chat_members b ON b.chat_id = a.chat_id AND b.user_id = ? WHERE a.user_id = s.id))`)
    .all(localId, localId, localId);
}

// Создать или обновить «теневого» пользователя. Имя и аватарка берутся из последнего, что прислал его сервер
function ensureShadow(peer, login, name, av) {
  const username = `${peer.instance_id}:${login}`;
  let u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u) {
    const r = db.prepare(`INSERT INTO users (username, password_hash, display_name, is_bot, workspace_id, fed_instance, fed_login, fed_avatar_v)
      VALUES (?, '', ?, 2, 0, ?, ?, ?)`).run(username, String(name || login).slice(0, 80) || login, peer.instance_id, login, null);
    u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  } else if (u.is_bot !== 2) {
    return null;   // имя занято настоящим пользователем
  } else if (name && String(name).slice(0, 80) !== u.display_name) {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(String(name).slice(0, 80), u.id);
    u.display_name = String(name).slice(0, 80);
    spaces.knownByOf(u.id).forEach(id => wsm().sendTo(id, { type: 'user_updated', user_id: u.id, display_name: u.display_name }));
  }
  if (av !== undefined && String(av || '') !== String(u.fed_avatar_v || '')) refreshAvatar(peer, u, String(av || ''));
  return u;
}
async function refreshAvatar(peer, shadow, av) {
  const file = path.join(AVATAR_DIR, `${shadow.id}.jpg`);
  db.prepare('UPDATE users SET fed_avatar_v = ? WHERE id = ?').run(av, shadow.id);   // раньше запроса: не запускаем дважды
  if (!av) { try { fs.unlinkSync(file); } catch {} announceAvatar(shadow.id); return; }
  const tmp = file + '.tmp' + process.pid;
  try {
    await fetchFile(peer.id, { op: 'avatar', login: shadow.fed_login, ...(peer.via ? { inst: shadow.fed_instance } : {}) }, tmp, 2 * 1024 * 1024);
  } catch { try { fs.unlinkSync(tmp); } catch {}; db.prepare('UPDATE users SET fed_avatar_v = NULL WHERE id = ?').run(shadow.id); return; }
  try {
    const buf = fs.readFileSync(tmp);
    if (!require('./routes/users').isImageBuffer(buf)) throw new Error('not image');
    let out = buf;
    try { out = await require('sharp')(buf).rotate().resize(256, 256, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer(); } catch {}
    fs.writeFileSync(file, out);
    announceAvatar(shadow.id);
  } catch { db.prepare('UPDATE users SET fed_avatar_v = NULL WHERE id = ?').run(shadow.id); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}
function announceAvatar(shadowId) {
  const ids = new Set(spaces.knownByOf(shadowId));
  db.prepare('SELECT owner_id FROM contacts WHERE contact_id = ?').all(shadowId).forEach(r => ids.add(r.owner_id));
  db.prepare('SELECT contact_id FROM contacts WHERE owner_id = ?').all(shadowId).forEach(r => ids.add(r.contact_id));
  ids.forEach(id => wsm().sendTo(id, { type: 'avatar_updated', user_id: shadowId }));
}

function directChat(localId, shadowId) {
  return db.prepare(`SELECT c.id FROM chats c
    JOIN chat_members a ON a.chat_id = c.id AND a.user_id = ? JOIN chat_members b ON b.chat_id = c.id AND b.user_id = ?
    WHERE c.type = 'direct' AND COALESCE(c.is_secret, 0) = 0 LIMIT 1`).get(localId, shadowId)?.id || null;
}

// Не больше N новых переписок в час с одного сервера: защита от массовой рассылки
const newChatTimes = new Map();
function newChatAllowed(peerId) {
  const limit = Math.max(1, Number(getS('fed_new_per_hour', '20')) || 20);
  const now = Date.now(), list = (newChatTimes.get(peerId) || []).filter(t => now - t < 3600000);
  if (list.length >= limit) { newChatTimes.set(peerId, list); return false; }
  list.push(now); newChatTimes.set(peerId, list); return true;
}

// ─────────────────────────── контакты ───────────────────────────
function parseAddr(s) {
  const m = /^@?([a-z0-9][a-z0-9._-]{1,31}):(.+)$/i.exec(String(s || '').trim());
  return m ? { instance: m[1].toLowerCase(), login: m[2].trim() } : null;
}
// Найти человека на другом сервере и завести его у нас (без добавления в контакты)
async function lookupRemote(address) {
  const a = parseAddr(address);
  if (!a) return { error: 'Введите адрес вида @сервер:логин', code: 'bad_address' };
  const peer = peerByInstance(a.instance);
  if (!peer || peer.status !== 'active') return { error: 'Такого сервера нет среди подключённых', code: 'no_peer' };
  let r;
  try { r = await rpc(peer.id, 'lookup', { login: a.login }); }
  catch (e) { return e.message === 'not_found' ? { error: 'Пользователь с таким логином не найден', code: 'not_found' } : { error: 'Нет связи с этим сервером. Попробуйте позже.', code: 'offline' }; }
  const shadow = ensureShadow(peer, r.login, r.name, r.av);
  if (!shadow) return { error: 'Пользователь с таким логином не найден', code: 'not_found' };
  return { peer, shadow };
}
function onContactAdded(ownerId, shadowId) {
  const sh = db.prepare('SELECT fed_instance, fed_login FROM users WHERE id = ?').get(shadowId);
  const peer = sh && peerByInstance(sh.fed_instance);
  if (!peer) return;
  const me = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(ownerId);
  enqueue(peer.id, { k: 'contact_add', from: me.username, to: sh.fed_login, name: me.display_name, av: avatarVersion(ownerId) });
  if (spaces.mutualContact(ownerId, shadowId)) syncPresence(peer.id, ownerId);
}
function onContactRemoved(ownerId, shadowId) {
  const sh = db.prepare('SELECT fed_instance, fed_login FROM users WHERE id = ?').get(shadowId);
  const peer = sh && peerByInstance(sh.fed_instance);
  if (!peer) return;
  const me = db.prepare('SELECT username FROM users WHERE id = ?').get(ownerId);
  enqueue(peer.id, { k: 'contact_remove', from: me.username, to: sh.fed_login });
}

// ─────────────────────────── отправка ───────────────────────────
function peerAndShadowOfChat(chatId, localId) {
  const sh = db.prepare(`SELECT u.* FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ? AND u.is_bot = 2 AND cm.user_id != ? LIMIT 1`).get(chatId, localId);
  const peer = sh && peerByInstance(sh.fed_instance);
  return peer ? { peer, shadow: sh } : null;
}
function onLocalMessage(msgId) {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
  if (!m || m.deleted) return;
  const ps = peerAndShadowOfChat(m.chat_id, m.sender_id);
  if (!ps) return;
  const me = identity();
  const uid = `${me.id}:${m.id}`;
  db.prepare('UPDATE messages SET fed_uid = ? WHERE id = ?').run(uid, m.id);
  const u = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(m.sender_id);
  let att = null;
  try {
    const a = m.attachment ? JSON.parse(m.attachment) : null;
    if (a?.url) att = { name: a.name, size: a.size, mime: a.mime, w: a.width || null, h: a.height || null, thumb: !!a.thumb };
    else if (a?.gif) att = { gif: a.gif };   // GIF из Klipy: только ссылки, файл с сервера на сервер не передаётся
  } catch {}
  let fwd = null;
  try { const f = m.forward_data ? JSON.parse(m.forward_data) : null; if (f) fwd = { name: f.name, text: f.text }; } catch {}
  const reply = m.reply_to_id ? db.prepare('SELECT fed_uid FROM messages WHERE id = ?').get(m.reply_to_id)?.fed_uid || null : null;
  enqueue(ps.peer.id, { k: 'msg', uid, from: u.username, to: ps.shadow.fed_login, name: u.display_name, av: avatarVersion(m.sender_id), text: m.text, ts: m.sent_at, reply, fwd, att });
}
function msgPeer(m) { return peerAndShadowOfChat(m.chat_id, m.sender_id || 0); }
const isGroupChat = chatId => { const t = db.prepare('SELECT type FROM chats WHERE id = ?').get(chatId)?.type; return t === 'group' || t === 'room'; };
function onGroupMessage(msgId) { groups().onMessage(msgId); }
function onEdit(msgId) {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
  if (m && isGroupChat(m.chat_id)) return groups().onEdit(m);
  const ps = m?.fed_uid && msgPeer(m);
  if (ps) enqueue(ps.peer.id, { k: 'edit', uid: m.fed_uid, text: m.text, at: m.edited_at });
}
function onDelete(m) {
  if (m && isGroupChat(m.chat_id)) return groups().onDelete(m);
  const ps = m?.fed_uid && msgPeer(m);
  if (ps) enqueue(ps.peer.id, { k: 'del', uid: m.fed_uid });
}
function onReact(m, userId, emoji, on) {
  if (isGroupChat(m.chat_id)) return groups().onReact(m, userId, emoji, on);
  const ps = peerAndShadowOfChat(m.chat_id, userId);
  if (ps) enqueue(ps.peer.id, { k: 'react', uid: m.fed_uid, from: db.prepare('SELECT username FROM users WHERE id = ?').get(userId).username, emoji, on: !!on });
}
// Статусы «доставлено» и «прочитано» сообщений человека с другого сервера: наш читатель → его сервер
function onStatus(kind, shadowId, readerId, maxLocalId) {
  const mc = db.prepare('SELECT chat_id FROM messages WHERE id = ?').get(maxLocalId);
  if (mc && isGroupChat(mc.chat_id)) return groups().onStatus(kind, readerId, maxLocalId);
  const sh = db.prepare('SELECT fed_instance, fed_login FROM users WHERE id = ?').get(shadowId);
  const peer = sh && peerByInstance(sh.fed_instance);
  const msg = db.prepare('SELECT fed_uid FROM messages WHERE id = ?').get(maxLocalId);
  if (!peer || !msg?.fed_uid) return;
  const upto = Number(String(msg.fed_uid).split(':').pop());
  if (!upto) return;
  enqueue(peer.id, { k: kind, from: db.prepare('SELECT username FROM users WHERE id = ?').get(readerId).username, to: sh.fed_login, upto });
}
function onPin(chatId, msgId, userId, on) { if (isGroupChat(chatId)) groups().onPin(chatId, msgId, userId, on); }
function onTyping(chatId, userId) {
  if (isGroupChat(chatId)) return groups().onTyping(chatId, userId);
  const ps = peerAndShadowOfChat(chatId, userId);
  if (!ps || !spaces.mutualContact(userId, ps.shadow.id)) return;
  sendLive(ps.peer.id, { k: 'typing', from: db.prepare('SELECT username FROM users WHERE id = ?').get(userId).username, to: ps.shadow.fed_login });
}
// Статус нашего человека → его взаимным контактам на других серверах
function onPresence(userId, status, lastSeen) {
  if (!sessions.size) return;
  const me = db.prepare('SELECT username, is_bot FROM users WHERE id = ?').get(userId);
  if (!me || me.is_bot) return;
  db.prepare(`SELECT s.fed_instance, s.fed_login, s.id FROM contacts c1 JOIN contacts c2 ON c2.owner_id = c1.contact_id AND c2.contact_id = c1.owner_id
    JOIN users s ON s.id = c1.contact_id WHERE c1.owner_id = ? AND s.is_bot = 2`).all(userId).forEach(s => {
    const peer = peerByInstance(s.fed_instance);
    if (peer) sendLive(peer.id, { k: 'presence', from: me.username, to: s.fed_login, status, last_seen: lastSeen || null });
  });
}
// Текущие статусы всех, кто взаимно связан с этим сервером (после подключения и при появлении взаимности)
function syncPresence(peerId, onlyLocalId) {
  const peer = peerRow(peerId);
  if (!peer || !isOnline(peerId)) return;
  const rows = db.prepare(`SELECT c1.owner_id AS lid, s.fed_login FROM contacts c1 JOIN contacts c2 ON c2.owner_id = c1.contact_id AND c2.contact_id = c1.owner_id
    JOIN users s ON s.id = c1.contact_id WHERE s.is_bot = 2 AND s.fed_instance = ?`).all(peer.instance_id);
  for (const r of rows) {
    if (onlyLocalId && r.lid !== onlyLocalId) continue;
    const u = db.prepare('SELECT username, last_seen_at FROM users WHERE id = ?').get(r.lid);
    const st = wsm().getStatus(r.lid);
    sendLive(peerId, { k: 'presence', from: u.username, to: r.fed_login, status: st, last_seen: st === 'offline' ? u.last_seen_at : null });
  }
}
// Имя или аватарка нашего человека изменились: сообщаем серверам, которые его знают
function onProfile(userId) {
  const u = db.prepare('SELECT username, display_name, is_bot FROM users WHERE id = ?').get(userId);
  if (!u || u.is_bot) return;
  relatedPeers(userId).forEach(p => enqueue(p.id, { k: 'profile', login: u.username, name: u.display_name, av: avatarVersion(userId) }));
}

// ─────────────────────────── приём ───────────────────────────
async function handleEvent(peer, ev) {
  if (!ev || typeof ev.k !== 'string') return;
  switch (ev.k) {
    case 'msg': return recvMessage(peer, ev);
    case 'edit': return recvEdit(peer, ev);
    case 'del': return recvDelete(peer, ev);
    case 'react': return recvReact(peer, ev);
    case 'dlv': case 'read': return recvStatus(peer, ev);
    case 'contact_add': return recvContactAdd(peer, ev);
    case 'contact_remove': return recvContactRemove(peer, ev);
    case 'profile': return recvProfile(peer, ev);
    case 'rej': return recvReject(peer, ev);
    case 'typing': return recvTyping(peer, ev);
    case 'presence': return recvPresence(peer, ev);
    // Группы и комнаты (версия протокола 2): caps и всё, что начинается на g
    default: if (ev.k === 'caps' || /^g[a-z_]+$/.test(ev.k)) return groups().handle(peer, ev);
  }
}
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

function reject(peer, ev, reason) {
  stat(peer.id, reason === 'limit' ? 'rej_limit' : reason === 'rate' ? 'rej_rate' : reason === 'blocked' ? 'rej_blocked' : 'rej_other');
  enqueue(peer.id, { k: 'rej', uid: ev.uid, reason });
}

async function recvMessage(peer, ev) {
  const login = str(ev.from, 64), uid = str(ev.uid, 80);
  const local = findLocalUser(str(ev.to, 64));
  if (!login || !uid || !local) return reject(peer, ev, 'no_user');
  if (db.prepare('SELECT 1 FROM messages WHERE fed_uid = ?').get(uid)) return;   // повтор после обрыва
  const shadow = ensureShadow(peer, login, str(ev.name, 80), ev.av === undefined ? undefined : str(ev.av, 40));
  if (!shadow) return reject(peer, ev, 'no_user');
  if (spaces.isBlocked(local.id, shadow.id)) return reject(peer, ev, 'blocked');
  if (spaces.limitApplies(shadow.id, local.id) && spaces.limitUsed(shadow.id, local.id) >= spaces.DM_LIMIT) return reject(peer, ev, 'limit');

  let chatId = directChat(local.id, shadow.id);
  if (!chatId && !newChatAllowed(peer.id)) return reject(peer, ev, 'rate');

  const text = str(ev.text, 4096);
  // Вложение: скачиваем у себя, проверяя размер и формат по НАШИМ настройкам
  let attachment = null;
  if (ev.att && typeof ev.att === 'object') attachment = ev.att.gif ? gifLib.sanitize(ev.att) : await receiveAttachment(peer, uid, ev.att);
  let fwdJson = null;
  if (ev.fwd && typeof ev.fwd === 'object') fwdJson = JSON.stringify({ user_id: shadow.id, name: str(ev.fwd.name, 80), text: str(ev.fwd.text, 4096), attachment: null, is_bot: false });
  if (!text && !attachment && !fwdJson) return;

  let reload = false;
  if (!chatId) {
    reload = true;
    chatId = db.transaction(() => {
      const r = db.prepare("INSERT INTO chats (type, created_by) VALUES ('direct', ?)").run(shadow.id);
      db.prepare('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)').run(r.lastInsertRowid, shadow.id);
      db.prepare('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)').run(r.lastInsertRowid, local.id);
      return r.lastInsertRowid;
    })();
  } else if (db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ? AND hidden_at IS NOT NULL').get(chatId, local.id)) {
    db.prepare('UPDATE chat_members SET hidden_at = NULL WHERE chat_id = ? AND user_id = ?').run(chatId, local.id);
    reload = true;
  }
  const replyTo = ev.reply ? db.prepare('SELECT id FROM messages WHERE fed_uid = ? AND chat_id = ?').get(str(ev.reply, 80), chatId)?.id || null : null;
  const ts = Math.min(Math.floor(Number(ev.ts)) || Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));
  const online = wsm().hasOpenConnection(local.id);
  const msgId = db.transaction(() => {
    const r = db.prepare('INSERT INTO messages (chat_id, sender_id, text, sent_at, reply_to_id, attachment, forward_data, fed_uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(chatId, shadow.id, text, ts, replyTo, attachment ? JSON.stringify(attachment) : null, fwdJson, uid);
    if (online) {
      db.prepare('INSERT OR IGNORE INTO message_status (message_id, user_id) VALUES (?, ?)').run(r.lastInsertRowid, local.id);
      db.prepare('UPDATE message_status SET delivered_at = COALESCE(delivered_at, unixepoch()) WHERE message_id = ? AND user_id = ?').run(r.lastInsertRowid, local.id);
    }
    return r.lastInsertRowid;
  })();
  // Счётчики «сообщений без ответа»: его сообщение увеличивает его счётчик, а наш сбрасывает (он нам ответил)
  if (spaces.limitApplies(shadow.id, local.id)) spaces.limitBump(shadow.id, local.id);
  if (spaces.limitUsed(local.id, shadow.id) > 0) {
    spaces.limitReset(local.id, shadow.id);
    wsm().sendTo(local.id, { type: 'chat_limit', chat_id: chatId, dm_limit: spaces.limitFor(local.id, shadow.id) });
  }
  if (reload) wsm().sendTo(local.id, { type: 'reload_chats' });
  wsm().finishMessage(msgId, chatId, shadow.id);
  if (online) enqueue(peer.id, { k: 'dlv', from: local.username, to: login, upto: Number(uid.split(':').pop()) });
}

// Скачивание вложения. Возвращает объект вложения для базы: готовый файл у нас или пометку «недоступно»
async function receiveAttachment(peer, uid, a) {
  const name = str(a.name, 200) || 'file';
  const size = Math.max(0, Math.floor(Number(a.size)) || 0);
  const mime = str(a.mime, 100);
  const meta = { name, size, mime };
  const cfg = uploadCfg();
  const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file';
  const c = cfg[kind];
  const ext = path.extname(name).replace('.', '').toLowerCase();
  if (!size || size > c.maxSizeMb * 1024 * 1024) return { ...meta, unavailable: 'policy' };
  if (c.extensions.length && !c.extensions.includes(ext)) return { ...meta, unavailable: 'policy' };
  const fname = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext ? '.' + ext.replace(/[^a-z0-9]/g, '') : ''}`;
  const dest = path.join(FILES_DIR, fname);
  try {
    const r = await fetchFile(peer.id, { uid, which: 'file' }, dest, c.maxSizeMb * 1024 * 1024);
    if (!r.size) throw new Error('empty');
  } catch (e) {
    return { ...meta, unavailable: e.message === 'too_big' ? 'policy' : 'fetch' };
  }
  const out = { url: `/files/${fname}`, thumb: null, name, size: fs.statSync(dest).size, mime, width: null, height: null };
  const sharp = (() => { try { return require('sharp'); } catch { return null; } })();
  if (kind === 'image' && sharp) {
    try {
      const md = await sharp(dest).metadata();
      if (!md.width) throw new Error('not image');
      const swapped = md.orientation >= 5 && md.orientation <= 8;
      out.width = swapped ? md.height : md.width; out.height = swapped ? md.width : md.height;
      if (mime !== 'image/gif') {
        const tn = fname.replace(/\.[^.]*$/, '') + '_t.webp';
        await sharp(dest).rotate().resize({ width: 320, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(FILES_DIR, tn));
        out.thumb = `/files/${tn}`;
      }
    } catch { try { fs.unlinkSync(dest); } catch {} return { ...meta, unavailable: 'policy' }; }
  } else if (kind === 'video' && a.thumb) {
    // Кадр-превью видео берём у отправителя (ffmpeg у нас может не быть); принимаем только маленькую картинку
    const tn = fname.replace(/\.[^.]*$/, '') + '_t.jpg', tp = path.join(FILES_DIR, tn);
    try {
      await fetchFile(peer.id, { uid, which: 'thumb' }, tp, 512 * 1024);
      if (require('./routes/users').isImageBuffer(fs.readFileSync(tp))) { out.thumb = `/files/${tn}`; out.width = Number(a.w) || null; out.height = Number(a.h) || null; }
      else fs.unlinkSync(tp);
    } catch { try { fs.unlinkSync(tp); } catch {} }
  }
  return out;
}

function remoteUser(peer, login) { return shadowRow(peer.instance_id, str(login, 64)); }
function senderOfUid(peer, uid) {
  const m = db.prepare('SELECT m.*, u.fed_instance FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.fed_uid = ? AND m.deleted = 0 AND u.is_bot = 2').get(str(uid, 80));
  return m && m.fed_instance === peer.instance_id ? m : null;
}
function recvEdit(peer, ev) {
  const m = senderOfUid(peer, ev.uid);
  const text = str(ev.text, 4096).trim();
  if (!m || !text) return;
  db.prepare('UPDATE messages SET text = ?, edited_at = unixepoch() WHERE id = ?').run(text, m.id);
  const w = wsm();
  w.broadcast(m.chat_id, { type: 'message_edited', message: w.getMessageWithStatus(m.id, m.sender_id) });
  if (db.prepare('SELECT 1 FROM pinned_messages WHERE message_id = ?').get(m.id)) w.broadcast(m.chat_id, { type: 'pins_updated', chat_id: m.chat_id, pins: w.getPins(m.chat_id) });
}
// Файл сообщения удаляем, только если на него больше никто не ссылается
function removeMessageFiles(m) {
  try {
    const a = m.attachment ? JSON.parse(m.attachment) : null;
    if (a?.url) {
      const fname = path.basename(a.url);
      const refs = db.prepare("SELECT COUNT(*) c FROM messages WHERE id != ? AND deleted = 0 AND (attachment LIKE ? OR forward_data LIKE ?)").get(m.id, `%${fname}%`, `%${fname}%`).c;
      if (!refs) [a.url, a.thumb].forEach(u => { if (u) try { fs.unlinkSync(path.join(FILES_DIR, path.basename(u))); } catch {} });
    }
  } catch {}
}
function recvDelete(peer, ev) {
  const m = senderOfUid(peer, ev.uid);
  if (!m) return;
  removeMessageFiles(m);
  db.prepare("UPDATE messages SET deleted = 1, text = '', attachment = NULL WHERE id = ?").run(m.id);
  const w = wsm();
  w.broadcast(m.chat_id, { type: 'message_deleted', message_id: m.id, chat_id: m.chat_id });
  if (db.prepare('DELETE FROM pinned_messages WHERE message_id = ?').run(m.id).changes) w.broadcast(m.chat_id, { type: 'pins_updated', chat_id: m.chat_id, pins: w.getPins(m.chat_id) });
}
function recvReact(peer, ev) {
  const sh = remoteUser(peer, ev.from);
  const m = sh && db.prepare('SELECT * FROM messages WHERE fed_uid = ? AND deleted = 0').get(str(ev.uid, 80));
  const emoji = str(ev.emoji, 16);
  if (!m || !emoji || !/\p{Extended_Pictographic}/u.test(emoji)) return;
  if (!db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(m.chat_id, sh.id)) return;
  if (ev.on) db.prepare('INSERT OR IGNORE INTO reactions (message_id, user_id, reaction) VALUES (?, ?, ?)').run(m.id, sh.id, emoji);
  else db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND reaction = ?').run(m.id, sh.id, emoji);
  const counts = db.prepare('SELECT reaction, COUNT(*) as count, group_concat(user_id) as user_ids FROM reactions WHERE message_id = ? GROUP BY reaction').all(m.id);
  const w = wsm();
  w.broadcast(m.chat_id, { type: 'reaction_update', message_id: m.id, counts });
  if (ev.on && m.sender_id !== sh.id) w.sendTo(m.sender_id, { type: 'reaction_notify', chatId: m.chat_id, reactorName: sh.display_name, reaction: emoji });
}
// «Доставлено» / «прочитано» нашим сообщениям: upto — наш id сообщения
function recvStatus(peer, ev) {
  const sh = remoteUser(peer, ev.from);
  const local = findLocalUser(str(ev.to, 64));
  const upto = Math.floor(Number(ev.upto));
  if (!sh || !local || !upto) return;
  const chatId = directChat(local.id, sh.id);
  if (!chatId) return;
  const ids = db.prepare('SELECT id FROM messages WHERE chat_id = ? AND sender_id = ? AND id <= ? AND deleted = 0 ORDER BY id').all(chatId, local.id, upto).map(r => r.id);
  if (!ids.length) return;
  const read = ev.k === 'read';
  const ins = db.prepare('INSERT OR IGNORE INTO message_status (message_id, user_id) VALUES (?, ?)');
  const upd = db.prepare(`UPDATE message_status SET delivered_at = COALESCE(delivered_at, unixepoch())${read ? ', read_at = COALESCE(read_at, unixepoch())' : ''} WHERE message_id = ? AND user_id = ?`);
  db.transaction(() => ids.forEach(id => { ins.run(id, sh.id); upd.run(id, sh.id); }))();
  const wsmod = wsm();
  wsmod.sendTo(local.id, { type: 'status_range', chat_id: chatId, kind: read ? 'read' : 'delivered', min_id: ids[0], max_id: ids[ids.length - 1], reader_id: sh.id });
}
function recvContactAdd(peer, ev) {
  const local = findLocalUser(str(ev.to, 64)), login = str(ev.from, 64);
  if (!local || !login) return;
  const sh = ensureShadow(peer, login, str(ev.name, 80), ev.av === undefined ? undefined : str(ev.av, 40));
  if (!sh) return;
  // «Он добавил нас»: запись контакта с владельцем-тенью. Дальше работают обычные правила (взаимность, лимит)
  db.prepare('INSERT OR IGNORE INTO contacts (owner_id, contact_id) VALUES (?, ?)').run(sh.id, local.id);
  afterContactChange(local.id, sh.id);
}
function recvContactRemove(peer, ev) {
  const local = findLocalUser(str(ev.to, 64)), sh = remoteUser(peer, ev.from);
  if (!local || !sh) return;
  const wasMutual = spaces.mutualContact(local.id, sh.id);
  db.prepare('DELETE FROM contacts WHERE owner_id = ? AND contact_id = ?').run(sh.id, local.id);
  afterContactChange(local.id, sh.id, wasMutual);
}
// Контакт появился или исчез на их стороне: у нас меняется лимит «без ответа» и видимость статуса
function afterContactChange(localId, shadowId, wasMutual) {
  const w = wsm();
  spaces.directChatIds(localId, shadowId).forEach(chatId => w.sendTo(localId, { type: 'chat_limit', chat_id: chatId, dm_limit: spaces.limitFor(localId, shadowId) }));
  const mutual = spaces.mutualContact(localId, shadowId);
  if (mutual || wasMutual) w.sendTo(localId, { type: 'presence_refresh' });
  if (mutual) { const sh = db.prepare('SELECT fed_instance FROM users WHERE id = ?').get(shadowId); const p = sh && peerByInstance(sh.fed_instance); if (p) syncPresence(p.id, localId); }
}
function recvProfile(peer, ev) {
  const sh = remoteUser(peer, ev.login);
  if (!sh) return;
  ensureShadow(peer, sh.fed_login, str(ev.name, 80), ev.av === undefined ? undefined : str(ev.av, 40));
}
// Сервер получателя не принял наше сообщение: снимаем его у нас и сообщаем отправителю
function recvReject(peer, ev) {
  const m = db.prepare('SELECT m.*, u.is_bot AS su FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.fed_uid = ? AND m.deleted = 0').get(str(ev.uid, 80));
  const mirror = m && db.prepare('SELECT 1 FROM chats WHERE id = ? AND fed_instance = ?').get(m.chat_id, peer.instance_id);
  if (!m || m.su === spaces.FED || !(mirror || chatWithPeer(m.chat_id, peer))) return;
  db.prepare("UPDATE messages SET deleted = 1, text = '', attachment = NULL WHERE id = ?").run(m.id);
  const w = wsm();
  w.broadcast(m.chat_id, { type: 'message_deleted', message_id: m.id, chat_id: m.chat_id });
  const sh = peerAndShadowOfChat(m.chat_id, m.sender_id)?.shadow;
  const reason = str(ev.reason, 20);
  let lim = null;
  if (reason === 'limit' && sh) {
    db.prepare('INSERT INTO dm_limits (sender_id, recipient_id, n) VALUES (?, ?, ?) ON CONFLICT(sender_id, recipient_id) DO UPDATE SET n = ?').run(m.sender_id, sh.id, spaces.DM_LIMIT, spaces.DM_LIMIT);
    lim = spaces.limitFor(m.sender_id, sh.id);
  }
  w.sendTo(m.sender_id, { type: 'send_rejected', chat_id: m.chat_id, reason: ['limit', 'blocked', 'no_user', 'rate'].includes(reason) ? (reason === 'no_user' ? 'federation_off' : reason) : 'federation_off', dm_limit: lim || undefined });
}
function recvTyping(peer, ev) {
  const sh = remoteUser(peer, ev.from), local = findLocalUser(str(ev.to, 64));
  if (!sh || !local || !spaces.mutualContact(local.id, sh.id)) return;
  const chatId = directChat(local.id, sh.id);
  if (chatId) wsm().sendTo(local.id, { type: 'typing', chat_id: chatId, user_id: sh.id, sender_name: sh.display_name });
}
function recvPresence(peer, ev) {
  const sh = remoteUser(peer, ev.from), local = findLocalUser(str(ev.to, 64));
  const st = ev.status;
  if (!sh || !local || !['online', 'away', 'offline'].includes(st) || !spaces.mutualContact(local.id, sh.id)) return;
  wsm().setRemoteStatus(sh.id, st, st === 'offline' ? Math.floor(Number(ev.last_seen)) || 0 : 0);
}

// ─────────────────────────── ключ активации и подключение ───────────────────────────
// Секрет ключа по сети не передаётся: партнёр доказывает, что он его знает, подписью HMAC над одноразовым
// значением, которое выдаёт эта сторона. Подслушав обмен даже по обычному http, подключиться вместо него нельзя.
const hmac = (secret, str) => crypto.createHmac('sha256', String(secret)).update(str).digest('base64');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const connectProof = (secret, nonce, id, pub, url, name) => hmac(secret, ['connect', nonce, id, pub, url || '', name || ''].join('|'));
const connectAck = (secret, nonce, pub) => hmac(secret, ['ok', nonce, pub].join('|'));
const connNonces = new Map();   // nonce → { inv, exp }
function createInvite() {
  const me = identity();
  if (!me.configured) return { error: 'Сначала задайте идентификатор сервера' };
  if (!me.url) return { error: 'Укажите адрес для соединений: по нему партнёр подключится к вам' };
  const invId = crypto.randomBytes(8).toString('hex');
  const secret = crypto.randomBytes(24).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  db.prepare('DELETE FROM fed_invites WHERE expires_at < unixepoch() OR used_at IS NOT NULL').run();
  db.prepare('INSERT INTO fed_invites (token_hash, secret, expires_at) VALUES (?, ?, ?)').run(invId, secret, exp);
  const payload = { v: 1, i: me.id, n: me.name, u: me.url, k: me.pub, ti: invId, t: secret };
  return { key: 'FED-' + Buffer.from(JSON.stringify(payload)).toString('base64url'), expires_at: exp, url: me.url };
}
function parseKey(key) {
  const s = String(key || '').trim().replace(/\s+/g, '');
  if (!s.startsWith('FED-')) return null;
  try {
    const p = JSON.parse(Buffer.from(s.slice(4), 'base64url').toString('utf8'));
    if (p?.v !== 1 || !ID_RE.test(p.i) || !p.t || !/^[0-9a-f]{16}$/.test(String(p.ti)) || !validPub(p.k) || normalizeUrl(p.u) === null || !p.u) return null;
    return { id: p.i, name: String(p.n || p.i).slice(0, 60), url: normalizeUrl(p.u), pub: p.k, inv: p.ti, secret: p.t, fp: fingerprint(p.k) };
  } catch { return null; }
}
// Проверка ключа без сетевых запросов: показать партнёра и отпечаток
function previewKey(key) {
  const k = parseKey(key);
  if (!k) return { error: 'Ключ не распознан. Скопируйте его целиком, вместе с «FED-».' };
  const me = identity();
  if (!me.configured) return { error: 'Сначала задайте идентификатор сервера' };
  if (k.id === me.id) return { error: 'Это ключ вашего собственного сервера' };
  if (peerByInstance(k.id)) return { error: 'Соединение с этим сервером уже есть' };
  return { id: k.id, name: k.name, url: k.url, fp: k.fp };
}
// Шаг 1: партнёр называет номер ключа и получает одноразовое значение (живёт минуту)
function connectBegin(invId) {
  const inv = db.prepare('SELECT expires_at, used_at FROM fed_invites WHERE token_hash = ?').get(String(invId || ''));
  if (!inv || inv.used_at || inv.expires_at < Math.floor(Date.now() / 1000)) return { status: 403, error: 'invite_invalid' };
  const now = Date.now();
  for (const [n, v] of connNonces) if (v.exp < now) connNonces.delete(n);
  if (connNonces.size > 200) return { status: 429, error: 'too_many' };
  const nonce = crypto.randomBytes(18).toString('base64url');
  connNonces.set(nonce, { inv: String(invId), exp: now + 60000 });
  return { status: 200, nonce };
}
// Шаг 2: партнёр предъявляет доказательство знания секрета и свои данные (вызывается из публичной ручки)
function acceptConnect(body) {
  const me = identity();
  if (!me.configured) return { status: 400, error: 'not_configured' };
  const id = String(body?.id || '').toLowerCase();
  if (!ID_RE.test(id) || id === me.id || !validPub(body?.pub)) return { status: 400, error: 'bad_request' };
  const n = connNonces.get(String(body?.nonce || ''));
  connNonces.delete(String(body?.nonce || ''));   // значение одноразовое, при любой ошибке сгорает
  const inv = n && n.exp > Date.now() && n.inv === String(body?.inv) ? db.prepare('SELECT token_hash, secret, expires_at, used_at FROM fed_invites WHERE token_hash = ?').get(n.inv) : null;
  const url = body.url ? normalizeUrl(body.url) : null;
  const name = String(body.name || id).slice(0, 60);
  if (!inv || inv.used_at || inv.expires_at < Math.floor(Date.now() / 1000)
      || !safeEq(connectProof(inv.secret, body.nonce, id, body.pub, body.url || '', String(body.name || '')), body.proof || '')) return { status: 403, error: 'invite_invalid' };
  if (peerByInstance(id)) return { status: 409, error: 'exists' };
  db.transaction(() => {
    db.prepare("INSERT INTO fed_peers (instance_id, name, url, pub, role, status) VALUES (?, ?, ?, ?, 'in', 'active')").run(id, name, url || null, body.pub);
    db.prepare('UPDATE fed_invites SET used_at = unixepoch() WHERE token_hash = ?').run(inv.token_hash);
  })();
  return { status: 200, id: me.id, name: me.name, pub: me.pub, ack: connectAck(inv.secret, body.nonce, me.pub) };
}
// Подключиться по ключу партнёра (мы — сторона, которая вводит ключ)
async function connectWithKey(key) {
  const k = parseKey(key);
  if (!k) return { error: 'Ключ не распознан' };
  const me = identity();
  if (!me.configured) return { error: 'Сначала задайте идентификатор сервера' };
  if (k.id === me.id) return { error: 'Это ключ вашего собственного сервера' };
  if (peerByInstance(k.id)) return { error: 'Соединение с этим сервером уже есть' };
  const post = async (path, body) => {
    const res = await fetch(k.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000), body: JSON.stringify(body) });
    let j = null; try { j = await res.json(); } catch {}
    return { ok: res.ok, j };
  };
  const reasons = { invite_invalid: 'Ключ недействителен: он уже использован или истёк срок', exists: 'Партнёр уже подключён с таким идентификатором', not_configured: 'Партнёр ещё не настроил федерацию', too_many: 'Слишком много попыток, подождите минуту' };
  let j;
  try {
    const b1 = await post('/fed/v1/connect/begin', { inv: k.inv });
    if (!b1.ok || !b1.j?.nonce) return { error: reasons[b1.j?.error] || 'Партнёр отклонил подключение' };
    const nonce = b1.j.nonce;
    const r2 = await post('/fed/v1/connect', { inv: k.inv, nonce, id: me.id, name: me.name, url: me.url || null, pub: me.pub, proof: connectProof(k.secret, nonce, me.id, me.pub, me.url || '', me.name || '') });
    if (!r2.ok) return { error: reasons[r2.j?.error] || 'Партнёр отклонил подключение' };
    j = r2.j;
    // Ответ тоже подтверждается секретом ключа: подставной сервер без него не ответит правильно
    if (!j || j.id !== k.id || j.pub !== k.pub || !safeEq(connectAck(k.secret, nonce, k.pub), j.ack || '')) return { error: 'Ответ партнёра не совпал с ключом. Подключение прервано.' };
  } catch { return { error: 'Не удалось связаться с сервером партнёра. Проверьте адрес и интернет.' }; }
  const r = db.prepare("INSERT INTO fed_peers (instance_id, name, url, pub, role, status) VALUES (?, ?, ?, ?, 'out', 'active')").run(k.id, k.name, k.url, k.pub);
  const peer = peerRow(r.lastInsertRowid);
  startDialer(peer);
  return { ok: true, peer };
}


// ─────────────────────────── сводка для главной админки ───────────────────────────
// period: day (24 часа по часам), week (7 дней), month (30 дней). Сообщения и файлы берём из messages, объём и отклонённое из fed_stats.
function statsView(period) {
  flushStats();
  const peers = db.prepare('SELECT * FROM fed_peers ORDER BY created_at, id').all();
  if (!peers.length) return { peers: [] };
  period = ['day', 'week', 'month'].includes(period) ? period : 'day';
  const now = Math.floor(Date.now() / 1000), hourNow = Math.floor(now / 3600) * 3600;
  const dayStart = ts => { const d = new Date(ts * 1000); d.setHours(0, 0, 0, 0); return Math.floor(d.getTime() / 1000); };
  // сетки корзин: для суток 24 часа, для недели и месяца календарные дни по местному времени
  let bucketsT = [];
  if (period === 'day') for (let i = 23; i >= 0; i--) bucketsT.push(hourNow - i * 3600);
  else { const n = period === 'week' ? 7 : 30; const today = dayStart(now); for (let i = n - 1; i >= 0; i--) { const d = new Date(today * 1000); d.setDate(d.getDate() - i); bucketsT.push(Math.floor(d.getTime() / 1000)); } }
  const since = bucketsT[0];
  const keyOf = ts => period === 'day' ? Math.floor(ts / 3600) * 3600 : dayStart(ts);
  const idx = new Map(bucketsT.map((t, i) => [t, i]));
  const series = bucketsT.map(t => ({ t, msgOut: 0, msgIn: 0, fOut: 0, fIn: 0, bOut: 0, bIn: 0 }));
  const by = new Map(peers.map(p => [p.instance_id, { id: p.id, instance_id: p.instance_id, name: p.name, status: p.status, online: isOnline(p.id), role: p.role, last_contact_at: p.last_contact_at, queue: queueSize(p.id), msgOut: 0, msgIn: 0, fOut: 0, fIn: 0, bytes: 0 }]));
  const byId = new Map([...by.values()].map(p => [p.id, p]));
  const day24 = hourNow - 23 * 3600;
  const tot = { msgOut: 0, msgIn: 0, fOut: 0, fIn: 0, bOut: 0, bIn: 0 };
  const rej = { limit: 0, rate: 0, blocked: 0, file: 0 };
  const rows = db.prepare(`SELECT s.fed_instance AS inst, (m.sender_id = s.id) AS inb, (m.sent_at / 3600) * 3600 AS h, COUNT(*) AS n,
      SUM(CASE WHEN m.attachment LIKE '%"url"%' THEN 1 ELSE 0 END) AS f, SUM(CASE WHEN m.attachment LIKE '%"unavailable"%' THEN 1 ELSE 0 END) AS fu
    FROM messages m JOIN chat_members cm ON cm.chat_id = m.chat_id JOIN users s ON s.id = cm.user_id AND s.is_bot = 2
    WHERE m.fed_uid IS NOT NULL AND m.sent_at >= ? GROUP BY inst, inb, h`).all(Math.min(since, day24));
  for (const r of rows) {
    const p = by.get(r.inst); if (!p) continue;
    const i = idx.get(keyOf(r.h));
    if (i !== undefined) { const b = series[i]; if (r.inb) { b.msgIn += r.n; b.fIn += r.f; } else { b.msgOut += r.n; b.fOut += r.f; } if (r.h >= since) { if (r.inb) { p.msgIn += r.n; p.fIn += r.f; } else { p.msgOut += r.n; p.fOut += r.f; } } }
    if (r.h >= day24) { if (r.inb) { tot.msgIn += r.n; tot.fIn += r.f; rej.file += r.fu; } else { tot.msgOut += r.n; tot.fOut += r.f; } }
  }
  const srows = db.prepare('SELECT * FROM fed_stats WHERE bucket >= ?').all(Math.min(since, day24));
  for (const r of srows) {
    const i = idx.get(keyOf(r.bucket)), p = byId.get(r.peer_id);
    if (i !== undefined) { series[i].bOut += r.bytes_out; series[i].bIn += r.bytes_in; if (p && r.bucket >= since) p.bytes += r.bytes_out + r.bytes_in; }
    if (r.bucket >= day24) { tot.bOut += r.bytes_out; tot.bIn += r.bytes_in; rej.limit += r.rej_limit; rej.rate += r.rej_rate; rej.blocked += r.rej_blocked; rej.file += r.rej_other; }
  }
  const list = [...by.values()];
  const active = list.filter(p => p.status === 'active' && p.online).length;
  return {
    period, series,
    peers: list,
    totals: { ...tot, queue: list.reduce((a, p) => a + p.queue, 0), active, all: list.length, rej: { ...rej, total: rej.limit + rej.rate + rej.blocked + rej.file } },
    newest_peer_at: Math.max(...peers.map(p => p.created_at || 0)),
  };
}

// Сведения для админки
function peersInfo() {
  return db.prepare('SELECT * FROM fed_peers ORDER BY created_at, id').all().map(p => ({
    id: p.id, instance_id: p.instance_id, name: p.name, url: p.url, role: p.role, status: p.status, fp: fingerprint(p.pub),
    online: isOnline(p.id), proto: p.proto || 0, last_contact_at: p.last_contact_at, created_at: p.created_at, queue: queueSize(p.id),
    people: db.prepare('SELECT COUNT(*) c FROM contacts c JOIN users s ON s.id = c.contact_id WHERE s.is_bot = 2 AND s.fed_instance = ?').get(p.instance_id).c,
  }));
}
function pausePeer(id) {
  const p = peerRow(id); if (!p) return false;
  db.prepare("UPDATE fed_peers SET status = 'paused' WHERE id = ?").run(id);
  stopDialer(id);
  try { sessions.get(id)?.ws.close(4000, 'paused'); } catch {}
  return true;
}
function resumePeer(id) {
  const p = peerRow(id); if (!p) return false;
  db.prepare("UPDATE fed_peers SET status = 'active' WHERE id = ?").run(id);
  startDialer(peerRow(id));
  return true;
}
function deletePeer(id) {
  const p = peerRow(id); if (!p) return false;
  stopDialer(id);
  try { sessions.get(id)?.ws.close(4000, 'deleted'); } catch {}
  db.prepare('DELETE FROM fed_peers WHERE id = ?').run(id);
  newChatTimes.delete(id);
  return true;
}

function start() {
  const purge = () => db.prepare('DELETE FROM fed_outbox WHERE created_at < unixepoch() - ?').run(OUTBOX_KEEP_DAYS * 86400);
  purge();
  setInterval(purge, 6 * 3600 * 1000).unref();
  db.prepare("SELECT * FROM fed_peers WHERE role = 'out' AND status = 'active'").all().forEach(startDialer);
}
// Маршрут /fed для входящих соединений
function mount(server) {
  server.on('upgrade', (req, socket, head) => {
    let p = ''; try { p = new URL(req.url, 'http://localhost').pathname; } catch {}
    if (p === '/fed') handleUpgrade(req, socket, head);
  });
  start();
}

module.exports = {
  mount, start, statsView, identity, setIdentity, fingerprint, parseAddr, getS, setS,
  createInvite, previewKey, connectBegin, acceptConnect, connectWithKey, peersInfo, pausePeer, resumePeer, deletePeer,
  lookupRemote, peerOfUser, peerByInstance, isOnline,
  onLocalMessage, onGroupMessage, onPin, onEdit, onDelete, onReact, onStatus, onTyping, onPresence, onProfile, onContactAdded, onContactRemoved, afterContactChange,
  // для fedgroups.js
  enqueue, sendLive, rpc, fetchFile, ensureShadow, remoteUser, shadowByAddr: shadowRow, findLocalUser, avatarVersion, receiveAttachment, removeMessageFiles,
};
