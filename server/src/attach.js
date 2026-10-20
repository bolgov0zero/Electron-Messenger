'use strict';
// Несколько вложений в одном сообщении. Первое лежит в самом attachment, остальные — в attachment.more (массив до 9).
// Так старые клиенты и все места сервера, читающие attachment.url, видят первое вложение и не ломаются.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'chat_db', 'chat.db');
const FILES_DIR = path.join(path.dirname(DB_PATH), 'files');
const MAX_MORE = 9;
const URL_RE = /^\/files\/[\w.\-]+$/;
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

function cleanItem(a) {
  if (!a || typeof a !== 'object' || typeof a.url !== 'string' || !URL_RE.test(a.url) || a.gif !== undefined || a.enc) return null;
  const o = { url: a.url, name: str(a.name, 200) || 'file', mime: str(a.mime, 100), size: Math.max(0, Math.floor(Number(a.size)) || 0) };
  if (typeof a.thumb === 'string' && URL_RE.test(a.thumb)) o.thumb = a.thumb;
  if (Number(a.width) > 0 && Number(a.height) > 0) { o.width = Math.floor(Number(a.width)); o.height = Math.floor(Number(a.height)); }
  return o;
}
// Вложение от клиента: лишнее в more отбрасываем
function sanitize(att) {
  if (!att || typeof att !== 'object' || !('more' in att)) return att;
  const { more, ...rest } = att;
  if (att.gif !== undefined || att.enc) return rest;
  const clean = (Array.isArray(more) ? more : []).slice(0, MAX_MORE).map(cleanItem).filter(Boolean);
  return clean.length ? { ...rest, more: clean } : rest;
}
// Все вложения сообщения по порядку (первое без more)
function list(att) {
  if (!att || typeof att !== 'object') return [];
  const { more, ...first } = att;
  return [first, ...(Array.isArray(more) ? more : [])];
}
const urls = att => list(att).flatMap(a => [a.url, a.thumb]).filter(u => typeof u === 'string' && u);
// Помечает недоступные (стёртые с диска) файлы
function markExpired(att) {
  if (!att) return att;
  const gone = a => a.url && !fs.existsSync(path.join(FILES_DIR, path.basename(a.url)));
  const out = gone(att) ? { ...att, expired: true } : { ...att };
  if (Array.isArray(att.more)) out.more = att.more.map(a => (gone(a) ? { ...a, expired: true } : a));
  return out;
}
// Удаляет файлы сообщения, на которые больше никто не ссылается (другие сообщения, пересылки)
function release(att, exceptMsgId) {
  list(att).forEach(a => {
    if (!a.url) return;
    const fname = path.basename(a.url);
    const refs = db.prepare("SELECT COUNT(*) c FROM messages WHERE id != ? AND deleted = 0 AND (attachment LIKE ? OR forward_data LIKE ?)").get(exceptMsgId || 0, `%${fname}%`, `%${fname}%`).c;
    if (refs) return;
    [a.url, a.thumb].forEach(u => { if (u) { try { fs.unlinkSync(path.join(FILES_DIR, path.basename(u))); } catch {} } });
  });
}
// Удаляет все файлы без проверки ссылок (чат удалён целиком)
function purge(att) {
  urls(att).forEach(u => { const p = path.join(FILES_DIR, path.basename(u)); try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
}
module.exports = { MAX_MORE, sanitize, list, urls, markExpired, release, purge };
