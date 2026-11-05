// Заполнение стенда тестовыми данными, похожими на макет docs/flat-mockup/mobile.html.
// Запуск делает serve.sh:  node seed.js <порт> <путь к chat.db>
//   node seed.js hold <порт> <путь к chat.db>  — держит в сети тех, кто в макете «в сети» (запускается в фоне)
// Входной пользователь стенда — Мария Иванова: логин mivanova, пароль см. PASS ниже (только для локального стенда).
const path = require('path');
const fs = require('fs');
const SERVER = path.resolve(__dirname, '../../../server');
const req = m => require(require.resolve(m, { paths: [SERVER] }));
const Database = req('better-sqlite3'), bcrypt = req('bcryptjs'), WebSocket = req('ws'), sharp = req('sharp');

const HOLD = process.argv[2] === 'hold';
const args = HOLD ? process.argv.slice(3) : process.argv.slice(2);
const PORT = args[0] || '3999', DBP = args[1];
const BASE = 'http://localhost:' + PORT;
const PASS = 'stand-Flat-2026';
const ADMIN_PASS = 'stand-Admin-2026';

const PEOPLE = {
  me:      { u: 'mivanova',  n: 'Мария Иванова',   tag: null,     admin: 1 },
  dmitry:  { u: 'dsokolov',  n: 'Дмитрий Соколов', tag: 'Dev' },
  elena:   { u: 'emironova', n: 'Елена Миронова',  tag: 'Дизайн' },
  akrylov: { u: 'akrylov',   n: 'Алексей Крылов',  tag: 'Dev' },
  anna:    { u: 'alebedeva', n: 'Анна Лебедева',   tag: 'Лид' },
  marat:   { u: 'mhasanov',  n: 'Марат Хасанов',   tag: null },
  olga:    { u: 'obelyaeva', n: 'Ольга Беляева',   tag: null },
  petr:    { u: 'psidorov',  n: 'Пётр Сидоров',    tag: 'Dev' },
  admin:   { u: 'admin',     n: 'Администратор',   tag: 'Админ' },
};
const ONLINE = ['dmitry', 'elena', 'anna', 'admin', 'marat'];   // как в макете: остальные «был(а) недавно»

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(method, url, token, body, form) {
  const r = await fetch(BASE + url, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: form || (body ? JSON.stringify(body) : undefined) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(method + ' ' + url + ' → ' + r.status + ' ' + t.slice(0, 200));
  return j;
}
const login = async (u, p) => (await api('POST', '/api/auth/login', null, { username: u, password: p })).token;

const socks = {};
function connect(key, token) {
  return new Promise((res, rej) => {
    const ws = new WebSocket('ws://localhost:' + PORT + '/ws?token=' + token);
    const o = { ws, waiters: [] };
    ws.on('message', raw => { let d; try { d = JSON.parse(raw); } catch { return; } o.waiters = o.waiters.filter(w => !w(d)); });
    ws.on('open', () => { socks[key] = o; res(o); });
    ws.on('error', rej);
  });
}
const waitFor = (o, pred, ms = 5000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('таймаут ожидания')), ms);
  o.waiters.push(d => { if (pred(d)) { clearTimeout(t); res(d); return true; } return false; });
});

