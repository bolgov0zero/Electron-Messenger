'use strict';
// ── ВОССТАНОВЛЕНИЕ ИЗ РЕЗЕРВНОЙ КОПИИ ──
//
// Не подмена файла базы, а выборочное слияние в работающей базе: копия подключается как вторая база
// (ATTACH), нужные части переносятся в одной транзакции, при любой ошибке всё откатывается. Перезапуск
// сервера не нужен. Три части, каждая включается отдельно:
//   users    — люди из копии сопоставляются с текущими по логину: недостающие добавляются, у существующих
//              обновляются данные. Никого не удаляем. Текущие администраторы не трогаются вообще
//              (пароль, права и 2FA остаются как сейчас), поэтому доступ в админку не пропадёт;
//   chats    — комнаты, темы, группы и личные переписки заменяются теми, что в копии (участники, сообщения,
//              реакции, закрепы, вебхуки, секретные чаты). Чаты ссылаются на людей, поэтому chats включает users;
//   settings — настройки из копии, кроме технических ключей (подпись входа, ключи push, id системного
//              пользователя): их подмена сбросила бы входы и уведомления у всех.
// Номера людей в копии и в базе могут не совпадать (другой сервер, пересозданные учётки), поэтому все ссылки
// на людей переписываются через таблицу соответствия по логину.

const fs = require('fs');
const Database = require('better-sqlite3');
const db = require('./db');

const PROTECTED_SETTINGS = ['jwt_secret', 'vapid_public', 'vapid_private', 'vapid_public_key', 'vapid_private_key', 'system_user_id', 'fts_secret_v2'];
const REQUIRED_TABLES = ['users', 'chats', 'messages', 'settings'];
let busy = false;

