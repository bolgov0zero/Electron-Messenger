'use strict';
// Движок PostgreSQL для dal.js. Запросы переводятся из диалекта SQLite (dialect.js).
const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');
const { translate } = require('./dialect');

// bigint и numeric драйвер отдаёт строками; все наши числа (id, секунды) помещаются в double
types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));
// Булевы результаты выражений (a = b) в SQLite — 0 и 1; клиенты рассчитывают на числа
types.setTypeParser(16, v => (v === 't' ? 1 : 0));

let pool = null;
const meta = { pk: {}, id: new Set() };
const als = new AsyncLocalStorage();       // клиент открытой транзакции

const cacheQ = new Map();
function sqlFor(sql, forRun) {
  const key = (forRun ? 'r:' : 'q:') + sql;
  let t = cacheQ.get(key);
  if (!t) { if (cacheQ.size >= 2000) cacheQ.clear(); t = translate(sql, meta, forRun); cacheQ.set(key, t); }
  return t;
}
// NUL недопустим в тексте PostgreSQL; undefined и NaN — это NULL (так их связывает и SQLite)
const clean = p => p.map(v => (typeof v === 'string' && v.includes('\u0000') ? v.replace(/\u0000/g, '') : v === undefined || (typeof v === 'number' && Number.isNaN(v)) ? null : v));

async function exec(kind, sql, params) {
  const runner = als.getStore() || pool;
  const r = await runner.query(sqlFor(sql, kind === 'run'), clean(params));
  if (kind === 'get') return r.rows[0];
  if (kind === 'all') return r.rows;
  const id = r.rows && r.rows[0] && r.rows[0].id;
  return { changes: r.rowCount, lastId: id || 0, lastInsertRowid: id || 0 };
}

async function tx(fn) {
  if (als.getStore()) return fn();             // вложенная транзакция присоединяется к внешней
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await als.run(client, fn);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally { client.release(); }
}

async function loadMeta() {
  const pk = await pool.query(`
    SELECT kcu.table_name, kcu.column_name FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = current_schema() ORDER BY kcu.ordinal_position`);
  meta.pk = {};
  for (const r of pk.rows) (meta.pk[r.table_name] = meta.pk[r.table_name] || []).push(r.column_name);
  const ids = await pool.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'id' AND is_identity = 'YES'`);
  meta.id = new Set(ids.rows.map(r => r.table_name));
}

// Нумерованные миграции: migrations/pg/NNN_*.sql, применяются по порядку, версия — в таблице schema_migrations
async function migrate() {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint))');
  const dir = path.join(__dirname, 'migrations', 'pg');
  const files = fs.readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  const done = new Set((await pool.query('SELECT version FROM schema_migrations')).rows.map(r => r.version));
  for (const f of files) {
    const v = parseInt(f, 10);
    if (done.has(v)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [v, f]);
      await client.query('COMMIT');
      console.log('[БД] применена миграция', f);
    } catch (e) { try { await client.query('ROLLBACK'); } catch {} throw new Error(`Миграция ${f}: ${e.message}`); }
    finally { client.release(); }
  }
}

async function init() {
  // Каталоги данных (файлы и аватарки лежат на диске рядом с DB_PATH, как и с SQLite)
  const dataDir = path.dirname(process.env.DB_PATH || path.join(__dirname, '..', '..', 'chat_db', 'chat.db'));
  for (const d of ['avatar', 'files']) fs.mkdirSync(path.join(dataDir, d), { recursive: true });
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL) || 10 });
  pool.on('error', e => console.error('[БД] ошибка соединения PostgreSQL:', e.message));
  await migrate();
  await loadMeta();
  await require('./bootstrap').run(module.exports);
}

module.exports = {
  get: (sql, ...p) => exec('get', sql, p),
  all: (sql, ...p) => exec('all', sql, p),
  run: (sql, ...p) => exec('run', sql, p),
  tx,
  // Взаимное исключение внутри транзакции: тот, кто взял замок с тем же именем, ждёт конца первой
  lock: key => exec('get', 'SELECT pg_advisory_xact_lock(hashtext(?))', [String(key)]),
  init,
  close: async () => { if (pool) await pool.end(); },
  _meta: meta,
};
