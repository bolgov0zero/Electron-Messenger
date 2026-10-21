'use strict';
// ── ПЕРЕНОС БАЗЫ С SQLITE НА POSTGRESQL ──
//
//   test(conn)                       проверка подключения: версия, кодировка, права, пустая ли база
//   run({ conn, sqlitePath, ... })   перенос; при любой ошибке PostgreSQL остаётся пустым, SQLite не тронута
//   persist(url)                     запись строки подключения в окружение службы
//
// Порядок переноса:
//   1. снимок SQLite (резервная копия средствами SQLite — согласованная, без остановки записи);
//   2. очистка снимка от строк с нарушенными внешними ключами (бывает после восстановления из копии);
//   3. схема PostgreSQL (нумерованные миграции);
//   4. в одной транзакции: загрузка таблиц пачками, сброс счётчиков id, пересборка индексов;
//   5. сверка числа строк по каждой таблице;
//   6. COMMIT. Любая ошибка до него — ROLLBACK и возврат PostgreSQL к пустому состоянию.
//
// Режим обслуживания (запрет записи) включает вызывающий: он знает, работает ли сервер.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const { applyMigrations } = require('./pgschema');

const MIN_VERSION = 140000;

// ── Подключение ──
function connString(conn) {
  if (typeof conn === 'string') return conn;
  const host = String(conn.host || '').trim(), db = String(conn.database || '').trim(), user = String(conn.user || '').trim();
  if (!host || !db || !user) throw new Error('Укажите адрес сервера, имя базы и пользователя');
  const port = Number(conn.port) || 5432;
  const q = conn.ssl === 'require' ? '?sslmode=no-verify' : conn.ssl === 'verify-full' ? '?sslmode=verify-full' : '';
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(conn.password || '')}@${host}:${port}/${encodeURIComponent(db)}${q}`;
}
function makePool(conn) {
  const pool = new Pool({ connectionString: connString(conn), max: 2, connectionTimeoutMillis: 8000, idleTimeoutMillis: 5000 });
  pool.on('error', () => {});
  return pool;
}
const num = v => (v === null || v === undefined ? 0 : Number(v));

// ── Проверка подключения ──
async function test(conn) {
  const checks = [];
  const add = (name, ok, text) => checks.push({ name, ok, text });
  let pool;
  try { pool = makePool(conn); } catch (e) { return { ok: false, error: e.message, checks }; }
  try {
    let client;
    try { client = await pool.connect(); }
    catch (e) { return { ok: false, error: 'Не удалось подключиться: ' + e.message, checks }; }
    try {
      const ver = (await client.query('SHOW server_version')).rows[0].server_version;
      const verNum = Number((await client.query('SHOW server_version_num')).rows[0].server_version_num);
      add('version', verNum >= MIN_VERSION, `PostgreSQL ${ver}` + (verNum >= MIN_VERSION ? '' : ' — нужна версия 14 или новее'));
      const enc = (await client.query('SHOW server_encoding')).rows[0].server_encoding;
      add('encoding', enc === 'UTF8', `Кодировка базы ${enc}` + (enc === 'UTF8' ? '' : ' — нужна UTF8'));
      // Русская морфология поиска работает, только если локаль базы знает кириллицу
      const ts = (await client.query("SELECT to_tsvector('russian', 'Привет') AS v")).rows[0].v;
      add('locale', !!ts, ts ? 'Локаль базы знает русские буквы' : 'Локаль базы не знает русские буквы: создайте базу с LC_CTYPE C.UTF-8 или ru_RU.UTF-8');
      // Порядок строк (имена в списках) в SQLite — по кодам символов. Чтобы в PostgreSQL он не менялся,
      // база создаётся с сортировкой C. Это не мешает переносу, поэтому только предупреждение
      const coll = (await client.query('SELECT datcollate FROM pg_database WHERE datname = current_database()')).rows[0].datcollate;
      const cOk = ['C', 'POSIX', 'C.UTF-8', 'C.utf8'].includes(coll);
      checks.push({ name: 'collation', ok: true, warn: !cOk, text: cOk ? `Сортировка ${coll}: порядок имён как раньше` : `Сортировка ${coll}: порядок имён в списках может отличаться от прежнего (для прежнего порядка создайте базу с LC_COLLATE C.UTF-8)` });
      const tables = num((await client.query("SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'")).rows[0].c);
      add('empty', tables === 0, tables === 0 ? 'База пустая' : `В базе уже есть таблицы (${tables}): нужна пустая база`);
      try {
        await client.query('BEGIN');
        await client.query('CREATE TABLE electron_probe (x int)');
        await client.query('ROLLBACK');
        add('rights', true, 'Права на создание таблиц есть');
      } catch (e) { try { await client.query('ROLLBACK'); } catch {} add('rights', false, 'Нет прав на создание таблиц: ' + e.message); }
      return { ok: checks.every(c => c.ok), version: ver, checks };
    } finally { client.release(); }
  } finally { await pool.end().catch(() => {}); }
}

// ── Перенос ──
const BATCH_PARAMS = 30000;     // предел параметров в одном INSERT (у PostgreSQL 65535)

function coerce(v, type) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (type === 'bigint' || type === 'integer' || type === 'smallint') {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
    if (typeof v === 'string') { const n = Number(v); return v.trim() !== '' && Number.isFinite(n) ? Math.trunc(n) : null; }
    return null;
  }
  if (type === 'double precision') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  if (type === 'bytea') return Buffer.isBuffer(v) ? v : Buffer.from(String(v));
  if (typeof v === 'string') return v.includes('\u0000') ? v.replace(/\u0000/g, '') : v;
  if (Buffer.isBuffer(v)) return v.toString('utf8').replace(/\u0000/g, '');
  return String(v);
}

async function run({ conn, sqlitePath, snapshotPath, onProgress = () => {}, log = () => {} }) {
  const t0 = Date.now();
  const say = (phase, text, extra = {}) => { if (phase !== 'copy') log(text); onProgress({ phase, text, ...extra }); };
  const pool = makePool(conn);
  let snapDb = null;
  const result = { tables: 0, rows: 0, orphans: 0, snapshot: snapshotPath };
  let client = null, schemaCreated = false;
  try {
    // 0. проверки
    say('check', 'Проверка PostgreSQL');
    const t = await test(conn);
    if (!t.ok) throw new Error(t.error || t.checks.filter(c => !c.ok).map(c => c.text).join('; '));

    // 1. снимок SQLite
    say('snapshot', 'Снимок текущей базы');
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    try { fs.unlinkSync(snapshotPath); } catch {}
    const src = new Database(sqlitePath, { readonly: true, fileMustExist: true });
    try { await src.backup(snapshotPath); } finally { src.close(); }
    snapDb = new Database(snapshotPath);
    snapDb.pragma('foreign_keys = OFF');

    // 2. строки с нарушенными ссылками уберём из снимка (в рабочей базе они остаются)
    // Удалённая строка может быть родителем других (сообщение с реакциями), поэтому проверяем, пока нарушения не кончатся
    const del = new Set();
    for (let pass = 0; pass < 20; pass++) {
      const bad = snapDb.pragma('foreign_key_check');
      if (!bad.length) break;
      for (const b of bad) {
        snapDb.prepare(`DELETE FROM "${b.table}" WHERE rowid = ?`).run(b.rowid);
        del.add(b.table + ':' + b.rowid);
      }
    }
    if (del.size) {
      result.orphans = del.size;
      say('clean', `Убрано строк с нарушенными ссылками: ${del.size}`);
    }

    // 3. схема
    say('schema', 'Создание схемы PostgreSQL');
    schemaCreated = true;
    await applyMigrations(pool);

    // 4. данные
    client = await pool.connect();
    // Обрыв соединения посреди переноса приходит и как событие: без обработчика оно уронило бы процесс
    client.on('error', () => {});
    await client.query('BEGIN');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    const pgTables = (await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations' ORDER BY table_name`)).rows.map(r => r.table_name);
    const sqliteHas = new Set(snapDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
    const plan = [];
    let grand = 0;
    for (const tn of pgTables) {
      if (!sqliteHas.has(tn)) continue;
      const pgCols = (await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position`, [tn])).rows;
      const sqCols = new Set(snapDb.prepare(`PRAGMA table_info("${tn}")`).all().map(c => c.name));
      const cols = pgCols.filter(c => sqCols.has(c.column_name));
      const count = snapDb.prepare(`SELECT COUNT(*) AS c FROM "${tn}"`).get().c;
      plan.push({ table: tn, cols, count });
      grand += count;
    }

    // Вторичные индексы строим после загрузки: так в разы быстрее
    const idx = (await client.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexdef NOT LIKE 'CREATE UNIQUE%' AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE contype IN ('p', 'u'))`)).rows;
    for (const i of idx) await client.query(`DROP INDEX "${i.indexname}"`);

    let done = 0;
    for (const p of plan) {
      say('copy', `Таблица ${p.table}`, { table: p.table, done, total: grand });
      if (!p.count || !p.cols.length) { result.tables++; continue; }
      const names = p.cols.map(c => `"${c.column_name}"`).join(', ');
      const types = p.cols.map(c => c.data_type);
      const per = Math.max(1, Math.min(2000, Math.floor(BATCH_PARAMS / p.cols.length)));
      const stmt = snapDb.prepare(`SELECT ${names} FROM "${p.table}"`);
      let batch = [];
      const flush = async () => {
        if (!batch.length) return;
        const vals = [], rowsSql = [];
        batch.forEach((row, ri) => {
          rowsSql.push('(' + p.cols.map((_, ci) => '$' + (ri * p.cols.length + ci + 1)).join(', ') + ')');
          p.cols.forEach((c, ci) => vals.push(coerce(row[c.column_name], types[ci])));
        });
        try { await client.query(`INSERT INTO "${p.table}" (${names}) VALUES ${rowsSql.join(', ')}`, vals); }
        catch (e) { throw new Error(`Таблица ${p.table}: ${e.message}`); }
        done += batch.length;
        result.rows += batch.length;
        batch = [];
        onProgress({ phase: 'copy', text: `Таблица ${p.table}`, table: p.table, done, total: grand });
      };
      for (const row of stmt.iterate()) { batch.push(row); if (batch.length >= per) await flush(); }
      await flush();
      result.tables++;
    }

    // Счётчики id продолжаются с наибольшего перенесённого
    say('sequences', 'Сброс счётчиков');
    const idTables = (await client.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'id' AND is_identity = 'YES'`)).rows.map(r => r.table_name);
    // Счётчик продолжается с наибольшего номера, который SQLite когда-либо выдавала (sqlite_sequence), а не только с
    // наибольшего оставшегося: иначе после удаления последних строк номера пошли бы заново. Очередь федерации
    // (fed_outbox) этого не прощает: соседний сервер помнит выданные номера и принимает только растущие
    const issued = new Map();
    try { for (const r of snapDb.prepare('SELECT name, seq FROM sqlite_sequence').all()) issued.set(r.name, Number(r.seq) || 0); } catch {}
    for (const tn of idTables) {
      const mx = Number((await client.query(`SELECT COALESCE(MAX(id), 0) AS m FROM "${tn}"`)).rows[0].m) || 0;
      const v = Math.max(mx, issued.get(tn) || 0);
      await client.query(`SELECT setval(pg_get_serial_sequence('"${tn}"', 'id'), $1, $2)`, [Math.max(v, 1), v > 0]);
    }

    // Внешние ключи проверяются здесь (отложенная проверка включается обратно): без этого
    // PostgreSQL не даст строить индексы по таблицам с непроверенными изменениями
    say('verify', 'Проверка ссылок между таблицами');
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');

    // Индексы
    say('indexes', 'Построение индексов', { done: grand, total: grand });
    for (const i of idx) await client.query(i.indexdef);

    // 5. сверка
    say('verify', 'Сверка числа строк');
    for (const p of plan) {
      const n = num((await client.query(`SELECT COUNT(*) AS c FROM "${p.table}"`)).rows[0].c);
      if (n !== p.count) throw new Error(`Не сошлось число строк в таблице ${p.table}: было ${p.count}, перенесено ${n}`);
    }

    say('commit', 'Завершение транзакции');
    await client.query('COMMIT');
    client.release(); client = null;
    // После массовой загрузки: карта видимости и статистика. Без VACUUM PostgreSQL не может
    // считать только по индексу, и счётчики сообщений по чатам тянутся секундами
    say('vacuum', 'Оптимизация базы');
    await pool.query('VACUUM (ANALYZE)');
    result.seconds = Math.round((Date.now() - t0) / 1000);
    say('done', `Перенесено строк: ${result.rows}, таблиц: ${result.tables}`);
    return result;
  } catch (e) {
    // PostgreSQL возвращаем в пустое состояние: перед переносом он был пуст
    if (client) { try { await client.query('ROLLBACK'); } catch {} client.release(); client = null; }
    if (schemaCreated) { try { await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); } catch (e2) { log('Не удалось очистить схему: ' + e2.message); } }
    throw e;
  } finally {
    if (snapDb) { try { snapDb.close(); } catch {} }
    await pool.end().catch(() => {});
  }
}

// ── Строка подключения в окружение службы ──
// Файл с паролем доступен только владельцу; в базе строка не хранится.
function sh(cmd, args) { return new Promise(res => execFile(cmd, args, err => res(!err))); }
async function persist(conn) {
  const url = connString(conn);
  const confDir = process.env.ELECTRON_CONF_DIR || '/etc/electron';
  const sysDir = process.env.ELECTRON_SYSTEMD_DIR || '/etc/systemd/system';
  fs.mkdirSync(confDir, { recursive: true, mode: 0o700 });
  const envFile = path.join(confDir, 'database.env');
  fs.writeFileSync(envFile, `DATABASE_URL=${url}\n`, { mode: 0o600 });
  fs.chmodSync(envFile, 0o600);
  const dropDir = path.join(sysDir, 'electron.service.d');
  fs.mkdirSync(dropDir, { recursive: true });
  fs.writeFileSync(path.join(dropDir, 'database.conf'), `[Service]\nEnvironmentFile=${envFile}\n`);
  const systemd = await sh('systemctl', ['daemon-reload']);
  return { envFile, dropIn: path.join(dropDir, 'database.conf'), systemd };
}

// Вернуть службу на SQLite (аварийно): убирает строку подключения. Данные, записанные в PostgreSQL, в SQLite не попадут.
async function unpersist() {
  const confDir = process.env.ELECTRON_CONF_DIR || '/etc/electron';
  const sysDir = process.env.ELECTRON_SYSTEMD_DIR || '/etc/systemd/system';
  for (const f of [path.join(confDir, 'database.env'), path.join(sysDir, 'electron.service.d', 'database.conf')]) { try { fs.unlinkSync(f); } catch {} }
  return sh('systemctl', ['daemon-reload']);
}

module.exports = { test, run, persist, unpersist, connString };
