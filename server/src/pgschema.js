'use strict';
// Схема PostgreSQL: применение нумерованных миграций и сведения о таблицах.
// Вынесено из dal-pg.js, потому что нужно и переносу данных (pgmigrate.js),
// который работает с чужой, ещё не подключённой как основная, базой.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'migrations', 'pg');

// pool — всё, у чего есть query() и connect() (pg.Pool)
async function applyMigrations(pool, log = () => {}) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at BIGINT NOT NULL DEFAULT (extract(epoch from now())::bigint))');
  const files = fs.readdirSync(DIR).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  const done = new Set((await pool.query('SELECT version FROM schema_migrations')).rows.map(r => r.version));
  for (const f of files) {
    const v = parseInt(f, 10);
    if (done.has(v)) continue;
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [v, f]);
      await client.query('COMMIT');
      log(f);
    } catch (e) { try { await client.query('ROLLBACK'); } catch {} throw new Error(`Миграция ${f}: ${e.message}`); }
    finally { client.release(); }
  }
}

// { pk: {таблица: [колонки]}, id: Set(таблиц с колонкой id-идентификатором) }
async function loadMeta(pool) {
  const meta = { pk: {}, id: new Set() };
  const pk = await pool.query(`
    SELECT kcu.table_name, kcu.column_name FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = current_schema() ORDER BY kcu.ordinal_position`);
  for (const r of pk.rows) (meta.pk[r.table_name] = meta.pk[r.table_name] || []).push(r.column_name);
  const ids = await pool.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'id' AND is_identity = 'YES'`);
  meta.id = new Set(ids.rows.map(r => r.table_name));
  return meta;
}

module.exports = { applyMigrations, loadMeta };
