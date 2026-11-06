'use strict';
// ── ССЫЛКИ НА ВИДЕОЗВОНОК ДЛЯ ГОСТЕЙ ──
//
// Человек с правом (или администратор сервера) создаёт ссылку на время: до недели, по умолчанию сутки. Ссылка многоразовая — это
// одна комната LiveKit, в неё приходят сотрудники и гости. Создатель ссылки — администратор звонка. Правила:
//   · сотрудник (человек с учётной записью этого сервера) входит сразу; гость вводит имя и ждёт, пока администратор его впустит;
//   · администратор в звонке видит ожидающих и может впустить, отклонить, впустить всех; исключить можно любого участника;
//   · гость — запись call_link_guests без учётной записи, привязанная к устройству (ключ хранится в браузере гостя, в базе хеш);
//     отклонённый и исключённый на это устройство больше не пускается, пока ссылка жива; привязка исчезает вместе со ссылкой;
//   · токен LiveKit гость получает только после «впустить»;
//   · ожидание длится 10 минут, потом «Администратор не подключился»; гость может попросить впустить заново;
//   · администратор вышел — звонок идёт дальше, новых гостей никто не впускает;
//   · удаление ссылки и окончание срока закрывают вход новым гостям, идущий звонок продолжается, пока в нём есть люди;
//   · звонок живёт только в памяти (как остальные звонки): после перезапуска сервера он закончен.
// Гость не держит соединения с сервером чата: страница опрашивает состояние и тем самым сообщает, что жива.

const crypto = require('crypto');
const dal = require('./dal');
const calls = require('./calls');
const guestLib = require('./guest');

const MIN_TTL = 10 * 60, MAX_TTL = 7 * 24 * 3600, DEF_TTL = 24 * 3600;
const WAIT_SEC = 10 * 60;          // сколько гость ждёт, пока его впустят
const SEEN_SEC = 45;               // гость в звонке, от которого нет вестей дольше, считается вышедшим
const MAX_WAITING = 20;            // ожидающих на одну ссылку
const MAX_LINKS = 20;              // действующих ссылок у одного человека
const PUSH_GAP = 10 * 60e3;        // не чаще одного уведомления администратору на ссылку
const GUEST_TOKEN_TTL = 2 * 3600;  // токен LiveKit гостя: нужен только чтобы войти
const now = () => Math.floor(Date.now() / 1000);
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const ws = () => require('./ws');
const err = (code, message, status = 409) => new calls.CallError(code, message, status);

const live = new Map();   // id ссылки → звонок: { id, linkId, room, ownerId, emp: Set, guests: Map(guestId → { name, seen }), names: Map, banned: Set, createdAt, startedAt, det }
const lastPush = new Map();
const callId = linkId => 'link:' + linkId;
const has = id => typeof id === 'string' && id.startsWith('link:') && live.has(Number(id.slice(5)));
const byUser = userId => { const id = calls.busy.get(userId); return has(id) ? live.get(Number(id.slice(5))) : null; };

// ── Ссылки ──
async function canCreate(userId) {
  const u = await dal.get('SELECT is_admin, can_call_links, banned, is_bot FROM users WHERE id = ?', userId);
  return !!u && !u.banned && !u.is_bot && !!(u.is_admin || u.can_call_links);
}
const closed = r => !!r.closed_at || r.expires_at <= now();

// Что мешает звонкам по ссылке работать: нужен включённый свой сервер звонков. Остальное — предупреждения создателю
async function setup() {
  const cfg = await calls.getConfig();
  if (!cfg.enabled) throw err('disabled', 'Звонки не включены на сервере', 403);
  if (!calls.ownOk(cfg)) throw err('no_own', 'Ссылки на звонок работают только со своим сервером звонков (Настройки → Звонки)', 400);
  return cfg;
}
const warnings = cfg => [!cfg.public && 'not_public', !/^wss:/i.test(cfg.url) && 'insecure'].filter(Boolean);

async function create(userId, ttlSec) {
  if (!(await canCreate(userId))) throw err('forbidden', 'Нет права создавать ссылки на звонок', 403);
  const cfg = await setup();
  const ttl = ttlSec === undefined || ttlSec === null || ttlSec === '' ? DEF_TTL : Math.floor(Number(ttlSec));
  if (!(ttl >= MIN_TTL && ttl <= MAX_TTL)) throw err('bad_ttl', 'Срок ссылки от 10 минут до 7 суток', 400);
  const n = await dal.get('SELECT COUNT(*) AS n FROM call_links WHERE created_by = ? AND closed_at IS NULL AND expires_at > ?', userId, now());
  if (Number(n.n) >= MAX_LINKS) throw err('too_many', 'Слишком много действующих ссылок: удалите ненужные', 400);
  const token = crypto.randomBytes(24).toString('base64url'), room = 'lnk-' + crypto.randomBytes(8).toString('hex'), expires = now() + ttl;
  const r = await dal.run('INSERT INTO call_links (token, room, created_by, expires_at) VALUES (?, ?, ?, ?)', token, room, userId, expires);
  return { id: r.lastInsertRowid, token, expires_at: expires, warnings: warnings(cfg) };
}

