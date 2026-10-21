'use strict';
// Админка → Настройки → База данных: какой движок работает и перенос с SQLite на PostgreSQL.
// Подключается в admin.js (доступ только администраторам).
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const dal = require('../dal');
const maintenance = require('../maintenance');
const pgmigrate = require('../pgmigrate');
const { logAudit } = require('../audit');
const { broadcastAll } = require('../ws');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', '..', 'chat_db', 'chat.db');
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');

// Файл SQLite и его служебные файлы WAL/SHM: суммарный размер и список существующих
function legacyFiles() {
  const files = [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm'].filter(f => { try { return fs.statSync(f).isFile(); } catch { return false; } });
  return { files, size: files.reduce((n, f) => n + fs.statSync(f).size, 0) };
}

let job = null;     // { state: running | restarting | done | failed, phase, text, done, total, error, startedAt, result }

const publicJob = () => (job && { ...job });

// Подключение из тела запроса; пароль в ответах и журнале не возвращается
const connOf = b => ({ host: b?.host, port: b?.port, database: b?.database, user: b?.user, password: b?.password, ssl: b?.ssl });

router.get('/', async (req, res) => {
  const out = { engine: dal.engine, canMigrate: !dal.pg && !(job && job.state === 'running'), job: publicJob(), install: publicInst() };
  try {
    if (dal.pg) {
      out.version = String((await dal.get('SHOW server_version')).server_version).split(' ')[0];
      out.size = (await dal.get('SELECT pg_database_size(current_database()) AS b')).b;
      try { const u = new URL(process.env.DATABASE_URL); out.target = `${u.hostname}:${u.port || 5432}/${decodeURIComponent(u.pathname.slice(1))}`; } catch {}
      // Файл SQLite после переноса остаётся на диске: сервер им больше не пользуется
      const lg = legacyFiles();
      if (lg.size) out.legacy = { path: DB_PATH, size: lg.size };
    } else {
      out.version = (await dal.get('SELECT sqlite_version() AS v')).v;
      try { out.size = fs.statSync(DB_PATH).size; } catch {}
      out.messages = (await dal.get('SELECT COUNT(*) AS c FROM messages')).c;
    }
  } catch (e) { out.error = e.message; }
  res.json(out);
});

router.post('/test', async (req, res) => {
  if (dal.pg) return res.status(400).json({ error: 'Сервер уже работает на PostgreSQL' });
  try { res.json(await pgmigrate.test(connOf(req.body))); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// Удалить прежний файл SQLite (после переноса на PostgreSQL). Копия «до переноса» лежит в резервных копиях и не трогается
router.post('/delete-legacy', async (req, res) => {
  if (!dal.pg) return res.status(400).json({ error: 'Сервер работает на SQLite: этот файл и есть база' });
  if (!req.body?.confirm) return res.status(400).json({ error: 'Нужно подтверждение' });
  const lg = legacyFiles();
  if (!lg.files.length) return res.status(404).json({ error: 'Файла SQLite уже нет' });
  try { for (const f of lg.files) fs.unlinkSync(f); }
  catch (e) { return res.status(500).json({ error: 'Не удалось удалить файл: ' + e.message }); }
  await logAudit(req, 'server', 'Удалён прежний файл SQLite', path.basename(DB_PATH));
  res.json({ ok: true, freed: lg.size });
});

router.get('/migrate', (req, res) => res.json({ job: publicJob() }));

router.post('/migrate', async (req, res) => {
  if (dal.pg) return res.status(400).json({ error: 'Сервер уже работает на PostgreSQL' });
  if (job && (job.state === 'running' || job.state === 'restarting')) return res.status(409).json({ error: 'Перенос уже идёт' });
  if (!req.body?.confirm) return res.status(400).json({ error: 'Нужно подтверждение' });
  const conn = connOf(req.body);
  let target;
  try { target = pgmigrate.connString(conn); } catch (e) { return res.status(400).json({ error: e.message }); }
  const check = await pgmigrate.test(conn).catch(e => ({ ok: false, error: e.message }));
  if (!check.ok) return res.status(400).json({ error: check.error || 'База не подходит для переноса', checks: check.checks });

  const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
  const snapName = `chat-${ts}.db`;
  job = { state: 'running', phase: 'start', text: 'Подготовка', done: 0, total: 0, startedAt: Date.now() };
  await logAudit(req, 'server', 'Перенос базы на PostgreSQL: начат', check.version);
  res.status(202).json({ ok: true, job: publicJob() });

  // Дальше работаем в фоне; вся запись в базу запрещена до конца
  setImmediate(async () => {
    try {
      maintenance.on('migration');
      broadcastAll({ type: 'maintenance', on: true });
      await new Promise(r => setTimeout(r, 1500));    // даём дописаться уже начатым обработчикам
      const r = await pgmigrate.run({
        conn, sqlitePath: DB_PATH, snapshotPath: path.join(BACKUP_DIR, snapName),
        log: m => console.log('[Перенос]', m),
        onProgress: p => { job = { ...job, phase: p.phase, text: p.text, ...(p.total !== undefined ? { done: p.done || 0, total: p.total } : {}) }; },
      });
      try { fs.writeFileSync(path.join(BACKUP_DIR, snapName + '.kind'), 'pre'); } catch {}
      const p = await pgmigrate.persist(conn);
      job = { ...job, state: 'restarting', phase: 'restart', text: 'Перезапуск сервера', result: { rows: r.rows, tables: r.tables, orphans: r.orphans, seconds: r.seconds, snapshot: snapName, systemd: p.systemd } };
      if (p.systemd) setTimeout(() => exec('systemctl restart electron'), 800);
      else job = { ...job, state: 'done', text: 'Готово. Службы systemd нет: перезапустите сервер вручную, строка подключения записана в ' + p.envFile };
    } catch (e) {
      console.error('[Перенос] не удалось:', e.message);
      maintenance.off();
      broadcastAll({ type: 'maintenance', on: false });
      job = { ...job, state: 'failed', error: e.message };
      logAudit(req, 'server', 'Перенос базы на PostgreSQL: не удался', String(e.message).slice(0, 120));
    }
  });
});

// ── Установка PostgreSQL на этом сервере ──
// Делает pg-setup.sh (тот же, что вызывает установщик). Действие меняет систему и необратимо,
// поэтому нужен пароль того, кто нажал; неверные пароли считаются и ограничиваются.
const SETUP_SCRIPT = process.env.ELECTRON_PG_SETUP || path.join(__dirname, '..', '..', 'pg-setup.sh');
let inst = null;   // { state: running | done | failed, pct, stage, text, error, result, log: [] }
const badPw = new Map();   // id админа → { n, t }

const publicInst = () => inst && { state: inst.state, pct: inst.pct, stage: inst.stage, text: inst.text, error: inst.error, result: inst.result, log: inst.log.slice(-20) };

router.get('/install-pg', (req, res) => res.json({ job: publicInst() }));

router.post('/install-pg', async (req, res) => {
  if (dal.pg) return res.status(400).json({ error: 'Сервер уже работает на PostgreSQL' });
  if (inst && inst.state === 'running') return res.status(409).json({ error: 'Установка уже идёт' });
  if (job && (job.state === 'running' || job.state === 'restarting')) return res.status(409).json({ error: 'Сейчас идёт перенос базы' });

  // Пароль администратора
  const rec = badPw.get(req.user.id);
  if (rec && rec.n >= 5 && Date.now() - rec.t < 10 * 60e3) return res.status(429).json({ error: 'Слишком много неверных паролей, попробуйте через несколько минут' });
  const pw = String(req.body?.password || '');
  const row = pw ? await dal.get('SELECT password_hash FROM users WHERE id = ?', req.user.id) : null;
  if (!row || !bcrypt.compareSync(pw, row.password_hash)) {
    badPw.set(req.user.id, { n: (rec && Date.now() - rec.t < 10 * 60e3 ? rec.n : 0) + 1, t: Date.now() });
    return res.status(403).json({ error: 'Неверный пароль' });
  }
  badPw.delete(req.user.id);
  if (!fs.existsSync(SETUP_SCRIPT)) return res.status(500).json({ error: 'Не найден скрипт установки pg-setup.sh' });

  inst = { state: 'running', pct: 0, stage: 1, text: 'Запуск', error: null, result: null, log: [] };
  await logAudit(req, 'server', 'Установка PostgreSQL на сервере: начата', null);
  res.status(202).json({ ok: true, job: publicInst() });

  const child = spawn('bash', [SETUP_SCRIPT], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  const onLine = line => {
    if (!line) return;
    let m;
    if ((m = /^@(\d+)\|(\d+)\|(.*)$/.exec(line))) inst = { ...inst, pct: Math.min(100, Number(m[1])), stage: Number(m[2]), text: m[3] };
    else if ((m = /^@RESULT\|(.*)$/.exec(line))) { try { inst.result = JSON.parse(m[1]); } catch {} }
    else if ((m = /^@ERROR\|(.*)$/.exec(line))) inst.error = m[1];
    else { inst.log.push(line.slice(0, 300)); if (inst.log.length > 200) inst.log.shift(); }
  };
  const feed = chunk => { buf += chunk.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); } };
  child.stdout.on('data', feed); child.stderr.on('data', feed);
  child.on('error', e => { inst = { ...inst, state: 'failed', error: 'Не удалось запустить скрипт: ' + e.message }; });
  child.on('close', code => {
    if (buf) onLine(buf);
    if (code === 0 && inst.result) {
      inst = { ...inst, state: 'done', pct: 100, text: 'PostgreSQL установлен и настроен' };
      logAudit(req, 'server', 'Установка PostgreSQL на сервере: завершена', `${inst.result.host}:${inst.result.port}/${inst.result.database}`);
    } else {
      inst = { ...inst, state: 'failed', error: inst.error || 'Установка прервалась (код ' + code + ')' };
      logAudit(req, 'server', 'Установка PostgreSQL на сервере: не удалась', String(inst.error).slice(0, 120));
    }
  });
});

module.exports = router;
