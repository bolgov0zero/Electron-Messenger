'use strict';
// ── МОНИТОРИНГ СЕРВЕРА ──
//
// Каждые 2 секунды снимаем нагрузку и держим последний час в памяти — для живых
// графиков на главной админки. Источники — то, что уже есть в Debian: /proc и
// cgroup службы systemd. Ставить ничего не нужно.
//
// История переживает перезапуск: при остановке и раз в 5 минут пишем её в файл
// рядом с базой, при запуске читаем обратно. Иначе после каждого обновления
// графики начинались бы с пустого места.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const STEP_MS = 2000;
const CAP = 1800;          // час по 2 секунды
const LAG_TICK = 50;       // шаг таймера, по опозданию которого меряем задержку
const CLK_TCK = 100;       // USER_HZ в Debian: единица времени в /proc/<pid>/stat
const CORES = os.cpus().length;

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'chat_db', 'chat.db');
const DATA_DIR = path.dirname(DB_PATH);
const HISTORY_FILE = path.join(DATA_DIR, 'monitor-history.json');

// Точка: [время, ЦП %, ЦП службы %, занято памяти, память службы, чтение Б/с, запись Б/с, задержка мс]
const samples = [];
// Отметки на графиках: { type: 'update' | 'restart', t0, t1 }
const events = [];
let live = {};

const readText = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const round = (v, d = 1) => v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d;

// ── Процессор ──
function cpuTimes() {
  const stat = readText('/proc/stat');
  if (stat) {
    const v = stat.slice(0, stat.indexOf('\n')).trim().split(/\s+/).slice(1, 9).map(Number);
    return { total: v.reduce((a, b) => a + b, 0), idle: v[3] + v[4] };
  }
  // Не Linux (запуск при разработке): те же доли из os.cpus()
  let total = 0, idle = 0;
  for (const c of os.cpus()) { for (const k in c.times) total += c.times[k]; idle += c.times.idle; }
  return { total, idle };
}

// ── Память ──
// Считаем по MemAvailable, а не по MemFree: Linux занимает свободное под кэш, и по
// «свободной» памяти сервер всегда выглядел бы заполненным
function memInfo() {
  const txt = readText('/proc/meminfo');
  if (!txt) return { total: os.totalmem(), available: os.freemem(), cached: null, swapTotal: null, swapFree: null };
  const get = k => { const m = txt.match(new RegExp('^' + k + ':\\s+(\\d+)', 'm')); return m ? Number(m[1]) * 1024 : 0; };
  return {
    total: get('MemTotal'), available: get('MemAvailable'),
    cached: get('Cached') + get('Buffers') + get('SReclaimable'),
    swapTotal: get('SwapTotal'), swapFree: get('SwapFree'),
  };
}

// ── Служба ──
// systemd кладёт процесс сервера в свою cgroup, например
// /sys/fs/cgroup/system.slice/electron.service. Путь берём у самого процесса, а не
// собираем из имени службы — так неважно, как она называется.
function ownCgroup() {
  const line = (readText('/proc/self/cgroup') || '').split('\n').find(l => l.startsWith('0::'));
  if (!line) return null;
  const dir = path.join('/sys/fs/cgroup', line.slice(3).trim());
  return fs.existsSync(path.join(dir, 'cpu.stat')) ? dir : null;
}
const CGROUP = ownCgroup();
const UNIT = CGROUP && CGROUP.endsWith('.service') ? path.basename(CGROUP) : null;
// Обновление идёт отдельной временной службой (см. routes/admin.js) — её процессы
// показываем в той же таблице, но нагрузку службы чата они не увеличивают
const UPDATE_UNIT = 'electron-update.service';
const UPDATE_CGROUP = CGROUP ? path.join(path.dirname(CGROUP), UPDATE_UNIT) : null;

function cgroupUsec(dir) {
  const m = (readText(path.join(dir, 'cpu.stat')) || '').match(/^usage_usec (\d+)/m);
  return m ? Number(m[1]) : null;
}
const cgroupNumber = (dir, file) => { const v = Number(readText(path.join(dir, file))); return isFinite(v) && v > 0 ? v : null; };

function processes(dir, unit) {
  const pids = (readText(path.join(dir, 'cgroup.procs')) || '').split('\n').filter(Boolean).map(Number);
  return pids.map(pid => {
    const stat = readText(`/proc/${pid}/stat`);
    if (!stat) return null;
    // Имя процесса в скобках может содержать пробелы — поля считаем после ')'
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const rss = Number(((readText(`/proc/${pid}/status`) || '').match(/^VmRSS:\s+(\d+)/m) || [])[1] || 0) * 1024;
    const argv = (readText(`/proc/${pid}/cmdline`) || '').split('\0').filter(Boolean);
    const name = argv.length
      ? [path.basename(argv[0]), ...argv.slice(1).map(a => a.startsWith('/') ? a.split('/').slice(-2).join('/') : a)].join(' ').slice(0, 80)
      : f[0];
    return { pid, unit, ticks: Number(f[11]) + Number(f[12]), threads: Number(f[17]), start: Number(f[19]), rss, name };
  }).filter(Boolean);
}

