'use strict';
// Админка → Настройки → База данных: какой движок работает и перенос с SQLite на PostgreSQL.
// Подключается в admin.js (доступ только администраторам).
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const dal = require('../dal');
const maintenance = require('../maintenance');
const pgmigrate = require('../pgmigrate');
const { logAudit } = require('../audit');
const { broadcastAll } = require('../ws');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', '..', 'chat_db', 'chat.db');
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');

let job = null;     // { state: running | restarting | done | failed, phase, text, done, total, error, startedAt, result }

const publicJob = () => (job && { ...job });

// Подключение из тела запроса; пароль в ответах и журнале не возвращается
const connOf = b => ({ host: b?.host, port: b?.port, database: b?.database, user: b?.user, password: b?.password, ssl: b?.ssl });

router.get('/', async (req, res) => {
  const out = { engine: dal.engine, canMigrate: !dal.pg && !(job && job.state === 'running'), job: publicJob() };
  try {
    if (dal.pg) {
      out.version = (await dal.get('SHOW server_version')).server_version;
      out.size = (await dal.get('SELECT pg_database_size(current_database()) AS b')).b;
      try { const u = new URL(process.env.DATABASE_URL); out.target = `${u.hostname}:${u.port || 5432}/${decodeURIComponent(u.pathname.slice(1))}`; } catch {}
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

module.exports = router;