async function list(userId) {
  const rows = await dal.all('SELECT id, token, created_at, expires_at FROM call_links WHERE created_by = ? AND closed_at IS NULL AND expires_at > ? ORDER BY id DESC', userId, now());
  const cfg = await calls.getConfig();
  const out = [];
  for (const r of rows) {
    const c = live.get(r.id);
    out.push({ id: r.id, token: r.token, created_at: r.created_at, expires_at: r.expires_at, live: !!c, people: c ? c.emp.size + c.guests.size : 0, waiting: (await waitingOf(r.id)).length });
  }
  return { links: out, warnings: warnings(cfg) };
}

async function ownedLink(userId, linkId) {
  const r = await dal.get('SELECT * FROM call_links WHERE id = ?', Number(linkId));
  if (!r || r.created_by !== userId) throw err('not_found', 'Ссылка не найдена', 404);
  return r;
}
// Удаление закрывает вход новым гостям; идущий звонок продолжается, а запись уберёт уборка, когда он закончится
async function remove(userId, linkId) {
  const r = await ownedLink(userId, linkId);
  await dal.run('UPDATE call_links SET closed_at = ? WHERE id = ? AND closed_at IS NULL', now(), r.id);
  await purge();
  return { ok: true, live: live.has(r.id) };
}
async function endByOwner(userId, linkId) {
  const r = await ownedLink(userId, linkId);
  const c = live.get(r.id);
  if (!c) throw err('gone', 'Звонок не идёт', 404);
  await finish(c, 'ended');
  return { ok: true };
}

// ── Ожидающие ──
const waitingOf = async linkId => (await dal.all("SELECT id, name, asked_at FROM call_link_guests WHERE link_id = ? AND status = 'wait' AND asked_at > ? ORDER BY asked_at", linkId, now() - WAIT_SEC)).map(g => ({ id: g.id, name: g.name, at: g.asked_at }));
const people = c => [...[...c.emp].map(u => ({ key: 'u' + u, name: c.names.get('u' + u) || '', guest: false })), ...[...c.guests].map(([g, v]) => ({ key: 'g' + g, name: v.name, guest: true }))];

// Всем сотрудникам в звонке — состав; администратору ещё и список ожидающих
async function tell(c) {
  const waiting = await waitingOf(c.linkId), list = people(c);
  for (const u of c.emp) ws().sendTo(u, { type: 'call_link', event: 'update', link_id: c.linkId, call_id: c.id, participants: list, ...(u === c.ownerId ? { waiting } : {}) });
}
async function tellOwnerWaiting(link, guest) {
  const c = live.get(link.id);
  if (c && c.emp.has(link.created_by)) return tell(c);
  ws().sendTo(link.created_by, { type: 'call_link', event: 'waiting', link_id: link.id, guest: { id: guest.id, name: guest.name } });
  // Администратора нет в звонке: уведомление, не чаще раза в 10 минут на ссылку
  if (Date.now() - (lastPush.get(link.id) || 0) > PUSH_GAP) {
    lastPush.set(link.id, Date.now());
    calls.pushCall(link.created_by, { title: 'Гость ждёт в звонке', body: guest.name });
  }
}

