// Аудио- и видеозвонки на LiveKit.
//
// Сам звук и видео ходят через сервер LiveKit (SFU), чат-сервер в них не участвует: он хранит
// настройки подключения, выдаёт клиентам короткие токены на одну комнату и ведёт «звонок» как
// сигнал — кто кому звонит, принял ли, отклонил ли. Это состояние живёт только в памяти: звонок
// короткий, после перезапуска сервера его всё равно нет смысла продолжать.
//
// Ключи в таблице settings: calls_enabled ('1'), calls_url (ws:// или wss:// адрес LiveKit),
// calls_key и calls_secret (пара API key / secret: именно по подписи LiveKit проверяет, что токен
// выдал наш сервер, поэтому отдельного «ключа доступа» не нужно). Секрет наружу не отдаётся.
const jwt = require('jsonwebtoken');
const https = require('https');
const tls = require('tls');
const crypto = require('crypto');
const dal = require('./dal');

const RING_MS = 45 * 1000;     // сколько звонит, пока не ответили
const TOKEN_TTL = 6 * 3600;    // токен комнаты, секунд: хватает на любой звонок, дольше не живёт
const KEYS = { enabled: 'calls_enabled', url: 'calls_url', key: 'calls_key', secret: 'calls_secret', public: 'calls_public', certFp: 'calls_cert_fp' };

const getS = async k => (await dal.get('SELECT value FROM settings WHERE key = ?', k))?.value ?? null;
const setS = (k, v) => dal.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, String(v));

// ws://host:7880, wss://host; http(s) приводим к ws(s), хвостовые слэши убираем
function normUrl(v) {
  let s = String(v || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  s = s.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
  if (!/^wss?:\/\/[^\s/]+(:\d+)?(\/.*)?$/i.test(s)) return null;
  return s;
}
const httpBase = u => u.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');

async function getConfig() {
  const [enabled, url, key, secret, pubFlag, certFp] = await Promise.all(Object.values(KEYS).map(getS));
  return { enabled: enabled === '1', url: url || '', key: key || '', secret: secret || '', public: pubFlag === '1', certFp: certFp || '' };
}
// Включено и подключение задано целиком
// Включено: со своим LiveKit или без него. Без своего («гостевой режим») звонить можно только людям с серверов, которые разрешили нам свой LiveKit
const ownOk = c => !!(c.url && c.key && c.secret);
async function active() {
  const c = await getConfig();
  return c.enabled;
}
const NO_OWN = 'У вашего сервера нет своего сервера звонков: звонить можно только людям с серверов, которые разрешили вам свой сервер звонков';
// Для админки: секрет не отдаём, только факт, что он задан
async function publicConfig() {
  const c = await getConfig();
  return { enabled: c.enabled, url: c.url, key: c.key, secret_set: !!c.secret, ready: !!(c.url && c.key && c.secret), guest: c.enabled && !ownOk(c), public: c.public, cert_fp: c.certFp };
}
async function saveConfig({ enabled, url, key, secret, public: pub, certFp }) {
  if (certFp !== undefined) await setS(KEYS.certFp, certFp);
  if (pub !== undefined) await setS(KEYS.public, pub ? '1' : '0');
  if (url !== undefined) await setS(KEYS.url, url);
  if (key !== undefined) await setS(KEYS.key, key);
  if (secret) await setS(KEYS.secret, secret);   // пустой секрет — «оставить прежний»
  if (enabled !== undefined) await setS(KEYS.enabled, enabled ? '1' : '0');
}

// Токен доступа LiveKit (JWT HS256). iss — API key, sub — идентификатор участника, video — права
function signToken(cfg, { identity, name, room, admin, kill, micOnly, ttl = TOKEN_TTL }) {
  const video = room
    ? { roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true, ...(micOnly ? { canPublishSources: ['microphone'] } : {}) }
    : kill ? { roomCreate: true } : admin ? { roomList: true } : {};
  return jwt.sign({ name, video }, cfg.secret, { algorithm: 'HS256', issuer: cfg.key, subject: identity, expiresIn: ttl });
}

// Проверка подключения: просим у LiveKit список комнат токеном с правом roomList.
// Верная подпись → 200, чужой ключ → 401, сервер не отвечает → сетевая ошибка
// Самоподписанный сертификат сервера звонков: администратор принимает его по отпечатку (SHA-256). Клиент Electron доверяет только
// ему и только для адреса этого сервера; браузеры такого не умеют, им нужен настоящий сертификат
const fpOf = cert => (cert && cert.fingerprint256) || '';
function lkPost(url, headers, body, pin) {
  if (!pin || !/^https:/i.test(url)) return fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(6000) }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }));
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers, rejectUnauthorized: false, timeout: 6000 }, res => {
      let d = ''; res.on('data', c => { d += c; });
      res.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch {} resolve({ status: res.statusCode, json: j }); });
    });
    req.on('socket', s => s.on('secureConnect', () => { if (fpOf(s.getPeerCertificate()) !== pin) req.destroy(Object.assign(new Error('Сертификат сервера не совпал с принятым отпечатком'), { code: 'CERT_PIN' })); }));
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    req.on('error', reject); req.end(body);
  });
}
// Что за сертификат у wss-адреса: для окна «Сертификат» в админке
function inspectCert(url) {
  return new Promise(resolve => {
    let u; try { u = new URL(httpBase(url)); } catch { return resolve({ error: 'Некорректный адрес' }); }
    if (u.protocol !== 'https:') return resolve({ error: 'Сертификат есть только у адреса wss://' });
    const sock = tls.connect({ host: u.hostname, port: Number(u.port) || 443, servername: /^[\d.]+$/.test(u.hostname) ? undefined : u.hostname, rejectUnauthorized: false, timeout: 6000 }, () => {
      const c = sock.getPeerCertificate();
      resolve({ fingerprint: fpOf(c), subject: c.subject?.CN || '', issuer: c.issuer?.CN || c.issuer?.O || '', valid_to: c.valid_to || '', trusted: sock.authorized });
      sock.end();
    });
    sock.on('error', e => resolve({ error: 'Не удалось подключиться: ' + (e.code || e.message) }));
    sock.on('timeout', () => { sock.destroy(); resolve({ error: 'Сервер не отвечает' }); });
  });
}
async function check(cfg) {
  const url = normUrl(cfg.url);
  if (!url) return { error: 'Адрес должен начинаться с ws:// или wss://' };
  if (!cfg.key || !cfg.secret) return { error: 'Укажите ключ и секрет' };
  try {
    const r = await lkPost(httpBase(url) + '/twirp/livekit.RoomService/ListRooms', { 'Content-Type': 'application/json', Authorization: 'Bearer ' + signToken(cfg, { identity: 'server', admin: true, ttl: 60 }) }, '{}', cfg.certFp);
    if (r.status === 401 || r.status === 403) return { error: 'LiveKit отклонил ключ или секрет' };
    if (r.status < 200 || r.status >= 300) return { error: 'LiveKit ответил ошибкой ' + r.status };
    return { ok: true, rooms: (r.json.rooms || []).length };
  } catch (e) {
    return { error: e.code === 'CERT_PIN' ? e.message : e.name === 'TimeoutError' ? 'LiveKit не отвечает (таймаут)' : /CERT|self.signed|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(String(e.cause?.code || e.code || e.message)) ? 'Сертификат сервера звонков не принят: он самоподписанный. Откройте «Сертификат» и примите его по отпечатку' : 'Нет связи с LiveKit: ' + (e.cause?.code || e.message) };
  }
}

// ── Настройки звонков у человека ──
// Звонки на сервере включены — значит у всех они включены по умолчанию. Человек может выключить все звонки сразу, отдельно
// аудио и видео, а также приём звонков с других серверов (тогда ему звонят только свои). Хранится в settings под ключом calls_prefs_<id>
const PREF_KEYS = ['enabled', 'audio', 'video', 'fed'];
async function getPrefs(userId) {
  let p = {}; try { p = JSON.parse((await getS('calls_prefs_' + userId)) || '{}') || {}; } catch {}
  return Object.fromEntries(PREF_KEYS.map(k => [k, p[k] !== false]));
}
async function setPrefs(userId, patch) {
  const cur = await getPrefs(userId);
  for (const k of PREF_KEYS) if (typeof patch?.[k] === 'boolean') cur[k] = patch[k];
  await setS('calls_prefs_' + userId, JSON.stringify(cur));
  ws().sendTo(userId, { type: 'call_prefs', prefs: cur });   // остальные устройства подхватят сразу
  return cur;
}
// Почему звонок этому человеку невозможен по его настройкам (null — можно)
const prefBlock = (p, video) => (!p.enabled ? 'all' : video && !p.video ? 'video' : !video && !p.audio ? 'audio' : null);

// ── Звонки (в памяти) ──
const calls = new Map();    // id → { id, chatId, room, callerId, calleeId, video, state, timer, startedAt }
const busy = new Map();     // userId → id звонка
const ws = () => require('./ws');
const fedMod = () => require('./federation');
const spaces = () => require('./spaces');
// Уведомление на телефон или в браузер: звонок должен дойти, даже когда приложение закрыто. Нажатие открывает клиент (параметр
// call в адресе), и тот сразу показывает входящий звонок из настроек (/api/calls/config → current или groups)
const pushMod = () => require('./routes/push');
const hasPush = async uid => { try { return await pushMod().hasPushSubscription(uid); } catch { return false; } };
const pushCall = (uid, payload) => pushMod().sendPushToUser(uid, payload).catch(e => console.warn('[Звонки] push:', e.message));

const pub = c => ({ call_id: c.id, chat_id: c.chatId, video: c.video, fed: !!c.fed });
// Хронология звонка для журнала: события (позвонил, ответил, вошёл, вышел, показал экран, завершил) и устройства людей.
// u — человек (с display_name и dev из запроса) или просто его номер; a — на кого направлено действие (кого добавили)
const detOf = c => c.det || (c.det = { ev: [], dev: {}, nm: {} });
function note(c, k, u, a) {
  const d = detOf(c), id = u && typeof u === 'object' ? u.id : u;
  if (d.ev.length < 300) d.ev.push({ t: Math.floor(Date.now() / 1000), k, u: id || 0, ...(a ? { a } : {}) });
  if (u && typeof u === 'object') { if (u.display_name) d.nm[id] = u.display_name; if (u.dev) d.dev[id] = u.dev; }
}
const other = (c, uid) => (uid === c.callerId ? c.calleeId : c.callerId);

// Запись о звонке в переписке: обычное сообщение от звонящего (его видят оба, а при звонке на другой сервер оно уходит
// через федерацию). Текст нейтральный, потому что один и тот же для обоих: «Звонок без ответа», «Видеозвонок · 2:14»
const fmtDur = s => { const m = Math.floor(s / 60), h = Math.floor(m / 60); return (h ? h + ':' + String(m % 60).padStart(2, '0') : String(m)) + ':' + String(s % 60).padStart(2, '0'); };
async function chatRecord(chatId, senderId, text) {
  try {
    const r = await dal.run('INSERT INTO messages (chat_id, sender_id, text) VALUES (?, ?, ?)', chatId, senderId, text);
    await ws().finishMessage(r.lastInsertRowid, chatId, senderId);
    const isGroup = (await dal.get('SELECT type FROM chats WHERE id = ?', chatId))?.type === 'group';
    if (isGroup) await fedMod().onGroupMessage(r.lastInsertRowid); else await fedMod().onLocalMessage(r.lastInsertRowid);
  } catch (e) { console.warn('[Звонки] запись в чате:', e.message); }
}
function recordOf(c, reason, duration) {
  if (reason === 'disabled' || (c.fed && c.fed.role === 'callee')) return;   // запись делает сервер звонящего
  const kind = c.video ? 'Видеозвонок' : 'Аудиозвонок';
  const text = c.startedAt ? (duration >= 1 ? kind + ' · ' + fmtDur(duration) : null) : ({ declined: 'Звонок отклонён', missed: 'Звонок без ответа', cancelled: 'Звонок отменён' }[reason] || null);
  if (text) chatRecord(c.chatId, c.callerId, text);
}

