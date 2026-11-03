// Установка сервера LiveKit на другую машину по SSH (раздел «Звонки» в настройках админки).
//
// Администратор указывает адрес, логин и пароль чистого сервера. Сначала проверка подключения: показываем отпечаток
// ключа хоста и систему, администратор подтверждает, что это тот самый сервер. Потом по SSH запускается livekit-setup.sh
// (он же годится для ручной установки), ход которого читается построчно, как у pg-setup.sh. Пароль от машины живёт
// только в памяти на время одного подключения: ни в базу, ни в журнал он не попадает.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const { Client } = require('ssh2');

const SCRIPT = process.env.ELECTRON_LK_SETUP || path.join(__dirname, '..', 'livekit-setup.sh');
const REMOTE = '/root/.livekit-setup.sh';
const MAX_MS = 15 * 60 * 1000;

let job = null;   // { state: running | done | failed, pct, stage, text, error, result, log: [] }
const pub = () => job && { state: job.state, pct: job.pct, stage: job.stage, text: job.text, error: job.error, result: job.result && { url: job.result.url, public: job.result.public, proxy: !!job.result.proxy, local: !!job.result.local, domain: job.result.domain, ip: job.result.ip }, log: job.log.slice(-20) };

// Что-то вроде SHA256:AbCd…, как показывает ssh
const fpOf = hex => 'SHA256:' + Buffer.from(hex, 'hex').toString('base64').replace(/=+$/, '');

function clean(o) {
  const host = String(o?.host || '').trim(), port = Number(o?.port) || 22, user = String(o?.user || 'root').trim() || 'root', password = String(o?.password || '');
  if (!/^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$|^[0-9a-fA-F:]+$/.test(host)) return { error: 'Укажите адрес сервера: IP или имя' };
  if (port < 1 || port > 65535) return { error: 'Порт должен быть от 1 до 65535' };
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(user)) return { error: 'Некорректный логин' };
  if (!password) return { error: 'Введите пароль' };
  return { host, port, user, password };
}

function connect(c, fingerprint) {
  return new Promise((resolve, reject) => {
    const cl = new Client();
    let seen = null, done = false;
    const fin = (fn, v) => { if (done) return; done = true; fn(v); };
    cl.on('ready', () => fin(resolve, { cl, fp: seen }));
    cl.on('keyboard-interactive', (n, i, l, prompts, finish) => finish(prompts.map(() => c.password)));
    cl.on('error', e => {
      const m = String(e.message || e);
      fin(reject, new Error(/All configured authentication methods failed/i.test(m) ? 'Неверный логин или пароль'
        : /ECONNREFUSED/.test(m) ? 'Сервер не принимает подключения на этом порту'
        : /ETIMEDOUT|Timed out while waiting for handshake|EHOSTUNREACH|ENETUNREACH/.test(m) ? 'Сервер не отвечает: проверьте адрес и порт'
        : /ENOTFOUND/.test(m) ? 'Не удалось найти такой сервер'
        : 'Не удалось подключиться: ' + m));
    });
    cl.connect({
      host: c.host, port: c.port, username: c.user, password: c.password, tryKeyboard: true, readyTimeout: 15000, keepaliveInterval: 10000,
      hostHash: 'sha256',
      hostVerifier: hex => { seen = fpOf(hex); if (fingerprint && fingerprint !== seen) { fin(reject, new Error('Отпечаток сервера не совпал с подтверждённым: подключение остановлено')); return false; } return true; },
    });
  });
}
const exec = (cl, cmd) => new Promise((resolve, reject) => cl.exec(cmd, (e, s) => (e ? reject(e) : resolve(s))));
const collect = async (cl, cmd) => { const s = await exec(cl, cmd); let out = ''; s.on('data', d => { out += d; }); s.stderr.on('data', () => {}); await new Promise(r => s.on('close', r)); return out; };

// Проверка: подключается, снимает отпечаток, смотрит систему. Ничего не меняет
async function check(o) {
  const c = clean(o); if (c.error) return c;
  let conn;
  try {
    conn = await connect(c);
    const out = (await collect(conn.cl, '. /etc/os-release 2>/dev/null; echo "$(id -u)|$(uname -m)|${PRETTY_NAME:-}|$(command -v apt-get >/dev/null && echo apt)|$(command -v systemctl >/dev/null && echo systemd)"')).trim().split('|');
    const root = out[0] === '0';
    const res = { ok: true, fingerprint: conn.fp, os: out[2] || 'неизвестна', arch: out[1], root, apt: out[3] === 'apt', systemd: out[4] === 'systemd' };
    if (!root) return { error: 'Нужен вход под root: установке нужны права на системные службы' };
    if (!res.apt || !res.systemd) return { error: `Автоматическая установка поддерживает Debian и Ubuntu (на сервере: ${res.os})` };
    return res;
  } catch (e) { return { error: e.message }; }
  finally { try { conn?.cl.end(); } catch {} }
}