// ── Сотрудники ──
async function joinEmployee(user, token, page) {
  const link = await dal.get('SELECT * FROM call_links WHERE token = ?', String(token || ''));
  if (!link) throw err('not_found', 'Ссылка не найдена или срок её действия закончился', 404);
  let c = live.get(link.id);
  if (closed(link) && !c) throw err('expired', 'Срок действия ссылки закончился', 410);
  const cfg = await setup();
  const p = await calls.getPrefs(user.id);
  if (!p.enabled || !p.video) throw err('prefs_self', 'У вас выключены видеозвонки в настройках', 403);
  if (c && c.banned.has(user.id)) throw err('kicked', 'Вас исключили из этого звонка', 403);
  const mine = calls.busy.get(user.id);
  if (mine && mine !== callId(link.id)) throw err('in_call', 'Вы уже в звонке');
  if (!c) {
    c = { id: callId(link.id), linkId: link.id, room: link.room, ownerId: link.created_by, emp: new Set(), page: new Map(), guests: new Map(), names: new Map(), banned: new Set(), createdAt: now(), startedAt: Date.now(), det: null };
    live.set(link.id, c);
  }
  const micOnly = c.emp.size + c.guests.size >= calls.GROUP_MAX && !c.emp.has(user.id);
  c.emp.add(user.id); calls.busy.set(user.id, c.id);
  // Со страницы звонка в браузере у человека нет соединения с сервером чата: о том, что он на месте, сообщает сама страница (beat)
  if (page) c.page.set(user.id, Date.now()); else c.page.delete(user.id);
  c.names.set('u' + user.id, user.display_name || '');
  calls.note(c, 'join', user);
  await tell(c);
  return {
    call_id: c.id, link_id: link.id, video: true, owner: user.id === c.ownerId, mic_only: micOnly || undefined, participants: people(c),
    waiting: user.id === c.ownerId ? await waitingOf(link.id) : undefined,
    url: cfg.url, cert_fp: cfg.certFp || undefined, quality: (await calls.getQuality()).group,
    token: calls.signToken(cfg, { identity: 'u' + user.id, name: user.display_name, room: c.room, micOnly }),
  };
}
async function leave(userId, reason) {
  const c = byUser(userId);
  if (!c || !c.emp.has(userId)) return;
  c.emp.delete(userId); c.page.delete(userId); calls.note(c, 'leave', userId);
  if (calls.busy.get(userId) === c.id) calls.busy.delete(userId);
  await afterLeave(c, reason);
}
async function afterLeave(c, reason) {
  if (!c.emp.size && !c.guests.size) return finish(c, reason === 'dropped' ? 'ended' : reason || 'ended');
  await tell(c);
}

// Звонок закончился: комната закрывается, журнал, гости «впущенные» снова должны просить
async function finish(c, reason) {
  if (live.get(c.linkId) !== c) return;
  live.delete(c.linkId);
  for (const u of c.emp) { if (calls.busy.get(u) === c.id) calls.busy.delete(u); ws().sendTo(u, { type: 'call_ended', call_id: c.id, video: true, reason: reason === 'ended' ? 'ended' : reason, duration: 0 }); }
  await calls.killRoom(c.room);
  try {
    await dal.run("UPDATE call_link_guests SET status = 'idle' WHERE link_id = ? AND status = 'in'", c.linkId);
    const names = [...c.names.values(), ...[...(c.gnames || new Map()).values()].map(n => n + ' (гость)')];
    calls.logCall({ callerId: c.ownerId, video: true, startedAt: c.createdAt, answered: true, duration: Math.round((Date.now() - c.startedAt) / 1000), reason: 'link', kind: 'group', det: c.det, members: names });
  } catch (e) { console.warn('[Ссылки на звонок] завершение:', e.message); }
  await purge();
}
async function endAll(reason) { for (const c of [...live.values()]) await finish(c, reason); }
async function adminEnd(id) { const c = has(id) && live.get(Number(id.slice(5))); if (!c) return false; await finish(c, 'admin'); return true; }

function activeRows() {
  return [...live.values()].map(c => ({ id: c.id, kind: 'conf', state: 'active', video: true, since: c.startedAt, link: true, people: people(c).map(p => p.name + (p.guest ? ' (гость)' : '')) }));
}

function beat(userId) { const c = byUser(userId); if (c && c.page.has(userId)) c.page.set(userId, Date.now()); }

// Состояние для администратора: кто ждёт и кто в звонке (страница звонка опрашивает его)
async function ownerState(userId, linkId) {
  const link = await ownedLink(userId, linkId), c = live.get(link.id);
  if (c && c.page.has(userId)) c.page.set(userId, Date.now());
  return { in_call: !!c && c.emp.has(userId), waiting: await waitingOf(link.id), participants: c ? people(c) : [] };
}