// Журнал звонков для админки: кто, кому, когда, личный или групповой, сколько, была ли запись. Записывать звонки сервер не умеет,
// поэтому recorded всегда 0: поле заведено под отметку «запись велась», когда она появится
// Имена людей, чьи события есть в хронологии, но имя не попало в неё при записи
async function detailOf(det) {
  if (!det || !det.ev || !det.ev.length) return null;
  try {
    for (const e of det.ev) for (const id of [e.u, e.a]) if (id && !det.nm[id]) det.nm[id] = await nameOf(id);
    return JSON.stringify(det).slice(0, 20000);
  } catch { return null; }
}
async function logCall(r) {
  try {
    const callerName = r.callerName || (r.callerId ? await nameOf(r.callerId) : '');
    const calleeName = r.kind === 'direct' ? (r.calleeName || (r.calleeId ? await nameOf(r.calleeId) : '')) : '';
    await dal.run('INSERT INTO call_log (caller_id, callee_id, video, started_at, answered, duration, reason, chat_id, kind, caller_name, callee_name, members, peer_server, recorded, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
      r.callerId || null, r.calleeId || null, r.video ? 1 : 0, r.startedAt, r.answered ? 1 : 0, r.duration || 0, r.reason || '', r.chatId || null, r.kind, callerName, calleeName, r.members ? JSON.stringify(r.members) : null, r.peerServer || null, await detailOf(r.det));
  } catch (e) { console.warn('[Звонки] журнал:', e.message); }
}

// remote — конец пришёл от другого сервера: ему сообщать об этом не нужно
function finish(c, reason, remote, by) {
  if (!calls.delete(c.id)) return;
  note(c, 'end', by || 0);
  if (c.fed && !remote) { try { fedMod().sendLive(c.fed.peer.id, { k: 'call_ev', cid: c.id, ev: reason }); } catch {} }
  clearTimeout(c.timer);
  if (busy.get(c.callerId) === c.id) busy.delete(c.callerId);
  if (busy.get(c.calleeId) === c.id) busy.delete(c.calleeId);
  const duration = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0;
  logCall({ callerId: c.callerId, calleeId: c.calleeId, video: c.video, startedAt: c.createdAt, answered: !!c.startedAt, duration, reason, chatId: c.chatId, kind: 'direct', det: c.det, callerName: c.callerName, peerServer: c.fed ? (c.fed.peer.name || c.fed.peer.instance_id) : null });
  recordOf(c, reason, duration);
  const ev = { type: 'call_ended', ...pub(c), reason, duration };
  ws().sendTo(c.callerId, ev);
  ws().sendTo(c.calleeId, ev);
}

class CallError extends Error { constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; } }

// Не больше 8 вызовов в минуту с одного человека: иначе звонок-отбой можно гонять кругами и забивать собеседнику уведомления
const startLog = new Map();
function tooOften(userId) {
  const now = Date.now(), list = (startLog.get(userId) || []).filter(t => now - t < 60000);
  if (list.length >= 8) { startLog.set(userId, list); return true; }
  list.push(now); startLog.set(userId, list); return false;
}
setInterval(() => { const now = Date.now(); for (const [u, l] of startLog) if (!l.some(t => now - t < 60000)) startLog.delete(u); }, 300000).unref();
async function start(user, chatId, video) {
  const cfg = await getConfig();
  if (!cfg.enabled) throw new CallError('disabled', 'Звонки не включены на сервере', 403);
  const chat = await dal.get('SELECT type, is_secret FROM chats WHERE id = ?', chatId);
  const peer = chat?.type === 'direct'
    ? await dal.get('SELECT u.id, u.display_name FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ? AND cm.user_id != ?', chatId, user.id)
    : null;
  const mine = await dal.get('SELECT 1 AS x FROM chat_members WHERE chat_id = ? AND user_id = ?', chatId, user.id);
  if (!chat || !mine || !peer) throw new CallError('bad_chat', 'Звонить можно в личном чате', 400);
  if (chat.is_secret) throw new CallError('secret', 'В секретных чатах звонки недоступны', 400);
  if (await spaces().isBlocked(peer.id, user.id)) throw new CallError('blocked', 'Собеседник вас заблокировал', 403);
  if (await spaces().isBlocked(user.id, peer.id)) throw new CallError('you_blocked', 'Вы заблокировали собеседника', 403);
  if (busy.has(user.id)) throw new CallError('in_call', 'Вы уже в звонке');
  if (tooOften(user.id)) throw new CallError('rate', 'Слишком много звонков подряд: подождите минуту', 429);
  const myp = await getPrefs(user.id), mb = prefBlock(myp, !!video);
  if (mb) throw new CallError('prefs_self', mb === 'all' ? 'У вас выключены звонки в настройках' : mb === 'video' ? 'У вас выключены видеозвонки в настройках' : 'У вас выключены аудиозвонки в настройках', 403);
  if (await spaces().isFed(peer.id)) return await startFed(cfg, user, chatId, peer, video);
  if (!ownOk(cfg)) throw new CallError('no_own', NO_OWN, 400);
  if (busy.has(peer.id)) throw new CallError('busy', 'Собеседник занят');
  const pb = prefBlock(await getPrefs(peer.id), !!video);
  if (pb) throw new CallError('prefs_peer', pb === 'all' ? 'Собеседник не принимает звонки' : pb === 'video' ? 'Собеседник не принимает видеозвонки' : 'Собеседник не принимает аудиозвонки', 403);
  // Без соединения звонить можно, только если собеседнику придёт уведомление
  if (!ws().isConnected(peer.id) && !(await hasPush(peer.id))) throw new CallError('offline', 'Собеседник не в сети');

  const id = crypto.randomUUID();
  const c = { id, chatId, room: 'call-' + id, callerId: user.id, calleeId: peer.id, callerName: user.display_name, video: !!video, state: 'ringing', createdAt: Math.floor(Date.now() / 1000), startedAt: 0, timer: null };
  c.timer = setTimeout(() => { const x = calls.get(id); if (x && x.state === 'ringing') finish(x, 'missed'); }, RING_MS);
  c.timer.unref?.();
  calls.set(id, c); busy.set(user.id, id); busy.set(peer.id, id);
  note(c, 'start', user);
  ws().sendTo(peer.id, { type: 'call_incoming', ...pub(c), from: { id: user.id, name: user.display_name }, timeout: RING_MS / 1000 });
  pushCall(peer.id, { title: 'Входящий ' + (video ? 'видеозвонок' : 'аудиозвонок'), body: user.display_name, chatId, call: id });
  return { ...pub(c), url: cfg.url, cert_fp: cfg.certFp || undefined, token: signToken(cfg, { identity: 'u' + user.id, name: user.display_name, room: c.room }), peer: { id: peer.id, name: peer.display_name } };
}

const mineCall = (id, uid) => {
  const c = calls.get(id);
  if (!c || (c.callerId !== uid && c.calleeId !== uid)) throw new CallError('gone', 'Звонок уже завершён', 404);
  return c;
};

async function accept(user, id) {
  if (!calls.has(id) && confs.has(id)) return await confAccept(user, id);
  if (!calls.has(id) && remoteConfs.has(id)) return await remoteConfAccept(user, id);
  const c = mineCall(id, user.id);
  if (c.calleeId !== user.id || c.state !== 'ringing') throw new CallError('gone', 'Звонок уже завершён', 404);
  const cfg = await getConfig();
  c.state = 'active'; c.startedAt = Date.now();
  clearTimeout(c.timer);
  note(c, 'answer', user);
  ws().sendTo(c.callerId, { type: 'call_accepted', ...pub(c) });
  // Другие устройства того, кто ответил, перестают звонить
  ws().sendTo(c.calleeId, { type: 'call_answered', ...pub(c) });
  if (c.fed) {
    // Комната на одном из двух серверов: токен и адрес для нас выдал хозяин комнаты (в запросе звонка или мы сами)
    try { fedMod().sendLive(c.fed.peer.id, { k: 'call_ev', cid: c.id, ev: 'accepted' }); } catch {}
    return { ...pub(c), url: c.fed.url, cert_fp: c.fed.fp || undefined, token: c.fed.token };
  }
  return { ...pub(c), url: cfg.url, cert_fp: cfg.certFp || undefined, token: signToken(cfg, { identity: 'u' + user.id, name: user.display_name, room: c.room }) };
}

function decline(user, id) {
  if (!calls.has(id) && confs.has(id)) return confDecline(user, id);
  if (!calls.has(id) && remoteConfs.has(id)) return remoteConfDecline(user, id);
  const c = mineCall(id, user.id);
  if (c.calleeId !== user.id || c.state !== 'ringing') throw new CallError('gone', 'Звонок уже завершён', 404);
  finish(c, 'declined', false, user.id);
}

// Завершить: звонящий до ответа — «отменён», дальше — обычное завершение
function end(user, id) {
  if (confs.has(id)) return confs.get(id).pending.has(user.id) ? confDecline(user, id) : confLeave(user.id, id, 'ended');
  if (remoteConfs.has(id)) return remoteConfs.get(id).pending.has(user.id) ? remoteConfDecline(user, id) : remoteConfLeave(user.id, id);
  const c = calls.get(id);
  if (!c || (c.callerId !== user.id && c.calleeId !== user.id)) return;   // уже завершён — не ошибка
  finish(c, c.state === 'ringing' ? (c.callerId === user.id ? 'cancelled' : 'declined') : 'ended', false, user.id);
}

// Все соединения пользователя закрылись: его звонок не продолжить
// Клиент сообщает о показе экрана: попадает в хронологию журнала
function event(user, id, k, on) {
  if (k !== 'screen') return;
  const o = calls.get(id) || confs.get(id) || groupById(id);
  if (!o || !(o.participants ? o.participants.has(user.id) : (o.callerId === user.id || o.calleeId === user.id))) return;
  note(o, on ? 'scr_on' : 'scr_off', user);
}
function onDisconnect(userId) {
  const id = busy.get(userId);
  const c = id && calls.get(id);
  if (c) finish(c, 'dropped');
  const g = id && (groupById(id) || remoteGroupById(id));
  if (g) groupLeave(userId, g.id, 'dropped');
  const cf = id && confs.get(id);
  if (cf) { if (cf.pending.has(userId)) confDecline({ id: userId }, id).catch(() => {}); else groupLeave(userId, id, 'dropped'); }
  const rc = id && remoteConfs.get(id);
  if (rc) { if (rc.pending.has(userId)) { try { remoteConfDecline({ id: userId, username: '' }, id); } catch {} } else remoteConfLeave(userId, id); }
}