async function main() {
  const db = new Database(DBP);

  if (HOLD) {
    const TOKENS = JSON.parse(fs.readFileSync(path.join(path.dirname(DBP), 'tokens.json'), 'utf8'));   // токены сохранил основной запуск (вход ограничен 10 попытками в минуту)
    for (const k of ONLINE) {
      const row = db.prepare('SELECT username FROM users WHERE username = ?').get(PEOPLE[k].u);
      if (!row) continue;
      await connect(k, TOKENS[k]);
    }
    console.log('в сети:', Object.keys(socks).join(', '));
    setInterval(() => {}, 1 << 30);
    return;
  }

  // пароль администратора стенда; дальше все пользователи без обязательной смены пароля
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE username = ?').run(bcrypt.hashSync(ADMIN_PASS, 8), 'admin');
  const adminTok = await login('admin', ADMIN_PASS);
  const ids = { admin: db.prepare("SELECT id FROM users WHERE username='admin'").get().id };
  for (const [k, p] of Object.entries(PEOPLE)) {
    if (k === 'admin') continue;
    const r = await api('POST', '/api/users', adminTok, { username: p.u, password: PASS, display_name: p.n, is_admin: !!p.admin, tag: p.tag || undefined });
    ids[k] = r.id;
  }
  db.prepare('UPDATE users SET must_change_password = 0').run();
  const tok = { admin: adminTok };
  for (const k of Object.keys(PEOPLE)) if (k !== 'admin') tok[k] = await login(PEOPLE[k].u, PASS);
  fs.writeFileSync(path.join(path.dirname(DBP), 'tokens.json'), JSON.stringify(tok));
  for (const k of Object.keys(PEOPLE)) await connect(k, tok[k]);

  // ── чаты ──
  const chat = {};
  for (const k of ['marat', 'olga', 'elena', 'dmitry']) chat[k] = (await api('POST', '/api/chats/direct', tok.me, { user_id: ids[k] })).id;
  const grp = async (key, name, members) => { chat[key] = (await api('POST', '/api/chats/group', tok.me, { name, member_ids: members.map(m => ids[m]) })).id; };
  await grp('sever', 'Проект Север: запуск', ['anna', 'dmitry', 'marat']);
  await grp('dev', 'Разработка', ['akrylov', 'dmitry', 'petr']);
  await grp('rev', 'Дизайн-ревью', ['elena', 'dmitry', 'anna']);
  await grp('team', 'Команда продукта', ['dmitry', 'elena', 'akrylov']);
  chat.room = (await api('POST', '/api/admin/rooms', tok.admin, { name: 'Вся компания', member_ids: Object.keys(PEOPLE).map(k => ids[k]) })).id;
  const TOPICS = [['t-gen', 'Общее'], ['t-ann', 'Объявления'], ['t-rel', 'Релизы'], ['t-faq', 'Вопросы и ответы'], ['t-fun', 'Курилка']];
  for (const [k, n] of TOPICS) chat[k] = (await api('POST', '/api/admin/topics', tok.admin, { name: n, room_id: chat.room })).id;
  // «Анна добавила Петра» — служебная строка в группе Север
  await api('POST', '/api/chats/' + chat.sever + '/members', tok.me, { user_id: ids.petr });
  await sleep(200);

  // ── вложения ──
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('upload_file_extensions', 'pdf,docx,xlsx,zip,txt')").run();
  const upload = async (who, buf, name, mime) => {
    const f = new FormData(); f.append('file', new Blob([buf], { type: mime }), name);
    return api('POST', '/api/upload', tok[who], null, f);
  };
  const svg = (a, b, c) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs><rect width="900" height="560" fill="url(#g)"/><circle cx="700" cy="150" r="90" fill="#fff" fill-opacity=".25"/></svg>`);
  const png1 = await sharp(svg('#2ed3b7', '#6a6cf0', '#f0a020')).png().toBuffer();
  const png2 = await sharp(svg('#f0a020', '#d0566a', '#5a63c8')).png().toBuffer();
  const photo1 = await upload('elena', png1, 'demo.png', 'image/png');
  const photo2 = await upload('dmitry', png2, 'accent.png', 'image/png');
  const pdf = (n) => Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n' + ' '.repeat(n));
  const file1 = await upload('akrylov', pdf(1500), 'Roadmap_Q4.pdf', 'application/pdf');
  const file2 = await upload('dmitry', pdf(900), 'Release_notes_2.4.pdf', 'application/pdf');

  // ── сообщения ──
  const msgs = [];   // { id, tm }
  const byKey = {};
  const send = async (chatKey, who, o) => {
    const o1 = socks[who], cid = 's' + Math.random().toString(36).slice(2, 10);
    const p = waitFor(o1, d => d.type === 'message' && d.message && d.message.client_id === cid || d.type === 'send_rejected');
    const payload = { type: 'message', chat_id: chat[chatKey], text: o.t || '', client_id: cid };
    if (o.reply) payload.reply_to_id = byKey[o.reply];
    if (o.att) payload.attachment = o.att;
    if (o.fwd) payload.forward_data = o.fwd;
    o1.ws.send(JSON.stringify(payload));
    const d = await p;
    if (d.type === 'send_rejected') throw new Error('сообщение отклонено: ' + JSON.stringify(d));
    const id = d.message.id;
    if (o.key) byKey[o.key] = id;
    msgs.push({ id, tm: o.tm, chat: chatKey, who });
    for (const [em, who2] of o.re || []) socks[who2].ws.send(JSON.stringify({ type: 'react', message_id: id, reaction: em }));
    if (o.pin) socks[who].ws.send(JSON.stringify({ type: 'pin_message', message_id: id }));
    await sleep(40);
    return id;
  };
  const att = a => ({ url: a.url, thumb: a.thumb, name: a.name, size: a.size, mime: a.mime, width: a.width, height: a.height });

  // Команда продукта — главный чат переписки (как в макете)
  await send('team', 'dmitry', { t: 'Макеты профиля готовы, посмотрите вариант B', tm: '09:18', key: 't1', pin: 1 });
  await send('team', 'me', { reply: 't1', t: 'Согласна с вариантом B. Кнопки делаем с одним радиусом, как во всём клиенте', tm: '09:21' });
  await send('team', 'dmitry', { t: 'Беру в работу, к пятнице будет в релизе', tm: '09:24', re: [['❤️', 'me']] });
  await send('team', 'dmitry', { t: 'Ещё одно: цвет акцента берём из настроек', tm: '09:24' });
  await send('team', 'elena', { t: 'Короткая демонстрация анимации:', tm: '09:27', att: att(photo1), re: [['🔥', 'dmitry']] });
  await send('team', 'akrylov', { t: 'Дорожная карта на четвёртый квартал', tm: '09:30', att: att(file1) });
  await send('team', 'me', { t: '👍', tm: '09:33', re: [['👍', 'me'], ['👍', 'elena'], ['🔥', 'dmitry']] });
  // остальные
  await send('sever', 'petr', { t: 'Ячейки под новую партию готовы?', tm: '10:20' });
  await send('sever', 'anna', { t: 'Приняли, готовим ячейки под новую', tm: '10:31' });
  await send('sever', 'dmitry', { t: 'Нужно ещё сверить склад', tm: '10:33' });
  await send('sever', 'marat', { t: 'Проверю после обеда', tm: '10:34' });
  await send('sever', 'anna', { t: 'Отлично, жду отчёта', tm: '10:36' });
  await send('sever', 'dmitry', { t: 'Договорились', tm: '10:37' });
  await send('marat', 'marat', { t: 'Привет! Пришлёшь график на неделю?', tm: '10:12' });
  if (socks.marat) { socks.marat.ws.close(); delete socks.marat; await sleep(150); }   // чтобы ответ остался «отправлено», без доставки
  await send('marat', 'me', { t: 'Марат, привет! Пришлёшь график на неделю?', tm: '10:21' });
  await send('dev', 'akrylov', { t: 'Тогда закрываем задачу и берёмся за интеграцию', tm: '10:09', re: [['👍', 'dmitry'], ['👍', 'petr']] });
  await send('dev', 'akrylov', { t: 'Команда для сборки:\n```\nnpm run build\n```', tm: '10:10' });
  await send('dev', 'dmitry', { t: '', tm: '10:11', fwd: { user_id: ids.anna, name: PEOPLE.anna.n, text: 'Релиз переносим на пятницу' } });
  await send('dev', 'dmitry', { t: 'Дорожная карта: https://example.com/roadmap', tm: '10:12' });
  await send('rev', 'elena', { t: 'Правки по карточкам внесла, посмотрите', tm: '09:40' });
  await send('rev', 'anna', { t: 'Смотрю', tm: '09:45' });
  await send('rev', 'me', { t: 'Принято, сегодня выкатим', tm: '09:51' });
  await send('rev', 'dmitry', { t: 'Спасибо!', tm: '09:55' });
  await send('olga', 'olga', { t: 'Мария, подпиши, пожалуйста, график', tm: '08:50' });
  await send('elena', 'elena', { t: '🎉', tm: '08:44' });
  await send('dmitry', 'dmitry', { t: 'Так выглядит плашка «Подготовка»', tm: '08:26' });
  await send('dmitry', 'dmitry', { t: 'Вариант с акцентом по краю', tm: '08:27', att: att(photo2) });
  // комната с темами
  await send('t-gen', 'anna', { t: 'Доброе утро, коллеги! Напоминаю: общий созвон сегодня в 11:00', tm: '10:41' });
  await send('t-gen', 'dmitry', { t: 'Буду, подключусь с телефона', tm: '10:43' });
  await send('t-gen', 'me', { t: 'Я тоже на связи', tm: '10:44' });
  await send('t-gen', 'anna', { t: 'Созвон переносим на 11:30', tm: '10:46', re: [['👍', 'dmitry'], ['👍', 'me'], ['👍', 'elena']] });
  await send('t-ann', 'admin', { t: 'Завтра в 22:00 обновление сервера. Чат будет недоступен около 10 минут.', tm: '10:12' });
  await send('t-ann', 'admin', { t: '@mivanova, закройте открытые вложения заранее', tm: '10:12' });
  await send('t-rel', 'dmitry', { t: 'Версия 2.4 уже в продакшене', tm: '09:40', re: [['🎉', 'anna'], ['🎉', 'elena'], ['🎉', 'me']] });
  await send('t-rel', 'dmitry', { t: 'Что изменилось', tm: '09:41', att: att(file2) });
  await send('t-faq', 'elena', { t: 'Где найти шаблоны писем?', tm: '09:03', key: 'q1' });
  await send('t-faq', 'me', { reply: 'q1', t: 'Шаблоны лежат в разделе «Файлы»', tm: '09:05' });
  await send('t-fun', 'akrylov', { t: 'Кто за пиццу в пятницу?', tm: 'вчера' });
  await send('t-fun', 'akrylov', { t: '🍕', tm: 'вчера', re: [['🍕', 'dmitry'], ['🍕', 'elena'], ['🍕', 'anna'], ['❤️', 'me']] });
  await sleep(500);

  // ── время сообщений: сегодня / вчера ──
  const today = new Date(); today.setSeconds(0, 0);
  const stamp = tm => { const d = new Date(today); if (tm === 'вчера') { d.setDate(d.getDate() - 1); d.setHours(18, 5); } else { const [h, m] = tm.split(':').map(Number); d.setHours(h, m); } return Math.floor(d / 1000); };
  const upd = db.prepare('UPDATE messages SET sent_at = ? WHERE id = ?');
  // чтобы системные строки не оказались «из будущего», ставим и им время
  db.prepare("UPDATE messages SET sent_at = ? WHERE chat_id = ? AND (sender_id IS NULL OR system_kind IS NOT NULL)").run(stamp('10:25'), chat.sever);
  db.transaction(() => msgs.forEach(m => upd.run(stamp(m.tm), m.id)))();

  // ── прочитано / непрочитано у Марии: сколько последних чужих сообщений остаётся непрочитанными ──
  const UNREAD = { sever: 5, dev: 2, rev: 1, olga: 1, elena: 1, dmitry: 1, 't-gen': 2, 't-ann': 1, 't-rel': 1 };
  const rs = db.prepare('INSERT OR REPLACE INTO chat_read_state (user_id, chat_id, last_read_id, delivered_id) VALUES (?, ?, ?, ?)');
  const meId = ids.me;
  for (const [key, cid] of Object.entries(chat)) {
    const rows = db.prepare('SELECT id, sender_id FROM messages WHERE chat_id = ? ORDER BY id').all(cid);
    if (!rows.length) continue;
    const others = rows.filter(r => r.sender_id !== meId);
    const n = UNREAD[key] || 0;
    const last = n ? (others[others.length - n].id - 1) : rows[rows.length - 1].id;
    rs.run(meId, cid, last, rows[rows.length - 1].id);
    // свои сообщения прочитаны собеседниками в «Дизайн-ревью» и «Команде продукта» (две галочки)
    if (key === 'rev' || key === 'team') for (const k of ['elena', 'dmitry', 'anna', 'akrylov']) if (ids[k]) {
      const m = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(cid, ids[k]);
      if (m) rs.run(ids[k], cid, rows[rows.length - 1].id, rows[rows.length - 1].id);
    }
  }

  // ── закрепление чата, звук, папки ──
  await api('POST', '/api/chats/' + chat.sever + '/pin', tok.me);
  await api('POST', '/api/chats/' + chat.dev + '/mute', tok.me, {});
  const f1 = (await api('POST', '/api/folders', tok.me, { name: 'Работа', color: '#4b8df0', icon: 'briefcase' })).id;
  const f2 = (await api('POST', '/api/folders', tok.me, { name: 'Люди', color: '#d0566a', icon: 'users' })).id;
  for (const k of ['room', 'sever', 'dev', 'rev', 'team']) await api('PUT', '/api/folders/chat/' + chat[k], tok.me, { folder_ids: [f1] });
  for (const k of ['marat', 'olga', 'elena', 'dmitry']) await api('PUT', '/api/folders/chat/' + chat[k], tok.me, { folder_ids: [f2] });

  for (const o of Object.values(socks)) try { o.ws.close(); } catch {}
  console.log('данные созданы: чатов', Object.keys(chat).length, ', сообщений', msgs.length, '; вход: mivanova /', PASS);
  process.exit(0);
}
main().catch(e => { console.error('seed:', e); process.exit(1); });
