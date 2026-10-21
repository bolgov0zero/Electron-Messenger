#!/usr/bin/env node
'use strict';
// Команда `electron db …` — работа с базой данных из консоли.
//
//   electron db status                       какой движок работает
//   electron db test <url>                   проверить подключение к PostgreSQL
//   electron db migrate <url>                перенести SQLite → PostgreSQL (служба на время переноса останавливается)
//   electron db sqlite                       вернуть службу на SQLite (аварийно; данные, записанные в PostgreSQL, не переносятся)
//
// <url> — postgres://пользователь:пароль@хост:порт/база. Можно вместо него флагами:
//   --host 127.0.0.1 --port 5432 --db electron --user electron --password …
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const pgmigrate = require('../pgmigrate');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', '..', 'chat_db', 'chat.db');
const SERVICE = 'electron';
const out = m => process.stdout.write(m + '\n');
const die = m => { process.stderr.write('Ошибка: ' + m + '\n'); process.exit(1); };

function flags(args) {
  const f = {}; const rest = [];
  for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) { f[args[i].slice(2)] = args[i + 1]; i++; } else rest.push(args[i]); }
  return { f, rest };
}
function connFrom({ f, rest }) {
  if (rest[0]) return rest[0];
  if (f.host || f.db) return { host: f.host || '127.0.0.1', port: f.port, database: f.db, user: f.user, password: f.password, ssl: f.ssl || '' };
  die('Укажите строку подключения: postgres://пользователь:пароль@хост:порт/база');
}
const sysctl = (...a) => { const r = spawnSync('systemctl', a, { encoding: 'utf8' }); return { ok: !r.error && r.status === 0, out: (r.stdout || '').trim() }; };
const hasSystemd = () => !spawnSync('systemctl', ['--version']).error;

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const parsed = flags(args);
  if (cmd === 'status') {
    const envFile = path.join(process.env.ELECTRON_CONF_DIR || '/etc/electron', 'database.env');
    const pg = fs.existsSync(envFile);
    out(`Движок: ${pg ? 'PostgreSQL' : 'SQLite'}`);
    if (pg) { try { const u = new URL(fs.readFileSync(envFile, 'utf8').trim().replace(/^DATABASE_URL=/, '')); out(`Подключение: ${u.hostname}:${u.port || 5432}/${decodeURIComponent(u.pathname.slice(1))}`); } catch {} }
    else { try { out(`Файл: ${DB_PATH} (${(fs.statSync(DB_PATH).size / 1048576).toFixed(1)} МБ)`); } catch { out(`Файл: ${DB_PATH}`); } }
    return;
  }
  if (cmd === 'test') {
    const r = await pgmigrate.test(connFrom(parsed));
    for (const c of r.checks) out(`${c.ok ? '✓' : '✗'} ${c.text}`);
    if (r.error) out('✗ ' + r.error);
    process.exit(r.ok ? 0 : 1);
  }
  if (cmd === 'migrate') {
    const conn = connFrom(parsed);
    if (fs.existsSync(path.join(process.env.ELECTRON_CONF_DIR || '/etc/electron', 'database.env'))) die('Сервер уже работает на PostgreSQL');
    if (!fs.existsSync(DB_PATH)) die('Файл SQLite не найден: ' + DB_PATH);
    out('Проверка PostgreSQL…');
    const t = await pgmigrate.test(conn);
    for (const c of t.checks) out(`  ${c.ok ? '✓' : '✗'} ${c.text}`);
    if (!t.ok) die(t.error || 'База не подходит для переноса');
    const systemd = hasSystemd() && sysctl('is-active', SERVICE).out === 'active';
    if (systemd) { out('Останавливаю службу…'); sysctl('stop', SERVICE); }
    let ok = false;
    try {
      const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
      const backups = path.join(path.dirname(DB_PATH), 'backups'), snap = `chat-${ts}.db`;
      let last = '';
      const r = await pgmigrate.run({ conn, sqlitePath: DB_PATH, snapshotPath: path.join(backups, snap), onProgress: p => {
        if (p.phase === 'copy') { const pct = p.total ? Math.round(p.done / p.total * 100) : 0; const line = `  Перенос данных: ${pct}%`; if (line !== last) { process.stdout.write('\r' + line + '   '); last = line; } }
        else { if (last) { process.stdout.write('\n'); last = ''; } out('  ' + p.text); }
      } });
      if (last) out('');
      try { fs.writeFileSync(path.join(backups, snap + '.kind'), 'pre'); } catch {}
      await pgmigrate.persist(conn);
      out(`Готово: строк ${r.rows}, таблиц ${r.tables}. Копия SQLite: ${path.join(backups, snap)}`);
      ok = true;
    } catch (e) { out('\nПеренос не удался: ' + e.message + '\nСлужба останется на SQLite, данные не затронуты.'); }
    if (systemd) { out('Запускаю службу…'); sysctl('start', SERVICE); }
    else if (ok) out('Службы systemd нет: перезапустите сервер вручную.');
    process.exit(ok ? 0 : 1);
  }
  if (cmd === 'sqlite') {
    await pgmigrate.unpersist();
    out('Строка подключения PostgreSQL убрана. Данные, записанные в PostgreSQL после переноса, в SQLite не попадут.');
    if (hasSystemd()) { sysctl('restart', SERVICE); out('Служба перезапущена на SQLite.'); }
    return;
  }
  out('Использование: electron db status | test <url> | migrate <url> | sqlite');
}
main().catch(e => die(e.message));
