'use strict';
// ── КЛЮЧИ УСТРОЙСТВ ──
//
// Вход по паролю выдаёт клиенту ключ его устройства (пара «человек + устройство»). Если токен потом не принят
// (истёк, сервер переустановлен и т. п.), клиент входит по ключу сам, и пароль нигде не хранится.
//   · device  — ключ устройства: один на пару (человек, device_id); повторный вход с того же устройства обновляет ключ;
//   · profile — ключ профиля на сетевом диске («Высокая доступность»): им новый компьютер регистрирует своё устройство
//               и входит без пароля. В чат по нему не войти, он только выдаёт ключи устройств.
// Приложение (app) хранит ключ зашифрованным на компьютере и без срока. Браузер (web) и телефон (mobile) хранят его в хранилище страницы,
// поэтому он гаснет через 90 дней без использования (WEB_IDLE_DAYS).
// Ротация: при каждом входе по ключу устройство получает новый ключ, а прежний остаётся действующим ещё GRACE_SEC секунд (на случай,
// когда ответ с новым ключом потерялся). Прежний ключ позже этого срока означает, что у кого-то есть копия: устройство отзывается.
// В базе только хеш ключа. Отзыв устройства закрывает и токены, выданные этому устройству (в токене лежит номер ключа, см. auth.js).
// Отозванный ключ профиля — запрет регистрации новых компьютеров; уже зарегистрированные продолжают работать.

const crypto = require('crypto');
const dal = require('./dal');

const WEB_IDLE_DAYS = 90;
// Адрес клиента без префикса IPv4-в-IPv6 («::ffff:1.2.3.4»)
const cleanIp = ip => String(ip || '').replace(/^::ffff:/i, '').slice(0, 64) || null;
const GRACE_SEC = 300;
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const now = () => Math.floor(Date.now() / 1000);
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const newKey = prefix => prefix + crypto.randomBytes(32).toString('base64url');

// Сведения об устройстве из тела запроса: id (постоянный номер установки), имя компьютера, пользователь Windows
function parseDevice(d) {
  if (!d || typeof d !== 'object') return null;
  const id = String(d.id || '');
  if (!/^[\w-]{8,64}$/.test(id)) return null;
  const platform = ['web', 'mobile'].includes(d.platform) ? d.platform : 'app';
  return { id, platform, name: clean(d.name, 80) || 'Устройство', os_user: clean(d.os_user, 80) };
}
// Ключ браузера или телефона не использовался дольше срока
function idleExpired(row) {
  return row.kind === 'device' && row.platform !== 'app' && now() - (row.last_used_at || row.created_at) > WEB_IDLE_DAYS * 86400;
}

