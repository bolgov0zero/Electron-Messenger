'use strict';
// Несколько вложений в одном сообщении. Первое лежит в самом attachment, остальные — в attachment.more (массив до 9).
// Так старые клиенты и все места сервера, читающие attachment.url, видят первое вложение и не ломаются.
const fs = require('fs');
const path = require('path');
const dal = require('./dal');

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
// Голосовое сообщение: аудиофайл с длительностью и огибающей громкости (до 64 столбиков 0..31) для волны в пузыре
const VOICE_MAX_SEC = 600;
const VOICE_MIME_RE = /^audio\/(webm|ogg|mp4)$/;
function cleanVoice(att) {
  const v = att && att.voice;
  if (!v || typeof v !== 'object' || typeof att.url !== 'string' || !URL_RE.test(att.url) || att.enc || att.gif !== undefined) return null;
  const mime = typeof att.mime === 'string' ? att.mime.split(';')[0].trim().toLowerCase() : '';
  if (!VOICE_MIME_RE.test(mime)) return null;
  const dur = Math.min(VOICE_MAX_SEC, Math.max(1, Math.round(Number(v.dur)) || 1));
  const wave = (Array.isArray(v.wave) ? v.wave : []).slice(0, 64).map(n => Math.min(31, Math.max(0, Math.round(Number(n)) || 0)));
  return { url: att.url, name: 'voice', mime, size: Math.max(0, Math.floor(Number(att.size)) || 0), voice: { dur, wave } };
}
// Вложение от клиента: лишнее в more отбрасываем
function sanitize(att) {
  if (att && typeof att === 'object' && att.voice !== undefined) return cleanVoice(att);
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
// Превью ленты (имя_p.webp) делается при первом просмотре и удаляется вместе с файлом
const previewOf = u => (typeof u === 'string' && /\.(jpe?g|png|webp)$/i.test(u)) ? u.replace(/\.[^.\/]*$/, '') + '_p.webp' : null;
const urls = att => list(att).flatMap(a => [a.url, a.thumb, previewOf(a.url)]).filter(u => typeof u === 'string' && u);
// Помечает недоступные (стёртые с диска) файлы
function markExpired(att) {
  if (!att) return att;
  const gone = a => a.url && !fs.existsSync(path.join(FILES_DIR, path.basename(a.url)));
  const out = gone(att) ? { ...att, expired: true } : { ...att };
  if (Array.isArray(att.more)) out.more = att.more.map(a => (gone(a) ? { ...a, expired: true } : a));
  return out;
}
// Удаляет файлы сообщения, на которые больше никто не ссылается (другие сообщения, пересылки)
async function release(att, exceptMsgId) {
  for (const a of list(att)) {
    if (!a.url) continue;
    const fname = path.basename(a.url);
    const refs = (await dal.get("SELECT COUNT(*) c FROM messages WHERE id != ? AND deleted = 0 AND (attachment LIKE ? OR forward_data LIKE ?)", exceptMsgId || 0, `%${fname}%`, `%${fname}%`)).c;
    if (refs) continue;
    [a.url, a.thumb, previewOf(a.url)].forEach(u => { if (u) { try { fs.unlinkSync(path.join(FILES_DIR, path.basename(u))); } catch {} } });
  } ;
}
// Удаляет все файлы без проверки ссылок (чат удалён целиком)
function purge(att) {
  urls(att).forEach(u => { const p = path.join(FILES_DIR, path.basename(u)); try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
}
module.exports = { MAX_MORE, sanitize, list, urls, markExpired, release, purge };