// Копия открывается только на чтение; все проверки — до того, как что-то будет записано
function openCopy(file) {
  // Сначала смотрим заголовок (первые 16 байт), а не читаем файл целиком: копии бывают в сотни мегабайт
  const buf = Buffer.alloc(16);
  try { const fd = fs.openSync(file, 'r'); try { fs.readSync(fd, buf, 0, 16, 0); } finally { fs.closeSync(fd); } }
  catch { throw new Error('Не удалось прочитать файл'); }
  if (!buf.toString('latin1').startsWith('SQLite format 3')) throw new Error('Это не файл базы SQLite');
  let c;
  try { c = new Database(file, { readonly: true, fileMustExist: true }); }
  catch { throw new Error('Это не файл базы SQLite'); }
  try {
    const have = new Set(c.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
    const miss = REQUIRED_TABLES.filter(t => !have.has(t));
    if (miss.length) throw new Error('В файле нет таблиц чата: ' + miss.join(', '));
    const chk = c.pragma('integrity_check', { simple: true });
    if (chk !== 'ok') throw new Error('Файл повреждён: проверка целостности не прошла');
    return c;
  } catch (e) { try { c.close(); } catch {} throw e; }
}
// Открытая на чтение копия в режиме WAL оставляет рядом служебные файлы -wal и -shm — убираем их за собой
const cleanSide = f => { for (const x of ['-wal', '-shm']) { try { fs.unlinkSync(f + x); } catch {} } };
const colsOf = (conn, t, schema = 'main') => { try { return conn.prepare(`PRAGMA ${schema}.table_info(${t})`).all().map(c => c.name); } catch { return []; } };

const stat = (conn) => {
  const has = (t, c) => colsOf(conn, t).includes(c);
  const one = (sql) => { try { return conn.prepare(sql).get(); } catch { return null; } };
  const notBot = has('users', 'is_bot') ? 'WHERE is_bot IS NULL OR is_bot = 0' : '';
  const alive = has('messages', 'deleted') ? 'WHERE deleted = 0' : '';
  const top = has('chats', 'parent_id') ? ' AND parent_id IS NULL' : '';
  return {
    users: one(`SELECT COUNT(*) AS c FROM users ${notBot}`)?.c || 0,
    rooms: one(`SELECT COUNT(*) AS c FROM chats WHERE type='room'${top}`)?.c || 0,
    groups: one("SELECT COUNT(*) AS c FROM chats WHERE type='group'")?.c || 0,
    direct: one("SELECT COUNT(*) AS c FROM chats WHERE type='direct'")?.c || 0,
    msgs: one(`SELECT COUNT(*) AS c FROM messages ${alive}`)?.c || 0,
    last: one(`SELECT MAX(sent_at) AS t FROM messages ${alive}`)?.t || null,
  };
};

const SET_LABEL = {
  github_token: 'GitHub-токен', backup_retention_days: 'Хранить копии', edit_time_limit: 'Время на правку сообщения',
  upload_image_max_size: 'Изображения: размер', upload_video_max_size: 'Видео: размер', upload_file_max_size: 'Файлы: размер',
  upload_file_lifetime: 'Срок хранения файлов',
};
const DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
function settingsMap(rows) { return new Map(rows.map(r => [r.key, r.value])); }
function settingsDiff(cur, cp) {
  const out = [];
  const show = (k, m) => {
    const v = m.get(k);
    if (k === 'github_token') return v ? 'задан' : 'не задан';
    if (k === 'backup_retention_days') return v ? `${v} дн.` : 'всегда';
    return v ? String(v) : 'не задано';
  };
  for (const k of Object.keys(SET_LABEL)) if ((cur.get(k) || '') !== (cp.get(k) || '')) out.push([SET_LABEL[k], show(k, cur), show(k, cp)]);
  const sched = m => { const d = (m.get('backup_schedule_days') || '').split(',').filter(Boolean).map(n => DAYS[Number(n)]).join(', '); return d ? `${d} в ${m.get('backup_schedule_time') || '—'}` : 'только вручную'; };
  if (sched(cur) !== sched(cp)) out.push(['Расписание копий', sched(cur), sched(cp)]);
  return out;
}

// Сравнение «сейчас → в копии» для окна подтверждения; ничего не пишет
function inspect(file) {
  const c = openCopy(file);
  try {
    const now = stat(db), copy = stat(c);
    const curUsers = new Map(db.prepare('SELECT username, password_hash, is_admin FROM users').all().map(u => [u.username, u]));
    let uNew = 0, uUpd = 0, pw = 0;
    const hasAdm = colsOf(c, 'users').includes('is_admin');
    for (const u of c.prepare('SELECT username, password_hash FROM users').all()) {
      if (u.username === '__system__') continue;
      const cu = curUsers.get(u.username);
      if (!cu) uNew++;
      else if (!cu.is_admin) { uUpd++; if (cu.password_hash !== u.password_hash) pw++; }
    }
    const lost = copy.last ? db.prepare('SELECT COUNT(*) AS c FROM messages WHERE deleted = 0 AND sent_at > ?').get(copy.last).c : now.msgs;
    return {
      now, copy, uNew, uUpd, pw, lost,
      settings: settingsDiff(settingsMap(db.prepare('SELECT key, value FROM settings').all()), settingsMap(c.prepare('SELECT key, value FROM settings').all())),
      admins: db.prepare("SELECT username FROM users WHERE is_admin = 1 AND (is_bot IS NULL OR is_bot = 0) ORDER BY username").all().map(r => r.username),
      schemaOk: true, hasAdminCol: hasAdm,
    };
  } finally { c.close(); cleanSide(file); }
}

const FTS_TRIGGERS = `
  DROP TRIGGER IF EXISTS messages_fts_ai; DROP TRIGGER IF EXISTS messages_fts_ad; DROP TRIGGER IF EXISTS messages_fts_au;
  DROP TRIGGER IF EXISTS messages_fts_au_del; DROP TRIGGER IF EXISTS messages_fts_au_ins;`;
const FTS_TRIGGERS_NEW = `
  CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages WHEN new.iv IS NULL BEGIN
    INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages WHEN old.iv IS NULL BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
  END;
  CREATE TRIGGER messages_fts_au_del AFTER UPDATE OF text ON messages WHEN old.iv IS NULL BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
  END;
  CREATE TRIGGER messages_fts_au_ins AFTER UPDATE OF text ON messages WHEN new.iv IS NULL BEGIN
    INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
  END;`;

// Таблицы чатов: от зависимых к главным (так их чистим); для каждой — какие столбцы ссылаются на людей
// (nullable — можно оставить пустым, req — без человека строка бессмысленна и пропускается)
const CHAT_TABLES = [
  ['reactions', [], ['user_id']], ['message_status', [], ['user_id']], ['pinned_messages', ['pinned_by'], []],
  ['chat_read_state', [], ['user_id']], ['muted_chats', [], ['user_id']],
  ['secret_grants', [], ['granter_user_id']], ['secret_key_requests', ['approver_user_id'], ['requester_user_id']], ['secret_chat_devices', [], ['user_id']],
  ['webhooks', [], ['user_id']], ['chat_members', [], ['user_id']], ['messages', ['sender_id'], []], ['chats', ['created_by'], []],
];

// Применяет выбранные части. Возвращает итог для окна; бросает ошибку с понятным текстом
function apply(file, opts) {
  if (busy) throw new Error('Восстановление уже идёт');
  const o = { users: !!opts.users, chats: !!opts.chats, settings: !!opts.settings };
  if (o.chats) o.users = true;           // чаты ссылаются на людей
  if (!o.users && !o.chats && !o.settings) throw new Error('Не выбрано, что восстанавливать');
  const probe = openCopy(file); probe.close(); cleanSide(file);
  busy = true;
  const tmp = file + '.apply-' + Date.now();
  const res = { users: null, chats: null, settings: 0, logout: [] };
  let attached = false;
  try {
    fs.copyFileSync(file, tmp);          // работаем с копией копии: исходный файл остаётся нетронутым
    db.prepare('ATTACH DATABASE ? AS bk').run(tmp); attached = true;
    const bkHas = t => !!db.prepare("SELECT 1 FROM bk.sqlite_master WHERE type='table' AND name = ?").get(t);
    const common = t => { const m = new Set(colsOf(db, t, 'main')); return colsOf(db, t, 'bk').filter(c => m.has(c)); };
    db.pragma('foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DROP TABLE IF EXISTS temp.umap; CREATE TEMP TABLE umap (bk INTEGER PRIMARY KEY, cur INTEGER)');
      // ── люди ──
      if (o.users) {
        const cur = new Map(db.prepare('SELECT id, username, password_hash, banned, is_admin FROM main.users').all().map(u => [u.username, u]));
        const ucols = common('users').filter(c => !['id', 'username', 'created_at', 'last_seen_at', 'sessions_valid_from'].includes(c));
        const icols = common('users').filter(c => c !== 'id');
        const upd = ucols.length ? db.prepare(`UPDATE main.users SET ${ucols.map(c => `${c} = @${c}`).join(', ')}, sessions_valid_from = CASE WHEN @relog = 1 THEN unixepoch() ELSE sessions_valid_from END WHERE id = @id`) : null;
        const ins = db.prepare(`INSERT INTO main.users (${icols.join(', ')}) VALUES (${icols.map(c => '@' + c).join(', ')})`);
        const map = db.prepare('INSERT OR REPLACE INTO temp.umap (bk, cur) VALUES (?, ?)');
        let added = 0, updated = 0, pw = 0;
        for (const u of db.prepare('SELECT * FROM bk.users').all()) {
          const c = cur.get(u.username);
          if (u.username === '__system__') { if (c) map.run(u.id, c.id); continue; }
          if (c) {
            map.run(u.id, c.id);
            if (c.is_admin) continue;                        // текущих администраторов не трогаем
            const relog = (c.password_hash !== u.password_hash || (u.banned || 0) !== (c.banned || 0)) ? 1 : 0;
            if (upd) upd.run({ ...Object.fromEntries(ucols.map(k => [k, u[k] ?? null])), relog, id: c.id });
            updated++; if (c.password_hash !== u.password_hash) pw++;
            if (relog) res.logout.push(c.id);
          } else {
            const r = ins.run(Object.fromEntries(icols.map(k => [k, u[k] ?? null])));
            map.run(u.id, Number(r.lastInsertRowid)); added++;
          }
        }
        res.users = { added, updated, pw };
      }
      // ── чаты ──
      if (o.chats) {
        const fts = !!db.prepare("SELECT 1 FROM main.sqlite_master WHERE name = 'messages_fts'").get();
        if (fts) db.exec(FTS_TRIGGERS);
        for (const [t] of CHAT_TABLES) db.exec(`DELETE FROM main.${t}`);
        for (const [t, nul, req] of [...CHAT_TABLES].reverse()) {
          if (!bkHas(t)) continue;
          const cs = common(t); if (!cs.length) continue;
          const ucol = new Set([...nul, ...req]);
          const sel = cs.map(c => ucol.has(c) ? `(SELECT cur FROM temp.umap WHERE bk = s.${c})` : `s.${c}`);
          const where = req.filter(c => cs.includes(c)).map(c => `EXISTS (SELECT 1 FROM temp.umap WHERE bk = s.${c})`).join(' AND ');
          db.exec(`INSERT INTO main.${t} (${cs.join(', ')}) SELECT ${sel.join(', ')} FROM bk.${t} s${where ? ' WHERE ' + where : ''}`);
        }
        // упоминания хранят номера людей списком: переписываем, только если номера в копии и в базе различаются
        const ident = db.prepare('SELECT COUNT(*) AS c FROM temp.umap WHERE bk != cur').get().c === 0;
        if (!ident && common('messages').includes('mentions')) {
          const mp = new Map(db.prepare('SELECT bk, cur FROM temp.umap').all().map(r => [r.bk, r.cur]));
          const up = db.prepare('UPDATE main.messages SET mentions = ? WHERE id = ?');
          for (const r of db.prepare('SELECT id, mentions FROM main.messages WHERE mentions IS NOT NULL').all()) {
            try { const a = JSON.parse(r.mentions); if (Array.isArray(a)) up.run(JSON.stringify(a.map(x => mp.get(x) ?? x)), r.id); } catch {}
          }
        }
        if (fts) {
          db.exec("INSERT INTO messages_fts(messages_fts) VALUES ('delete-all')");
          db.exec('INSERT INTO messages_fts(rowid, text) SELECT id, text FROM main.messages WHERE iv IS NULL');
          db.exec(FTS_TRIGGERS_NEW);
        }
        res.chats = stat(db);
      }
      // ── настройки ──
      if (o.settings && bkHas('settings')) {
        const keep = PROTECTED_SETTINGS.map(k => `'${k}'`).join(', ');
        db.exec(`DELETE FROM main.settings WHERE key NOT IN (${keep})`);
        db.exec(`INSERT OR REPLACE INTO main.settings (key, value) SELECT key, value FROM bk.settings WHERE key NOT IN (${keep})`);
        res.settings = db.prepare('SELECT COUNT(*) AS c FROM main.settings').get().c;
      }
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
    try { const bad = db.prepare('PRAGMA foreign_key_check').all(); if (bad.length) console.warn('[Restore] Ссылки с пробелами после восстановления:', bad.length); } catch {}
    return res;
  } finally {
    try { db.pragma('foreign_keys = ON'); } catch {}
    if (attached) { try { db.exec('DROP TABLE IF EXISTS temp.umap'); } catch {} try { db.prepare('DETACH DATABASE bk').run(); } catch {} }
    try { fs.unlinkSync(tmp); } catch {}
    cleanSide(tmp); cleanSide(file);
    busy = false;
  }
}

module.exports = { inspect, apply, PROTECTED_SETTINGS };