// Незавершённые звонки у пользователя (клиент спрашивает после повторного подключения)
function currentFor(userId) {
  const id = busy.get(userId), c = calls.get(id);
  const cf = confs.get(id);
  if (cf) {
    if (cf.pending.has(userId)) return { call_id: cf.id, chat_id: cf.chatId, video: cf.video, state: 'ringing', incoming: true, conf: true, from: cf.pending.get(userId).from, timeout: Math.max(1, Math.round(RING_MS / 1000 - (Date.now() - cf.pending.get(userId).at) / 1000)) };
    return { call_id: cf.id, chat_id: cf.chatId, video: cf.video, group: true, conf: true, state: 'active', incoming: false };
  }
  const rc = remoteConfs.get(id);
  if (rc) {
    const p = rc.pending.get(userId);
    if (p) return { call_id: rc.id, chat_id: rc.chatId, video: rc.video, state: 'ringing', incoming: true, conf: true, from: p.from, timeout: Math.max(1, Math.round(RING_MS / 1000 - (Date.now() - p.at) / 1000)) };
    return { call_id: rc.id, chat_id: rc.chatId, video: rc.video, group: true, conf: true, state: 'active', incoming: false };
  }
  if (c) {
    const inc = c.calleeId === userId;
    return { ...pub(c), state: c.state, incoming: inc, ...(inc && c.state === 'ringing' ? { from: { id: c.callerId, name: c.callerName || '' }, timeout: Math.max(1, Math.round(RING_MS / 1000 - (Date.now() / 1000 - c.createdAt))) } : {}) };
  }
  const g = groupById(id) || remoteGroupById(id);
  return g ? { call_id: g.id, chat_id: g.chatId, video: g.video, group: true, state: 'active', incoming: false } : null;
}

// ── Групповые звонки (только локальные группы) ──
// Не «звонок» с гудками, а приглашение: кто-то из группы начинает, остальным приходит call_group (event started) с кнопкой
// «Присоединиться», а в шапке группы появляется «Присоединиться», пока звонок идёт. Комната закрывается, когда выходит последний.
const GROUP_MAX = 12;
const groupCalls = new Map();   // chatId → { id, chatId, room, startedBy, video, participants: Set, createdAt, startedAt }
const groupById = id => id && [...groupCalls.values()].find(g => g.id === id) || null;
const groupPub = g => ({ call_id: g.id, chat_id: g.chatId, video: g.video, started_by: g.startedBy, participants: [...g.participants] });
// ── Добавить человека в идущий звонок ──
// Разговаривают двое, нажали «Добавить», выбрали человека: ему приходит обычный звонок с гудками, а звонок двоих становится групповым
// (комната LiveKit та же, у участников просто меняется экран на сетку). Дальше так же можно звать ещё людей. Звонок не привязан к
// чату группы: чат остаётся тем, откуда он начался.
// Звать можно людей своего сервера и сервера, с которым есть федерация. Тогда схема «звезда», как у групп: комната живёт на LiveKit
// одного сервера (хозяина: у кого шёл звонок или у кого он публичный и разрешён второму), люди второго сервера входят по токенам хозяина
// и выглядят в комнате его «теневыми» пользователями. У второго сервера (зеркала) запись remoteConfs: свои люди, ждущие ответа, токены.
// Между серверами: op call_conf_add (зеркало просит хозяина позвать человека), op call_conf_invite (хозяин зовёт человека зеркала),
// события conf_up / conf_ev (хозяин → зеркало), conf_acc / conf_dec / conf_leave (зеркало → хозяин), conf_cancel (хозяин → зеркало).
const confs = new Map();         // id → { id, room, chatId, video, participants: Set, pending: Map(userId → { timer, at, from, name }), createdAt, startedAt, firstCaller, names: Map, remote: Map(userId → peer) }
const remoteConfs = new Map();   // id → { id, peerId, peer, chatId, video, locals: Set, pending: Map(userId → { timer, at, from, name, url, fp, token }), names: Map, createdAt, startedAt, recordBy }
const confById = id => id && confs.get(id) || null;
const nameOf = async id => (await dal.get('SELECT display_name FROM users WHERE id = ?', id))?.display_name || '';
const pendingList = cf => [...cf.pending].map(([id, p]) => ({ id, name: p.name || '' }));
const peerLabel = peer => (peer && (peer.name || peer.instance_id)) || '';
// Хозяин рассылает событие зеркалам: всем людям других серверов, которые в звонке или ждут ответа
function confRelay(cf, body, onlyPeer) {
  const seen = new Set();
  for (const peer of cf.remote.values()) {
    if (seen.has(peer.id) || (onlyPeer && onlyPeer.id !== peer.id)) continue; seen.add(peer.id);
    try { fedMod().sendLive(peer.id, { k: 'call_ev', ev: 'conf_ev', cid: cf.id, payload: body }); } catch {}
  }
}
async function confTellMembers(cf, payload, except) {
  const body = { ...payload, mix: cf.remote.size > 0 };
  for (const u of cf.participants) if (u !== except && !cf.remote.has(u)) ws().sendTo(u, { type: 'call_conf', call_id: cf.id, ...body });
  confRelay(cf, body);
}
async function confEnd(cf, reason) {
  if (!confs.delete(cf.id)) return;
  for (const [u, p] of cf.pending) {
    clearTimeout(p.timer);
    if (busy.get(u) === cf.id) busy.delete(u);
    const peer = cf.remote.get(u);
    if (peer) { try { fedMod().sendLive(peer.id, { k: 'call_ev', ev: 'conf_cancel', cid: cf.id, login: p.login, reason: 'cancelled' }); } catch {} }
    else ws().sendTo(u, { type: 'call_ended', call_id: cf.id, chat_id: cf.chatId, video: cf.video, reason: 'cancelled', duration: 0 });
  }
  const members = [...cf.participants]; cf.participants.clear(); members.forEach(u => note(cf, 'leave', u));
  confRelay(cf, { event: 'ended', reason, mix: true });
  members.forEach(u => { if (busy.get(u) === cf.id) busy.delete(u); if (!cf.remote.has(u)) ws().sendTo(u, { type: 'call_conf', call_id: cf.id, event: 'ended', reason }); });
  const duration = Math.round((Date.now() - cf.startedAt) / 1000), peers = [...new Set([...cf.remote.values()].map(peerLabel))].join(', ');
  if (reason !== 'disabled') {
    const real = cf.firstCaller && !cf.remote.has(cf.firstCaller) ? cf.firstCaller : (members.find(u => !cf.remote.has(u)) || null);
    logCall({ callerId: real, video: cf.video, startedAt: cf.createdAt, answered: true, duration, reason: 'group', chatId: cf.chatId, kind: 'conf', det: cf.det, members: [...cf.names.values()], peerServer: peers || null });
    if (duration >= 3 && real && cf.firstCaller === real) chatRecord(cf.chatId, real, (cf.video ? 'Групповой видеозвонок' : 'Групповой аудиозвонок') + ' · ' + fmtDur(duration));
  }
}
async function confLeave(userId, id, reason) {
  const cf = confs.get(id);
  if (!cf || !cf.participants.has(userId)) return;
  cf.participants.delete(userId); cf.remote.delete(userId); note(cf, 'leave', userId);
  if (busy.get(userId) === id) busy.delete(userId);
  // Остался один и никого не ждём: говорить не с кем, звонок заканчивается у всех
  if (cf.participants.size <= 1 && !cf.pending.size) return await confEnd(cf, reason || 'ended');
  await confTellMembers(cf, { event: 'update', participants: [...cf.participants], pending: pendingList(cf) });
}
// Звонок двоих на этом сервере (свой или федеративный, где комната у нас) становится общим
async function confUpgrade(c) {
  const names = new Map([[c.callerId, c.callerName || await nameOf(c.callerId)], [c.calleeId, await nameOf(c.calleeId)]]);
  const cf = { id: c.id, names, room: c.room, chatId: c.chatId, video: c.video, participants: new Set([c.callerId, c.calleeId]), pending: new Map(), createdAt: c.createdAt, startedAt: c.startedAt, firstCaller: c.callerId, remote: new Map(), c0: c, fresh: true };
  if (c.fed) { const shadow = c.fed.role === 'caller' ? c.calleeId : c.callerId; cf.remote.set(shadow, c.fed.peer); }
  cf.det = c.det; calls.delete(c.id); clearTimeout(c.timer); confs.set(cf.id, cf);
  if (c.fed) { try { fedMod().sendLive(c.fed.peer.id, { k: 'call_ev', ev: 'conf_up', cid: cf.id }); } catch {} }
  await confTellMembers(cf, { event: 'upgraded', participants: [...cf.participants], pending: [] });
  return cf;
}
const CONF_ERR = {
  no_public: 'Чтобы позвать человека с другого сервера, ваш сервер звонков должен быть доступен из интернета и разрешён тому серверу (Настройки → Звонки)',
  already: 'Он уже в звонке или ему звонят', full: 'В звонке уже ' + 12 + ' человек', bad_user: 'Этого человека добавить нельзя', rate: 'Слишком много звонков подряд: подождите минуту',
};
// Звонок только что стал общим, но позвать человека не вышло (занят, не в сети…): возвращаем обычный звонок двоих
async function confRevert(cf) {
  if (!cf.fresh || cf.participants.size !== 2 || cf.pending.size || !confs.delete(cf.id)) return;
  calls.set(cf.c0.id, cf.c0);
  const body = { event: 'downgraded', mix: false };
  for (const u of cf.participants) if (!cf.remote.has(u)) ws().sendTo(u, { type: 'call_conf', call_id: cf.id, ...body });
  confRelay(cf, body);
}
// Позвать человека в звонок, комната которого у нас. from — тот, кто зовёт (свой человек или «теневой»)
async function confInvite(cf, from, t, cfg) {
  if (cf.participants.has(t.id) || cf.pending.has(t.id)) throw new CallError('already', CONF_ERR.already, 409);
  if (cf.participants.size + cf.pending.size >= GROUP_MAX) throw new CallError('full', 'В звонке уже ' + GROUP_MAX + ' человек', 409);
  if (busy.has(t.id)) throw new CallError('busy', 'Он занят', 409);
  const fromShadow = cf.remote.has(from.id);
  const remote = t.is_bot === 2 ? await fedMod().peerOfUser(t.id) : null;
  if (t.is_bot === 2 && !remote) throw new CallError('fed_offline', FED_ERR.offline_link[0], 503);
  const mkTimer = () => {
    const timer = setTimeout(async () => {
      const x = confs.get(cf.id); const p = x && x.pending.get(t.id); if (!p) return;
      if (remote) { try { fedMod().sendLive(remote.id, { k: 'call_ev', ev: 'conf_cancel', cid: cf.id, login: t.fed_login, reason: 'missed' }); } catch {} }
      else ws().sendTo(t.id, { type: 'call_ended', call_id: cf.id, chat_id: cf.chatId, video: cf.video, reason: 'missed', duration: 0 });
      await confPendingDrop(x, t.id, 'missed', t.display_name);
    }, RING_MS); timer.unref?.(); return timer;
  };
  if (remote) {
    if (!remote || remote.status !== 'active' || !fedMod().isOnline(remote.id)) throw new CallError('fed_offline', FED_ERR.offline_link[0], 503);
    if (!(await hostable(cfg, remote.instance_id))) throw new CallError('no_public', CONF_ERR.no_public, 400);
    cf.pending.set(t.id, { timer: mkTimer(), at: Date.now(), from: { id: from.id, name: from.display_name }, name: t.display_name, login: t.fed_login });
    cf.remote.set(t.id, remote); busy.set(t.id, cf.id);
    try {
      await fedMod().rpc(remote.id, 'call_conf_invite', {
        cid: cf.id, to: t.fed_login, video: cf.video, count: cf.participants.size,
        from: fromShadow ? { login: from.fed_login, name: from.display_name, here: true } : { login: from.username, name: from.display_name, here: false },
        url: cfg.url, fp: cfg.certFp || '', token: signToken(cfg, { identity: 'u' + t.id, name: t.display_name, room: cf.room }),
      }, { timeout: 10000 });
    } catch (e) {
      const p = cf.pending.get(t.id); if (p) clearTimeout(p.timer);
      cf.pending.delete(t.id); cf.remote.delete(t.id); if (busy.get(t.id) === cf.id) busy.delete(t.id);
      const k = e.message === 'timeout' ? 'timeout' : e.message === 'offline' ? 'offline' : (FED_ERR[e.message] || CONF_ERR[e.message] ? e.message : 'unknown');
      throw new CallError(k, (FED_ERR[k] && FED_ERR[k][0]) || CONF_ERR[k], (FED_ERR[k] && FED_ERR[k][1]) || 400);
    }
  } else {
    if (!(await spaces().canSee(from.id, t.id)) && !fromShadow) throw new CallError('bad_user', 'Этот человек вам недоступен', 403);
    if (!fromShadow && (await spaces().isBlocked(t.id, from.id) || await spaces().isBlocked(from.id, t.id))) throw new CallError('blocked', 'Этого человека добавить нельзя', 403);
    const pb = prefBlock(await getPrefs(t.id), cf.video);
    if (pb) throw new CallError('prefs_peer', pb === 'all' ? 'Он не принимает звонки' : pb === 'video' ? 'Он не принимает видеозвонки' : 'Он не принимает аудиозвонки', 403);
    if (fromShadow && !(await getPrefs(t.id)).fed) throw new CallError('prefs_fed', FED_ERR.prefs_fed[0], 403);
    if (!ws().isConnected(t.id) && !(await hasPush(t.id))) throw new CallError('offline', 'Он не в сети', 409);
    cf.pending.set(t.id, { timer: mkTimer(), at: Date.now(), from: { id: from.id, name: from.display_name }, name: t.display_name }); busy.set(t.id, cf.id);
    ws().sendTo(t.id, { type: 'call_incoming', call_id: cf.id, chat_id: cf.chatId, video: cf.video, from: { id: from.id, name: from.display_name }, timeout: RING_MS / 1000, conf: true, participants: cf.participants.size, mix: cf.remote.size > 0 });
    pushCall(t.id, { title: 'Входящий ' + (cf.video ? 'видеозвонок' : 'аудиозвонок'), body: from.display_name + ' зовёт в разговор', chatId: cf.chatId, call: cf.id });
  }
  await confTellMembers(cf, { event: 'update', participants: [...cf.participants], pending: pendingList(cf) });
  return { ok: true, call_id: cf.id, user: { id: t.id, name: t.display_name } };
}
const USER_COLS = 'id, username, display_name, is_bot, banned, fed_instance, fed_login';
async function callAdd(user, id, targetId) {
  const cfg = await getConfig();
  if (!cfg.enabled) throw new CallError('disabled', 'Звонки не включены на сервере', 403);
  const t = await dal.get('SELECT ' + USER_COLS + ' FROM users WHERE id = ?', targetId);
  if (!t || (t.is_bot && t.is_bot !== 2) || t.banned || t.id === user.id) throw new CallError('bad_user', CONF_ERR.bad_user, 400);
  let cf = confs.get(id);
  const rc = !cf && remoteConfs.get(id), c = !cf && !rc && calls.get(id);
  if (!cf && !rc && !c) throw new CallError('gone', 'Звонок уже завершён', 404);
  // Комната у другого сервера: просим хозяина позвать человека
  if (rc || (c && c.fed && c.fed.role !== c.fed.host)) {
    if (c && ((c.callerId !== user.id && c.calleeId !== user.id) || c.state !== 'active')) throw new CallError('not_active', 'Добавить человека можно, когда собеседник уже ответил', 409);
    if (rc && !rc.locals.has(user.id)) throw new CallError('gone', 'Звонок уже завершён', 404);
    const peer = rc ? rc.peer : c.fed.peer;
    if (t.is_bot === 2 && t.fed_instance !== peer.instance_id) throw new CallError('bad_user', 'Звать можно людей этого сервера и сервера собеседника', 400);
    if (tooOften(user.id)) throw new CallError('rate', CONF_ERR.rate, 429);
    if (peer.status !== 'active' || !fedMod().isOnline(peer.id)) throw new CallError('fed_offline', FED_ERR.offline_link[0], 503);
    try {
      await fedMod().rpc(peer.id, 'call_conf_add', { cid: id, from: user.username, target: { login: t.is_bot === 2 ? t.fed_login : t.username, name: t.display_name, here: t.is_bot !== 2 } }, { timeout: 15000 });
    } catch (e) {
      const k = e.message === 'timeout' ? 'timeout' : e.message === 'offline' ? 'offline' : (FED_ERR[e.message] || CONF_ERR[e.message] ? e.message : 'unknown');
      throw new CallError(k, (FED_ERR[k] && FED_ERR[k][0]) || CONF_ERR[k], (FED_ERR[k] && FED_ERR[k][1]) || 400);
    }
    return { ok: true, call_id: id, user: { id: t.id, name: t.display_name } };
  }
  if (!ownOk(cfg)) throw new CallError('no_own', NO_OWN, 400);
  if (!cf) {   // звонок двоих у нас: переводим в общий
    if (!c || (c.callerId !== user.id && c.calleeId !== user.id)) throw new CallError('gone', 'Звонок уже завершён', 404);
    if (c.state !== 'active') throw new CallError('not_active', 'Добавить человека можно, когда собеседник уже ответил', 409);
    // Звать человека с другого сервера в свой звонок можно, только если наш LiveKit подходит ему: проверяем до перевода в общий
    if (t.is_bot === 2) { const peer = await fedMod().peerOfUser(t.id); if (!peer || !(await hostable(cfg, peer.instance_id))) throw new CallError('no_public', CONF_ERR.no_public, 400); }
    cf = await confUpgrade(c);
  }
  if (!cf.participants.has(user.id)) throw new CallError('gone', 'Звонок уже завершён', 404);
  if (t.is_bot === 2 && cf.remote.size && ![...cf.remote.values()].some(p => p.instance_id === t.fed_instance)) throw new CallError('bad_user', 'Звать можно людей этого сервера и сервера собеседника', 400);
  if (tooOften(user.id)) throw new CallError('rate', CONF_ERR.rate, 429);
  const me = await dal.get('SELECT ' + USER_COLS + ' FROM users WHERE id = ?', user.id);
  note(cf, 'invite', user, t.id);
  try { const r = await confInvite(cf, me, t, cfg); cf.fresh = false; return r; }
  catch (e) { await confRevert(cf); throw e; }
}
// Человек принял, отклонил или не ответил: общая часть для своих людей и «теневых»
async function confAcceptId(cf, uid, name) {
  const p = cf.pending.get(uid); if (!p) return false;
  clearTimeout(p.timer); cf.pending.delete(uid); cf.participants.add(uid); cf.names.set(uid, name || await nameOf(uid)); note(cf, 'join', uid);
  await confTellMembers(cf, { event: 'update', participants: [...cf.participants], pending: pendingList(cf) }, uid);
  return true;
}
async function confPendingDrop(cf, uid, how, name) {
  const p = cf.pending.get(uid); if (!p) return;
  clearTimeout(p.timer); cf.pending.delete(uid);
  if (!cf.participants.has(uid)) cf.remote.delete(uid);
  if (busy.get(uid) === cf.id) busy.delete(uid);
  await confTellMembers(cf, { event: how, user: { id: uid, name: name || p.name }, pending: pendingList(cf) });
  if (cf.participants.size <= 1 && !cf.pending.size) await confEnd(cf, 'ended');
}
async function confAccept(user, id) {
  const cf = confs.get(id);
  if (cf && user.dev) detOf(cf).dev[user.id] = user.dev;
  if (!cf || !(await confAcceptId(cf, user.id, user.display_name))) throw new CallError('gone', 'Звонок уже завершён', 404);
  const cfg = await getConfig();
  return { call_id: cf.id, chat_id: cf.chatId, video: cf.video, group: true, conf: true, mix: cf.remote.size > 0, participants: [...cf.participants], url: cfg.url, cert_fp: cfg.certFp || undefined, token: signToken(cfg, { identity: 'u' + user.id, name: user.display_name, room: cf.room }) };
}
async function confDecline(user, id) {
  const cf = confs.get(id);
  if (!cf || !cf.pending.has(user.id)) throw new CallError('gone', 'Звонок уже завершён', 404);
  await confPendingDrop(cf, user.id, 'declined', user.display_name || await nameOf(user.id));
}

