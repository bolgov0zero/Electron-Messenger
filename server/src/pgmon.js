'use strict';
// ── МОНИТОРИНГ POSTGRESQL ДЛЯ ГЛАВНОЙ АДМИНКИ ──
// Раз в 30 секунд снимаем показатели базы (соединения, транзакции, кэш, размер, состав) и, если PostgreSQL
// стоит на этом же сервере, нагрузку его службы из cgroup systemd (процессор, память, процессы).
// Ряд «соединения и запросы за час» копится в памяти: после перезапуска сервера он начинается заново.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const dal = require('./dal');

const STEP = 30000, SERIES_MAX = 120;
const CORES = os.cpus().length;
const series = [];            // [время, соединений, запросов в секунду]
let prev = null, last = null, unitName, cgPrev = null, cgDir = null, fast = null;

const readText = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const sh = (cmd, args) => new Promise(res => execFile(cmd, args, { timeout: 3000 }, (e, out) => res(e ? null : String(out))));
const kvOf = out => { const kv = {}; for (const l of String(out || '').trim().split('\n')) { const i = l.indexOf('='); if (i > 0) kv[l.slice(0, i)] = l.slice(i + 1); } return kv; };

// База на этом же сервере? Тогда у неё есть своя служба. Внешней базе службы тут нет
function isLocal() {
  try { return ['127.0.0.1', 'localhost', '::1', '[::1]', ''].includes(new URL(process.env.DATABASE_URL).hostname); } catch { return false; }
}

// В Debian служба PostgreSQL — postgresql@17-main.service (postgresql.service только запускает её)
async function findUnit() {
  if (unitName !== undefined) return unitName;
  unitName = null;
  if (!isLocal()) return null;
  const out = await sh('systemctl', ['list-units', 'postgresql*', '--type=service', '--all', '--no-legend', '--plain']);
  if (out == null) return null;
  const units = out.split('\n').map(l => l.trim().split(/\s+/)[0]).filter(Boolean);
  unitName = units.find(u => /^postgresql@.+\.service$/.test(u)) || units.find(u => u === 'postgresql.service') || null;
  return unitName;
}

async function serviceStats() {
  const unit = await findUnit();
  if (!unit) return null;
  const out = await sh('systemctl', ['show', unit, '--property=ActiveState,ControlGroup,ActiveEnterTimestampMonotonic,NRestarts']);
  if (out == null) return null;
  const kv = kvOf(out);
  // Каталог cgroup запоминаем: процессор, память и процессы читаются из него часто (fastSample), а systemctl — редко
  const dir = kv.ControlGroup ? path.join('/sys/fs/cgroup', kv.ControlGroup) : null;
  cgDir = dir && fs.existsSync(path.join(dir, 'cpu.stat')) ? dir : null;
  const cpu = fast ? fast.cpu : null, mem = fast ? fast.mem : null, tasks = fast ? fast.tasks : null;
  const btime = Number(((readText('/proc/stat') || '').match(/^btime (\d+)/m) || [])[1] || 0);
  const mono = Number(kv.ActiveEnterTimestampMonotonic || 0);
  return {
    unit, state: kv.ActiveState || null,
    since: btime && mono ? Math.round(btime * 1000 + mono / 1000) : null,
    restarts: kv.NRestarts != null && kv.NRestarts !== '' ? Number(kv.NRestarts) : null,
    cpu, mem, tasks,
  };
}

// Нагрузка службы: читается из cgroup (это чтение трёх файлов), поэтому с тем же шагом, что и у electron.
// Так в блоке «Службы» обе строки обновляются одновременно
function fastSample() {
  if (!cgDir) { fast = null; return; }
  const now = Date.now();
  const m = (readText(path.join(cgDir, 'cpu.stat')) || '').match(/^usage_usec (\d+)/m);
  const usec = m ? Number(m[1]) : null;
  let cpu = null;
  if (usec != null && cgPrev && now > cgPrev.t) cpu = Math.max(0, (usec - cgPrev.usec) / 1e6 / ((now - cgPrev.t) / 1000) / CORES * 100);
  if (usec != null) cgPrev = { usec, t: now };
  const mem = Number(readText(path.join(cgDir, 'memory.current'))), tasks = Number(readText(path.join(cgDir, 'pids.current')));
  fast = { cpu, mem: mem > 0 ? mem : null, tasks: tasks > 0 ? tasks : null, t: now };
}

async function sample() {
  try {
    const t0 = Date.now();
    const r = await dal.get(`SELECT numbackends AS conn, xact_commit + xact_rollback AS xact, blks_hit AS hit, blks_read AS rd,
      pg_database_size(current_database()) AS size FROM pg_stat_database WHERE datname = current_database()`);
    const latency = Date.now() - t0;
    const mx = Number((await dal.get('SHOW max_connections')).max_connections);
    const parts = await dal.get(`SELECT pg_total_relation_size('chat_read_state') + pg_total_relation_size('status_log') AS st, pg_table_size('messages') AS msg,
      COALESCE(pg_relation_size(to_regclass('idx_messages_tsv')), 0) AS idx,
      extract(epoch from pg_postmaster_start_time()) * 1000 AS started`);
    // «15.19 (Debian 15.19-0+deb12u1)» → «15.19»: сборка дистрибутива в карточку не нужна
    const ver = String((await dal.get('SHOW server_version')).server_version).split(' ')[0];
    const now = Date.now();
    let tps = null, cache = null;
    if (prev && now > prev.t) {
      tps = Math.max(0, (r.xact - prev.xact) / ((now - prev.t) / 1000));
      const dh = r.hit - prev.hit, dr = r.rd - prev.rd;
      cache = dh + dr > 0 ? dh / (dh + dr) * 100 : null;
    }
    if (cache == null && r.hit + r.rd > 0) cache = r.hit / (r.hit + r.rd) * 100;
    prev = { t: now, xact: r.xact, hit: r.hit, rd: r.rd };
    const svc = await serviceStats();
    last = {
      version: ver, size: r.size, conn: r.conn, maxConn: mx, cache, tps, latency,
      started: Math.round(parts.started),
      parts: { status: parts.st, messages: parts.msg, search: parts.idx, other: Math.max(0, r.size - parts.st - parts.msg - parts.idx) },
      local: isLocal(), service: svc,
    };
    series.push([now, r.conn, tps == null ? 0 : Math.round(tps * 10) / 10]);
    if (series.length > SERIES_MAX) series.shift();
  } catch (e) { if (!/обслуживание/.test(e.message)) console.warn('[PgMon]', e.message); }
}

function start() {
  sample().then(fastSample);
  setInterval(sample, STEP).unref();
  setInterval(fastSample, 2000).unref();
}
// Службу с самой свежей нагрузкой берём поверх снимка, снятого раз в 30 секунд
const service = () => (last && last.service ? { ...last.service, ...(fast ? { cpu: fast.cpu, mem: fast.mem, tasks: fast.tasks } : {}) } : null);
const info = () => (last ? { ...last, service: service(), series } : null);
const unit = async () => findUnit();

module.exports = { start, info, unit, sample, service };
