'use strict';
// ── ВОССТАНОВЛЕНИЕ ИЗ РЕЗЕРВНОЙ КОПИИ НА POSTGRESQL ──
//
// То же, что restore.js, только для PostgreSQL: выборочное слияние из файла копии (SQLite) в работающую
// базу, три части включаются отдельно (люди, чаты, настройки), всё в одной транзакции, ошибка откатывает
// всё. Описание правил слияния — в restore.js. На время работы включается режим обслуживания (запись
// клиентов остановлена, чтение работает): иначе параллельные сообщения терялись бы вместе с заменой чатов.
const dal = require('./dal');
const maintenance = require('./maintenance');
const { PROTECTED_SETTINGS, openCopy, cleanSide, colsOf, stat, settingsMap, settingsDiff } = require('./restorecommon');

let busy = false;
const BATCH_PARAMS = 30000;

// Те же таблицы чатов и ссылки на людей, что в restore.js: [таблица, столбцы с людьми (можно пустые), столбцы с людьми (обязательные)]
const CHAT_TABLES = [
  ['reactions', [], ['user_id']], ['status_log', [], ['user_id']], ['pinned_messages', ['pinned_by'], []],
  ['chat_read_state', [], ['user_id']], ['muted_chats', [], ['user_id']],
  ['secret_grants', [], ['granter_user_id']], ['secret_key_requests', ['approver_user_id'], ['requester_user_id']], ['secret_chat_devices', [], ['user_id']],
  ['webhooks', [], ['user_id']], ['chat_members', [], ['user_id']], ['messages', ['sender_id'], []], ['chats', ['created_by'], []],
];

const one = async (sql, ...p) => (await dal.get(sql, ...p)) || {};
async function statPg() {
  return {
    users: (await one('SELECT COUNT(*) AS c FROM users WHERE is_bot IS NULL OR is_bot = 0')).c || 0,
    rooms: (await one("SELECT COUNT(*) AS c FROM chats WHERE type = 'room' AND parent_id IS NULL")).c || 0,
    groups: (await one("SELECT COUNT(*) AS c FROM chats WHERE type = 'group'")).c || 0,
    direct: (await one("SELECT COUNT(*) AS c FROM chats WHERE type = 'direct'")).c || 0,
    msgs: (await one('SELECT COUNT(*) AS c FROM messages WHERE deleted = 0')).c || 0,
    last: (await one('SELECT MAX(sent_at) AS t FROM messages WHERE deleted = 0')).t || null,
  };
}

// Сравнение «сейчас → в копии» для окна подтверждения; ничего не пишет
async function inspect(file) {
  const c = openCopy(file);
  try {
    const now = await statPg(), copy = stat(c);
    const curUsers = new Map((await dal.all('SELECT username, password_hash, is_admin FROM users')).map(u => [u.username, u]));
    let uNew = 0, uUpd = 0, pw = 0;
    const hasAdm = colsOf(c, 'users').includes('is_admin');
    for (const u of c.prepare('SELECT username, password_hash FROM users').all()) {
      if (u.username === '__system__') continue;
      const cu = curUsers.get(u.username);
      if (!cu) uNew++;
      else if (!cu.is_admin) { uUpd++; if (cu.password_hash !== u.password_hash) pw++; }
    }
    const lost = copy.last ? (await one('SELECT COUNT(*) AS c FROM messages WHERE deleted = 0 AND sent_at > ?', copy.last)).c : now.msgs;
    return {
      now, copy, uNew, uUpd, pw, lost,
      settings: settingsDiff(settingsMap(await dal.all('SELECT key, value FROM settings')), settingsMap(c.prepare('SELECT key, value FROM settings').all())),
      admins: (await dal.all("SELECT username FROM users WHERE is_admin = 1 AND (is_bot IS NULL OR is_bot = 0) ORDER BY username")).map(r => r.username),
      schemaOk: true, hasAdminCol: hasAdm,
    };
  } finally { c.close(); cleanSide(file); }
}

async function targetCols(t) {
  return (await dal.all("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND is_generated = 'NEVER' ORDER BY ordinal_position", t)).map(r => r.column_name);
}

