'use strict';
// Дополнительные пары ключей LiveKit для других серверов чата («Настройки → Звонки → Доступ для других серверов»).
//
// Каждому постороннему серверу, которому разрешили пользоваться нашим сервером звонков, выдаётся своя пара «API key + секрет»,
// записанная в конфиг LiveKit рядом с основной. Любую пару можно отозвать отдельно, остальные продолжают работать. LiveKit читает
// ключи только при запуске, поэтому создание и отзыв перезапускают его на несколько секунд (идущие звонки прерываются).
//
// Менять конфиг LiveKit приходится по SSH. Чтобы не спрашивать пароль каждый раз, один раз (по паролю) на сервер LiveKit
// ставится скрипт livekit-keys.sh и ограниченный ключ ed25519: в authorized_keys он записан как restrict,command=..., то есть
// умеет только добавлять и удалять пары и перезапускать LiveKit. Закрытая часть ключа лежит здесь, в базе, в зашифрованном виде.
// Пароль от сервера LiveKit нигде не сохраняется.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { utils } = require('ssh2');
const dal = require('./dal');
const lk = require('./lkinstall');
const calls = require('./calls');

const SCRIPT = process.env.ELECTRON_LK_KEYS || path.join(__dirname, '..', 'livekit-keys.sh');
const REMOTE = '/usr/local/sbin/livekit-keys';
const MARK = 'electron-chat-livekit-keys';   // метка строки в authorized_keys
const K_LIST = 'calls_keys', K_SSH = 'calls_ssh';
const getS = async k => (await dal.get('SELECT value FROM settings WHERE key = ?', k))?.value ?? null;
const setS = (k, v) => dal.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, String(v));
const delS = k => dal.run('DELETE FROM settings WHERE key = ?', k);

