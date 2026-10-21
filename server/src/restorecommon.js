'use strict';
// Общее для восстановления из копии на обоих движках (restore.js — SQLite, restorepg.js — PostgreSQL):
// открытие и проверка файла копии, сравнение настроек. Копия всегда файл SQLite: на PostgreSQL
// копии тоже делаются в этом формате (см. pgexport.js), поэтому один и тот же файл годится для обоих.
const fs = require('fs');
const Database = require('better-sqlite3');

const PROTECTED_SETTINGS = ['jwt_secret', 'vapid_public', 'vapid_private', 'vapid_public_key', 'vapid_private_key', 'system_user_id', 'fts_secret_v2', 'fed_id', 'fed_pub', 'fed_priv'];
const REQUIRED_TABLES = ['users', 'chats', 'messages', 'settings'];

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

module.exports = { PROTECTED_SETTINGS, REQUIRED_TABLES, openCopy, cleanSide, colsOf, stat, SET_LABEL, settingsMap, settingsDiff };