// ── Решения администратора ──
async function ownerCall(userId, linkId) {
  const link = await ownedLink(userId, linkId), c = live.get(link.id);
  if (!c || !c.emp.has(userId)) throw err('not_in_call', 'Сначала подключитесь к звонку', 409);
  return { link, c };
}
async function admit(userId, linkId, guestId) {
  const { link, c } = await ownerCall(userId, linkId);
  const where = guestId === 'all' ? '' : ' AND id = ' + Number(guestId);
  const r = await dal.run(`UPDATE call_link_guests SET status = 'in' WHERE link_id = ? AND status = 'wait' AND asked_at > ?${where}`, link.id, now() - WAIT_SEC);
  calls.note(c, 'admit', userId);
  await tell(c);
  return { ok: true, admitted: r.changes };
}
async function reject(userId, linkId, guestId) {
  const link = await ownedLink(userId, linkId);
  const r = await dal.run("UPDATE call_link_guests SET status = 'rejected' WHERE id = ? AND link_id = ? AND status = 'wait'", Number(guestId), link.id);
  const c = live.get(link.id); if (c) await tell(c);
  return { ok: true, rejected: r.changes };
}
// Исключить участника с плитки: key вида g<номер> (гость) или u<номер> (сотрудник)
async function kick(userId, linkId, key) {
  const { link, c } = await ownerCall(userId, linkId);
  const m = /^([gu])(\d+)$/.exec(String(key || ''));
  if (!m) throw err('bad_key', 'Не указан участник', 400);
  const id = Number(m[2]);
  if (m[1] === 'u') {
    if (id === c.ownerId) throw err('bad_key', 'Себя исключить нельзя', 400);
    if (!c.emp.has(id)) throw err('gone', 'Участника уже нет в звонке', 404);
    c.banned.add(id);
    ws().sendTo(id, { type: 'call_ended', call_id: c.id, video: true, reason: 'kicked', duration: 0 });
    c.emp.delete(id); c.page.delete(id); if (calls.busy.get(id) === c.id) calls.busy.delete(id);
    calls.note(c, 'kick', userId, id);
  } else {
    if (!c.guests.delete(id)) throw err('gone', 'Участника уже нет в звонке', 404);
    await dal.run("UPDATE call_link_guests SET status = 'kicked' WHERE id = ? AND link_id = ?", id, link.id);
    calls.note(c, 'kick', userId);
  }
  await calls.removeParticipant(c.room, key);
  await afterLeave(c);
  return { ok: true };
}

// ── Гости ──
const gcheck = (token, dk) => dal.get('SELECT g.*, l.created_by, l.expires_at, l.closed_at, l.room AS link_room, l.id AS lid FROM call_link_guests g JOIN call_links l ON l.id = g.link_id WHERE l.token = ? AND g.device_hash = ?', String(token || ''), sha(dk || ''));

// Сведения о ссылке для страницы гостя: до ввода имени
async function peek(token) {
  const link = await dal.get('SELECT l.*, u.display_name AS owner FROM call_links l JOIN users u ON u.id = l.created_by WHERE l.token = ?', String(token || ''));
  if (!link) return { status: 404, code: 'not_found' };
  if (closed(link) && !live.has(link.id)) return { status: 410, code: 'expired' };
  return { status: 200, owner: link.owner, expires_at: link.expires_at, live: live.has(link.id), closed: closed(link) };
}

// Гость просит впустить. Первый раз — с именем, дальше — по ключу устройства
async function guestJoin(token, name, dk) {
  const link = await dal.get('SELECT * FROM call_links WHERE token = ?', String(token || ''));
  if (!link) return { status: 404, code: 'not_found' };
  const c = live.get(link.id), found = dk ? await gcheck(token, dk) : null;
  if (found) {
    if (found.status === 'rejected' || found.status === 'kicked') return { status: 200, state: found.status, name: found.name, device_key: dk };
    if (found.status === 'in' && c) return { status: 200, state: 'in', name: found.name, device_key: dk };
    // Просит заново: прошло ожидание, звонок закончился или он ещё не был впущен
    if (closed(link) && !c) return { status: 410, code: 'expired' };
    if (found.status === 'in' || found.status === 'idle' || found.asked_at <= now() - WAIT_SEC) {
      if (closed(link)) return { status: 410, code: 'expired' };
      await dal.run("UPDATE call_link_guests SET status = 'wait', asked_at = ? WHERE id = ?", now(), found.id);
      await tellOwnerWaiting(link, found);
    }
    return { status: 200, state: 'wait', name: found.name, device_key: dk };
  }
  if (closed(link)) return { status: 410, code: 'expired' };
  const nm = guestLib.cleanName(name);
  if (!nm) return { status: 400, code: 'name_required' };
  if ((await waitingOf(link.id)).length >= MAX_WAITING) return { status: 429, code: 'busy' };
  const key = crypto.randomBytes(24).toString('hex');
  const r = await dal.run("INSERT INTO call_link_guests (link_id, name, device_hash, status) VALUES (?, ?, ?, 'wait')", link.id, nm, sha(key));
  await tellOwnerWaiting(link, { id: r.lastInsertRowid, name: nm });
  return { status: 200, state: 'wait', name: nm, device_key: key };
}

