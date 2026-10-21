// GIF из Klipy (модуль «gif»). Файлов на нашем сервере нет: в сообщении хранится только ссылка на ролик у Klipy и его
// описание. Сервер здесь лишь хранит ключ API (его вводит администратор), отдаёт его клиентам включённого модуля
// и проверяет вложение: чужого в сообщение не положить, только адреса Klipy и только в обычных чатах.
//
// Условия Klipy требуют, чтобы запросы к их API и загрузка картинок шли с устройства пользователя, поэтому поиск
// сервер не проксирует и не кэширует.
const dal = require('./dal');

const KEY = 'gif_klipy_key';
const getKey = async () => (await dal.get('SELECT value FROM settings WHERE key = ?', KEY))?.value || '';
async function setKey(v) {
  if (!v) await dal.run('DELETE FROM settings WHERE key = ?', KEY);
  else await dal.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', KEY, v);
}
const isOn = async () => !!(await dal.get("SELECT enabled FROM modules WHERE key = 'gif'"))?.enabled && !!(await getKey());

// Ссылка допустима, если это https-адрес на домене klipy.com (или его поддомене), без лишнего
function klipyUrl(u) {
  if (typeof u !== 'string' || u.length > 600) return null;
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:' || x.username || x.password) return null;
    if (x.hostname !== 'klipy.com' && !x.hostname.endsWith('.klipy.com')) return null;
    return x.toString();
  } catch { return null; }
}
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '');
const dim = v => { const n = Math.round(Number(v)); return n > 0 && n < 4000 ? n : 0; };

// Вложение-GIF из присланного клиентом. null, если это не GIF или он некорректен.
function sanitize(att) {
  const g = att && typeof att === 'object' ? att.gif : null;
  if (!g || typeof g !== 'object') return null;
  const mp4 = klipyUrl(g.mp4), webp = klipyUrl(g.webp), jpg = klipyUrl(g.jpg);
  const slug = str(g.slug, 120);
  if (!slug || (!mp4 && !webp)) return null;
  const title = str(g.title, 120);
  return {
    mime: 'image/gif', name: title || 'GIF',
    gif: { provider: 'klipy', slug, title, w: dim(g.w) || 320, h: dim(g.h) || 240, mp4, webp, jpg },
  };
}

module.exports = { getKey, setKey, isOn, sanitize };