// ── Зеркало: наши люди в общем звонке, комната которого на другом сервере ──
function rcFinish(rc, reason) {
  if (!remoteConfs.delete(rc.id)) return;
  for (const [u, p] of rc.pending) { clearTimeout(p.timer); if (busy.get(u) === rc.id) busy.delete(u); ws().sendTo(u, { type: 'call_ended', call_id: rc.id, chat_id: rc.chatId, video: rc.video, reason: 'cancelled', duration: 0 }); }
  for (const u of rc.locals) { if (busy.get(u) === rc.id) busy.delete(u); }
  if (reason === 'disabled' || !rc.startedAt) return;
  const duration = Math.round((Date.now() - rc.startedAt) / 1000);
  logCall({ callerId: rc.recordBy || [...rc.names.keys()][0] || null, video: rc.video, startedAt: rc.createdAt, answered: true, duration, reason: 'group', chatId: rc.chatId || null, kind: 'conf', members: [...rc.names.values()], peerServer: peerLabel(rc.peer) || null });
  if (duration >= 3 && rc.recordBy && rc.chatId) chatRecord(rc.chatId, rc.recordBy, (rc.video ? 'Групповой видеозвонок' : 'Групповой аудиозвонок') + ' · ' + fmtDur(duration));
}
async function remoteConfAccept(user, id) {
  const rc = remoteConfs.get(id), p = rc && rc.pending.get(user.id);
  if (!rc || !p) throw new CallError('gone', 'Звонок уже завершён', 404);
  clearTimeout(p.timer); rc.pending.delete(user.id); rc.locals.add(user.id); rc.names.set(user.id, user.display_name || await nameOf(user.id));
  if (!rc.startedAt) rc.startedAt = Date.now();
  try { fedMod().sendLive(rc.peer.id, { k: 'call_ev', ev: 'conf_acc', cid: id, login: user.username }); } catch {}
  return { call_id: id, chat_id: rc.chatId, video: rc.video, group: true, conf: true, mix: true, url: p.url, cert_fp: p.fp || undefined, token: p.token };
}
function remoteConfDecline(user, id, how) {
  const rc = remoteConfs.get(id), p = rc && rc.pending.get(user.id);
  if (!rc || !p) throw new CallError('gone', 'Звонок уже завершён', 404);
  clearTimeout(p.timer); rc.pending.delete(user.id); if (busy.get(user.id) === id) busy.delete(user.id);
  try { fedMod().sendLive(rc.peer.id, { k: 'call_ev', ev: 'conf_dec', cid: id, login: user.username, reason: how || 'declined' }); } catch {}
  if (!rc.locals.size && !rc.pending.size) rcFinish(rc, 'ended');
}
async function remoteConfLeave(userId, id) {
  const rc = remoteConfs.get(id);
  if (!rc || !rc.locals.delete(userId)) return;
  if (busy.get(userId) === id) busy.delete(userId);
  const u = await dal.get('SELECT username FROM users WHERE id = ?', userId);
  try { fedMod().sendLive(rc.peer.id, { k: 'call_ev', ev: 'conf_leave', cid: id, login: u?.username }); } catch {}
  if (!rc.locals.size && !rc.pending.size) rcFinish(rc, 'ended');
}
// Хозяин зовёт нашего человека (op call_conf_invite)
async function fedConfInvite(peer, f) {
  const cfg = await getConfig();
  if (!cfg.enabled) throw new Error('disabled');
  const cid = String(f.cid || '').slice(0, 64), video = !!f.video;
  if (!/^[0-9a-f-]{36}$/i.test(cid) || calls.has(cid) || confs.has(cid)) throw new Error('not_found');
  const url = normUrl(f.url), token = typeof f.token === 'string' ? f.token.slice(0, 4000) : '';
  if (!url || !token) throw new Error('unknown');
  const X = await fedMod().findLocalUser(String(f.to || ''));
  if (!X) throw new Error('not_found');
  const fr = f.from || {}, here = !!fr.here;
  let fromId, fromName = String(fr.name || '').slice(0, 80);
  if (here) { const l = await fedMod().findLocalUser(String(fr.login || '')); if (!l) throw new Error('not_found'); fromId = l.id; fromName = l.display_name; }
  else {
    const sh = await fedMod().ensureShadow(peer, String(fr.login || '').slice(0, 64), fromName); if (!sh) throw new Error('not_found');
    if (await spaces().isBlocked(X.id, sh.id) || await spaces().isBlocked(sh.id, X.id)) throw new Error('blocked');
    fromId = sh.id; fromName = sh.display_name;
  }
  const lp = await getPrefs(X.id), lb = prefBlock(lp, video);
  if (lb) throw new Error('prefs');
  if (!here && !lp.fed) throw new Error('prefs_fed');
  if (busy.has(X.id)) throw new Error('busy');
  if (!ws().isConnected(X.id) && !(await hasPush(X.id))) throw new Error('offline');
  const chatId = (await fedMod().directChat(X.id, fromId)) || (here ? 0 : (await fedMod().ensureDirect(peer, X, { id: fromId, display_name: fromName }).catch(() => 0))) || 0;
  let rc = remoteConfs.get(cid);
  if (rc && rc.peerId !== peer.id) throw new Error('not_found');
  if (!rc) { rc = { id: cid, peerId: peer.id, peer, chatId, video, locals: new Set(), pending: new Map(), names: new Map(), createdAt: Math.floor(Date.now() / 1000), startedAt: 0, recordBy: 0 }; remoteConfs.set(cid, rc); }
  const timer = setTimeout(() => {
    const x = remoteConfs.get(cid), p = x && x.pending.get(X.id); if (!p) return;
    x.pending.delete(X.id); if (busy.get(X.id) === cid) busy.delete(X.id);
    ws().sendTo(X.id, { type: 'call_ended', call_id: cid, chat_id: x.chatId, video: x.video, reason: 'missed', duration: 0 });
    try { fedMod().sendLive(x.peer.id, { k: 'call_ev', ev: 'conf_dec', cid, login: X.username, reason: 'missed' }); } catch {}
    if (!x.locals.size && !x.pending.size) rcFinish(x, 'ended');
  }, RING_MS); timer.unref?.();
  rc.pending.set(X.id, { timer, at: Date.now(), from: { id: fromId, name: fromName }, name: X.display_name, url, fp: String(f.fp || '').slice(0, 120), token });
  busy.set(X.id, cid);
  ws().sendTo(X.id, { type: 'call_incoming', call_id: cid, chat_id: chatId, video, from: { id: fromId, name: fromName }, timeout: RING_MS / 1000, conf: true, participants: Number(f.count) || 2, mix: true });
  pushCall(X.id, { title: 'Входящий ' + (video ? 'видеозвонок' : 'аудиозвонок'), body: fromName + ' зовёт в разговор', chatId, call: cid });
  return { ok: true };
}
// Зеркало просит нас, хозяина комнаты, позвать человека (op call_conf_add)
async function fedConfAdd(peer, f) {
  const cfg = await getConfig();
  if (!(cfg.enabled && cfg.url && cfg.key && cfg.secret)) throw new Error('disabled');
  const cid = String(f.cid || '').slice(0, 64), init = await fedMod().remoteUser(peer, String(f.from || ''));
  if (!init) throw new Error('not_found');
  let cf = confs.get(cid);
  if (!cf) {
    const c = calls.get(cid);
    if (!c || !c.fed || c.fed.peer.id !== peer.id || c.fed.role !== c.fed.host || c.state !== 'active' || (c.callerId !== init.id && c.calleeId !== init.id)) throw new Error('not_found');
    cf = await confUpgrade(c);
  } else if (!cf.participants.has(init.id) || cf.remote.get(init.id)?.id !== peer.id) throw new Error('not_found');
  const tg = f.target || {};
  const t = tg.here ? await fedMod().ensureShadow(peer, String(tg.login || '').slice(0, 64), String(tg.name || '').slice(0, 80)) : await fedMod().findLocalUser(String(tg.login || ''));
  if (!t) throw new Error('not_found');
  const row = await dal.get('SELECT ' + USER_COLS + ' FROM users WHERE id = ?', t.id), me = await dal.get('SELECT ' + USER_COLS + ' FROM users WHERE id = ?', init.id);
  try { await confInvite(cf, me, row, cfg); cf.fresh = false; }
  catch (e) { await confRevert(cf); throw new Error(e instanceof CallError ? ({ prefs_peer: 'prefs', fed_offline: 'offline_link' }[e.code] || e.code) : e.message); }
  return { ok: true };
}
// События между серверами про общий звонок
async function recvConfEvent(peer, ev) {
  const e = String(ev.ev), cid = String(ev.cid || '');
  // хозяин → зеркало
  if (e === 'conf_up') {
    const c = calls.get(cid); if (!c || !c.fed || c.fed.peer.id !== peer.id) return;
    const local = c.fed.role === 'caller' ? c.callerId : c.calleeId;
    clearTimeout(c.timer); calls.delete(cid);
    remoteConfs.set(cid, { c0: c, id: cid, peerId: peer.id, peer, chatId: c.chatId, video: c.video, locals: new Set([local]), pending: new Map(), names: new Map([[local, await nameOf(local)]]), createdAt: c.createdAt, startedAt: c.startedAt || Date.now(), recordBy: c.fed.role === 'caller' ? c.callerId : 0 });
    return;
  }
  const rc = remoteConfs.get(cid);
  if (rc && rc.peerId === peer.id) {
    if (e === 'conf_ev') {
      const body = ev.payload && typeof ev.payload === 'object' ? ev.payload : {};
      for (const u of rc.locals) ws().sendTo(u, { type: 'call_conf', call_id: cid, ...body });
      if (body.event === 'ended') rcFinish(rc, 'ended');
      else if (body.event === 'downgraded' && rc.c0 && !rc.pending.size && remoteConfs.delete(cid)) calls.set(cid, rc.c0);
    } else if (e === 'conf_cancel') {
      const X = await fedMod().findLocalUser(String(ev.login || '')), p = X && rc.pending.get(X.id); if (!p) return;
      clearTimeout(p.timer); rc.pending.delete(X.id); if (busy.get(X.id) === cid) busy.delete(X.id);
      ws().sendTo(X.id, { type: 'call_ended', call_id: cid, chat_id: rc.chatId, video: rc.video, reason: ev.reason === 'missed' ? 'missed' : 'cancelled', duration: 0 });
      if (!rc.locals.size && !rc.pending.size) rcFinish(rc, 'ended');
    }
    return;
  }
  // зеркало → хозяин
  const cf = confs.get(cid); if (!cf) return;
  const sh = await fedMod().remoteUser(peer, String(ev.login || '')); if (!sh || cf.remote.get(sh.id)?.id !== peer.id) return;
  if (e === 'conf_acc') await confAcceptId(cf, sh.id, sh.display_name);
  else if (e === 'conf_dec') await confPendingDrop(cf, sh.id, ev.reason === 'missed' ? 'missed' : 'declined', sh.display_name);
  else if (e === 'conf_leave') await confLeave(sh.id, cid, 'ended');
}

