'use strict';
// ── РЕЗЕРВНАЯ КОПИЯ БАЗЫ POSTGRESQL ──
//
// Копия — файл SQLite со всеми таблицами чата, тот же формат, что и копии SQLite-сервера. Так список копий,
// расписание, скачивание и восстановление в админке работают одинаково на обоих движках, копию можно
// восстановить и на PostgreSQL, и на SQLite, а для создания не нужны ни pg_dump, ни особые права.
//
// Читаем одним снимком (REPEATABLE READ): переписка и все таблицы согласованы между собой, сервер работает
// как обычно. Схему файла создаёт сам db.js (в отдельном процессе, во временной папке), поэтому копия
// всегда в актуальном формате.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const pgdal = require('./dal-pg');

const FETCH = 5000;
const SKIP = t => /^(sqlite_|messages_fts)/.test(t);

function makeEmptySqlite(tmpDir) {
  return new Promise((resolve, reject) => {
    const file = path.join(tmpDir, 'chat.db');
    const child = spawn(process.execPath, ['-e', "require(process.argv[1]); setTimeout(() => process.exit(0), 50);", path.join(__dirname, 'db.js')], {
      env: { ...process.env, DB_PATH: file, DATABASE_URL: '' }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => (code === 0 && fs.existsSync(file) ? resolve(file) : reject(new Error('Не удалось создать схему копии' + (err ? ': ' + err.slice(0, 200) : '')))));
  });
}

// destPath — куда положить готовый файл; onProgress({done, total, table})
async function exportToSqlite(destPath, onProgress = () => {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-backup-'));
  let sq = null, client = null;
  try {
    const file = await makeEmptySqlite(tmpDir);
    sq = new Database(file);
    sq.pragma('journal_mode = OFF');
    sq.pragma('synchronous = OFF');
    sq.pragma('foreign_keys = OFF');
    // Новая база уже содержит строки по умолчанию (администратор, пространство): очищаем, всё придёт из PostgreSQL
    const tables = sq.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name).filter(t => !SKIP(t));
    for (const trg of sq.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()) sq.exec(`DROP TRIGGER IF EXISTS "${trg.name}"`);
    try { sq.exec('DROP TABLE IF EXISTS messages_fts'); } catch {}
    for (const t of tables) sq.exec(`DELETE FROM "${t}"`);
    try { sq.exec("DELETE FROM sqlite_sequence"); } catch {}

    client = await pgdal.getClient();
    client.on('error', () => {});
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const pgTables = new Set((await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'")).rows.map(r => r.table_name));
    const plan = [];
    let total = 0;
    for (const t of tables) {
      if (!pgTables.has(t)) continue;
      const pgCols = new Set((await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND is_generated = 'NEVER'", [t])).rows.map(r => r.column_name));
      const cols = sq.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name).filter(c => pgCols.has(c));
      if (!cols.length) continue;
      const n = Number((await client.query(`SELECT COUNT(*) AS c FROM "${t}"`)).rows[0].c);
      plan.push({ t, cols, n }); total += n;
    }

    let done = 0, cur = 0;
    for (const p of plan) {
      onProgress({ table: p.t, done, total });
      if (!p.n) continue;
      const names = p.cols.map(c => `"${c}"`).join(', ');
      const ins = sq.prepare(`INSERT INTO "${p.t}" (${names}) VALUES (${p.cols.map(() => '?').join(', ')})`);
      const put = sq.transaction(rows => { for (const r of rows) ins.run(p.cols.map(c => (r[c] === undefined ? null : r[c]))); });
      const cname = 'bk' + (++cur);
      await client.query(`DECLARE ${cname} NO SCROLL CURSOR FOR SELECT ${names} FROM "${p.t}"`);
      for (;;) {
        const r = await client.query(`FETCH ${FETCH} FROM ${cname}`);
        if (!r.rows.length) break;
        put(r.rows);
        done += r.rows.length;
        onProgress({ table: p.t, done, total });
      }
      await client.query(`CLOSE ${cname}`);
    }
    await client.query('COMMIT');
    client.release(); client = null;

    sq.pragma('foreign_keys = ON');
    sq.close(); sq = null;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    try { fs.renameSync(file, destPath); } catch { fs.copyFileSync(file, destPath); }
    return { rows: done, tables: plan.length };
  } catch (e) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} client.release(); client = null; }
    try { fs.unlinkSync(destPath); } catch {}
    throw e;
  } finally {
    if (sq) { try { sq.close(); } catch {} }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { exportToSqlite };
