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
const dal = require('./dal');
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
const spacesMod = () => require('./fedspaces');
const uploadCfg = async () => (await require('./routes/upload').getUploadSettings());

// ─────────────────────────── настройки и ключи ───────────────────────────
const getS = async (k, d = '') => (await dal.get('SELECT value FROM settings WHERE key = ?', k))?.value ?? d;
const setS = async (k, v) => (await dal.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, String(v)));

let _priv = null;
const _pubCache = new Map();
async function ensureKeys() {
  if ((await getS('fed_priv')) && (await getS('fed_pub'))) return;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  await setS('fed_pub', publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
  await setS('fed_priv', privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'));
}
async function priv() {
  if (!_priv) { await ensureKeys(); _priv = crypto.createPrivateKey({ key: Buffer.from((await getS('fed_priv')), 'base64'), format: 'der', type: 'pkcs8' }); }
  return _priv;
}
const sign = async str => crypto.sign(null, Buffer.from(str), (await priv())).toString('base64');
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
async function identity() {
  const id = await getS('fed_id');
  if (!id) return { configured: false, id: '', name: (await getS('fed_name')), url: (await getS('fed_url')) };
  await ensureKeys();
  const pub = await getS('fed_pub');
  return { configured: true, id, name: (await getS('fed_name')) || id, url: (await getS('fed_url')), pub, fp: fingerprint(pub) };
}
async function setIdentity({ id, name, url }) {
  const cur = await getS('fed_id');
  if (id !== undefined && String(id) !== cur) {
    if (cur) return { error: 'Идентификатор после задания не меняется' };
    const v = String(id).trim().toLowerCase();
    if (!ID_RE.test(v)) return { error: 'Идентификатор: 2–32 символа, латиница, цифры, точка, дефис, подчёркивание' };
    await setS('fed_id', v);
    await ensureKeys();
  }
  if (name !== undefined) {
    const n = String(name).trim().replace(/\s+/g, ' ');
    if (!n || n.length > 60) return { error: 'Имя системы: от 1 до 60 символов' };
    await setS('fed_name', n);
  }
  if (url !== undefined) {
    const u = normalizeUrl(url);
    if (u === null) return { error: 'Адрес должен начинаться с http:// или https://' };
    await setS('fed_url', u);
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
async function flushStats() {
  if (!statAcc.size) return;
  const rows = [...statAcc.values()]; statAcc.clear();
  const cols = STAT_FIELDS.join(', '), ph = STAT_FIELDS.map(() => '?').join(', ');
  const upd = STAT_FIELDS.map(f => `${f} = fed_stats.${f} + excluded.${f}`).join(', ');
  const st = `INSERT INTO fed_stats (bucket, peer_id, ${cols}) VALUES (?, ?, ${ph}) ON CONFLICT(bucket, peer_id) DO UPDATE SET ${upd}`;
  await dal.tx(async () => { for (const o of rows) { if (await dal.get('SELECT 1 FROM fed_peers WHERE id = ?', o.peerId)) await dal.run(st, o.b, o.peerId, ...STAT_FIELDS.map(f => o[f] || 0)); } });
}
setInterval(async () => { try { await flushStats(); } catch (e) { console.warn('[Fed] счётчики:', e.message); } }, 15000).unref();

// ─────────────────────────── соединения ───────────────────────────
const peerRow = async id => (await dal.get('SELECT * FROM fed_peers WHERE id = ?', id));
// Версия этого сервера (server/version.json): сообщаем партнёрам вместе с возможностями
let _ownVer = null;
function ownVersion() {
  if (_ownVer === null) { try { _ownVer = String(JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'version.json'), 'utf8')).version || ''); } catch { _ownVer = ''; } }
  return _ownVer;
}
const peerByInstance = async inst => (await dal.get('SELECT * FROM fed_peers WHERE instance_id = ?', String(inst)));
// Настоящее (прямое) соединение; «сквозные» записи (virt = 1) не считаются
const realPeerByInstance = async inst => { const p = await peerByInstance(inst); return p && !p.virt ? p : null; };
async function clearVirtualRow(inst) {
  const p = await peerByInstance(inst);
  if (p && p.virt) { await endVirtual(p.id, true); await dal.run('DELETE FROM fed_peers WHERE id = ?', p.id); }
}
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
  wss.handleUpgrade(req, socket, head, async ws => (await onInbound(ws)));
}
async function onInbound(ws) {
  const me = await identity();
  if (!me.configured) { ws.close(4003, 'not configured'); return; }
  const nonce = crypto.randomBytes(24).toString('base64url');
  const eph = newEphemeral();
  const timer = setTimeout(() => { try { ws.close(4008, 'timeout'); } catch {} }, 10000);
  ws.once('message', async raw => {
    clearTimeout(timer);
    let m; try { m = JSON.parse(raw); } catch { ws.close(4003, 'bad'); return; }
    const peer = m?.t === 'hello' ? (await peerByInstance(m.id)) : null;
    if (!peer || peer.role !== 'in' || peer.status !== 'active' || typeof m.epk !== 'string'
        || !verify(peer.pub, hsBody('hello', m.id, nonce, eph.pub, m.epk), m.sig)) { ws.close(4003, 'denied'); return; }
    let keys;
    try { keys = deriveKeys(ephShared(eph.priv, m.epk), nonce, true); } catch { ws.close(4003, 'denied'); return; }
    ws.send(JSON.stringify({ t: 'welcome', id: me.id, sig: (await sign(hsBody('welcome', me.id, nonce, eph.pub, m.epk))) }));
    await attach(peer, { ws, nonce, ...keys });
  });
  ws.send(JSON.stringify({ t: 'challenge', nonce, epk: eph.pub }));
}

