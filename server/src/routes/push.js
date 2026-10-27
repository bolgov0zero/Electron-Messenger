'use strict';

const router = require('express').Router();
const webpush = require('web-push');
const dal = require('../dal');
const { authMiddleware } = require('../auth');

// ── VAPID ключи: генерируем один раз, храним в settings ──
async function getOrCreateVapidKeys() {
  const pubRow  = await dal.get("SELECT value FROM settings WHERE key = 'vapid_public'");
  const privRow = await dal.get("SELECT value FROM settings WHERE key = 'vapid_private'");
  if (pubRow && privRow) {
    return { publicKey: pubRow.value, privateKey: privRow.value };
  }
  const keys = webpush.generateVAPIDKeys();
  const upsert = 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)';
  await dal.run(upsert, 'vapid_public',  keys.publicKey);
  await dal.run(upsert, 'vapid_private', keys.privateKey);
  return keys;
}

const VAPID_CONTACT = 'mailto:bolgov@me.com';

// Ключи читаются из базы асинхронно; рассылка идёт уже после запуска сервера
let vapidKeys = null;
async function initVapid() {
  vapidKeys = await getOrCreateVapidKeys();

  // Если контакт сменился — все старые подписки невалидны, сбрасываем
  const savedContact = (await dal.get("SELECT value FROM settings WHERE key = 'vapid_contact'"))?.value;
  if (savedContact !== VAPID_CONTACT) {
    const wiped = (await dal.run('DELETE FROM push_subscriptions')).changes;
    await dal.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('vapid_contact', ?)", VAPID_CONTACT);
    if (wiped) console.warn(`[Push] VAPID contact изменился (${savedContact} → ${VAPID_CONTACT}): удалено подписок: ${wiped}. Пользователи переподпишутся при следующем открытии PWA.`);
  }

  webpush.setVapidDetails(VAPID_CONTACT, vapidKeys.publicKey, vapidKeys.privateKey);
  initVapid.done();
}
// Ключи читаются из базы, поэтому запуск отдельным шагом (index.js, после dal.init)
const vapidReady = new Promise(res => { initVapid.done = res; });

// Декларативный Web Push (Safari 18.4+): адрес для открытия указан прямо в уведомлении (navigate), и нажатие на него
// не зависит от service worker, который на iOS событие нажатия не всегда получает. Старое содержимое (title, body, chatId,
// unread) остаётся на верхнем уровне: браузеры без декларативных пушей отдают его service worker'у, как раньше.
function buildPayload(appUrl, payload) {
  if (!appUrl) return payload;
  let navigate;
  try {
    const u = new URL(appUrl);
    if (u.pathname === '/beta/') u.pathname = '/m/';   // подписки, оформленные в бете (убрана в s2.31.0), открывают /m/
    if (payload.chatId) u.searchParams.set('chatId', String(payload.chatId));
    navigate = u.toString();
  } catch { return payload; }
  const n = { title: payload.title || 'Новое сообщение', body: payload.body || '', navigate, silent: false };
  if (typeof payload.unread === 'number') n.app_badge = String(payload.unread);
  return Object.assign({ web_push: 8030, notification: n }, payload);
}

// Настройки уведомлений человека: показывать ли текст и тихие часы
async function getPrefs(userId) {
  const r = await dal.get('SELECT show_text, quiet_from, quiet_to, tz FROM push_prefs WHERE user_id = ?', userId);
  return { show_text: r ? !!r.show_text : true, quiet_from: r?.quiet_from ?? null, quiet_to: r?.quiet_to ?? null, tz: r?.tz || null };
}
function inQuietHours(p, now = new Date()) {
  if (p.quiet_from == null || p.quiet_to == null || p.quiet_from === p.quiet_to) return false;
  let mins;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: p.tz || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    mins = Number(parts.find(x => x.type === 'hour').value) * 60 + Number(parts.find(x => x.type === 'minute').value);
  } catch { return false; }
  return p.quiet_from < p.quiet_to ? (mins >= p.quiet_from && mins < p.quiet_to) : (mins >= p.quiet_from || mins < p.quiet_to);
}

// Экспортируем для использования в ws.js
async function sendPushToUser(userId, payload) {
  const prefs = await getPrefs(userId);
  if (inQuietHours(prefs)) return;                       // тихие часы: уведомлений нет вообще
  if (!prefs.show_text) payload = { ...payload, body: 'Новое сообщение' };
  const subs = await dal.all('SELECT endpoint, keys, app_url FROM push_subscriptions WHERE user_id = ?', userId);
  subs.forEach(row => {
    const sub = { endpoint: row.endpoint, keys: JSON.parse(row.keys) };
    webpush.sendNotification(sub, JSON.stringify(buildPayload(row.app_url, payload))).catch(async err => {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Подписка истекла на стороне браузера — удаляем
        await dal.run('DELETE FROM push_subscriptions WHERE endpoint = ?', row.endpoint);
      } else {
        console.error('[Push] sendNotification failed:', err.statusCode, err.message, row.endpoint.slice(0, 60));
      }
    });
  });
}