// Опрос страницы гостя: ждёт, впущен, отклонён, исключён, время вышло, звонок закончился. Заодно это «я здесь» для впущенного
async function guestStatus(token, dk) {
  const g = await gcheck(token, dk);
  if (!g) return { status: 200, state: 'unknown' };
  const link = { id: g.lid, expires_at: g.expires_at, closed_at: g.closed_at }, c = live.get(g.lid);
  if (g.status === 'rejected' || g.status === 'kicked') return { status: 200, state: g.status };
  if (g.status === 'in') {
    if (!c) return { status: 200, state: 'ended' };
    const m = c.guests.get(g.id); if (m) m.seen = Date.now();
    return { status: 200, state: 'in', participants: people(c) };
  }
  if (g.status === 'idle') return { status: 200, state: closed(link) ? 'expired' : 'ended' };
  // wait
  if (closed(link) && !c) return { status: 200, state: 'expired' };
  if (g.asked_at <= now() - WAIT_SEC) return { status: 200, state: 'timeout', admin_in: !!(c && c.emp.has(g.created_by)) };
  return { status: 200, state: 'wait', until: g.asked_at + WAIT_SEC, admin_in: !!(c && c.emp.has(g.created_by)) };
}

// Впущенный гость заходит: токен LiveKit выдаётся только здесь и только впущенному
async function guestEnter(token, dk) {
  const g = await gcheck(token, dk);
  if (!g || g.status !== 'in') throw err('not_admitted', 'Вас ещё не впустили', 403);
  const c = live.get(g.lid);
  if (!c) throw err('ended', 'Звонок закончился', 410);
  const cfg = await setup();
  const micOnly = c.emp.size + c.guests.size >= calls.GROUP_MAX && !c.guests.has(g.id);
  if (!c.guests.has(g.id)) calls.note(c, 'join', { id: 'g' + g.id, display_name: g.name });
  (c.gnames || (c.gnames = new Map())).set(g.id, g.name);   // для журнала: гость мог уже выйти к концу звонка
  c.guests.set(g.id, { name: g.name, seen: Date.now() });
  await tell(c);
  return { call_id: c.id, video: true, mic_only: micOnly || undefined, participants: people(c), name: g.name, identity: 'g' + g.id, url: cfg.url, cert_fp: cfg.certFp || undefined, quality: (await calls.getQuality()).group,
    token: calls.signToken(cfg, { identity: 'g' + g.id, name: g.name, room: c.room, micOnly, ttl: GUEST_TOKEN_TTL }) };
}
async function guestLeave(token, dk) {
  const g = await gcheck(token, dk), c = g && live.get(g.lid);
  if (!c || !c.guests.delete(g.id)) return;
  calls.note(c, 'leave', 'g' + g.id);
  await afterLeave(c);
}

// ── Уборка ──
// Закрытые и просроченные ссылки без идущего звонка исчезают вместе с гостями: привязки устройств очищаются
async function purge() {
  const rows = await dal.all('SELECT id FROM call_links WHERE closed_at IS NOT NULL OR expires_at <= ?', now());
  for (const r of rows) {
    if (live.has(r.id)) continue;
    await dal.run('DELETE FROM call_link_guests WHERE link_id = ?', r.id);
    await dal.run('DELETE FROM call_links WHERE id = ?', r.id);
    lastPush.delete(r.id);
  }
}
async function sweep() {
  const limit = Date.now() - SEEN_SEC * 1000;
  for (const c of [...live.values()]) {
    let changed = false;
    for (const [id, v] of c.guests) if (v.seen < limit) { c.guests.delete(id); calls.note(c, 'leave', 'g' + id); changed = true; }
    for (const [u, t] of c.page) if (t < limit) { c.page.delete(u); c.emp.delete(u); if (calls.busy.get(u) === c.id) calls.busy.delete(u); calls.note(c, 'leave', u); changed = true; }
    if (changed) await afterLeave(c, 'dropped');
  }
  await purge();
}
let timer = null;
function startScheduler() {
  // После перезапуска звонков нет: впущенные гости снова должны просить
  dal.run("UPDATE call_link_guests SET status = 'idle' WHERE status = 'in'").then(purge).catch(e => console.warn('[Ссылки на звонок] запуск:', e.message));
  if (timer) clearInterval(timer);
  timer = setInterval(() => sweep().catch(e => console.warn('[Ссылки на звонок] уборка:', e.message)), Number(process.env.CALLLINK_TICK_MS) || 15_000);
  timer.unref();
}

module.exports = { beat, ownerState, canCreate, create, list, remove, endByOwner, joinEmployee, leave, has, admit, reject, kick, peek, guestJoin, guestStatus, guestEnter, guestLeave, activeRows, adminEnd, endAll, startScheduler, waitingOf, ownedLink, MAX_TTL, DEF_TTL };