// Секреты пар и закрытый ключ шифруются ключом, выведенным из секрета сервера (jwt_secret или JWT_SECRET)
async function encKey() { return crypto.createHash('sha256').update('lkkeys|' + (process.env.JWT_SECRET || (await getS('jwt_secret')) || '')).digest(); }
async function seal(txt) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', await encKey(), iv);
  const b = Buffer.concat([c.update(String(txt), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), b].map(x => x.toString('base64')).join('.');
}
async function unseal(s) {
  const [iv, tag, b] = String(s).split('.').map(x => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', await encKey(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(b), d.final()]).toString('utf8');
}
const json = async (k, d) => { try { return JSON.parse((await getS(k)) || 'null') ?? d; } catch { return d; } };

let busy = false;   // создание, отзыв и настройка идут по одному: каждое перезапускает LiveKit
async function exclusive(fn) {
  if (busy) return { error: 'Другое действие с ключами ещё выполняется, подождите несколько секунд', status: 409 };
  busy = true;
  try { return await fn(); } finally { busy = false; }
}

const rnd = (n, abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789') => Array.from(crypto.randomBytes(n), b => abc[b % abc.length]).join('');
const hostOf = url => { try { return new URL(String(url).replace(/^ws/i, 'http')).hostname; } catch { return ''; } };
const pubFp = pub => 'SHA256:' + crypto.createHash('sha256').update(Buffer.from(String(pub).split(' ')[1] || '', 'base64')).digest('base64').replace(/=+$/, '');
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

// ── что показать в админке ──
async function view() {
  const [ssh, keys, cfg] = await Promise.all([json(K_SSH, null), json(K_LIST, []), calls.getConfig()]);
  let live = 0; try { live = (await calls.activeList()).filter(c => c.state === 'active').length; } catch {}
  return {
    ssh: ssh ? { on: true, host: ssh.host, port: ssh.port, user: ssh.user, fp: ssh.pubFp, since: ssh.since } : { on: false },
    keys: keys.map(k => ({ id: k.id, name: k.name, key: k.key, created: k.created, off: !!k.off, when: k.when || null })),
    live, url: cfg.url || '', host: hostOf(cfg.url),
  };
}

// ── вход по сохранённому ключу ──
async function remote(cmd) {
  const ssh = await json(K_SSH, null);
  if (!ssh) throw new Error('Управление без пароля не настроено');
  let priv; try { priv = await unseal(ssh.priv); } catch { throw new Error('Сохранённый ключ не читается: настройте управление без пароля заново'); }
  let conn;
  try {
    conn = await withTimeout(lk.connect({ host: ssh.host, port: ssh.port, user: ssh.user, privateKey: priv }, ssh.hostFp), 20000, 'Сервер LiveKit не отвечает');
    const out = await withTimeout(lk.collect(conn.cl, cmd), 60000, 'LiveKit не ответил за минуту');
    const line = String(out).trim().split('\n').filter(Boolean).pop() || '';
    if (!line.startsWith('OK|')) throw new Error(line.startsWith('ERR|') ? line.slice(4) : 'Неожиданный ответ сервера LiveKit');
    return line.slice(3);
  } catch (e) {
    throw new Error(/All configured authentication methods failed/i.test(e.message) ? 'Сервер LiveKit больше не принимает ключ: настройте управление без пароля заново' : e.message);
  } finally { try { conn?.cl.end(); } catch {} }
}

// ── настройка и отключение входа без пароля ──
async function sshOn(o) {
  const fingerprint = String(o?.fingerprint || '');
  if (!fingerprint) return { error: 'Сначала проверьте подключение и подтвердите отпечаток сервера' };
  const c = lk.clean({ host: o.host, port: o.port, user: o.user, password: o.password });
  if (c.error) return c;
  if (c.user !== 'root') return { error: 'Нужен вход под root: скрипту нужны права на перезапуск службы' };
  if (!fs.existsSync(SCRIPT)) return { error: 'Не найден скрипт livekit-keys.sh' };
  return exclusive(async () => {
    let conn;
    try {
      conn = await lk.connect(c, fingerprint);
      const kp = utils.generateKeyPairSync('ed25519', { comment: MARK });
      const up = await lk.exec(conn.cl, `umask 022; cat > ${REMOTE}.new && chmod 755 ${REMOTE}.new && mv ${REMOTE}.new ${REMOTE}`);
      up.resume(); up.stderr.resume();
      const closed = new Promise(r => up.on('close', r));
      up.end(fs.readFileSync(SCRIPT));
      await closed;
      const line = `restrict,command="${REMOTE}" ${kp.public.trim()}`;
      await lk.collect(conn.cl, `umask 077; mkdir -p "$HOME/.ssh" && touch "$HOME/.ssh/authorized_keys" && sed -i '/${MARK}/d' "$HOME/.ssh/authorized_keys" && printf '%s\\n' '${line}' >> "$HOME/.ssh/authorized_keys"; mkdir -p /etc/livekit; [ -f /etc/livekit/extra-keys.txt ] || : > /etc/livekit/extra-keys.txt`);
      // Проверка: входим уже по ключу, без пароля
      let test;
      try {
        test = await lk.connect({ host: c.host, port: c.port, user: c.user, privateKey: kp.private }, fingerprint);
        const out = String(await lk.collect(test.cl, 'ping')).trim();
        if (!out.endsWith('OK|pong')) throw new Error(out.startsWith('ERR|') ? out.slice(4) : 'Ключ не сработал на сервере');
      } catch (e) {
        await lk.collect(conn.cl, `sed -i '/${MARK}/d' "$HOME/.ssh/authorized_keys"`).catch(() => {});
        return { error: 'Не удалось войти по новому ключу: ' + e.message };
      } finally { try { test?.cl.end(); } catch {} }
      await setS(K_SSH, JSON.stringify({ host: c.host, port: c.port, user: c.user, hostFp: fingerprint, priv: await seal(kp.private), pubFp: pubFp(kp.public), since: new Date().toISOString() }));
      return { ok: true, view: await view() };
    } catch (e) { return { error: e.message }; }
    finally { try { conn?.cl.end(); } catch {} }
  });
}
// Убирает ключ с сервера LiveKit (нужен пароль) и стирает его у нас; localOnly — только у нас, если сервер недоступен
async function sshOff(o) {
  const ssh = await json(K_SSH, null);
  if (!ssh) return { ok: true, view: await view() };
  return exclusive(async () => {
    if (!o?.localOnly) {
      const c = lk.clean({ host: ssh.host, port: ssh.port, user: ssh.user, password: o?.password });
      if (c.error) return c;
      let conn;
      try {
        conn = await lk.connect(c, ssh.hostFp);
        await lk.collect(conn.cl, `sed -i '/${MARK}/d' "$HOME/.ssh/authorized_keys"`);
      } catch (e) { return { error: e.message, can_local: true }; }
      finally { try { conn?.cl.end(); } catch {} }
    }
    await delS(K_SSH);
    return { ok: true, view: await view() };
  });
}

// ── пары ──
async function create(name) {
  name = String(name || '').trim().slice(0, 60);
  if (!name) return { error: 'Укажите название сервера' };
  return exclusive(async () => {
    const keys = await json(K_LIST, []);
    if (keys.some(k => !k.off && k.name.toLowerCase() === name.toLowerCase())) return { error: 'Пара с таким названием уже есть' };
    const key = 'API' + rnd(12), secret = rnd(40);
    try { await remote(`add ${key} ${secret}`); } catch (e) { return { error: e.message }; }
    const rec = { id: crypto.randomBytes(6).toString('hex'), name, key, secret: await seal(secret), created: new Date().toISOString() };
    keys.unshift(rec);
    await setS(K_LIST, JSON.stringify(keys));
    const cfg = await calls.getConfig();
    return { ok: true, id: rec.id, name, url: cfg.url, key, secret, view: await view() };
  });
}
async function revoke(id) {
  return exclusive(async () => {
    const keys = await json(K_LIST, []), k = keys.find(x => x.id === id);
    if (!k) return { error: 'Пара не найдена', status: 404 };
    if (k.off) return { error: 'Эта пара уже отозвана' };
    try { await remote(`del ${k.key}`); } catch (e) { return { error: e.message }; }
    k.off = true; k.when = new Date().toISOString();
    await setS(K_LIST, JSON.stringify(keys));
    return { ok: true, name: k.name, view: await view() };
  });
}
async function reveal(id) {
  const k = (await json(K_LIST, [])).find(x => x.id === id);
  if (!k) return { error: 'Пара не найдена', status: 404 };
  if (k.off) return { error: 'Пара отозвана' };
  const cfg = await calls.getConfig();
  return { name: k.name, url: cfg.url, key: k.key, secret: await unseal(k.secret) };
}
// Отозванную пару можно убрать из списка (с сервера LiveKit она уже удалена)
async function purge(id) {
  const keys = await json(K_LIST, []), k = keys.find(x => x.id === id);
  if (!k) return { error: 'Пара не найдена', status: 404 };
  if (!k.off) return { error: 'Сначала отзовите пару' };
  await setS(K_LIST, JSON.stringify(keys.filter(x => x.id !== id)));
  return { ok: true, view: await view() };
}
const nameOf = async id => (await json(K_LIST, [])).find(x => x.id === id)?.name || '';

module.exports = { view, sshOn, sshOff, create, revoke, reveal, purge, nameOf };