// Исходящее соединение: мы подключаемся к серверу, чей ключ ввели
async function startDialer(peer) {
  if (peer.role !== 'out' || peer.status !== 'active' || !peer.url) return;
  const old = dialers.get(peer.id);
  if (old && !old.stopped) return;
  const d = { timer: null, ws: null, backoff: 2000, stopped: false };
  dialers.set(peer.id, d);
  const dial = async () => {
    if (d.stopped) return;
    const cur = await peerRow(peer.id);
    if (!cur || cur.status !== 'active') { d.stopped = true; dialers.delete(peer.id); return; }
    const me = await identity();
    let ws;
    try { ws = new WebSocket(cur.url.replace(/^http/i, 'ws') + '/fed', { handshakeTimeout: 10000, maxPayload: MAX_FRAME }); }
    catch { schedule(); return; }
    d.ws = ws;
    let nonce = null, state = 'challenge', sEpk = null, eph = null;
    ws.on('message', async raw => {
      if (state === 'ready') return;   // дальше сообщения читает attach()
      let m; try { m = JSON.parse(raw); } catch { ws.close(); return; }
      if (state === 'challenge' && m.t === 'challenge' && typeof m.nonce === 'string' && typeof m.epk === 'string') {
        nonce = m.nonce; sEpk = m.epk; eph = newEphemeral(); state = 'welcome';
        ws.send(JSON.stringify({ t: 'hello', id: me.id, epk: eph.pub, sig: (await sign(hsBody('hello', me.id, nonce, sEpk, eph.pub))) }));
      } else if (state === 'welcome' && m.t === 'welcome' && m.id === cur.instance_id && verify(cur.pub, hsBody('welcome', m.id, nonce, sEpk, eph.pub), m.sig)) {
        let keys;
        try { keys = deriveKeys(ephShared(eph.priv, sEpk), nonce, false); } catch { ws.close(); return; }
        state = 'ready'; d.backoff = 2000;
        ws.removeAllListeners('message');
        await attach(cur, { ws, nonce, ...keys });
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
  await dial();
}
function stopDialer(peerId) {
  const d = dialers.get(peerId);
  if (!d) return;
  d.stopped = true; clearTimeout(d.timer);
  try { d.ws?.close(); } catch {}
  dialers.delete(peerId);
}

// Соединение установлено и проверено с обеих сторон
async function attach(peer, { ws, nonce, sendKey, recvKey }) {
  const old = sessions.get(peer.id);
  if (old && old.ws !== ws) { try { old.ws.close(4000, 'replaced'); } catch {} }
  const sess = { ws, nonce, sendKey, recvKey, sendCtr: 0, recvCtr: 0, peerId: peer.id, sentMax: 0, chain: Promise.resolve(), alive: true };
  sessions.set(peer.id, sess);
  stat(peer.id, 'reconnects');
  await dal.run('UPDATE fed_peers SET last_contact_at = unixepoch() WHERE id = ?', peer.id);
  ws.on('pong', () => { sess.alive = true; });
  sess.ping = setInterval(() => {
    if (!sess.alive) { try { ws.terminate(); } catch {} return; }
    sess.alive = false; try { ws.ping(); } catch {}
  }, 25000);
  ws.on('message', async (raw, isBinary) => (await onFrame(sess, raw, isBinary)));
  ws.on('close', async () => {
    clearInterval(sess.ping);
    if (sessions.get(peer.id) === sess) { sessions.delete(peer.id); await onOffline(peer.id); }
    for (const [rid, p] of pending) if (p.peerId === peer.id) { pending.delete(rid); clearTimeout(p.timer); p.fail(new Error('offline')); }
    await dropVirtualsVia(peer.id);
  });
  ws.on('error', () => {});
  await flush(peer.id);
  await syncPresence(peer.id);
  groups().sendCaps(peer.id);
  await groups().onLink(peer, true);
  try { await spacesMod().onLink(peer, true); } catch (e) { console.warn('[Fed] пространства:', e.message); }
}

// Связь пропала: статусы людей оттуда неизвестны, показываем «не в сети» (время последнего визита остаётся прежним)
async function onOffline(peerId) {
  const peer = await peerRow(peerId);
  if (!peer) return;
  for (const u of (await dal.all('SELECT id FROM users WHERE is_bot = 2 AND fed_instance = ?', peer.instance_id))
    ) { try { await wsm().setRemoteStatus(u.id, 'offline', 0); } catch {} } ;
  try { await groups().onLink(peer, false); } catch (e) { console.warn('[Fed] группы:', e.message); }
  try { await spacesMod().onLink(peer, false); } catch (e) { console.warn('[Fed] пространства:', e.message); }
}

// ─────────────────────────── сквозные каналы через соседей ───────────────────────────
// Сервер из общего пространства, с которым нет прямого соединения, у нас «сквозной» (fed_peers.virt = 1). Связь с ним идёт
// через соседей по дереву пространства: кадр заворачивается в конверт «кому / от кого» (t: 'rl') и пересылается дальше.
// Поверх конверта строится тот же шифрованный туннель, что и у прямого соединения: рукопожатие подписывается постоянными
// ключами обоих серверов (их ключи известны из дерева пространства, а после сверки отпечатка проверены людьми), поэтому
// промежуточный сервер видит лишь «кто с кем», размер и время кадров, но не содержимое. Остальная логика (очередь, подтверждения,
// файлы, вопрос-ответ) работает по такому каналу так же, как по прямому.
const RELAY_TTL = 8, HS_MAX_AGE = 60;
const vHalf = new Map();   // peer.id → { eph, ni }: наше «здравствуйте» отправлено, ждём ответ
const vSeen = new Map();   // ni → время: защита от повтора чужого «здравствуйте»
async function nextHopPeer(destInst) {
  const inst = await spacesMod().nextHop(destInst);
  const p = inst && (await peerByInstance(inst));
  return p && !p.virt && p.status === 'active' ? p : null;
}
async function relaySend(destInst, body) {
  const hop = await nextHopPeer(destInst);
  const hs = hop && sessions.get(hop.id);
  if (!hs || hs.ws.readyState !== 1) return false;
  return sendFrame(hs, { t: 'rl', to: destInst, from: (await identity()).id, ttl: RELAY_TTL, ...body });
}
function makeVirtualWs(peer) {
  // Маршрут к дальнему серверу берётся из базы (асинхронно), а потребителю нужен
  // состояние соединения сразу, как у настоящего сокета: держим снимок и
  // обновляем его при создании, при каждой отправке и по refresh()
  let state = 1, buffered = 0;
  const refresh = async () => {
    const hop = await nextHopPeer(peer.instance_id); const s = hop && sessions.get(hop.id);
    state = s && s.ws.readyState === 1 ? 1 : 3; buffered = s ? s.ws.bufferedAmount || 0 : 0;
    return s || null;
  };
  refresh().catch(() => {});
  return {
    get readyState() { return state; },
    get bufferedAmount() { return buffered; },
    refresh,
    async send(buf) { await refresh(); await relaySend(peer.instance_id, { d: Buffer.from(buf).toString('base64') }); },
    async close() { await endVirtual(peer.id); },
  };
}
async function endVirtual(peerId, silent) {
  const s = sessions.get(peerId);
  if (!s || !s.virt) return;
  clearInterval(s.ping);
  sessions.delete(peerId);
  vHalf.delete(peerId);
  for (const [rid, p] of pending) if (p.peerId === peerId) { pending.delete(rid); clearTimeout(p.timer); p.fail(new Error('offline')); }
  if (!silent) await onOffline(peerId);
}
// Оборвалась связь с соседом: сквозные каналы, шедшие через него, закрываем (они поднимутся заново, когда путь вернётся)
async function dropVirtualsVia(realPeerId) {
  for (const [pid, s] of [...sessions]) {
    if (!s.virt) continue;
    const p = await peerRow(pid), hop = p && (await nextHopPeer(p.instance_id));
    if (!hop || hop.id === realPeerId) await endVirtual(pid);
  }
}
async function attachVirtual(peer, keys) {
  if (sessions.get(peer.id)) await endVirtual(peer.id, true);
  const sess = { ws: makeVirtualWs(peer), sendKey: keys.sendKey, recvKey: keys.recvKey, sendCtr: 0, recvCtr: 0, peerId: peer.id, sentMax: 0, chain: Promise.resolve(), alive: true, virt: true, lastRx: Date.now() };
  sessions.set(peer.id, sess);
  stat(peer.id, 'reconnects');
  await dal.run('UPDATE fed_peers SET last_contact_at = unixepoch() WHERE id = ?', peer.id);
  sess.ping = setInterval(async () => {
    if (sessions.get(peer.id) !== sess) { clearInterval(sess.ping); return; }
    if (Date.now() - sess.lastRx > 70000) { await endVirtual(peer.id); return; }
    sendFrame(sess, { t: 'vping' });
  }, 20000);
  sess.ping.unref?.();
  await flush(peer.id);
  await syncPresence(peer.id);
  try { groups().sendCaps(peer.id); await groups().onLink(peer, true); } catch (e) { console.warn('[Fed] группы:', e.message); }
  try { await spacesMod().onLink(peer, true); } catch (e) { console.warn('[Fed] пространства:', e.message); }
}
// Начать рукопожатие со сквозным сервером (здоровается сервер с большим идентификатором)
async function virtualHello(peer) {
  const me = await identity();
  const ni = crypto.randomBytes(18).toString('base64url'), eph = newEphemeral(), ts = Math.floor(Date.now() / 1000);
  vHalf.set(peer.id, { eph, ni });
  await relaySend(peer.instance_id, { hs: { t: 'rhello', ni, ts, epk: eph.pub, sig: (await sign(`rhello|${me.id}|${peer.instance_id}|${ni}|${ts}|${eph.pub}`)) } });
}
async function virtualTick() {
  const me = await identity();
  if (!me.configured) return;
  const now = Date.now();
  for (const [k, t] of vSeen) if (now - t > 3 * HS_MAX_AGE * 1000) vSeen.delete(k);
  for (const p of (await dal.all("SELECT * FROM fed_peers WHERE virt = 1 AND status = 'active'"))) {
    if (sessions.has(p.id) || me.id < p.instance_id || !(await nextHopPeer(p.instance_id))) continue;
    try { await virtualHello(p); } catch (e) { console.warn('[Fed] сквозной канал:', e.message); }
  }
}
async function onVirtualHs(peer, hs) {
  const me = await identity();
  if (hs.t === 'rhello') {
    const ts = Math.floor(Number(hs.ts)), ni = str(hs.ni, 40), epk = str(hs.epk, 64);
    if (!ts || Math.abs(Math.floor(Date.now() / 1000) - ts) > HS_MAX_AGE || !ni || vSeen.has(ni)) return;
    if (!verify(peer.pub, `rhello|${peer.instance_id}|${me.id}|${ni}|${ts}|${epk}`, hs.sig)) return;
    vSeen.set(ni, Date.now());
    const nr = crypto.randomBytes(18).toString('base64url'), eph = newEphemeral();
    let keys; try { keys = deriveKeys(ephShared(eph.priv, epk), ni + nr, true); } catch { return; }
    await relaySend(peer.instance_id, { hs: { t: 'rwelcome', ni, nr, epk: eph.pub, sig: (await sign(`rwelcome|${me.id}|${peer.instance_id}|${ni}|${nr}|${epk}|${eph.pub}`)) } });
    await attachVirtual(peer, keys);
  } else if (hs.t === 'rwelcome') {
    const half = vHalf.get(peer.id);
    const nr = str(hs.nr, 40), epk = str(hs.epk, 64);
    if (!half || half.ni !== hs.ni || !nr) return;
    if (!verify(peer.pub, `rwelcome|${peer.instance_id}|${me.id}|${half.ni}|${nr}|${half.eph.pub}|${epk}`, hs.sig)) return;
    vHalf.delete(peer.id);
    let keys; try { keys = deriveKeys(ephShared(half.eph.priv, epk), half.ni + nr, false); } catch { return; }
    await attachVirtual(peer, keys);
  } else if (hs.t === 'rreset') {
    // Другая сторона потеряла наш канал (перезапуск): закрываем свою половину, при следующем обходе поздороваемся заново
    const s = sessions.get(peer.id);
    if (s && s.virt && Date.now() - s.lastRx > 2000) await endVirtual(peer.id);
  }
}
const resetSent = new Map();
async function onRelay(hopSess, f) {
  const me = await identity();
  const to = str(f.to, 40), from = str(f.from, 40);
  if (!to || !from) return;
  if (to !== me.id) {
    // Транзит: пересылаем только между серверами одного пространства, с которым мы связаны сами
    if (!(f.ttl > 0) || !(await spacesMod().mayRelay(from, to))) return;
    const hop = await nextHopPeer(to), hs = hop && sessions.get(hop.id);
    if (!hs || hs === hopSess) return;
    sendFrame(hs, { t: 'rl', to, from, ttl: f.ttl - 1, ...(f.hs ? { hs: f.hs } : { d: f.d }) });
    return;
  }
  const peer = await peerByInstance(from);
  if (!peer || !peer.virt || peer.status !== 'active') return;
  if (f.hs && typeof f.hs === 'object') return await onVirtualHs(peer, f.hs);
  const vs = sessions.get(peer.id);
  if (typeof f.d !== 'string') return;
  if (!vs || !vs.virt) {
    if (Date.now() - (resetSent.get(peer.id) || 0) > 5000) { resetSent.set(peer.id, Date.now()); await relaySend(from, { hs: { t: 'rreset' } }); }
    return;
  }
  await onFrame(vs, Buffer.from(f.d, 'base64'), true);
}

async function onFrame(sess, raw, isBinary) {
  const peer = await peerRow(sess.peerId);
  if (!peer || peer.status !== 'active') { try { sess.ws.close(4003, 'denied'); } catch {} return; }
  if (raw?.length) stat(peer.id, 'bytes_in', raw.length);
  const f = readFrame(sess, raw, isBinary);
  if (!f) { try { sess.ws.close(4004, 'bad frame'); } catch {} return; }
  sess.lastRx = Date.now();
  switch (f.t) {
    case 'rl': if (!sess.virt) await onRelay(sess, f); return;
    case 'vping': sendFrame(sess, { t: 'vpong' }); return;
    case 'vpong': return;
    case 'ev': {
      if (!f.seq) { handleEvent(peer, f.ev).catch(e => console.warn('[Fed] событие:', e.message)); return; }
      const ack = () => sendFrame(sess, { t: 'ack', seq: f.seq });
      if (f.seq <= peer.last_in_seq) { ack(); return; }
      sess.chain = sess.chain.then(async () => {
        try { await handleEvent(peer, f.ev); } catch (e) { console.warn('[Fed] событие', f.ev?.k, e.message); }
        await dal.run('UPDATE fed_peers SET last_in_seq = MAX(last_in_seq, ?), last_contact_at = unixepoch() WHERE id = ?', f.seq, peer.id);
        ack();
      });
      return;
    }
    case 'ack':
      await dal.run('DELETE FROM fed_outbox WHERE peer_id = ? AND id <= ?', peer.id, Number(f.seq) || 0);
      return;
    case 'req': handleReq(peer, sess, f).catch(e => sendFrame(sess, { t: 'res', rid: f.rid, ok: false, err: e.message || 'error' })); return;
    case 'res': case 'chunk': case 'end': onReply(f); return;
  }
}

// ─────────────────────────── очередь ───────────────────────────
async function enqueue(peerId, ev) {
  await dal.run('INSERT INTO fed_outbox (peer_id, ev) VALUES (?, ?)', peerId, JSON.stringify(ev));
  await flush(peerId);
}
async function flush(peerId) {
  const sess = sessions.get(peerId);
  if (!sess || sess.ws.readyState !== 1) return;
  const rows = await dal.all('SELECT id, ev FROM fed_outbox WHERE peer_id = ? AND id > ? ORDER BY id LIMIT 500', peerId, sess.sentMax);
  for (const r of rows) {
    if (!sendFrame(sess, { t: 'ev', seq: r.id, ev: JSON.parse(r.ev) })) return;
    sess.sentMax = r.id;
  }
  if (rows.length === 500) setImmediate(async () => (await flush(peerId)));
}
// Эфемерное событие: не хранится, уходит только если связь есть
function sendLive(peerId, ev) { return sendFrame(sessions.get(peerId), { t: 'ev', seq: 0, ev }); }
async function queueSize(peerId) { return (await dal.get('SELECT COUNT(*) c FROM fed_outbox WHERE peer_id = ?', peerId)).c; }

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
// Описание вложения для другого сервера: сам файл он потом запросит отдельно (op 'file', idx — номер среди нескольких)
function describeAtt(a) {
  const one = x => ({ name: x.name, size: x.size, mime: x.mime, w: x.width || null, h: x.height || null, thumb: !!x.thumb });
  const out = one(a);
  if (Array.isArray(a.more) && a.more.length) out.more = a.more.filter(x => x && x.url).map(one);
  return out;
}
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
      while (sess.ws.readyState === 1 && sess.ws.bufferedAmount > 4 * 1024 * 1024) { await new Promise(r => setTimeout(r, 20)); if (sess.ws.refresh) await sess.ws.refresh(); }
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
    const u = await findLocalUser(String(f.login || ''));
    if (!u) return await fail('not_found');
    return reply({ login: u.username, name: u.display_name, av: avatarVersion(u.id) });
  }
  if (f.op === 'gavatar') {
    const file = await groups().chatAvatarFile(peer, f.gid);
    return file ? (await sendFileFrames(sess, f.rid, file)) : (await fail('not_found'));
  }
  if (f.op && f.op[0] === 'g') {
    return groups().handleReq(peer, f).then(reply, async e => (await fail(e.message || 'error')));
  }
  if (f.op === 'avatar' && f.inst && f.inst !== (await identity()).id) {
    // Человек с третьего сервера, которого гость знает через нас: отдаём, если он состоит в чате с людьми гостя
    const sh = await shadowRow(String(f.inst), String(f.login || ''));
    const file = sh && path.join(AVATAR_DIR, `${sh.id}.jpg`);
    const shares = sh && (await dal.get(`SELECT 1 FROM chat_members a JOIN chat_members b ON b.chat_id = a.chat_id JOIN users s ON s.id = b.user_id
      WHERE a.user_id = ? AND s.is_bot = 2 AND s.fed_instance = ? LIMIT 1`, sh.id, peer.instance_id));
    if (!sh || !shares || !fs.existsSync(file)) return await fail('not_found');
    return await sendFileFrames(sess, f.rid, file);
  }
  if (f.op === 'avatar') {
    const u = await findLocalUser(String(f.login || ''));
    const file = u && path.join(AVATAR_DIR, `${u.id}.jpg`);
    if (!u || !(await isRelated(u.id, peer)) || !fs.existsSync(file)) return await fail('not_found');
    return await sendFileFrames(sess, f.rid, file);
  }
  if (f.op === 'file') {
    const m = await dal.get('SELECT m.*, c.type FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.fed_uid = ? AND m.deleted = 0', String(f.uid || ''));
    const sender = m && (await dal.get('SELECT id, is_bot FROM users WHERE id = ?', m.sender_id));
    // Отдаём только то, что мы сами отправили этому серверу; в группах — любое вложение чата, к которому сервер причастен
    const grp = m && (m.type === 'group' || m.type === 'room') && await (async () => {
      const c = await dal.get('SELECT fed_instance FROM chats WHERE id = ?', m.chat_id);
      return c.fed_instance ? c.fed_instance === peer.instance_id : (await chatWithPeer(m.chat_id, peer));
    })();
    if (!m || !sender || !(grp || (m.type === 'direct' && sender.is_bot !== spaces.FED && (await chatWithPeer(m.chat_id, peer))))) return await fail('not_found');
    let att; try { att = JSON.parse(m.attachment); } catch { att = null; }
    const item = f.idx ? (Array.isArray(att?.more) ? att.more[Math.floor(Number(f.idx)) - 1] : null) : att;   // idx — номер вложения среди нескольких
    const url = f.which === 'thumb' ? item?.thumb : item?.url;
    const file = url && path.join(FILES_DIR, path.basename(url));
    if (!file || !fs.existsSync(file)) return await fail('gone');
    return await sendFileFrames(sess, f.rid, file);
  }
  await fail('unknown');
}

// ─────────────────────────── люди и чаты ───────────────────────────
const addrOf = u => `${u.fed_instance}@${u.fed_login}`;
async function findLocalUser(login) {
  const l = String(login).trim().replace(/^@/, '');
  if (!l) return null;
  const q = 'SELECT id, username, display_name, banned FROM users WHERE COALESCE(is_bot, 0) = 0 AND COALESCE(banned, 0) = 0 AND ';
  return (await dal.get(q + 'username = ?', l)) || (await dal.get(q + 'LOWER(username) = LOWER(?)', l)) || null;
}
function avatarVersion(userId) {
  try { return String(Math.floor(fs.statSync(path.join(AVATAR_DIR, `${userId}.jpg`)).mtimeMs)); } catch { return ''; }
}
const shadowRow = async (inst, login) => (await dal.get('SELECT * FROM users WHERE is_bot = 2 AND fed_instance = ? AND fed_login = ?', inst, login));
// Чат между нами и людьми этого сервера?
async function chatWithPeer(chatId, peer) {
  return !!(await dal.get(`SELECT 1 FROM chat_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.chat_id = ? AND u.is_bot = 2 AND u.fed_instance = ?`, chatId, peer.instance_id));
}
// Есть ли общее пространство между этим человеком (выражение SQL) и нашим localId: пространство, которым владеют несколько серверов
const SHARED_SPACE = (otherSql, localSql) => `EXISTS (SELECT 1 FROM user_workspaces a JOIN user_workspaces b ON b.workspace_id = a.workspace_id
  JOIN workspaces w ON w.id = a.workspace_id WHERE w.fed_uid IS NOT NULL AND a.user_id = ${otherSql} AND b.user_id = ${localSql})`;
// Знает ли сервер этого человека: контакт в любую сторону, общий личный чат или общее пространство
async function isRelated(localId, peer) {
  return !!(await dal.get(`SELECT 1 FROM users s WHERE s.is_bot = 2 AND s.fed_instance = ? AND (
      EXISTS (SELECT 1 FROM contacts WHERE owner_id = s.id AND contact_id = ?)
      OR EXISTS (SELECT 1 FROM contacts WHERE owner_id = ? AND contact_id = s.id)
      OR EXISTS (SELECT 1 FROM chat_invites i WHERE i.user_id = s.id AND i.invited_by = ?)
      OR EXISTS (SELECT 1 FROM chat_members a JOIN chat_members b ON b.chat_id = a.chat_id AND b.user_id = ? WHERE a.user_id = s.id)
      OR ${SHARED_SPACE('s.id', '?')})
    LIMIT 1`, peer.instance_id, localId, localId, localId, localId, localId));
}
async function peerOfUser(userId) {
  const u = await dal.get('SELECT is_bot, fed_instance FROM users WHERE id = ?', userId);
  return u?.is_bot === 2 ? (await peerByInstance(u.fed_instance)) || null : null;
}
async function relatedPeers(localId) {
  return await dal.all(`SELECT DISTINCT p.* FROM fed_peers p JOIN users s ON s.fed_instance = p.instance_id AND s.is_bot = 2
    WHERE p.status = 'active' AND (
      EXISTS (SELECT 1 FROM contacts WHERE owner_id = s.id AND contact_id = ?)
      OR EXISTS (SELECT 1 FROM contacts WHERE owner_id = ? AND contact_id = s.id)
      OR EXISTS (SELECT 1 FROM chat_members a JOIN chat_members b ON b.chat_id = a.chat_id AND b.user_id = ? WHERE a.user_id = s.id)
      OR ${SHARED_SPACE('s.id', '?')})`, localId, localId, localId, localId);
}

// Создать или обновить «теневого» пользователя. Имя и аватарка берутся из последнего, что прислал его сервер
async function ensureShadow(peer, login, name, av) {
  const username = `${peer.instance_id}:${login}`;
  let u = await dal.get('SELECT * FROM users WHERE username = ?', username);
  if (!u) {
    // OR IGNORE: два одновременных события об одном человеке не должны ронять второе
    await dal.run(`INSERT OR IGNORE INTO users (username, password_hash, display_name, is_bot, workspace_id, fed_instance, fed_login, fed_avatar_v)
      VALUES (?, '', ?, 2, 0, ?, ?, ?)`, username, String(name || login).slice(0, 80) || login, peer.instance_id, login, null);
    u = await dal.get('SELECT * FROM users WHERE username = ?', username);
  } else if (u.is_bot !== 2) {
    return null;   // имя занято настоящим пользователем
  } else if (name && String(name).slice(0, 80) !== u.display_name) {
    await dal.run('UPDATE users SET display_name = ? WHERE id = ?', String(name).slice(0, 80), u.id);
    u.display_name = String(name).slice(0, 80);
    (await spaces.knownByOf(u.id)).forEach(id => wsm().sendTo(id, { type: 'user_updated', user_id: u.id, display_name: u.display_name }));
  }
  if (av !== undefined && String(av || '') !== String(u.fed_avatar_v || '')) await refreshAvatar(peer, u, String(av || ''));
  return u;
}
async function refreshAvatar(peer, shadow, av) {
  const file = path.join(AVATAR_DIR, `${shadow.id}.jpg`);
  await dal.run('UPDATE users SET fed_avatar_v = ? WHERE id = ?', av, shadow.id);   // раньше запроса: не запускаем дважды
  if (!av) { try { fs.unlinkSync(file); } catch {} await announceAvatar(shadow.id); return; }
  const tmp = file + '.tmp' + process.pid;
  try {
    await fetchFile(peer.id, { op: 'avatar', login: shadow.fed_login, ...(peer.via ? { inst: shadow.fed_instance } : {}) }, tmp, 2 * 1024 * 1024);
  } catch { try { fs.unlinkSync(tmp); } catch {}; await dal.run('UPDATE users SET fed_avatar_v = NULL WHERE id = ?', shadow.id); return; }
  try {
    const buf = fs.readFileSync(tmp);
    if (!require('./routes/users').isImageBuffer(buf)) throw new Error('not image');
    let out = buf;
    try { out = await require('sharp')(buf).rotate().resize(256, 256, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer(); } catch {}
    fs.writeFileSync(file, out);
    await announceAvatar(shadow.id);
  } catch { await dal.run('UPDATE users SET fed_avatar_v = NULL WHERE id = ?', shadow.id); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}
async function announceAvatar(shadowId) {
  const ids = new Set((await spaces.knownByOf(shadowId)));
  (await dal.all('SELECT owner_id FROM contacts WHERE contact_id = ?', shadowId)).forEach(r => ids.add(r.owner_id));
  (await dal.all('SELECT contact_id FROM contacts WHERE owner_id = ?', shadowId)).forEach(r => ids.add(r.contact_id));
  ids.forEach(id => wsm().sendTo(id, { type: 'avatar_updated', user_id: shadowId }));
}

async function directChat(localId, shadowId) {
  return (await dal.get(`SELECT c.id FROM chats c
    JOIN chat_members a ON a.chat_id = c.id AND a.user_id = ? JOIN chat_members b ON b.chat_id = c.id AND b.user_id = ?
    WHERE c.type = 'direct' AND COALESCE(c.is_secret, 0) = 0 LIMIT 1`, localId, shadowId))?.id || null;
}

// Не больше N новых переписок в час с одного сервера: защита от массовой рассылки
const newChatTimes = new Map();
async function newChatAllowed(peerId) {
  const limit = Math.max(1, Number((await getS('fed_new_per_hour', '20'))) || 20);
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
  const peer = await peerByInstance(a.instance);
  if (!peer || peer.status !== 'active') return { error: 'Такого сервера нет среди подключённых', code: 'no_peer' };
  let r;
  try { r = await rpc(peer.id, 'lookup', { login: a.login }); }
  catch (e) { return e.message === 'not_found' ? { error: 'Пользователь с таким логином не найден', code: 'not_found' } : { error: 'Нет связи с этим сервером. Попробуйте позже.', code: 'offline' }; }
  const shadow = await ensureShadow(peer, r.login, r.name, r.av);
  if (!shadow) return { error: 'Пользователь с таким логином не найден', code: 'not_found' };
  return { peer, shadow };
}
async function onContactAdded(ownerId, shadowId) {
  const sh = await dal.get('SELECT fed_instance, fed_login FROM users WHERE id = ?', shadowId);
  const peer = sh && (await peerByInstance(sh.fed_instance));
  if (!peer) return;
  const me = await dal.get('SELECT username, display_name FROM users WHERE id = ?', ownerId);
  await enqueue(peer.id, { k: 'contact_add', from: me.username, to: sh.fed_login, name: me.display_name, av: avatarVersion(ownerId) });
  if ((await spaces.mutualContact(ownerId, shadowId))) await syncPresence(peer.id, ownerId);
}
async function onContactRemoved(ownerId, shadowId) {
  const sh = await dal.get('SELECT fed_instance, fed_login FROM users WHERE id = ?', shadowId);
  const peer = sh && (await peerByInstance(sh.fed_instance));
  if (!peer) return;
  const me = await dal.get('SELECT username FROM users WHERE id = ?', ownerId);
  await enqueue(peer.id, { k: 'contact_remove', from: me.username, to: sh.fed_login });
}

// ─────────────────────────── отправка ───────────────────────────
async function peerAndShadowOfChat(chatId, localId) {
  const sh = await dal.get(`SELECT u.* FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ? AND u.is_bot = 2 AND cm.user_id != ? LIMIT 1`, chatId, localId);
  const peer = sh && (await peerByInstance(sh.fed_instance));
  return peer ? { peer, shadow: sh } : null;
}
async function onLocalMessage(msgId) {
  const m = await dal.get('SELECT * FROM messages WHERE id = ?', msgId);
  if (!m || m.deleted) return;
  const ps = await peerAndShadowOfChat(m.chat_id, m.sender_id);
  if (!ps) return;
  const me = await identity();
  const uid = `${me.id}:${m.id}`;
  await dal.run('UPDATE messages SET fed_uid = ? WHERE id = ?', uid, m.id);
  const u = await dal.get('SELECT username, display_name FROM users WHERE id = ?', m.sender_id);
  let att = null;
  try {
    const a = m.attachment ? JSON.parse(m.attachment) : null;
    if (a?.url) att = describeAtt(a);
    else if (a?.gif) att = { gif: a.gif };   // GIF из Klipy: только ссылки, файл с сервера на сервер не передаётся
  } catch {}
  let fwd = null;
  try { const f = m.forward_data ? JSON.parse(m.forward_data) : null; if (f) fwd = { name: f.name, text: f.text }; } catch {}
  const reply = m.reply_to_id ? (await dal.get('SELECT fed_uid FROM messages WHERE id = ?', m.reply_to_id))?.fed_uid || null : null;
  await enqueue(ps.peer.id, { k: 'msg', uid, from: u.username, to: ps.shadow.fed_login, name: u.display_name, av: avatarVersion(m.sender_id), text: m.text, ts: m.sent_at, reply, fwd, att });
}
async function msgPeer(m) { return await peerAndShadowOfChat(m.chat_id, m.sender_id || 0); }
const isGroupChat = async chatId => { const t = (await dal.get('SELECT type FROM chats WHERE id = ?', chatId))?.type; return t === 'group' || t === 'room'; };
async function onGroupMessage(msgId) { await groups().onMessage(msgId); }
async function onEdit(msgId) {
  const m = await dal.get('SELECT * FROM messages WHERE id = ?', msgId);
  if (m && (await isGroupChat(m.chat_id))) return await groups().onEdit(m);
  const ps = m?.fed_uid && (await msgPeer(m));
  if (ps) await enqueue(ps.peer.id, { k: 'edit', uid: m.fed_uid, text: m.text, at: m.edited_at });
}
async function onDelete(m) {
  if (m && (await isGroupChat(m.chat_id))) return await groups().onDelete(m);
  const ps = m?.fed_uid && (await msgPeer(m));
  if (ps) await enqueue(ps.peer.id, { k: 'del', uid: m.fed_uid });
}
async function onReact(m, userId, emoji, on) {
  if ((await isGroupChat(m.chat_id))) return await groups().onReact(m, userId, emoji, on);
  const ps = await peerAndShadowOfChat(m.chat_id, userId);
  if (ps) await enqueue(ps.peer.id, { k: 'react', uid: m.fed_uid, from: (await dal.get('SELECT username FROM users WHERE id = ?', userId)).username, emoji, on: !!on });
}
// Статусы «доставлено» и «прочитано» сообщений человека с другого сервера: наш читатель → его сервер
async function onStatus(kind, shadowId, readerId, maxLocalId) {
  const mc = await dal.get('SELECT chat_id FROM messages WHERE id = ?', maxLocalId);
  if (mc && (await isGroupChat(mc.chat_id))) return await groups().onStatus(kind, readerId, maxLocalId);
  const sh = await dal.get('SELECT fed_instance, fed_login FROM users WHERE id = ?', shadowId);
  const peer = sh && (await peerByInstance(sh.fed_instance));
  const msg = await dal.get('SELECT fed_uid FROM messages WHERE id = ?', maxLocalId);
  if (!peer || !msg?.fed_uid) return;
  const upto = Number(String(msg.fed_uid).split(':').pop());
  if (!upto) return;
  await enqueue(peer.id, { k: kind, from: (await dal.get('SELECT username FROM users WHERE id = ?', readerId)).username, to: sh.fed_login, upto });
}
async function onPin(chatId, msgId, userId, on) { if ((await isGroupChat(chatId))) await groups().onPin(chatId, msgId, userId, on); }
async function onTyping(chatId, userId) {
  if ((await isGroupChat(chatId))) return await groups().onTyping(chatId, userId);
  const ps = await peerAndShadowOfChat(chatId, userId);
  if (!ps || !(await spaces.canSeePresence(userId, ps.shadow.id))) return;
  sendLive(ps.peer.id, { k: 'typing', from: (await dal.get('SELECT username FROM users WHERE id = ?', userId)).username, to: ps.shadow.fed_login });
}
// Статус нашего человека → его взаимным контактам на других серверах
async function onPresence(userId, status, lastSeen, mobile) {
  if (!sessions.size) return;
  const me = await dal.get('SELECT username, is_bot FROM users WHERE id = ?', userId);
  if (!me || me.is_bot) return;
  for (const s of (await dal.all(`SELECT s.fed_instance, s.fed_login, s.id FROM contacts c1 JOIN contacts c2 ON c2.owner_id = c1.contact_id AND c2.contact_id = c1.owner_id
    JOIN users s ON s.id = c1.contact_id WHERE c1.owner_id = ? AND s.is_bot = 2`, userId))) {
    const peer = await peerByInstance(s.fed_instance);
    if (peer) sendLive(peer.id, { k: 'presence', from: me.username, to: s.fed_login, status, last_seen: lastSeen || null, mob: mobile ? 1 : undefined });
  } ;
  try { await spacesMod().presenceOut(userId, status, lastSeen, mobile); } catch (e) { console.warn('[Fed] пространства:', e.message); }
}
// Текущие статусы всех, кто взаимно связан с этим сервером (после подключения и при появлении взаимности)
async function syncPresence(peerId, onlyLocalId) {
  const peer = await peerRow(peerId);
  if (!peer || !isOnline(peerId)) return;
  if (!onlyLocalId) { try { await spacesMod().syncPresence(peerId); } catch (e) { console.warn('[Fed] пространства:', e.message); } }
  const rows = await dal.all(`SELECT c1.owner_id AS lid, s.fed_login FROM contacts c1 JOIN contacts c2 ON c2.owner_id = c1.contact_id AND c2.contact_id = c1.owner_id
    JOIN users s ON s.id = c1.contact_id WHERE s.is_bot = 2 AND s.fed_instance = ?`, peer.instance_id);
  for (const r of rows) {
    if (onlyLocalId && r.lid !== onlyLocalId) continue;
    const u = await dal.get('SELECT username, last_seen_at FROM users WHERE id = ?', r.lid);
    const st = wsm().getStatus(r.lid);
    sendLive(peerId, { k: 'presence', from: u.username, to: r.fed_login, status: st, last_seen: st === 'offline' ? u.last_seen_at : null, mob: wsm().getMobile(r.lid) ? 1 : undefined });
  }
}
// Имя или аватарка нашего человека изменились: сообщаем серверам, которые его знают
async function onProfile(userId) {
  const u = await dal.get('SELECT username, display_name, tag, is_bot FROM users WHERE id = ?', userId);
  if (!u || u.is_bot) return;
  for (const p of (await relatedPeers(userId))) (await enqueue(p.id, { k: 'profile', login: u.username, name: u.display_name, tag: u.tag || '', av: avatarVersion(userId) })) ;
}

// ─────────────────────────── приём ───────────────────────────
async function handleEvent(peer, ev) {
  if (!ev || typeof ev.k !== 'string') return;
  switch (ev.k) {
    case 'msg': return await recvMessage(peer, ev);
    case 'edit': return await recvEdit(peer, ev);
    case 'del': return await recvDelete(peer, ev);
    case 'react': return await recvReact(peer, ev);
    case 'dlv': case 'read': return await recvStatus(peer, ev);
    case 'contact_add': return await recvContactAdd(peer, ev);
    case 'contact_remove': return await recvContactRemove(peer, ev);
    case 'profile': return await recvProfile(peer, ev);
    case 'rej': return await recvReject(peer, ev);
    case 'typing': return await recvTyping(peer, ev);
    case 'presence': return await recvPresence(peer, ev);
    case 'spp': return await spacesMod().recvPresence(peer, ev);
    // Общие пространства: всё, что начинается на sp_
    // Группы и комнаты (версия протокола 2): caps и всё, что начинается на g
    default:
      if (/^sp_[a-z_]+$/.test(ev.k)) return await spacesMod().handle(peer, ev);
      if (ev.k === 'caps' || /^g[a-z_]+$/.test(ev.k)) return await groups().handle(peer, ev);
  }
}
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

async function reject(peer, ev, reason) {
  stat(peer.id, reason === 'limit' ? 'rej_limit' : reason === 'rate' ? 'rej_rate' : reason === 'blocked' ? 'rej_blocked' : 'rej_other');
  await enqueue(peer.id, { k: 'rej', uid: ev.uid, reason });
}

async function recvMessage(peer, ev) {
  const login = str(ev.from, 64), uid = str(ev.uid, 80);
  const local = await findLocalUser(str(ev.to, 64));
  if (!login || !uid || !local) return await reject(peer, ev, 'no_user');
  if ((await dal.get('SELECT 1 FROM messages WHERE fed_uid = ?', uid))) return;   // повтор после обрыва
  const shadow = await ensureShadow(peer, login, str(ev.name, 80), ev.av === undefined ? undefined : str(ev.av, 40));
  if (!shadow) return await reject(peer, ev, 'no_user');
  if ((await spaces.isBlocked(local.id, shadow.id))) return await reject(peer, ev, 'blocked');
  if ((await spaces.limitApplies(shadow.id, local.id)) && (await spaces.limitUsed(shadow.id, local.id)) >= spaces.DM_LIMIT) return await reject(peer, ev, 'limit');

  let chatId = await directChat(local.id, shadow.id);
  if (!chatId && !(await newChatAllowed(peer.id))) return await reject(peer, ev, 'rate');

  const text = str(ev.text, 4096);
  // Вложение: скачиваем у себя, проверяя размер и формат по НАШИМ настройкам
  let attachment = null;
  if (ev.att && typeof ev.att === 'object') attachment = ev.att.gif ? gifLib.sanitize(ev.att) : await receiveAttachments(peer, uid, ev.att);
  let fwdJson = null;
  if (ev.fwd && typeof ev.fwd === 'object') fwdJson = JSON.stringify({ user_id: shadow.id, name: str(ev.fwd.name, 80), text: str(ev.fwd.text, 4096), attachment: null, is_bot: false });
  if (!text && !attachment && !fwdJson) return;

  let reload = false;
  if (!chatId) {
    reload = true;
    chatId = await dal.tx(() => (async () => {
      const r = await dal.run("INSERT INTO chats (type, created_by) VALUES ('direct', ?)", shadow.id);
      await dal.run('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)', r.lastInsertRowid, shadow.id);
      await dal.run('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)', r.lastInsertRowid, local.id);
      return r.lastInsertRowid;
    })());
  } else if ((await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ? AND hidden_at IS NOT NULL', chatId, local.id))) {
    await dal.run('UPDATE chat_members SET hidden_at = NULL WHERE chat_id = ? AND user_id = ?', chatId, local.id);
    reload = true;
  }
  const replyTo = ev.reply ? (await dal.get('SELECT id FROM messages WHERE fed_uid = ? AND chat_id = ?', str(ev.reply, 80), chatId))?.id || null : null;
  const ts = Math.min(Math.floor(Number(ev.ts)) || Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));
  const online = wsm().hasOpenConnection(local.id);
  const msgId = await dal.tx(() => (async () => {
    const r = await dal.run('INSERT INTO messages (chat_id, sender_id, text, sent_at, reply_to_id, attachment, forward_data, fed_uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', chatId, shadow.id, text, ts, replyTo, attachment ? JSON.stringify(attachment) : null, fwdJson, uid);
    if (online) {
      await dal.run('INSERT OR IGNORE INTO message_status (message_id, user_id) VALUES (?, ?)', r.lastInsertRowid, local.id);
      await dal.run('UPDATE message_status SET delivered_at = COALESCE(delivered_at, unixepoch()) WHERE message_id = ? AND user_id = ?', r.lastInsertRowid, local.id);
    }
    return r.lastInsertRowid;
  })());
  // Счётчики «сообщений без ответа»: его сообщение увеличивает его счётчик, а наш сбрасывает (он нам ответил)
  if ((await spaces.limitApplies(shadow.id, local.id))) await spaces.limitBump(shadow.id, local.id);
  if ((await spaces.limitUsed(local.id, shadow.id)) > 0) {
    await spaces.limitReset(local.id, shadow.id);
    wsm().sendTo(local.id, { type: 'chat_limit', chat_id: chatId, dm_limit: (await spaces.limitFor(local.id, shadow.id)) });
  }
  if (reload) wsm().sendTo(local.id, { type: 'reload_chats' });
  await wsm().finishMessage(msgId, chatId, shadow.id);
  if (online) await enqueue(peer.id, { k: 'dlv', from: local.username, to: login, upto: Number(uid.split(':').pop()) });
}

// Скачивание вложения. Возвращает объект вложения для базы: готовый файл у нас или пометку «недоступно»
// Вложение с остальными (more): каждое файл забираем у хозяина по номеру
async function receiveAttachments(peer, uid, a) {
  const first = await receiveAttachment(peer, uid, a, 0);
  if (Array.isArray(a.more) && a.more.length && first) {
    const more = [];
    for (const [i, x] of a.more.slice(0, 9).entries()) { if (x && typeof x === 'object') more.push(await receiveAttachment(peer, uid, x, i + 1)); }
    if (more.length) first.more = more;
  }
  return first;
}
async function receiveAttachment(peer, uid, a, idx = 0) {
  const name = str(a.name, 200) || 'file';
  const size = Math.max(0, Math.floor(Number(a.size)) || 0);
  const mime = str(a.mime, 100);
  const meta = { name, size, mime };
  const cfg = await uploadCfg();
  const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file';
  const c = cfg[kind];
  const ext = path.extname(name).replace('.', '').toLowerCase();
  if (!size || size > c.maxSizeMb * 1024 * 1024) return { ...meta, unavailable: 'policy' };
  if (c.extensions.length && !c.extensions.includes(ext)) return { ...meta, unavailable: 'policy' };
  const fname = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext ? '.' + ext.replace(/[^a-z0-9]/g, '') : ''}`;
  const dest = path.join(FILES_DIR, fname);
  try {
    const r = await fetchFile(peer.id, { uid, which: 'file', idx }, dest, c.maxSizeMb * 1024 * 1024);
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
      await fetchFile(peer.id, { uid, which: 'thumb', idx }, tp, 512 * 1024);
      if (require('./routes/users').isImageBuffer(fs.readFileSync(tp))) { out.thumb = `/files/${tn}`; out.width = Number(a.w) || null; out.height = Number(a.h) || null; }
      else fs.unlinkSync(tp);
    } catch { try { fs.unlinkSync(tp); } catch {} }
  }
  return out;
}

async function remoteUser(peer, login) { return await shadowRow(peer.instance_id, str(login, 64)); }
async function senderOfUid(peer, uid) {
  const m = await dal.get('SELECT m.*, u.fed_instance FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.fed_uid = ? AND m.deleted = 0 AND u.is_bot = 2', str(uid, 80));
  return m && m.fed_instance === peer.instance_id ? m : null;
}
async function recvEdit(peer, ev) {
  const m = await senderOfUid(peer, ev.uid);
  const text = str(ev.text, 4096).trim();
  if (!m || !text) return;
  await dal.run('UPDATE messages SET text = ?, edited_at = unixepoch() WHERE id = ?', text, m.id);
  const w = wsm();
  await w.broadcast(m.chat_id, { type: 'message_edited', message: (await w.getMessageWithStatus(m.id, m.sender_id)) });
  if ((await dal.get('SELECT 1 FROM pinned_messages WHERE message_id = ?', m.id))) await w.broadcast(m.chat_id, { type: 'pins_updated', chat_id: m.chat_id, pins: (await w.getPins(m.chat_id)) });
}
// Файл сообщения удаляем, только если на него больше никто не ссылается
async function removeMessageFiles(m) {
  try {
    const a = m.attachment ? JSON.parse(m.attachment) : null;
    if (a?.url) await require('./attach').release(a, m.id);
  } catch {}
}
async function recvDelete(peer, ev) {
  const m = await senderOfUid(peer, ev.uid);
  if (!m) return;
  await removeMessageFiles(m);
  await dal.run("UPDATE messages SET deleted = 1, text = '', attachment = NULL WHERE id = ?", m.id);
  const w = wsm();
  await w.broadcast(m.chat_id, { type: 'message_deleted', message_id: m.id, chat_id: m.chat_id });
  if ((await dal.run('DELETE FROM pinned_messages WHERE message_id = ?', m.id)).changes) await w.broadcast(m.chat_id, { type: 'pins_updated', chat_id: m.chat_id, pins: (await w.getPins(m.chat_id)) });
}
async function recvReact(peer, ev) {
  const sh = await remoteUser(peer, ev.from);
  const m = sh && (await dal.get('SELECT * FROM messages WHERE fed_uid = ? AND deleted = 0', str(ev.uid, 80)));
  const emoji = str(ev.emoji, 16);
  if (!m || !emoji || !/\p{Extended_Pictographic}/u.test(emoji)) return;
  if (!(await dal.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', m.chat_id, sh.id))) return;
  if (ev.on) await dal.run('INSERT OR IGNORE INTO reactions (message_id, user_id, reaction) VALUES (?, ?, ?)', m.id, sh.id, emoji);
  else await dal.run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND reaction = ?', m.id, sh.id, emoji);
  const counts = await dal.all('SELECT reaction, COUNT(*) as count, group_concat(user_id) as user_ids FROM reactions WHERE message_id = ? GROUP BY reaction', m.id);
  const w = wsm();
  await w.broadcast(m.chat_id, { type: 'reaction_update', message_id: m.id, counts });
  if (ev.on && m.sender_id !== sh.id) w.sendTo(m.sender_id, { type: 'reaction_notify', chatId: m.chat_id, reactorName: sh.display_name, reaction: emoji });
}
// «Доставлено» / «прочитано» нашим сообщениям: upto — наш id сообщения
async function recvStatus(peer, ev) {
  const sh = await remoteUser(peer, ev.from);
  const local = await findLocalUser(str(ev.to, 64));
  const upto = Math.floor(Number(ev.upto));
  if (!sh || !local || !upto) return;
  const chatId = await directChat(local.id, sh.id);
  if (!chatId) return;
  const ids = (await dal.all('SELECT id FROM messages WHERE chat_id = ? AND sender_id = ? AND id <= ? AND deleted = 0 ORDER BY id', chatId, local.id, upto)).map(r => r.id);
  if (!ids.length) return;
  const read = ev.k === 'read';
  const ins = 'INSERT OR IGNORE INTO message_status (message_id, user_id) VALUES (?, ?)';
  const upd = `UPDATE message_status SET delivered_at = COALESCE(delivered_at, unixepoch())${read ? ', read_at = COALESCE(read_at, unixepoch())' : ''} WHERE message_id = ? AND user_id = ?`;
  await dal.tx(async () => { for (const id of ids) { await dal.run(ins, id, sh.id); await dal.run(upd, id, sh.id); } });
  const wsmod = wsm();
  wsmod.sendTo(local.id, { type: 'status_range', chat_id: chatId, kind: read ? 'read' : 'delivered', min_id: ids[0], max_id: ids[ids.length - 1], reader_id: sh.id });
}
async function recvContactAdd(peer, ev) {
  const local = await findLocalUser(str(ev.to, 64)), login = str(ev.from, 64);
  if (!local || !login) return;
  const sh = await ensureShadow(peer, login, str(ev.name, 80), ev.av === undefined ? undefined : str(ev.av, 40));
  if (!sh) return;
  // «Он добавил нас»: запись контакта с владельцем-тенью. Дальше работают обычные правила (взаимность, лимит)
  await dal.run('INSERT OR IGNORE INTO contacts (owner_id, contact_id) VALUES (?, ?)', sh.id, local.id);
  await afterContactChange(local.id, sh.id);
}
async function recvContactRemove(peer, ev) {
  const local = await findLocalUser(str(ev.to, 64)), sh = await remoteUser(peer, ev.from);
  if (!local || !sh) return;
  const wasMutual = await spaces.mutualContact(local.id, sh.id);
  await dal.run('DELETE FROM contacts WHERE owner_id = ? AND contact_id = ?', sh.id, local.id);
  await afterContactChange(local.id, sh.id, wasMutual);
}
// Контакт появился или исчез на их стороне: у нас меняется лимит «без ответа» и видимость статуса
async function afterContactChange(localId, shadowId, wasMutual) {
  const w = wsm();
  for (const chatId of (await spaces.directChatIds(localId, shadowId))) w.sendTo(localId, { type: 'chat_limit', chat_id: chatId, dm_limit: (await spaces.limitFor(localId, shadowId)) }) ;
  const mutual = await spaces.mutualContact(localId, shadowId);
  if (mutual || wasMutual) w.sendTo(localId, { type: 'presence_refresh' });
  if (mutual) { const sh = await dal.get('SELECT fed_instance FROM users WHERE id = ?', shadowId); const p = sh && (await peerByInstance(sh.fed_instance)); if (p) await syncPresence(p.id, localId); }
}
// Тег человека с другого сервера (подпись «ITS», «Склад» под именем) передаётся только внутри общих пространств
async function setShadowTag(shadow, tag) {
  const t = tag ? String(tag).trim().slice(0, 40) : null;
  const cur = await dal.get('SELECT display_name, tag FROM users WHERE id = ?', shadow.id);
  if (!cur || (cur.tag || null) === (t || null)) return;
  if (!(await dal.get('SELECT 1 FROM user_workspaces m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? AND w.fed_uid IS NOT NULL LIMIT 1', shadow.id))) return;
  await dal.run('UPDATE users SET tag = ? WHERE id = ?', t, shadow.id);
  (await spaces.knownByOf(shadow.id)).forEach(id => wsm().sendTo(id, { type: 'user_updated', user_id: shadow.id, display_name: cur.display_name, tag: t }));
}
async function recvProfile(peer, ev) {
  const sh = await remoteUser(peer, ev.login);
  if (!sh) return;
  await ensureShadow(peer, sh.fed_login, str(ev.name, 80), ev.av === undefined ? undefined : str(ev.av, 40));
  if (ev.tag !== undefined) await setShadowTag(sh, str(ev.tag, 40));
}
// Сервер получателя не принял наше сообщение: снимаем его у нас и сообщаем отправителю
async function recvReject(peer, ev) {
  const m = await dal.get('SELECT m.*, u.is_bot AS su FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.fed_uid = ? AND m.deleted = 0', str(ev.uid, 80));
  const mirror = m && (await dal.get('SELECT 1 FROM chats WHERE id = ? AND fed_instance = ?', m.chat_id, peer.instance_id));
  if (!m || m.su === spaces.FED || !(mirror || (await chatWithPeer(m.chat_id, peer)))) return;
  await dal.run("UPDATE messages SET deleted = 1, text = '', attachment = NULL WHERE id = ?", m.id);
  const w = wsm();
  await w.broadcast(m.chat_id, { type: 'message_deleted', message_id: m.id, chat_id: m.chat_id });
  const sh = (await peerAndShadowOfChat(m.chat_id, m.sender_id))?.shadow;
  const reason = str(ev.reason, 20);
  let lim = null;
  if (reason === 'limit' && sh) {
    await dal.run('INSERT INTO dm_limits (sender_id, recipient_id, n) VALUES (?, ?, ?) ON CONFLICT(sender_id, recipient_id) DO UPDATE SET n = ?', m.sender_id, sh.id, spaces.DM_LIMIT, spaces.DM_LIMIT);
    lim = await spaces.limitFor(m.sender_id, sh.id);
  }
  w.sendTo(m.sender_id, { type: 'send_rejected', chat_id: m.chat_id, reason: ['limit', 'blocked', 'no_user', 'rate'].includes(reason) ? (reason === 'no_user' ? 'federation_off' : reason) : 'federation_off', dm_limit: lim || undefined });
}
async function recvTyping(peer, ev) {
  const sh = await remoteUser(peer, ev.from), local = await findLocalUser(str(ev.to, 64));
  if (!sh || !local || !(await spaces.canSeePresence(local.id, sh.id))) return;
  const chatId = await directChat(local.id, sh.id);
  if (chatId) wsm().sendTo(local.id, { type: 'typing', chat_id: chatId, user_id: sh.id, sender_name: sh.display_name });
}
async function recvPresence(peer, ev) {
  const sh = await remoteUser(peer, ev.from), local = await findLocalUser(str(ev.to, 64));
  const st = ev.status;
  if (!sh || !local || !['online', 'away', 'offline'].includes(st) || !(await spaces.mutualContact(local.id, sh.id))) return;
  await wsm().setRemoteStatus(sh.id, st, st === 'offline' ? Math.floor(Number(ev.last_seen)) || 0 : 0, ev.mob === 1);
}

// ─────────────────────────── ключ активации и подключение ───────────────────────────
// Секрет ключа по сети не передаётся: партнёр доказывает, что он его знает, подписью HMAC над одноразовым
// значением, которое выдаёт эта сторона. Подслушав обмен даже по обычному http, подключиться вместо него нельзя.
const hmac = (secret, str) => crypto.createHmac('sha256', String(secret)).update(str).digest('base64');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const connectProof = (secret, nonce, id, pub, url, name) => hmac(secret, ['connect', nonce, id, pub, url || '', name || ''].join('|'));
const connectAck = (secret, nonce, pub) => hmac(secret, ['ok', nonce, pub].join('|'));
const connNonces = new Map();   // nonce → { inv, exp }
async function createInvite() {
  const me = await identity();
  if (!me.configured) return { error: 'Сначала задайте идентификатор сервера' };
  if (!me.url) return { error: 'Укажите адрес для соединений: по нему партнёр подключится к вам' };
  const invId = crypto.randomBytes(8).toString('hex');
  const secret = crypto.randomBytes(24).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  await dal.run('DELETE FROM fed_invites WHERE expires_at < unixepoch() OR used_at IS NOT NULL');
  await dal.run('INSERT INTO fed_invites (token_hash, secret, expires_at) VALUES (?, ?, ?)', invId, secret, exp);
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
async function previewKey(key) {
  const k = parseKey(key);
  if (!k) return { error: 'Ключ не распознан. Скопируйте его целиком, вместе с «FED-».' };
  const me = await identity();
  if (!me.configured) return { error: 'Сначала задайте идентификатор сервера' };
  if (k.id === me.id) return { error: 'Это ключ вашего собственного сервера' };
  if ((await realPeerByInstance(k.id))) return { error: 'Соединение с этим сервером уже есть' };
  return { id: k.id, name: k.name, url: k.url, fp: k.fp };
}
// Шаг 1: партнёр называет номер ключа и получает одноразовое значение (живёт минуту)
async function connectBegin(invId) {
  const inv = await dal.get('SELECT expires_at, used_at FROM fed_invites WHERE token_hash = ?', String(invId || ''));
  if (!inv || inv.used_at || inv.expires_at < Math.floor(Date.now() / 1000)) return { status: 403, error: 'invite_invalid' };
  const now = Date.now();
  for (const [n, v] of connNonces) if (v.exp < now) connNonces.delete(n);
  if (connNonces.size > 200) return { status: 429, error: 'too_many' };
  const nonce = crypto.randomBytes(18).toString('base64url');
  connNonces.set(nonce, { inv: String(invId), exp: now + 60000 });
  return { status: 200, nonce };
}
// Шаг 2: партнёр предъявляет доказательство знания секрета и свои данные (вызывается из публичной ручки)
async function acceptConnect(body) {
  const me = await identity();
  if (!me.configured) return { status: 400, error: 'not_configured' };
  const id = String(body?.id || '').toLowerCase();
  if (!ID_RE.test(id) || id === me.id || !validPub(body?.pub)) return { status: 400, error: 'bad_request' };
  const n = connNonces.get(String(body?.nonce || ''));
  connNonces.delete(String(body?.nonce || ''));   // значение одноразовое, при любой ошибке сгорает
  const inv = n && n.exp > Date.now() && n.inv === String(body?.inv) ? (await dal.get('SELECT token_hash, secret, expires_at, used_at FROM fed_invites WHERE token_hash = ?', n.inv)) : null;
  const url = body.url ? normalizeUrl(body.url) : null;
  const name = String(body.name || id).slice(0, 60);
  if (!inv || inv.used_at || inv.expires_at < Math.floor(Date.now() / 1000)
      || !safeEq(connectProof(inv.secret, body.nonce, id, body.pub, body.url || '', String(body.name || '')), body.proof || '')) return { status: 403, error: 'invite_invalid' };
  if ((await realPeerByInstance(id))) return { status: 409, error: 'exists' };
  await dal.tx(() => (async () => {
    await clearVirtualRow(id);
    await dal.run("INSERT INTO fed_peers (instance_id, name, url, pub, role, status) VALUES (?, ?, ?, ?, 'in', 'active')", id, name, url || null, body.pub);
    await dal.run('UPDATE fed_invites SET used_at = unixepoch() WHERE token_hash = ?', inv.token_hash);
  })());
  return { status: 200, id: me.id, name: me.name, pub: me.pub, ack: connectAck(inv.secret, body.nonce, me.pub) };
}
// Подключиться по ключу партнёра (мы — сторона, которая вводит ключ)
async function connectWithKey(key) {
  const k = parseKey(key);
  if (!k) return { error: 'Ключ не распознан' };
  const me = await identity();
  if (!me.configured) return { error: 'Сначала задайте идентификатор сервера' };
  if (k.id === me.id) return { error: 'Это ключ вашего собственного сервера' };
  if ((await realPeerByInstance(k.id))) return { error: 'Соединение с этим сервером уже есть' };
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
  await clearVirtualRow(k.id);
  const r = await dal.run("INSERT INTO fed_peers (instance_id, name, url, pub, role, status) VALUES (?, ?, ?, ?, 'out', 'active')", k.id, k.name, k.url, k.pub);
  const peer = await peerRow(r.lastInsertRowid);
  await startDialer(peer);
  return { ok: true, peer };
}


// ─────────────────────────── сводка для главной админки ───────────────────────────
// period: day (24 часа по часам), week (7 дней), month (30 дней). Сообщения и файлы берём из messages, объём и отклонённое из fed_stats.
async function statsView(period) {
  await flushStats();
  const peers = await dal.all('SELECT * FROM fed_peers WHERE virt = 0 ORDER BY created_at, id');
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
  const by = new Map((await Promise.all(peers.map(async p => [p.instance_id, { id: p.id, instance_id: p.instance_id, name: p.name, status: p.status, online: isOnline(p.id), role: p.role, last_contact_at: p.last_contact_at, queue: (await queueSize(p.id)), msgOut: 0, msgIn: 0, fOut: 0, fIn: 0, bytes: 0 }]))));
  const byId = new Map([...by.values()].map(p => [p.id, p]));
  const day24 = hourNow - 23 * 3600;
  const tot = { msgOut: 0, msgIn: 0, fOut: 0, fIn: 0, bOut: 0, bIn: 0 };
  const rej = { limit: 0, rate: 0, blocked: 0, file: 0 };
  const rows = await dal.all(`SELECT s.fed_instance AS inst, (m.sender_id = s.id) AS inb, (m.sent_at / 3600) * 3600 AS h, COUNT(*) AS n,
      SUM(CASE WHEN m.attachment LIKE '%"url"%' THEN 1 ELSE 0 END) AS f, SUM(CASE WHEN m.attachment LIKE '%"unavailable"%' THEN 1 ELSE 0 END) AS fu
    FROM messages m JOIN chat_members cm ON cm.chat_id = m.chat_id JOIN users s ON s.id = cm.user_id AND s.is_bot = 2
    WHERE m.fed_uid IS NOT NULL AND m.sent_at >= ? GROUP BY inst, inb, h`, Math.min(since, day24));
  for (const r of rows) {
    const p = by.get(r.inst); if (!p) continue;
    const i = idx.get(keyOf(r.h));
    if (i !== undefined) { const b = series[i]; if (r.inb) { b.msgIn += r.n; b.fIn += r.f; } else { b.msgOut += r.n; b.fOut += r.f; } if (r.h >= since) { if (r.inb) { p.msgIn += r.n; p.fIn += r.f; } else { p.msgOut += r.n; p.fOut += r.f; } } }
    if (r.h >= day24) { if (r.inb) { tot.msgIn += r.n; tot.fIn += r.f; rej.file += r.fu; } else { tot.msgOut += r.n; tot.fOut += r.f; } }
  }
  const srows = await dal.all('SELECT * FROM fed_stats WHERE bucket >= ?', Math.min(since, day24));
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
async function peersInfo() {
  return (await Promise.all((await dal.all('SELECT * FROM fed_peers WHERE virt = 0 ORDER BY created_at, id')).map(async p => ({
    id: p.id, instance_id: p.instance_id, name: p.name, url: p.url, role: p.role, status: p.status, fp: fingerprint(p.pub),
    online: isOnline(p.id), proto: p.proto || 0, last_contact_at: p.last_contact_at, created_at: p.created_at, queue: (await queueSize(p.id)),
    people: (await dal.get('SELECT COUNT(*) c FROM contacts c JOIN users s ON s.id = c.contact_id WHERE s.is_bot = 2 AND s.fed_instance = ?', p.instance_id)).c,
    ver: p.ver || '',
  }))));
}
async function pausePeer(id) {
  const p = await peerRow(id); if (!p) return false;
  await dal.run("UPDATE fed_peers SET status = 'paused' WHERE id = ?", id);
  stopDialer(id);
  try { sessions.get(id)?.ws.close(4000, 'paused'); } catch {}
  return true;
}
async function resumePeer(id) {
  const p = await peerRow(id); if (!p) return false;
  await dal.run("UPDATE fed_peers SET status = 'active' WHERE id = ?", id);
  await startDialer((await peerRow(id)));
  return true;
}
async function deletePeer(id) {
  const p = await peerRow(id); if (!p) return false;
  stopDialer(id);
  try { sessions.get(id)?.ws.close(4000, 'deleted'); } catch {}
  await dal.run('DELETE FROM fed_peers WHERE id = ?', id);
  newChatTimes.delete(id);
  try { await spacesMod().onPeerRemoved(p.instance_id); } catch (e) { console.warn('[Fed] пространства:', e.message); }
  return true;
}

async function start() {
  const purge = async () => (await dal.run('DELETE FROM fed_outbox WHERE created_at < unixepoch() - ?', OUTBOX_KEEP_DAYS * 86400));
  await purge();
  setInterval(purge, 6 * 3600 * 1000).unref();
  (await dal.all("SELECT * FROM fed_peers WHERE role = 'out' AND status = 'active'")).forEach(startDialer);
  try { await spacesMod().start(); } catch (e) { console.warn('[Fed] пространства:', e.message); }
}
// Маршрут /fed для входящих соединений
async function mount(server) {
  server.on('upgrade', (req, socket, head) => {
    let p = ''; try { p = new URL(req.url, 'http://localhost').pathname; } catch {}
    if (p === '/fed') handleUpgrade(req, socket, head);
  });
  await start();
}

module.exports = {
  mount, start, statsView, identity, setIdentity, fingerprint, validPub, parseAddr, getS, setS,
  createInvite, previewKey, connectBegin, acceptConnect, connectWithKey, peersInfo, pausePeer, resumePeer, deletePeer,
  setShadowTag, lookupRemote, peerOfUser, peerByInstance, realPeerByInstance, ownVersion, peerRow, clearVirtualRow, endVirtual, virtualTick, isOnline,
  onLocalMessage, onGroupMessage, onPin, onEdit, onDelete, onReact, onStatus, onTyping, onPresence, onProfile, onContactAdded, onContactRemoved, afterContactChange,
  // для fedgroups.js
  enqueue, sendLive, rpc, fetchFile, isRelatedTo: isRelated, ensureShadow, remoteUser, shadowByAddr: shadowRow, findLocalUser, avatarVersion, receiveAttachment, receiveAttachments, describeAtt, removeMessageFiles,
};