// ── ROUTES ──

// Публичный VAPID-ключ (без авторизации — нужен до входа для SW)
router.get('/vapid-public-key', async (req, res) => {
  await vapidReady;
  res.json({ key: vapidKeys.publicKey });
});

router.use(authMiddleware);

// Сохранить подписку
router.post('/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  // Адрес приложения (мобильная версия /m/): по нему строится адрес для открытия чата в декларативном пуше
  let appUrl = null;
  try {
    const u = new URL(String(req.body.app_url || ''));
    if (u.pathname === '/beta/') u.pathname = '/m/';
    if ((u.protocol === 'https:' || u.protocol === 'http:') && u.pathname === '/m/' && !u.search && !u.hash) appUrl = u.toString();
  } catch {}
  await dal.run(`
    INSERT INTO push_subscriptions (user_id, endpoint, keys, app_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys = excluded.keys, app_url = excluded.app_url
  `, req.user.id, endpoint, JSON.stringify(keys), appUrl);
  res.json({ ok: true });
});

// Настройки уведомлений: показ текста и тихие часы
router.get('/prefs', async (req, res) => res.json((await getPrefs(req.user.id))));
router.put('/prefs', async (req, res) => {
  const b = req.body || {}, cur = await getPrefs(req.user.id);
  const min = v => (v === null ? null : Number.isInteger(v) && v >= 0 && v < 1440 ? v : undefined);
  const qf = b.quiet_from === undefined ? cur.quiet_from : min(b.quiet_from), qt = b.quiet_to === undefined ? cur.quiet_to : min(b.quiet_to);
  if (qf === undefined || qt === undefined) return res.status(400).json({ error: 'Некорректное время' });
  let tz = b.tz === undefined ? cur.tz : (typeof b.tz === 'string' ? b.tz.slice(0, 64) : null);
  if (tz) { try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); } catch { tz = cur.tz; } }
  const show = b.show_text === undefined ? cur.show_text : !!b.show_text;
  await dal.run(`INSERT INTO push_prefs (user_id, show_text, quiet_from, quiet_to, tz) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET show_text = excluded.show_text, quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to, tz = excluded.tz`, req.user.id, show ? 1 : 0, qf, qt, tz);
  res.json((await getPrefs(req.user.id)));
});

// Удалить подписку
router.delete('/subscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) {
    await dal.run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', endpoint, req.user.id);
  }
  res.json({ ok: true });
});

// Список всех подписок (только для администраторов)
router.get('/subscriptions', async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Forbidden' });
  const rows = await dal.all(`
    SELECT ps.id, ps.user_id, ps.endpoint, ps.created_at,
      u.username, u.display_name
    FROM push_subscriptions ps
    JOIN users u ON u.id = ps.user_id
    ORDER BY ps.created_at DESC
  `);
  res.json(rows);
});

// Удаление подписки администратором по id
router.delete('/subscriptions/:id', async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Forbidden' });
  await dal.run('DELETE FROM push_subscriptions WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// Диагностика: тестовый push конкретному пользователю (только для администраторов)
router.post('/test/:userId', async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Forbidden' });
  const targetId = Number(req.params.userId);
  const subs = await dal.all('SELECT endpoint, keys, app_url FROM push_subscriptions WHERE user_id = ?', targetId);
  if (!subs.length) return res.status(404).json({ error: 'Нет подписок для этого пользователя' });

  const results = await Promise.all(subs.map(async row => {
    const sub = { endpoint: row.endpoint, keys: JSON.parse(row.keys) };
    const service = (() => { try { return new URL(row.endpoint).hostname; } catch { return row.endpoint.slice(0,40); } })();
    try {
      await webpush.sendNotification(sub, JSON.stringify(buildPayload(row.app_url, {
        title: 'Тест уведомлений',
        body: 'Push-уведомления работают корректно.',
        chatId: null,
      })));
      return { service, ok: true };
    } catch (err) {
      const code = err.statusCode || err.code || '?';
      const msg  = err.body || err.message || String(err);
      console.error('[Push] test failed:', code, msg, row.endpoint.slice(0, 60));
      // 410/404 — подписка устарела, чистим
      if (err.statusCode === 410 || err.statusCode === 404) {
        await dal.run('DELETE FROM push_subscriptions WHERE endpoint = ?', row.endpoint);
      }
      return { service, ok: false, code, error: msg.slice(0, 200) };
    }
  }));

  const allOk = results.every(r => r.ok);
  res.status(allOk ? 200 : 207).json({ results });
});


// Есть ли у человека подписка на уведомления. Нужна до того, как считать данные
// для уведомления: подписки нет — считать нечего, а подсчёты недешёвые.
const stmtHasSub = 'SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1';
async function hasPushSubscription(userId) {
  return !!(await dal.get(stmtHasSub, userId));
}

module.exports = router;
module.exports.sendPushToUser = sendPushToUser;
module.exports.buildPayload = buildPayload;
module.exports.hasPushSubscription = hasPushSubscription;
module.exports.init = initVapid;