// Домен публичного сервера должен уже указывать на машину, куда ставим: иначе сертификат не выпустится
async function checkDomain(domain, host) {
  try {
    const ips = (await dns.lookup(domain, { all: true })).map(r => r.address);
    const target = (await dns.lookup(host, { all: true }).catch(() => [])).map(r => r.address);
    if (!ips.length) return `Домен ${domain} не найден`;
    if (target.length && !ips.some(i => target.includes(i))) return `Домен ${domain} указывает на ${ips.join(', ')}, а не на ${host}. Исправьте запись DNS и подождите, пока она обновится`;
    return null;
  } catch { return `Домен ${domain} не найден: создайте запись DNS, которая указывает на этот сервер`; }
}

async function start(o, onResult, onFail) {
  if (job && job.state === 'running') return { error: 'Установка уже идёт' };
  const c = clean(o); if (c.error) return c;
  // lan — локальная сеть; public — свой сертификат через Caddy; proxy — сертификат и wss:// ведёт обратный прокси администратора
  const mode = ['lan', 'public', 'proxy'].includes(o.mode) ? o.mode : (o.public ? 'public' : 'lan'), domain = String(o.domain || '').trim().toLowerCase();
  if (mode !== 'lan') {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) return { error: 'Нужен домен вида calls.example.com' };
    // У прокси домен ведёт на сам прокси, а не на эту машину: DNS сверяем только когда сертификат выпускает она
    const bad = mode === 'public' && !o.skip_dns ? await checkDomain(domain, c.host) : null;
    if (bad) return { error: bad };
  }
  if (!fs.existsSync(SCRIPT)) return { error: 'Не найден скрипт livekit-setup.sh' };
  const fingerprint = String(o.fingerprint || '');
  if (!fingerprint) return { error: 'Сначала проверьте подключение и подтвердите отпечаток сервера' };

  job = { state: 'running', pct: 0, stage: 1, text: 'Подключение', error: null, result: null, log: [] };
  const mine = job;
  (async () => {
    let conn;
    const killer = setTimeout(() => { try { conn?.cl.end(); } catch {} }, MAX_MS);
    try {
      conn = await connect(c, fingerprint);
      // Скрипт кладём файлом: через stdin его съели бы команды, которые читают ввод (apt, например)
      const up = await exec(conn.cl, `umask 077; cat > ${REMOTE}`);
      up.resume(); up.stderr.resume();   // без чтения вывода канал не закрывается
      const closed = new Promise(r => up.on('close', r));
      up.end(fs.readFileSync(SCRIPT));
      await closed;
      const args = mode === 'public' ? `public ${domain}${o.tls_internal ? ' internal' : ''}` : mode === 'proxy' ? `proxy ${domain}${o.local ? ' local' : ''}` : 'lan';
      const s = await exec(conn.cl, `bash ${REMOTE} ${args} < /dev/null; rc=$?; rm -f ${REMOTE}; exit $rc`);
      let buf = '', code = null;
      const onLine = line => {
        if (!line) return;
        let m;
        if ((m = /^@(\d+)\|(\d+)\|(.*)$/.exec(line))) { mine.pct = Math.min(100, Number(m[1])); mine.stage = Number(m[2]); mine.text = m[3]; }
        else if ((m = /^@RESULT\|(.*)$/.exec(line))) { try { mine.result = JSON.parse(m[1]); } catch {} }
        else if ((m = /^@ERROR\|(.*)$/.exec(line))) mine.error = m[1];
        else { mine.log.push(line.slice(0, 300)); if (mine.log.length > 200) mine.log.shift(); }
      };
      const feed = chunk => { buf += chunk.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); } };
      s.on('data', feed); s.stderr.on('data', feed);
      await new Promise(r => s.on('close', c2 => { code = c2; r(); }));
      if (buf) onLine(buf);
      if (code === 0 && mine.result) {
        mine.state = 'done'; mine.pct = 100; mine.text = 'Сервер звонков установлен и настроен';
        try { await onResult(mine.result); } catch (e) { console.warn('[Звонки] не удалось сохранить настройки после установки:', e.message); }
      } else { mine.state = 'failed'; mine.error = mine.error || 'Установка прервалась (код ' + code + ')'; }
    } catch (e) { mine.state = 'failed'; mine.error = mine.error || e.message; }
    finally { clearTimeout(killer); try { conn?.cl.end(); } catch {} if (mine.state === 'failed') try { onFail?.(mine.error); } catch {} }
  })();
  return { ok: true, job: pub() };
}

module.exports = { check, start, job: pub };