// Группа с людьми других серверов («звезда», см. fedgroups.js): комната живёт на LiveKit сервера-хозяина группы, остальные серверы
// (зеркала) входят и выходят запросами call_gjoin / call_gleave, а о ходе звонка хозяин сообщает им событиями call_ev (gstarted,
// gupdate, gended). Люди зеркал на LiveKit хозяина выглядят как его «теневые» пользователи. Нужен публичный LiveKit хозяина,
// разрешённый серверу гостя (так же, как в личных звонках).
const remoteGroups = new Map();   // chatId (у нас, зеркало) → { id, chatId, peerId, video, participants, from, locals: Set }
const remoteGroupById = id => id && [...remoteGroups.values()].find(r => r.id === id) || null;
async function groupMembers(chatId) { return await dal.all('SELECT cm.user_id, u.is_bot, u.fed_instance FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ?', chatId); }
const sendersName = async id => (await dal.get('SELECT display_name FROM users WHERE id = ?', id))?.display_name || '';
// Сообщить о звонке своим людям группы: окно приглашения (started), число участников (update), конец (ended)
async function notifyLocals(chatId, event, info, except, fromFed) {
  const gname = (await dal.get('SELECT name FROM chats WHERE id = ?', chatId))?.name || 'Группа';
  for (const m of await groupMembers(chatId)) {
    const uid = m.user_id;
    if (m.is_bot === 2 || uid === except) continue;
    if (event === 'started') { const p = await getPrefs(uid); if (!p.enabled || (fromFed && !p.fed)) continue; }   // звонки выключены: приглашения нет
    ws().sendTo(uid, { type: 'call_group', event, call_id: info.call_id, chat_id: chatId, video: info.video, participants: info.participants, started_by: info.started_by, from: info.from });
    if (event === 'started' && !(await dal.get('SELECT 1 AS x FROM muted_chats WHERE user_id = ? AND chat_id = ? AND (until IS NULL OR until > unixepoch())', uid, chatId)))
      pushCall(uid, { title: info.video ? 'Групповой видеозвонок' : 'Групповой аудиозвонок', body: info.from.name + ' · ' + gname, chatId, call: info.call_id, group: true });
  }
}
async function groupTell(g, event, except) {
  const info = { call_id: g.id, video: g.video, participants: [...g.participants], started_by: g.startedBy, from: { id: g.startedBy, name: await sendersName(g.startedBy) } };
  await notifyLocals(g.chatId, event, info, except, false);
  // Остальным серверам группы: по одному событию на сервер, а они разошлют своим людям
  const members = await groupMembers(g.chatId), insts = new Set(members.filter(m => m.is_bot === 2 && m.fed_instance).map(m => m.fed_instance));
  // Начавший звонок гость приглашения не получает: его логин уходит вместе с событием, чтобы сервер гостя его пропустил
  const ex = except ? await dal.get('SELECT fed_instance, fed_login FROM users WHERE id = ? AND is_bot = 2', except) : null;
  for (const inst of insts) {
    try { const peer = await fedMod().peerByInstance(inst); if (peer && peer.status === 'active') fedMod().sendLive(peer.id, { k: 'call_ev', ev: 'g' + event, gid: g.chatId, call_id: g.id, video: g.video, participants: info.participants, from: info.from, exl: ex && ex.fed_instance === inst ? ex.fed_login : undefined }); } catch {}
  }
}
// Идущие групповые звонки в чатах, где состоит человек (для кнопок «Присоединиться»)
async function groupsFor(userId) {
  const out = [];
  for (const g of groupCalls.values()) if (await dal.get('SELECT 1 AS x FROM chat_members WHERE chat_id = ? AND user_id = ?', g.chatId, userId)) out.push({ ...groupPub(g), from: { id: g.startedBy, name: await sendersName(g.startedBy) } });
  for (const r of remoteGroups.values()) if (await dal.get('SELECT 1 AS x FROM chat_members WHERE chat_id = ? AND user_id = ?', r.chatId, userId)) out.push({ call_id: r.id, chat_id: r.chatId, video: r.video, started_by: 0, participants: r.participants, from: r.from });
  return out;
}
// Добавить человека в комнату у хозяина группы (свой или «теневой» гость): создаёт звонок, если его ещё нет
async function hostAdd(chatId, userId, video) {
  let g = groupCalls.get(chatId), created = false;
  if (!g) { created = true; g = { id: crypto.randomUUID(), chatId, room: 'gcall-' + crypto.randomUUID().slice(0, 12), startedBy: userId, video: !!video, participants: new Set(), createdAt: Math.floor(Date.now() / 1000), startedAt: Date.now(), firstLocal: 0 }; groupCalls.set(chatId, g); }
  g.participants.add(userId); busy.set(userId, g.id);
  if (!g.names) g.names = new Map();
  if (!g.names.has(userId)) g.names.set(userId, await nameOf(userId));
  return { g, created };
}
async function groupJoin(user, chatId, video) {
  const cfg = await getConfig();
  if (!cfg.enabled) throw new CallError('disabled', 'Звонки не включены на сервере', 403);
  if (!ownOk(cfg)) throw new CallError('no_own', NO_OWN, 400);
  const chat = await dal.get('SELECT type, is_secret, fed_instance, fed_chat_id FROM chats WHERE id = ?', chatId);
  const mine = await dal.get('SELECT 1 AS x FROM chat_members WHERE chat_id = ? AND user_id = ?', chatId, user.id);
  if (!chat || !mine || (chat.type !== 'group' && chat.type !== 'room')) throw new CallError('bad_chat', 'Групповой звонок возможен в группе или комнате', 400);
  // Комната с подкомнатами — только «папка»: звонок идёт в самой подкомнате
  if (chat.type === 'room' && await dal.get('SELECT 1 AS x FROM chats WHERE parent_id = ?', chatId)) throw new CallError('bad_chat', 'В этой комнате звонки идут в подкомнатах', 400);
  if (chat.is_secret) throw new CallError('bad_chat', 'В этой группе звонки недоступны', 400);
  if (busy.has(user.id)) throw new CallError('in_call', 'Вы уже в звонке');
  if (!(await getPrefs(user.id)).enabled) throw new CallError('prefs_self', 'У вас выключены звонки в настройках', 403);
  if (chat.fed_instance) return await groupJoinMirror(user, chatId, chat, video);
  // Свыше 12 человек в звонке новые участники подключаются только со звуком: видео на 12, звук без ограничений
  const micOnly = (groupCalls.get(chatId)?.participants.size || 0) >= GROUP_MAX && !groupCalls.get(chatId)?.participants.has(user.id);
  const { g, created } = await hostAdd(chatId, user.id, video);
  note(g, 'join', user);
  if (!g.firstLocal) g.firstLocal = user.id;
  // Начавшему звонок приглашение не нужно: остальным — приглашение, а когда кто-то присоединился, всем обновляется число.
  // В комнате (в ней все сотрудники) не звоним и не шлём push: только обновляется отметка «идёт звонок» и кнопка «Присоединиться»
  if (created && chat.type !== 'room') await groupTell(g, 'started', user.id); else await groupTell(g, 'update');
  return { ...groupPub(g), group: true, mic_only: micOnly || undefined, url: cfg.url, cert_fp: cfg.certFp || undefined, token: signToken(cfg, { identity: 'u' + user.id, name: user.display_name, room: g.room, micOnly }) };
}
// Мы — зеркало чужой группы: комната у хозяина, входим запросом к нему
async function groupJoinMirror(user, chatId, chat, video) {
  const peer = await fedMod().peerByInstance(chat.fed_instance);
  if (!peer || peer.status !== 'active' || !fedMod().isOnline(peer.id)) throw new CallError('fed_offline', FED_ERR.offline_link[0], 503);
  let r;
  try { r = await fedMod().rpc(peer.id, 'call_gjoin', { gid: chat.fed_chat_id, login: user.username, video: !!video }, { timeout: 10000 }); }
  catch (e) { const k = e.message === 'timeout' ? 'timeout' : e.message === 'offline' ? 'offline' : (FED_ERR[e.message] ? e.message : 'unknown'); throw new CallError(k, FED_ERR[k][0], FED_ERR[k][1]); }
  const url = normUrl(r.url);
  if (!url || !r.token) throw new CallError('unknown', FED_ERR.unknown[0], 400);
  let rg = remoteGroups.get(chatId);
  if (!rg) { rg = { id: r.call_id, chatId, peerId: peer.id, video: !!r.video, participants: r.participants || [], from: r.from || { id: 0, name: '' }, locals: new Set() }; remoteGroups.set(chatId, rg); }
  rg.id = r.call_id; rg.participants = r.participants || rg.participants;
  rg.locals.add(user.id); busy.set(user.id, r.call_id);
  (rg.joined = rg.joined || new Map()).set(user.id, Date.now());
  return { call_id: r.call_id, chat_id: chatId, video: !!r.video, started_by: 0, participants: rg.participants, group: true, fed_group: true, url, cert_fp: String(r.fp || '').slice(0, 120) || undefined, token: r.token };
}
async function groupLeave(userId, id, reason) {
  if (confs.has(id)) return await confLeave(userId, id, reason);
  if (remoteConfs.has(id)) return await remoteConfLeave(userId, id);
  const rg = remoteGroupById(id);
  if (rg) {   // зеркало: сообщаем хозяину
    if (!rg.locals.delete(userId)) return;
    if (busy.get(userId) === id) busy.delete(userId);
    const hp = await fedMod().peerRow(rg.peerId).catch(() => null);
    logCall({ callerId: userId, video: rg.video, startedAt: Math.floor((rg.joined?.get(userId) || Date.now()) / 1000), answered: true, duration: Math.round((Date.now() - (rg.joined?.get(userId) || Date.now())) / 1000), reason: 'group', chatId: rg.chatId, kind: 'group', members: [await nameOf(userId)], peerServer: hp ? (hp.name || hp.instance_id) : null });
    const u = await dal.get('SELECT username FROM users WHERE id = ?', userId);
    try { fedMod().rpc(rg.peerId, 'call_gleave', { call_id: id, login: u?.username }, { timeout: 8000 }).catch(() => {}); } catch {}
    return;
  }
  const g = groupById(id);
  if (!g || !g.participants.has(userId)) return;
  g.participants.delete(userId); note(g, 'leave', userId);
  if (busy.get(userId) === id) busy.delete(userId);
  if (g.participants.size) return groupTell(g, 'update');
  groupCalls.delete(g.chatId);
  const duration = Math.round((Date.now() - g.startedAt) / 1000);
  logCall({ callerId: g.firstLocal || g.startedBy, video: g.video, startedAt: g.createdAt, answered: true, duration, reason: reason === 'dropped' ? 'ended' : 'group', chatId: g.chatId, kind: 'group', det: g.det, members: [...(g.names || new Map()).values()] });
  await groupTell(g, 'ended');
  // Запись в группе делает свой человек: сообщение гостя хозяин сам не рассылает
  if (duration >= 3 && g.firstLocal) chatRecord(g.chatId, g.firstLocal, (g.video ? 'Групповой видеозвонок' : 'Групповой аудиозвонок') + ' · ' + fmtDur(duration));
}