// Применяет выбранные части. Возвращает итог для окна; бросает ошибку с понятным текстом
async function apply(file, opts) {
  if (busy) throw new Error('Восстановление уже идёт');
  const o = { users: !!opts.users, chats: !!opts.chats, settings: !!opts.settings };
  if (o.chats) o.users = true;           // чаты ссылаются на людей
  if (!o.users && !o.chats && !o.settings) throw new Error('Не выбрано, что восстанавливать');
  const c = openCopy(file);
  busy = true;
  maintenance.on('restore');
  const res = { users: null, chats: null, settings: 0, logout: [] };
  try {
    await maintenance.privileged(() => dal.tx(async () => {
      await dal.run('SET CONSTRAINTS ALL DEFERRED');
      const bkHas = t => !!c.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
      const common = async t => { const m = new Set(await targetCols(t)); return colsOf(c, t).filter(x => m.has(x)); };
      const umap = new Map();
      const loaded = [];            // таблицы, у которых после загрузки нужно поправить счётчик id

      // ── люди ──
      if (o.users) {
        const cur = new Map((await dal.all('SELECT id, username, password_hash, banned, is_admin FROM users')).map(u => [u.username, u]));
        const cu = await common('users');
        const ucols = cu.filter(x => !['id', 'username', 'created_at', 'last_seen_at', 'sessions_valid_from'].includes(x));
        const icols = cu.filter(x => x !== 'id');
        let added = 0, updated = 0, pw = 0;
        for (const u of c.prepare('SELECT * FROM users').all()) {
          const ex = cur.get(u.username);
          if (u.username === '__system__') { if (ex) umap.set(u.id, ex.id); continue; }
          if (ex) {
            umap.set(u.id, ex.id);
            if (ex.is_admin) continue;                        // текущих администраторов не трогаем
            const relog = (ex.password_hash !== u.password_hash || (u.banned || 0) !== (ex.banned || 0)) ? 1 : 0;
            if (ucols.length) await dal.run(`UPDATE users SET ${ucols.map(x => `${x} = ?`).join(', ')}, sessions_valid_from = CASE WHEN ? = 1 THEN unixepoch() ELSE sessions_valid_from END WHERE id = ?`,
              ...ucols.map(x => u[x] ?? null), relog, ex.id);
            updated++; if (ex.password_hash !== u.password_hash) pw++;
            if (relog) res.logout.push(ex.id);
          } else {
            const r = await dal.run(`INSERT INTO users (${icols.join(', ')}) VALUES (${icols.map(() => '?').join(', ')})`, ...icols.map(x => u[x] ?? null));
            umap.set(u.id, r.lastId); added++;
          }
        }
        res.users = { added, updated, pw };
        loaded.push('users');
      }

      // ── чаты ──
      if (o.chats) {
        // Таблицы, которые ссылаются на чаты, но в копию не входят (папки, приглашения): удаление чатов стёрло бы их каскадом.
        // Запоминаем строки и возвращаем те, чьи чаты остались
        const fkRows = await dal.all(`SELECT c.conrelid::regclass::text AS tbl, a.attname AS col FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
          WHERE c.contype = 'f' AND c.confrelid = 'chats'::regclass`);
        const inList = new Set(CHAT_TABLES.map(x => x[0]));
        const keep = [];
        for (const f of fkRows) if (!inList.has(f.tbl) && f.tbl !== 'chats') keep.push({ tbl: f.tbl, col: f.col, rows: await dal.all(`SELECT * FROM ${f.tbl}`) });

        for (const [t] of CHAT_TABLES) await dal.run(`DELETE FROM ${t}`);
        const ident = [...umap].every(([a, b]) => a === b);
        for (const [t, nul, req] of [...CHAT_TABLES].reverse()) {
          if (!bkHas(t)) continue;
          const cs = await common(t); if (!cs.length) continue;
          const ucol = new Set([...nul, ...req]);
          const reqCols = req.filter(x => cs.includes(x));
          const per = Math.max(1, Math.min(2000, Math.floor(BATCH_PARAMS / cs.length)));
          let batch = [];
          const flush = async () => {
            if (!batch.length) return;
            const vals = []; const sqlRows = batch.map(r => { cs.forEach(x => vals.push(r[x])); return '(' + cs.map(() => '?').join(', ') + ')'; });
            await dal.run(`INSERT INTO ${t} (${cs.join(', ')}) VALUES ${sqlRows.join(', ')}`, ...vals);
            batch = [];
          };
          for (const r of c.prepare(`SELECT ${cs.join(', ')} FROM ${t}`).iterate()) {
            if (reqCols.some(x => !umap.has(r[x]))) continue;       // без человека строка бессмысленна
            const row = {};
            for (const x of cs) row[x] = ucol.has(x) ? (r[x] == null ? null : (umap.get(r[x]) ?? null)) : (r[x] === undefined ? null : r[x]);
            // упоминания хранят номера людей списком: переписываем, если номера в копии и в базе различаются
            if (t === 'messages' && !ident && row.mentions) { try { const a = JSON.parse(row.mentions); if (Array.isArray(a)) row.mentions = JSON.stringify(a.map(x => umap.get(x) ?? x)); } catch {} }
            batch.push(row);
            if (batch.length >= per) await flush();
          }
          await flush();
          loaded.push(t);
        }
        // Копия, снятая до перехода на отметки статусов, хранит их строками message_status: сводим их в отметки.
        // Времени в такой копии для журнала нет, поэтому полным журнал считается только с этого момента
        if (bkHas('message_status')) {
          const agg = new Map();
          for (const r of c.prepare('SELECT ms.user_id, m.chat_id, ms.read_at, ms.delivered_at, m.id FROM message_status ms JOIN messages m ON m.id = ms.message_id').iterate()) {
            const u = umap.get(r.user_id); if (u == null) continue;
            const k = u + ':' + r.chat_id, a = agg.get(k) || { u, chat: r.chat_id, r: 0, d: 0 };
            if (r.read_at != null) a.r = Math.max(a.r, r.id);
            if (r.read_at != null || r.delivered_at != null) a.d = Math.max(a.d, r.id);
            agg.set(k, a);
          }
          const all = [...agg.values()];
          for (let i = 0; i < all.length; i += 1000) {
            const part = all.slice(i, i + 1000);
            await dal.run(`INSERT INTO chat_read_state (user_id, chat_id, last_read_id, delivered_id) VALUES ${part.map(() => '(?, ?, ?, ?)').join(', ')}
              ON CONFLICT(user_id, chat_id) DO UPDATE SET last_read_id = MAX(chat_read_state.last_read_id, excluded.last_read_id),
                delivered_id = MAX(chat_read_state.delivered_id, excluded.delivered_id)`, ...part.flatMap(a => [a.u, a.chat, a.r, a.d]));
          }
        }
        await dal.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('status_log_from', ?)", String(Math.floor(Date.now() / 1000)));
        // вернуть строки папок, приглашений и т. п. для чатов, которые остались
        const chatIds = new Set((await dal.all('SELECT id FROM chats')).map(x => x.id));
        for (const k of keep) {
          for (const r of k.rows) {
            if (!chatIds.has(r[k.col])) continue;
            const cols = Object.keys(r);
            await dal.run(`INSERT INTO ${k.tbl} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`, ...cols.map(x => r[x]));
          }
        }
      }

      // ── настройки ──
      if (o.settings && bkHas('settings')) {
        const prot = PROTECTED_SETTINGS;
        await dal.run(`DELETE FROM settings WHERE key NOT IN (${prot.map(() => '?').join(', ')})`, ...prot);
        for (const r of c.prepare('SELECT key, value FROM settings').all()) {
          if (prot.includes(r.key)) continue;
          await dal.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', r.key, r.value);
        }
        res.settings = (await one('SELECT COUNT(*) AS c FROM settings')).c;
      }

      // Счётчики id продолжаются с наибольшего перенесённого
      for (const t of loaded) {
        const hasId = (await dal.get("SELECT 1 AS x FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = 'id' AND is_identity = 'YES'", t));
        if (hasId) {
          // Счётчик только растёт: номера удалённых при восстановлении строк (особенно сообщений, которые помнит
          // федерация) заново не выдаются
          const mx = Number((await dal.get(`SELECT COALESCE(MAX(id), 0) AS m FROM "${t}"`)).m) || 0;
          const v = Math.max(mx, await dal.seq(t));
          await dal.get(`SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), ?, ?)`, Math.max(v, 1), v > 0 ? true : false);
        }
      }
      if (o.chats) res.chats = await statPg();
    }));
    return res;
  } finally {
    maintenance.off();
    try { c.close(); } catch {}
    cleanSide(file);
    busy = false;
    dal.run('ANALYZE').catch(() => {});
  }
}

module.exports = { inspect, apply };