// ── Диск ──
// Раздел, на котором лежит база: номер устройства из stat, строка — в /proc/diskstats.
// Если раздела там нет (бывает у некоторых файловых систем), берём сумму по дискам.
function deviceOf(dir) {
  try {
    const dev = fs.statSync(dir).dev;
    return `${(dev >> 8) & 0xfff}:${(dev & 0xff) | ((dev >> 12) & 0xfff00)}`;
  } catch { return null; }
}
const DISK_DEV = deviceOf(DATA_DIR);
const WHOLE_DISK = /^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/;

function diskSectors() {
  const txt = readText('/proc/diskstats');
  if (!txt) return null;
  let rd = 0, wr = 0, any = false;
  for (const line of txt.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10) continue;
    if (`${f[0]}:${f[1]}` === DISK_DEV) return { rd: Number(f[5]), wr: Number(f[9]) };
    if (WHOLE_DISK.test(f[2])) { rd += Number(f[5]); wr += Number(f[9]); any = true; }
  }
  return any ? { rd, wr } : null;
}

// ── Задержка обработки событий ──
// Таймер раз в 50 мс: насколько он опоздал, настолько сервер был занят чем-то
// другим — чаще всего долгим синхронным запросом к базе. monitorEventLoopDelay из
// perf_hooks для этого не подошёл: в пробе он не заметил блокировку на 150 мс.
let lagMax = 0;
function startLag() {
  let expected = performance.now() + LAG_TICK;
  setInterval(() => {
    const now = performance.now();
    lagMax = Math.max(lagMax, now - expected);
    expected = now + LAG_TICK;
  }, LAG_TICK).unref();
}

// ── Замер ──
let prev = null;
function sample() {
  const t = Date.now();
  const cpu = cpuTimes();
  const mem = memInfo();
  const disk = diskSectors();
  const svcUsec = CGROUP ? cgroupUsec(CGROUP) : null;
  const self = process.cpuUsage();
  const procs = CGROUP
    ? [...processes(CGROUP, UNIT), ...(fs.existsSync(UPDATE_CGROUP) ? processes(UPDATE_CGROUP, UPDATE_UNIT) : [])]
    : [];
  const lag = lagMax;
  lagMax = 0;

  if (prev) {
    const dt = (t - prev.t) / 1000;
    const dTotal = cpu.total - prev.cpu.total;
    const cpuPct = dTotal > 0 ? (1 - (cpu.idle - prev.cpu.idle) / dTotal) * 100 : 0;
    const share = usec => usec / 1e6 / dt / CORES * 100;          // доля всех ядер
    const svcPct = svcUsec != null && prev.svcUsec != null
      ? share(svcUsec - prev.svcUsec)
      : share((self.user - prev.self.user) + (self.system - prev.self.system));
    const svcMem = CGROUP ? cgroupNumber(CGROUP, 'memory.current') : process.memoryUsage().rss;
    const bps = k => disk && prev.disk ? Math.max(0, Math.round((disk[k] - prev.disk[k]) * 512 / dt)) : null;

    samples.push([t, round(Math.min(100, Math.max(0, cpuPct))), round(Math.max(0, svcPct), 2),
      mem.total - mem.available, svcMem, bps('rd'), bps('wr'), round(Math.max(0, lag))]);
    if (samples.length > CAP) samples.splice(0, samples.length - CAP);

    const sysUptime = Number((readText('/proc/uptime') || '0').split(' ')[0]);
    const prevTicks = new Map(prev.procs.map(p => [p.pid, p.ticks]));
    const heap = process.memoryUsage();
    live = {
      mem: { total: mem.total, available: mem.available, cached: mem.cached, swapTotal: mem.swapTotal, swapFree: mem.swapFree },
      load: os.loadavg().map(v => round(v, 2)),
      tasks: CGROUP ? cgroupNumber(CGROUP, 'pids.current') : null,
      heapUsed: heap.heapUsed, heapTotal: heap.heapTotal,
      procs: CGROUP
        ? procs.map(p => ({
            pid: p.pid, unit: p.unit, name: p.name, rss: p.rss, threads: p.threads,
            cpu: prevTicks.has(p.pid) ? round(share((p.ticks - prevTicks.get(p.pid)) / CLK_TCK * 1e6), 2) : null,
            uptime: Math.max(0, Math.round(sysUptime - p.start / CLK_TCK)),
          }))
        // Без systemd (разработка) показываем сам процесс сервера
        : [{ pid: process.pid, unit: null, name: 'node src/index.js', rss: heap.rss, threads: null,
             cpu: round(svcPct, 2), uptime: Math.round(process.uptime()) }],
    };
  }
  prev = { t, cpu, svcUsec, self, disk, procs };
}

// ── История ──
function save() {
  try {
    fs.writeFileSync(HISTORY_FILE + '.tmp', JSON.stringify({ samples, events }));
    fs.renameSync(HISTORY_FILE + '.tmp', HISTORY_FILE);
  } catch (e) {
    console.error('[Monitor] не удалось сохранить историю:', e.message);
  }
}