// ── Идущие звонки для админки и принудительное завершение ──
// Что сейчас происходит на этом сервере: личные (в том числе ещё звонящие), общие, групповые; у зеркала федеративной группы видны только свои люди
async function activeList() {
  const out = [], nm = async ids => (await Promise.all([...ids].map(nameOf))).filter(Boolean);
  for (const c of calls.values()) out.push({ id: c.id, kind: 'direct', state: c.state === 'active' ? 'active' : 'ringing', video: c.video, since: c.startedAt || c.createdAt * 1000, people: [c.callerName || await nameOf(c.callerId), await nameOf(c.calleeId)], peer_server: c.fed ? (c.fed.peer.name || c.fed.peer.instance_id || '') : '' });
  for (const cf of confs.values()) out.push({ id: cf.id, kind: 'conf', state: 'active', video: cf.video, since: cf.startedAt, people: [...cf.names.values()], waiting: [...cf.pending.values()].map(p => p.name).filter(Boolean) });
  for (const rc of remoteConfs.values()) if (rc.locals.size) out.push({ id: rc.id, kind: 'conf', state: 'active', video: rc.video, since: rc.startedAt || Date.now(), people: [...rc.locals].map(u => rc.names.get(u) || ''), mirror: true, peer_server: peerLabel(rc.peer) });
  for (const g of groupCalls.values()) out.push({ id: g.id, kind: 'group', state: 'active', video: g.video, since: g.startedAt, group: (await dal.get('SELECT name FROM chats WHERE id = ?', g.chatId))?.name || '', people: g.names ? [...g.names.values()] : await nm(g.participants) });
  for (const r of remoteGroups.values()) out.push({ id: r.id, kind: 'group', state: 'active', video: r.video, since: r.joined?.size ? Math.min(...r.joined.values()) : Date.now(), group: (await dal.get('SELECT name FROM chats WHERE id = ?', r.chatId))?.name || '', people: await nm(r.locals), mirror: true });
  return out.sort((a, b) => a.since - b.since);
}
// Выключить комнату на LiveKit: всех, кто в ней, отключает сразу, даже если у кого-то клиент не отреагировал
async function killRoom(room) {
  try {
    const cfg = await getConfig(); if (!(cfg.url && cfg.key && cfg.secret && room)) return;
    await lkPost(httpBase(cfg.url) + '/twirp/livekit.RoomService/DeleteRoom', { 'Content-Type': 'application/json', Authorization: 'Bearer ' + signToken(cfg, { identity: 'server', kill: true, ttl: 60 }) }, JSON.stringify({ room }), cfg.certFp);
  } catch (e) { console.warn('[Звонки] комната не закрылась:', e.message); }
}
// Администратор завершает звонок. Участникам приходит причина «admin» (клиенты пишут «Звонок завершён администратором»)
async function adminEnd(id) {
  const c = calls.get(id);
  if (c) { const room = c.fed ? null : c.room; finish(c, 'admin'); if (room) await killRoom(room); return { ok: true, what: 'direct' }; }
  const cf = confs.get(id);
  if (cf) { const room = cf.room; await confEnd(cf, 'admin'); await killRoom(room); return { ok: true, what: 'conf' }; }
  const rcx = remoteConfs.get(id);
  if (rcx) {
    for (const u of [...rcx.locals]) { ws().sendTo(u, { type: 'call_ended', call_id: rcx.id, chat_id: rcx.chatId, video: rcx.video, reason: 'admin', duration: 0 }); await remoteConfLeave(u, rcx.id); }
    return { ok: true, what: 'mirror' };
  }
  const g = groupById(id);
  if (g) {
    const room = g.room, list = [...g.participants];
    for (const u of list) ws().sendTo(u, { type: 'call_ended', call_id: g.id, chat_id: g.chatId, video: g.video, reason: 'admin', duration: 0 });
    for (const u of list) await groupLeave(u, g.id, 'admin');
    await killRoom(room); return { ok: true, what: 'group' };
  }
  const rg = remoteGroupById(id);
  if (rg) {
    for (const u of [...rg.locals]) { ws().sendTo(u, { type: 'call_ended', call_id: rg.id, chat_id: rg.chatId, video: rg.video, reason: 'admin', duration: 0 }); await groupLeave(u, rg.id, 'admin'); }
    return { ok: true, what: 'mirror' };
  }
  throw new CallError('gone', 'Звонок уже завершён', 404);
}