// Ключ устройства для пары (человек, устройство). Есть действующий — меняем его ключ (старый перестаёт работать), дата регистрации остаётся
async function issueDevice(userId, dev, parentId = null, ip = null) {
  ip = cleanIp(ip);
  const key = newKey('dk_'), t = now();
  const cur = await dal.get("SELECT id FROM device_keys WHERE user_id = ? AND kind = 'device' AND device_id = ? AND revoked_at IS NULL", userId, dev.id);
  if (cur) {
    await dal.run('UPDATE device_keys SET key_hash = ?, prev_hash = NULL, prev_at = NULL, platform = ?, name = ?, os_user = ?, last_used_at = ?, last_ip = COALESCE(?, last_ip), parent_id = COALESCE(?, parent_id) WHERE id = ?', sha(key), dev.platform, dev.name, dev.os_user, t, ip, parentId, cur.id);
    return { key, id: cur.id, created: false };
  }
  // Устройство вошло снова после отзыва: прежние отозванные записи этой пары больше не нужны
  await dal.run("DELETE FROM device_keys WHERE user_id = ? AND kind = 'device' AND device_id = ? AND revoked_at IS NOT NULL", userId, dev.id);
  const r = await dal.run("INSERT INTO device_keys (user_id, kind, device_id, platform, name, os_user, key_hash, parent_id, created_at, last_used_at, ip, last_ip) VALUES (?, 'device', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    userId, dev.id, dev.platform, dev.name, dev.os_user, sha(key), parentId, t, t, ip, ip);
  return { key, id: Number(r.lastInsertRowid), created: true };
}

// Найти ключ устройства: действующий или прежний (после ротации). Ничего не меняет. { row, via: 'cur' | 'prev', hash } или { code }
async function lookupDevice(key) {
  if (typeof key !== 'string' || key.length < 20 || key.length > 100) return { code: 'device_unknown' };
  const h = sha(key);
  const row = await dal.get("SELECT * FROM device_keys WHERE kind = 'device' AND (key_hash = ? OR prev_hash = ?)", h, h);
  if (!row) return { code: 'device_unknown' };
  if (row.revoked_at) return { code: 'device_revoked' };
  if (idleExpired(row)) return { code: 'device_expired' };
  return { row, via: row.key_hash === h ? 'cur' : 'prev', hash: h };
}
// Обменять ключ на новый. Действующий: меняем (прежним становится он). Прежний в пределах GRACE_SEC: повтор после потерянного ответа, меняем
// снова. Прежний позже: у кого-то есть копия, устройство отзывается. Обмен идёт «с проверкой»: при двух одновременных запросах побеждает
// один, второй находит уже обновлённую строку и обрабатывается как повтор.
// check(row) — проверки вызывающего до обмена (устройство, пользователь): вернуть null или { code, status, error }
async function consumeDevice(key, check) {
  for (let i = 0; i < 3; i++) {
    const f = await lookupDevice(key);
    if (f.code) return f;
    const bad = check ? await check(f.row) : null;
    if (bad) return bad;
    const t = now();
    if (f.via === 'prev' && t - (f.row.prev_at || 0) > GRACE_SEC) {
      await dal.run('UPDATE device_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', t, f.row.id);
      kickLive(f.row.user_id, f.row.id);
      try { await require('./audit').logAudit({ user: { id: f.row.user_id }, ip: null }, 'security', 'Повторное использование ключа устройства: устройство отозвано', f.row.name); } catch {}
      require('./notify').deviceReuse(f.row.user_id, f.row.name).catch(e => console.warn('[Electron] уведомление:', e.message));
      return { code: 'device_reuse', row: f.row };
    }
    const nk = newKey('dk_');
    const r = await dal.run(`UPDATE device_keys SET prev_hash = key_hash, prev_at = ?, key_hash = ?, last_used_at = ? WHERE id = ? AND ${f.via === 'cur' ? 'key_hash' : 'prev_hash'} = ?`, t, sha(nk), t, f.row.id, f.hash);
    if (r.changes) return { row: f.row, key: nk };
  }
  return { code: 'device_unknown' };
}

// Ключ профиля для пары (человек, пользователь Windows). Если администратор запретил регистрацию (строка отозвана), новый не выдаётся
async function issueProfile(userId, osUser) {
  const os = clean(osUser, 80);
  if (!os) return null;
  const rows = await dal.all("SELECT id, revoked_at FROM device_keys WHERE user_id = ? AND kind = 'profile' AND os_user = ?", userId, os);
  if (rows.some(r => r.revoked_at)) return null;
  const key = newKey('pk_'), t = now();
  if (rows.length) { await dal.run('UPDATE device_keys SET key_hash = ?, last_used_at = ? WHERE id = ?', sha(key), t, rows[0].id); return { key, id: rows[0].id }; }
  const r = await dal.run("INSERT INTO device_keys (user_id, kind, device_id, name, os_user, key_hash, created_at, last_used_at) VALUES (?, 'profile', NULL, ?, ?, ?, ?, ?)", userId, 'Профиль на сетевом диске', os, sha(key), t, t);
  return { key, id: Number(r.lastInsertRowid) };
}

// Строка по ключу нужного вида: { row } или { code } — device_revoked / profile_revoked / device_unknown
async function find(key, kind) {
  if (typeof key !== 'string' || key.length < 20 || key.length > 100) return { code: 'device_unknown' };
  const row = await dal.get('SELECT * FROM device_keys WHERE key_hash = ?', sha(key));
  if (!row || row.kind !== kind) return { code: 'device_unknown' };
  if (row.revoked_at) return { code: kind === 'profile' ? 'profile_revoked' : 'device_revoked' };
  if (idleExpired(row)) return { code: 'device_expired' };
  return { row };
}

const touch = id => dal.run('UPDATE device_keys SET last_used_at = ? WHERE id = ?', now(), id);

// Для проверки токена: ключ, по которому выдан токен, ещё действует
async function alive(id) {
  const r = await dal.get('SELECT revoked_at FROM device_keys WHERE id = ?', id);
  return !!r && !r.revoked_at;
}

// Число действующих устройств у каждого человека: не отозваны, ключ браузера или телефона не просрочен
async function activeCounts() {
  const rows = await dal.all("SELECT user_id, COUNT(*) AS n FROM device_keys WHERE kind = 'device' AND revoked_at IS NULL AND (platform = 'app' OR COALESCE(last_used_at, created_at) >= ?) GROUP BY user_id", now() - WEB_IDLE_DAYS * 86400);
  return new Map(rows.map(r => [r.user_id, Number(r.n)]));
}
// Убрать отозванное устройство из списка совсем (профиль снимается через allow). Действующее удалять нельзя
async function remove(userId, id) {
  const r = await dal.run("DELETE FROM device_keys WHERE id = ? AND user_id = ? AND kind = 'device' AND revoked_at IS NOT NULL", id, userId);
  return r.changes > 0;
}

// Явный выход с устройства: ключ перестаёт существовать
async function forget(row) { await dal.run('DELETE FROM device_keys WHERE id = ?', row.id); }

async function list(userId) {
  const rows = await dal.all("SELECT id, kind, platform, name, os_user, last_ip, created_at, last_used_at, revoked_at FROM device_keys WHERE user_id = ? ORDER BY CASE kind WHEN 'profile' THEN 0 ELSE 1 END, created_at DESC, id DESC", userId);
  return rows.map(r => ({ ...r, expired: !r.revoked_at && idleExpired(r) }));
}

function kickLive(userId, id) { try { require('./ws').kickDevice(userId, id); } catch {} }

// Отозвать один ключ. Устройство: закрываются и его соединения. Профиль: запрет регистрации новых устройств
async function revoke(userId, id) {
  const row = await dal.get('SELECT * FROM device_keys WHERE id = ? AND user_id = ?', id, userId);
  if (!row) return null;
  if (!row.revoked_at) await dal.run('UPDATE device_keys SET revoked_at = ? WHERE id = ?', now(), id);
  if (row.kind === 'device') kickLive(userId, id);
  return row;
}
// Разрешить регистрацию снова: отозванная строка профиля удаляется, следующий вход по паролю в режиме HA выдаст новый ключ
async function allow(userId, id) {
  const r = await dal.run("DELETE FROM device_keys WHERE id = ? AND user_id = ? AND kind = 'profile' AND revoked_at IS NOT NULL", id, userId);
  return r.changes > 0;
}
// Отозвать всё: и устройства, и профиль
async function revokeAll(userId) {
  const rows = await dal.all('SELECT id, kind FROM device_keys WHERE user_id = ? AND revoked_at IS NULL', userId);
  await dal.run('UPDATE device_keys SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', now(), userId);
  rows.filter(r => r.kind === 'device').forEach(r => kickLive(userId, r.id));
  return rows.length;
}
// Смена пароля: все ключи удаляются, кроме ключа устройства, с которого пароль сменили (его токен остаётся действующим)
async function wipe(userId, keepId) {
  if (keepId) await dal.run("DELETE FROM device_keys WHERE user_id = ? AND id != ? AND NOT (kind = 'profile' AND revoked_at IS NOT NULL)", userId, keepId);
  else await dal.run("DELETE FROM device_keys WHERE user_id = ? AND NOT (kind = 'profile' AND revoked_at IS NOT NULL)", userId);
}

module.exports = { cleanIp, lookupDevice, consumeDevice, parseDevice, issueDevice, issueProfile, find, touch, alive, forget, list, revoke, allow, remove, activeCounts, revokeAll, wipe };