function load() {
  let data = null;
  try { data = JSON.parse(readText(HISTORY_FILE) || 'null'); } catch {}
  const now = Date.now();
  const since = now - CAP * STEP_MS;
  if (data) {
    samples.push(...(data.samples || []).filter(s => Array.isArray(s) && s[0] > since && s[0] <= now));
    events.push(...(data.events || []).filter(e => e && (e.t1 || now) > since));
  }
  // Отметка, начатая до остановки (обновление, перезапуск из админки), заканчивается
  // сейчас. Если остановки никто не отмечал, а в истории дыра — это тоже перезапуск.
  const open = events.filter(e => !e.t1);
  open.forEach(e => { e.t1 = now; });
  const lastT = samples.length ? samples[samples.length - 1][0] : 0;
  if (!open.length && lastT && now - lastT > 10000) events.push({ type: 'restart', t0: lastT, t1: now });
}

function addEvent(type) {
  events.push({ type, t0: Date.now(), t1: null });
  save();
}

// ── Данные для админки ──
function snapshot(since) {
  const from = Number(since) || 0;
  let i = samples.length;
  while (i > 0 && samples[i - 1][0] > from) i--;
  const cutoff = Date.now() - CAP * STEP_MS;
  return { now: Date.now(), step: STEP_MS, cores: CORES, samples: samples.slice(i), events: events.filter(e => (e.t1 || Date.now()) > cutoff), live };
}

function hostInfo() {
  const pretty = ((readText('/etc/os-release') || '').match(/^PRETTY_NAME="?([^"\n]*)"?/m) || [])[1];
  return { hostname: os.hostname(), os: pretty || `${os.type()} ${os.release()}`, cores: CORES, memTotal: os.totalmem() };
}

let svcInfo = null, svcInfoAt = 0;
function serviceInfo() {
  if (!UNIT) return Promise.resolve(null);
  if (svcInfo && Date.now() - svcInfoAt < 30000) return Promise.resolve(svcInfo);
  return new Promise(resolve => {
    execFile('systemctl', ['show', UNIT, '--property=ActiveState,ActiveEnterTimestampMonotonic,NRestarts'], { timeout: 3000 }, (err, out) => {
      if (err) return resolve(svcInfo);
      const kv = {};
      for (const l of String(out).trim().split('\n')) { const i = l.indexOf('='); if (i > 0) kv[l.slice(0, i)] = l.slice(i + 1); }
      // Время запуска — от загрузки системы: btime из /proc/stat плюс монотонная отметка systemd.
      // Формат ActiveEnterTimestamp зависит от локали и версии systemd, а эти числа — нет.
      const btime = Number(((readText('/proc/stat') || '').match(/^btime (\d+)/m) || [])[1] || 0);
      const mono = Number(kv.ActiveEnterTimestampMonotonic || 0);
      svcInfo = {
        unit: UNIT,
        state: kv.ActiveState || null,
        since: btime && mono ? Math.round(btime * 1000 + mono / 1000) : null,
        restarts: kv.NRestarts != null && kv.NRestarts !== '' ? Number(kv.NRestarts) : null,
      };
      svcInfoAt = Date.now();
      resolve(svcInfo);
    });
  });
}

// Размеры папок — это обход файлов, поэтому не чаще раза в минуту
function dirStats(dir, isAux) {
  let size = 0, count = 0, latest = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      try {
        const st = fs.statSync(path.join(dir, name));
        if (!st.isFile()) continue;
        size += st.size;
        if (isAux && isAux(name)) continue;       // миниатюры: место занимают, файлом не считаются
        count++;
        latest = Math.max(latest, st.mtimeMs);
      } catch {}
    }
  } catch {}
  return { size, count, latest: latest || null };
}

let storage = null, storageAt = 0;
function storageInfo() {
  if (storage && Date.now() - storageAt < 60000) return storage;
  const sizeOf = p => { try { return fs.statSync(p).size; } catch { return 0; } };
  let disk = null;
  try { const s = fs.statfsSync(DATA_DIR); disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch {}
  const files = dirStats(path.join(DATA_DIR, 'files'), n => n.endsWith('_t.webp'));
  storage = {
    disk,
    db: sizeOf(DB_PATH),
    wal: sizeOf(DB_PATH + '-wal'),
    files: { size: files.size, count: files.count },
    backups: dirStats(path.join(DATA_DIR, 'backups')),
    avatars: { size: dirStats(path.join(DATA_DIR, 'avatar')).size },
  };
  storageAt = Date.now();
  return storage;
}

function start() {
  load();
  startLag();
  sample();
  setInterval(sample, STEP_MS).unref();
  setInterval(save, 5 * 60000).unref();
  // Сохраняем историю при остановке службы: systemd шлёт SIGTERM
  const stop = () => { save(); process.exit(0); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

module.exports = { start, snapshot, addEvent, hostInfo, serviceInfo, storageInfo, UPDATE_UNIT };