// Запросы от серверов-гостей хозяину группы (op call_gjoin, call_gleave)
async function fedGroupReq(peer, f) {
  if (f.op === 'call_gleave') {
    const sh = await fedMod().remoteUser(peer, String(f.login || ''));
    if (sh) await groupLeave(sh.id, String(f.call_id || ''));
    return { ok: true };
  }
  const cfg = await getConfig();
  if (!(cfg.enabled && cfg.url && cfg.key && cfg.secret)) throw new Error('disabled');
  if (!(await hostable(cfg, peer.instance_id))) throw new Error('no_public');
  const chat = await dal.get('SELECT id, type, is_secret, fed_instance FROM chats WHERE id = ?', Number(f.gid));
  const sh = await fedMod().remoteUser(peer, String(f.login || ''));
  if (!chat || chat.type !== 'group' || chat.is_secret || chat.fed_instance || !sh) throw new Error('not_found');
  if (!(await dal.get('SELECT 1 AS x FROM chat_members WHERE chat_id = ? AND user_id = ?', chat.id, sh.id))) throw new Error('not_found');
  if (busy.has(sh.id) && !groupCalls.get(chat.id)?.participants.has(sh.id)) throw new Error('busy');
  const micOnly = (groupCalls.get(chat.id)?.participants.size || 0) >= GROUP_MAX && !groupCalls.get(chat.id)?.participants.has(sh.id);
  const { g, created } = await hostAdd(chat.id, sh.id, !!f.video);
  if (created) await groupTell(g, 'started', sh.id); else await groupTell(g, 'update');
  return { call_id: g.id, video: g.video, participants: [...g.participants], from: { id: g.startedBy, name: await sendersName(g.startedBy) }, url: cfg.url, fp: cfg.certFp || '', token: signToken(cfg, { identity: 'u' + sh.id, name: sh.display_name, room: g.room, micOnly }) };
}
// События хозяина группы: звонок начался, изменился состав, закончился
async function recvGroupEvent(peer, ev) {
  const chat = await dal.get('SELECT id, type FROM chats WHERE fed_instance = ? AND fed_chat_id = ?', peer.instance_id, Number(ev.gid));
  if (!chat || chat.type !== 'group') return;
  const event = String(ev.ev).slice(1);
  const info = { call_id: String(ev.call_id || ''), video: !!ev.video, participants: Array.isArray(ev.participants) ? ev.participants.slice(0, 64) : [], started_by: 0, from: { id: 0, name: String(ev.from?.name || '').slice(0, 80) } };
  if (event === 'ended') {
    const rg = remoteGroups.get(chat.id);
    if (rg) { rg.locals.forEach(u => { if (busy.get(u) === rg.id) busy.delete(u); }); remoteGroups.delete(chat.id); }
  } else {
    const rg = remoteGroups.get(chat.id) || { id: info.call_id, chatId: chat.id, peerId: peer.id, locals: new Set() };
    Object.assign(rg, { id: info.call_id, video: info.video, participants: info.participants, from: info.from, peerId: peer.id });
    remoteGroups.set(chat.id, rg);
  }
  if (!['started', 'update', 'ended'].includes(event)) return;
  const inCall = remoteGroups.get(chat.id)?.locals;
  const exu = ev.exl ? await fedMod().findLocalUser(String(ev.exl).slice(0, 64)) : null;
  await notifyLocals(chat.id, event, info, exu && exu.id, true);
}

// Какие соседи разрешили нам пользоваться их LiveKit (для настроек: «звонки к их людям идут через их сервер звонков»)
async function peerAccess() {
  const peers = await fedMod().peersInfo();
  return await Promise.all(peers.filter(p => p.status === 'active').map(async p => {
    let allowed = null;
    if (p.online) { try { allowed = !!(await fedMod().rpc(p.id, 'call_access', {}, { timeout: 5000 })).allowed; } catch (e) { allowed = null; } }
    return { instance_id: p.instance_id, name: p.name, online: !!p.online, allowed };
  }));
}

// Звонки включили или выключили: клиенты узнают сразу (кнопки, раздел настроек, идущие звонки)
async function shutdownAll() {
  for (const c of [...calls.values()]) finish(c, 'disabled');
  for (const cf of [...confs.values()]) await confEnd(cf, 'disabled');
  for (const rc of [...remoteConfs.values()]) { for (const u of rc.locals) ws().sendTo(u, { type: 'call_conf', call_id: rc.id, event: 'ended', reason: 'disabled' }); rcFinish(rc, 'disabled'); }
  for (const r of [...remoteGroups.values()]) { r.locals.forEach(u => { if (busy.get(u) === r.id) busy.delete(u); }); notifyLocals(r.chatId, 'ended', { call_id: r.id, video: r.video, participants: [], started_by: 0, from: r.from || { id: 0, name: '' } }); }
  remoteGroups.clear();
  for (const g of [...groupCalls.values()]) {
    groupCalls.delete(g.chatId);
    g.participants.forEach(u => { if (busy.get(u) === g.id) busy.delete(u); });
    await groupTell(g, 'ended');
  }
}
async function afterConfigChange(was) {
  const now = await active();
  if (was === now) return;
  if (!now) await shutdownAll();
  ws().broadcastAll({ type: 'call_config', enabled: now });
}

// ── Звонки между серверами ──
// Комната живёт на одном из двух серверов, у которого есть публичный LiveKit, доступный другой стороне: люди с другого
// сервера подключаются к нему исходящим соединением, поэтому серверу за NAT публичный адрес не нужен. Если подходят оба,
// комнату создаёт звонящий; если ни один — звонок запрещён. Хозяин комнаты сам выдаёт токены обеим сторонам. Между серверами
// ходят запрос call_offer (rpc) и события call_ev (accepted, declined, ended…) по уже работающему каналу федерации.
const ALLOW_KEY = 'calls_fed_allow';
async function fedAllowed() { try { const a = JSON.parse((await getS(ALLOW_KEY)) || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } }
async function setFedAllowed(list) { await setS(ALLOW_KEY, JSON.stringify([...new Set((list || []).map(String))])); }
const hostable = async (cfg, inst) => cfg.enabled && !!(cfg.url && cfg.key && cfg.secret) && cfg.public && (await fedAllowed()).includes(String(inst));
const FED_ERR = {
  no_public: ['Звонок невозможен: ни у вас, ни у собеседника нет сервера звонков, доступного из интернета и разрешённого для другой стороны', 400],
  disabled: ['На сервере собеседника звонки не включены', 400], busy: ['Собеседник занят', 409], offline: ['Собеседник не в сети', 409],
  blocked: ['Собеседник недоступен', 403], prefs: ['Собеседник не принимает такие звонки', 403], prefs_fed: ['Собеседник не принимает звонки с других серверов', 403], not_found: ['Собеседник недоступен', 404], unknown: ['Сервер собеседника ещё не умеет звонить: ему нужно обновление', 400],
  timeout: ['Сервер собеседника не отвечает', 504], offline_link: ['Нет связи с сервером собеседника', 503],
};

async function startFed(cfg, user, chatId, shadow, video) {
  const peer = await fedMod().peerOfUser(shadow.id);
  if (!peer || peer.status !== 'active' || !fedMod().isOnline(peer.id)) throw new CallError('fed_offline', FED_ERR.offline_link[0], 503);
  const cid = crypto.randomUUID(), room = 'call-' + cid;
  const sh = await dal.get('SELECT fed_login, display_name FROM users WHERE id = ?', shadow.id);
  const mine = await hostable(cfg, peer.instance_id);
  let r;
  try {
    r = await fedMod().rpc(peer.id, 'call_offer', {
      cid, from: user.username, name: user.display_name, to: sh.fed_login, video: !!video,
      // Если наш LiveKit подходит, сразу даём токен для собеседника: он подключится к нам
      c_pub: mine, c_url: mine ? cfg.url : '', c_fp: mine ? cfg.certFp : '', c_tok: mine ? signToken(cfg, { identity: 'u' + shadow.id, name: sh.display_name, room }) : '',
    }, { timeout: 10000 });
  } catch (e) {
    const k = e.message === 'timeout' ? 'timeout' : e.message === 'offline' ? 'offline' : (FED_ERR[e.message] ? e.message : 'unknown');
    throw new CallError(k, FED_ERR[k][0], FED_ERR[k][1]);
  }
  const hostIsMe = r.host === 'caller';
  if (!hostIsMe && !(r.url && r.token && normUrl(r.url))) throw new CallError('unknown', FED_ERR.unknown[0], 400);
  const url = hostIsMe ? cfg.url : normUrl(r.url), fp = hostIsMe ? cfg.certFp : String(r.fp || '').slice(0, 120);
  const token = hostIsMe ? signToken(cfg, { identity: 'u' + user.id, name: user.display_name, room }) : r.token;
  const c = { id: cid, chatId, room, callerId: user.id, calleeId: shadow.id, video: !!video, state: 'ringing', createdAt: Math.floor(Date.now() / 1000), startedAt: 0, timer: null,
    fed: { peer, role: 'caller', host: r.host } };
  c.timer = setTimeout(() => { const x = calls.get(cid); if (x && x.state === 'ringing') finish(x, 'missed'); }, RING_MS);
  c.timer.unref?.();
  calls.set(cid, c); busy.set(user.id, cid);
  return { ...pub(c), url, cert_fp: fp || undefined, token, peer: { id: shadow.id, name: sh.display_name } };
}

// Входящий запрос от другого сервера (op call_offer)
async function handleFedReq(peer, f) {
  try { return await fedOffer(peer, f); }
  catch (e) { console.log('[Звонки] звонок с сервера «' + (peer.name || peer.instance_id) + '» не принят: ' + e.message); throw e; }
}
async function fedOffer(peer, f) {
  if (f.op === 'call_gjoin' || f.op === 'call_gleave') return await fedGroupReq(peer, f);
  if (f.op === 'call_conf_invite') return await fedConfInvite(peer, f);
  if (f.op === 'call_conf_add') return await fedConfAdd(peer, f);
  // Сосед спрашивает, можно ли ему пользоваться нашим LiveKit (для списка «доступные серверы звонков» в его настройках)
  if (f.op === 'call_access') { const c = await getConfig(); return { allowed: await hostable(c, peer.instance_id), name: '' }; }
  if (f.op !== 'call_offer') throw new Error('unknown');
  const cfg = await getConfig();
  if (!cfg.enabled) throw new Error('disabled');
  const cid = String(f.cid || '').slice(0, 64);
  if (!/^[0-9a-f-]{36}$/i.test(cid) || calls.has(cid)) throw new Error('not_found');
  const shadow = await fedMod().remoteUser(peer, String(f.from || ''));
  const local = await fedMod().findLocalUser(String(f.to || ''));
  if (!shadow || !local) throw new Error('not_found');
  if (await spaces().isBlocked(local.id, shadow.id) || await spaces().isBlocked(shadow.id, local.id)) throw new Error('blocked');
  const chatId = await fedMod().ensureDirect(peer, local, shadow);
  if (!chatId) throw new Error('not_found');
  const lp = await getPrefs(local.id), lb = prefBlock(lp, !!f.video);
  if (lb) throw new Error('prefs');
  if (!lp.fed) throw new Error('prefs_fed');
  if (busy.has(local.id)) throw new Error('busy');
  if (!ws().isConnected(local.id) && !(await hasPush(local.id))) throw new Error('offline');
  const room = 'call-' + cid, video = !!f.video;
  let host, url, tokenCallee, tokenCaller = '';
  const cUrl = f.c_pub ? normUrl(f.c_url) : null;
  if (cUrl && typeof f.c_tok === 'string' && f.c_tok) { host = 'caller'; url = cUrl; tokenCallee = f.c_tok; }
  else if (await hostable(cfg, peer.instance_id)) {
    host = 'callee'; url = cfg.url;
    tokenCallee = signToken(cfg, { identity: 'u' + local.id, name: local.display_name, room });
    tokenCaller = signToken(cfg, { identity: 'u' + shadow.id, name: shadow.display_name, room });
  } else throw new Error('no_public');
  const c = { id: cid, chatId, room, callerId: shadow.id, calleeId: local.id, callerName: shadow.display_name, video, state: 'ringing', createdAt: Math.floor(Date.now() / 1000), startedAt: 0, timer: null,
    fed: { peer, role: 'callee', host, url, fp: host === 'callee' ? cfg.certFp : String(f.c_fp || '').slice(0, 120), token: tokenCallee } };
  c.timer = setTimeout(() => { const x = calls.get(cid); if (x && x.state === 'ringing') finish(x, 'missed'); }, RING_MS);
  c.timer.unref?.();
  calls.set(cid, c); busy.set(local.id, cid);
  ws().sendTo(local.id, { type: 'call_incoming', ...pub(c), from: { id: shadow.id, name: shadow.display_name }, timeout: RING_MS / 1000 });
  pushCall(local.id, { title: 'Входящий ' + (video ? 'видеозвонок' : 'аудиозвонок'), body: shadow.display_name, chatId, call: cid });
  return host === 'callee' ? { host, url, fp: cfg.certFp, token: tokenCaller } : { host };
}

// Событие от другого сервера: звонок принят, отклонён, отменён, завершён…
function recvFedEvent(peer, ev) {
  if (typeof ev.ev === 'string' && ev.ev.startsWith('conf_')) return recvConfEvent(peer, ev).catch(e => console.warn('[Звонки] событие общего звонка:', e.message));
  if (typeof ev.ev === 'string' && ev.ev[0] === 'g' && ev.gid) return recvGroupEvent(peer, ev).catch(e => console.warn('[Звонки] событие группы:', e.message));
  const c = calls.get(String(ev.cid || ''));
  if (!c || !c.fed || c.fed.peer.id !== peer.id) return;
  const e = String(ev.ev || '');
  if (e === 'accepted') {
    if (c.fed.role !== 'caller' || c.state !== 'ringing') return;
    c.state = 'active'; c.startedAt = Date.now(); clearTimeout(c.timer);
    ws().sendTo(c.callerId, { type: 'call_accepted', ...pub(c) });
    return;
  }
  if (['declined', 'cancelled', 'missed', 'ended', 'dropped'].includes(e)) finish(c, e, true);
}

// Браузерные клиенты (/chat, /m) подключаются к LiveKit со страницы, а CSP разрешает только свои адреса: добавляем адрес нашего
// LiveKit (ws/wss и http/https для проверки соединения). Если есть соседние серверы, звонить можно и через их публичный LiveKit,
// адрес которого заранее неизвестен: тогда разрешаем любой wss://
let cspMemo = { at: 0, v: '' };
async function cspSources() {
  if (Date.now() - cspMemo.at < 5000) return cspMemo.v;
  const c = await getConfig();
  let v = '';
  // Без своего LiveKit (гостевой режим) звонок идёт на LiveKit соседа, адрес которого заранее неизвестен: разрешаем любой wss://
  if (c.enabled && !c.url && (await dal.get('SELECT COUNT(*) AS n FROM fed_peers WHERE virt = 0')).n > 0) v = ' wss: https:';
  if (c.enabled && c.url) {
    try {
      const u = new URL(c.url), tls = u.protocol === 'wss:';
      v = ` ${tls ? 'wss' : 'ws'}://${u.host} ${tls ? 'https' : 'http'}://${u.host}`;
      if ((await dal.get('SELECT COUNT(*) AS n FROM fed_peers WHERE virt = 0')).n > 0) v += ' wss: https:';
    } catch {}
  }
  cspMemo = { at: Date.now(), v };
  return v;
}

// ── Журнал звонков для раздела «Звонки» в админке ──
const KIND_SQL = "COALESCE(l.kind, CASE WHEN l.callee_id IS NULL THEN 'group' ELSE 'direct' END)";
const parseDet = s => { try { const d = s && JSON.parse(s); return d && Array.isArray(d.ev) ? d : null; } catch { return null; } };
async function logList({ period, kind, q, limit, offset }) {
  const now = Math.floor(Date.now() / 1000);
  const since = { day: now - 86400, week: now - 7 * 86400, month: now - 30 * 86400 }[period] || 0;
  const where = ['l.started_at >= ?'], args = [since];
  if (kind === 'direct') where.push(KIND_SQL + " = 'direct'");
  if (kind === 'group') where.push(KIND_SQL + " IN ('group', 'conf')");
  const text = String(q || '').trim().slice(0, 60);
  if (text) { where.push('(l.caller_name LIKE ? OR l.callee_name LIKE ? OR l.members LIKE ? OR c.name LIKE ? OR u1.display_name LIKE ? OR u2.display_name LIKE ?)'); const t = '%' + text.replace(/[%_]/g, '') + '%'; args.push(t, t, t, t, t, t); }
  const base = 'FROM call_log l LEFT JOIN chats c ON c.id = l.chat_id LEFT JOIN users u1 ON u1.id = l.caller_id LEFT JOIN users u2 ON u2.id = l.callee_id WHERE ' + where.join(' AND ');
  const sum = await dal.get('SELECT COUNT(*) AS n, SUM(l.answered) AS ok, SUM(l.duration) AS sec, SUM(CASE WHEN ' + KIND_SQL + " IN ('group', 'conf') THEN 1 ELSE 0 END) AS grp, SUM(l.video) AS vid, SUM(l.recorded) AS rec " + base, ...args);
  const rows = await dal.all('SELECT l.id, l.started_at, l.video, l.answered, l.duration, l.reason, ' + KIND_SQL + ' AS kind, l.chat_id, l.members, l.peer_server, l.recorded, l.detail, COALESCE(l.caller_name, u1.display_name) AS caller, COALESCE(l.callee_name, u2.display_name) AS callee, c.name AS chat_name ' + base + ' ORDER BY l.started_at DESC, l.id DESC LIMIT ? OFFSET ?', ...args, Math.min(Math.max(Number(limit) || 50, 1), 200), Math.max(Number(offset) || 0, 0));
  const res = r => r.kind !== 'direct' ? 'group' : r.answered ? 'ok' : ({ declined: 'declined', missed: 'missed', cancelled: 'cancelled' }[r.reason] || 'failed');
  return {
    total: Number(sum.n) || 0,
    sum: { ok: Number(sum.ok) || 0, minutes: Math.round((Number(sum.sec) || 0) / 60), group: Number(sum.grp) || 0, video: Number(sum.vid) || 0, recorded: Number(sum.rec) || 0 },
    rows: rows.map(r => { let m = []; try { m = JSON.parse(r.members || '[]'); } catch {} return { id: r.id, at: r.started_at, kind: r.kind, video: !!r.video, caller: r.caller || 'Удалён', callee: r.kind === 'direct' ? (r.callee || 'Удалён') : '', group: r.kind === 'direct' ? '' : (r.chat_name || ''), members: m, duration: r.duration, result: res(r), peer_server: r.peer_server || '', recorded: !!r.recorded, det: parseDet(r.detail) }; }),
  };
}

// ── Статистика для главной админки ──
// Сводка в шапке — всегда за сутки; график и список людей — за выбранный период (сутки, неделя, месяц)
const LOG_KEEP_DAYS = 365;
const cleanup = () => dal.run('DELETE FROM call_log WHERE started_at < unixepoch() - ?', LOG_KEEP_DAYS * 86400).catch(e => console.warn('[Звонки] очистка журнала:', e.message));
function init() { cleanup(); setInterval(cleanup, 24 * 3600 * 1000).unref(); }

const memo = new Map();
async function stats(period) {
  period = ['day', 'week', 'month'].includes(period) ? period : 'day';
  const hit = memo.get(period);
  if (hit && Date.now() - hit.at < 1500) return hit.p;
  const p = compute(period);
  memo.set(period, { at: Date.now(), p });
  try { return await p; } catch (e) { memo.delete(period); throw e; }
}
async function compute(period) {
  const cfg = await getConfig(), ready = !!(cfg.url && cfg.key && cfg.secret);
  const now = Math.floor(Date.now() / 1000), hourNow = Math.floor(now / 3600) * 3600;
  const dayStart = ts => { const d = new Date(ts * 1000); d.setHours(0, 0, 0, 0); return Math.floor(d.getTime() / 1000); };
  const buckets = [];
  if (period === 'day') for (let i = 23; i >= 0; i--) buckets.push(hourNow - i * 3600);
  else { const n = period === 'week' ? 7 : 30, today = dayStart(now); for (let i = n - 1; i >= 0; i--) { const d = new Date(today * 1000); d.setDate(d.getDate() - i); buckets.push(Math.floor(d.getTime() / 1000)); } }
  const keyOf = ts => (period === 'day' ? Math.floor(ts / 3600) * 3600 : dayStart(ts));
  const idx = new Map(buckets.map((t, i) => [t, i]));
  const series = buckets.map(t => ({ t, ok: 0, miss: 0, audioMin: 0, videoMin: 0 }));
  const since = buckets[0], day24 = hourNow - 23 * 3600;
  const rows = await dal.all('SELECT caller_id, callee_id, video, started_at, answered, duration, reason FROM call_log WHERE started_at >= ?', Math.min(since, day24));
  const tot = { all: 0, ok: 0, miss: 0, declined: 0, noanswer: 0, video: 0, minutes: 0 };
  const people = new Map();
  for (const r of rows) {
    const mins = r.duration / 60, b = series[idx.get(keyOf(r.started_at))];
    if (b) { if (r.answered) { b.ok++; if (r.video) b.videoMin += mins; else b.audioMin += mins; } else b.miss++; }
    if (r.started_at >= since) for (const uid of [r.caller_id, r.callee_id]) {
      if (!uid) continue;
      const u = people.get(uid) || { id: uid, calls: 0, minutes: 0 };
      u.calls++; if (r.answered) u.minutes += mins;
      people.set(uid, u);
    }
    if (r.started_at >= day24) {
      tot.all++; tot.minutes += r.answered ? mins : 0;
      if (r.video) tot.video++;
      if (r.answered) tot.ok++; else { tot.miss++; if (r.reason === 'declined') tot.declined++; else tot.noanswer++; }
    }
  }
  const top = [...people.values()].sort((a, b) => b.calls - a.calls || b.minutes - a.minutes).slice(0, 8);
  if (top.length) {
    const names = new Map((await dal.all(`SELECT id, display_name FROM users WHERE id IN (${top.map(() => '?').join(',')})`, ...top.map(u => u.id))).map(u => [u.id, u.display_name]));
    top.forEach(u => { u.name = names.get(u.id) || 'Удалён'; u.minutes = Math.round(u.minutes); });
  }
  let any = rows.length > 0;
  if (!any) any = !!(await dal.get('SELECT 1 AS x FROM call_log LIMIT 1'));
  series.forEach(b => { b.audioMin = Math.round(b.audioMin * 10) / 10; b.videoMin = Math.round(b.videoMin * 10) / 10; });
  const live = [...calls.values()].filter(c => c.state === 'active').length, ringing = calls.size - live;
  return { period, enabled: cfg.enabled, ready, show: ready || any, live, ringing, series, top, totals: { ...tot, minutes: Math.round(tot.minutes) } };
}

module.exports = { event, peerAccess, ownOk, activeList, adminEnd, logList, callAdd, inspectCert, afterConfigChange, getPrefs, setPrefs, groupJoin, groupLeave, groupsFor, init, stats, cspSources, getConfig, handleFedReq, recvFedEvent, fedAllowed, setFedAllowed, active, publicConfig, saveConfig, normUrl, check, start, accept, decline, end, onDisconnect, currentFor, CallError };
