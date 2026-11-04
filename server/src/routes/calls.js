// Звонки: настройки подключения к LiveKit (админ) и сигналы звонка (пользователи). Логика — в ../calls.js
const express = require('express');
const bcrypt = require('bcryptjs');
const dal = require('../dal');
const { authMiddleware, adminMiddleware } = require('../auth');
const { logAudit } = require('../audit');
const calls = require('../calls');
const lk = require('../lkinstall');
const lkk = require('../lkkeys');
const fed = require('../federation');
const voice = require('../voice');

const wrap = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof calls.CallError) return res.status(e.status).json({ error: e.message, code: e.code });
    console.warn('[Звонки]', e.message);
    res.status(500).json({ error: 'Не удалось выполнить действие' });
  }
};
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

// Что за устройство звонит, по заголовку User-Agent: приложение, веб клиент или мобильный клиент, и система
function devOf(req) {
  const ua = String(req.headers['user-agent'] || '');
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux|X11/.test(ua) ? 'Linux' : '';
  const kind = /Electron\//.test(ua) ? 'Клиент' : /iPhone|iPad|Android|Mobile/.test(ua) ? 'Мобильный клиент' : 'Веб клиент';
  return kind + (os ? ' · ' + os : '');
}
// ── Для клиентов ──
const user = express.Router();
user.use(authMiddleware);
// Включены ли голосовые сообщения: нужно и гостю (кнопка отправки меняет вид)
user.get('/voice', wrap(async (req, res) => res.json({ enabled: await voice.isOn() })));
user.use((req, res, next) => (req.user.is_guest ? res.status(403).json({ error: 'Недоступно гостю', code: 'guest_forbidden' }) : (req.user.dev = devOf(req), next())));

// Доступны ли звонки (кнопки в шапке чата) и нет ли звонка, начатого до перезагрузки клиента
// scheme нужна браузеру: страница по https не откроет ws://, а значит, звонить с неё нельзя
user.get('/config', wrap(async (req, res) => { const c = await calls.getConfig(); res.json({ quality: await calls.getQuality(), prefs: await calls.getPrefs(req.user.id), enabled: await calls.active(), guest: !calls.ownOk(c), scheme: /^wss:/i.test(c.url) ? 'wss' : 'ws', current: calls.currentFor(req.user.id), groups: await calls.groupsFor(req.user.id) }); }));
user.post('/start', wrap(async (req, res) => {
  const chatId = Number(req.body?.chat_id);
  if (!Number.isInteger(chatId) || chatId <= 0) return res.status(400).json({ error: 'Не указан чат', code: 'bad_chat' });
  res.json(await calls.start(req.user, chatId, !!req.body?.video));
}));
// Свои настройки звонков: все / аудио / видео / приём с других серверов
user.get('/prefs', wrap(async (req, res) => res.json(await calls.getPrefs(req.user.id))));
user.put('/prefs', wrap(async (req, res) => res.json(await calls.setPrefs(req.user.id, req.body))));
user.post('/group/join', wrap(async (req, res) => {
  const chatId = Number(req.body?.chat_id);
  if (!Number.isInteger(chatId) || chatId <= 0) return res.status(400).json({ error: 'Не указан чат', code: 'bad_chat' });
  res.json(await calls.groupJoin(req.user, chatId, !!req.body?.video));
}));
user.post('/group/:id/leave', wrap(async (req, res) => { await calls.groupLeave(req.user.id, req.params.id); res.json({ ok: true }); }));
// Добавить человека в идущий звонок: звонок двоих становится групповым
user.post('/:id/add', wrap(async (req, res) => {
  const uid = Number(req.body?.user_id);
  if (!Number.isInteger(uid) || uid <= 0) return res.status(400).json({ error: 'Не указан человек', code: 'bad_user' });
  res.json(await calls.callAdd(req.user, req.params.id, uid));
}));
// Клиент сообщает о событии звонка (показ экрана) для журнала
user.post('/:id/event', wrap(async (req, res) => { calls.event(req.user, req.params.id, String(req.body?.k || ''), !!req.body?.on); res.json({ ok: true }); }));
user.post('/:id/accept', wrap(async (req, res) => res.json(await calls.accept(req.user, req.params.id))));
user.post('/:id/decline', wrap(async (req, res) => { await calls.decline(req.user, req.params.id); res.json({ ok: true }); }));
user.post('/:id/end', wrap(async (req, res) => { await calls.end(req.user, req.params.id); res.json({ ok: true }); }));

// ── Для админки ──
const admin = express.Router();
admin.use(authMiddleware, adminMiddleware);

admin.get('/', wrap(async (req, res) => res.json(await calls.publicConfig())));
// Журнал звонков: период day | week | month | all, вид direct | group, поиск по именам и названию группы
admin.get('/log', wrap(async (req, res) => res.json(await calls.logList(req.query))));
// Идущие сейчас звонки и принудительное завершение (в аудите: кто завершил и чей это был звонок)
admin.get('/active', wrap(async (req, res) => res.json({ rows: await calls.activeList() })));
admin.post('/active/:id/end', wrap(async (req, res) => {
  const info = (await calls.activeList()).find(x => x.id === req.params.id);
  const r = await calls.adminEnd(req.params.id);
  logAudit(req, 'security', 'Звонки: принудительное завершение', (info ? (info.kind === 'direct' ? info.people.join(' → ') : (info.group || 'общий звонок') + ': ' + info.people.join(', ')) : req.params.id).slice(0, 200));
  res.json(r);
}));
// Сводка для блока на главной: период day | week | month
admin.get('/stats', wrap(async (req, res) => res.json(await calls.stats(req.query.period))));

// Сохранить. Включить можно, только когда подключение проходит проверку
admin.put('/', wrap(async (req, res) => {
  const b = req.body || {}, prev = await calls.getConfig(), next = {};
  if (b.url !== undefined) {
    const u = calls.normUrl(b.url);
    if (u === null) return res.status(400).json({ error: 'Адрес должен выглядеть как ws://адрес:7880 или wss://домен' });
    next.url = u;
  }
  if (b.key !== undefined) next.key = str(b.key, 200);
  if (b.secret) next.secret = str(b.secret, 400);
  if (b.enabled !== undefined) next.enabled = !!b.enabled;
  if (b.public !== undefined) next.public = !!b.public;
  if (b.cert_fp !== undefined) next.certFp = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/i.test(String(b.cert_fp)) ? String(b.cert_fp).toUpperCase() : '';
  const merged = { ...prev, ...next };
  // Другим серверам и браузерам рассылается именно этот адрес, поэтому у публичного сервера он должен быть wss:// с доменом
  if (merged.public && (next.public !== undefined || next.url !== undefined) && !/^wss:\/\/[^\s/:]*[A-Za-z][^\s/:]*(:\d+)?(\/.*)?$/i.test(merged.url)) return res.status(400).json({ error: 'Публичным можно отметить только адрес вида wss://calls.example.com с доменом: именно он рассылается клиентам и другим серверам' });
  // Без своего LiveKit (все три поля пусты) включить можно: звонки пойдут через серверы, которые разрешили свой
  if (next.enabled && (merged.url || merged.key || merged.secret)) {
    const r = await calls.check(merged);
    if (r.error) return res.status(400).json({ error: 'Включить нельзя: ' + r.error });
  }
  const wasActive = await calls.active();
  await calls.saveConfig(next);
  await calls.afterConfigChange(wasActive);
  const what = [next.url !== undefined && 'адрес', next.key !== undefined && 'ключ', next.secret && 'секрет', next.enabled !== undefined && (next.enabled ? 'включены' : 'выключены'), next.public !== undefined && (next.public ? 'доступен из интернета' : 'не публичный')].filter(Boolean).join(', ');
  logAudit(req, 'server', 'Звонки: настройки', what || '—');
  res.json(await calls.publicConfig());
}));

// Каким соседям мы доступны: чей LiveKit нам разрешён (запрашивается у соседей)
// Голосовые сообщения: включены ли. Меняется в настройках, раздел «Звонки и голос»; клиенты узнают сразу (voice_changed)
admin.get('/voice', wrap(async (req, res) => res.json({ enabled: await voice.isOn() })));
admin.put('/voice', wrap(async (req, res) => {
  const on = !!req.body?.enabled;
  await voice.setOn(on);
  logAudit(req, 'server', 'Звонки: настройки', 'голосовые сообщения ' + (on ? 'включены' : 'выключены'));
  try { require('../ws').broadcastAll({ type: 'voice_changed', enabled: on }); } catch (e) { console.warn('[Голосовые] не удалось разослать:', e.message); }
  res.json({ enabled: on });
}));

// Аудиозвонки (звонок без видео): включены ли. Меняется в настройках, раздел «Звонки и голос»; по умолчанию выключены.
// Клиенты узнают сразу (call_audio): без включения нет кнопки аудиозвонка и переключателя в настройках человека
admin.get('/audio', wrap(async (req, res) => res.json({ enabled: await calls.audioOn() })));
admin.put('/audio', wrap(async (req, res) => {
  const on = !!req.body?.enabled;
  await calls.setAudioOn(on);
  logAudit(req, 'server', 'Звонки: настройки', 'аудиозвонки ' + (on ? 'включены' : 'выключены'));
  try { require('../ws').broadcastAll({ type: 'call_audio', allowed: on }); } catch (e) { console.warn('[Аудиозвонки] не удалось разослать:', e.message); }
  res.json({ enabled: on });
}));

// Качество видео: ступень отдельно для личных звонков (direct) и для групп, комнат и звонков по ссылке (group): eco | normal | high | max.
// Клиенты узнают сразу (call_quality); применяется к новым звонкам
admin.get('/quality', wrap(async (req, res) => res.json(await calls.getQuality())));
admin.put('/quality', wrap(async (req, res) => {
  const b = req.body || {}, bad = k => b[k] !== undefined && !calls.QUAL_LEVELS.includes(b[k]);
  if (bad('direct') || bad('group')) return res.status(400).json({ error: 'Неизвестная ступень качества' });
  const q = await calls.setQuality(b);
  const NAME = { eco: 'экономная', normal: 'обычная', high: 'высокая', max: 'максимальная' };
  logAudit(req, 'server', 'Звонки: настройки', 'качество видео: личные — ' + NAME[q.direct] + ', группы — ' + NAME[q.group]);
  try { require('../ws').broadcastAll({ type: 'call_quality', quality: q }); } catch (e) { console.warn('[Звонки] качество не разослано:', e.message); }
  res.json(q);
}));

admin.get('/access', wrap(async (req, res) => res.json({ peers: await calls.peerAccess() })));

// Звонки с других серверов: какие соседи могут пользоваться нашим LiveKit (только если он доступен из интернета)
admin.get('/fed', wrap(async (req, res) => {
  const [c, allowed, peers] = await Promise.all([calls.getConfig(), calls.fedAllowed(), fed.peersInfo()]);
  res.json({ public: c.public, peers: peers.map(p => ({ instance_id: p.instance_id, name: p.name, status: p.status, online: p.online, allowed: allowed.includes(p.instance_id) })) });
}));
admin.put('/fed', wrap(async (req, res) => {
  const ids = new Set((await fed.peersInfo()).map(p => p.instance_id));
  const list = (Array.isArray(req.body?.allow) ? req.body.allow : []).map(String).filter(i => ids.has(i));
  await calls.setFedAllowed(list);
  logAudit(req, 'security', 'Звонки: серверы, которым разрешён наш LiveKit', list.length ? String(list.length) : 'никому');
  res.json({ ok: true });
}));

// Какой сертификат у адреса сервера звонков (чтобы принять самоподписанный по отпечатку)
admin.post('/cert', wrap(async (req, res) => {
  const url = calls.normUrl(req.body?.url !== undefined ? req.body.url : (await calls.getConfig()).url);
  if (!url) return res.status(400).json({ error: 'Сначала укажите адрес сервера звонков' });
  const r = await calls.inspectCert(url);
  res.status(r.error ? 400 : 200).json(r);
}));

// Проверить подключение: то, что ввели в форму, иначе то, что сохранено (секрет оставляем прежний)
admin.post('/test', wrap(async (req, res) => {
  const b = req.body || {}, saved = await calls.getConfig();
  const cfg = { url: b.url !== undefined ? b.url : saved.url, key: b.key !== undefined ? str(b.key, 200) : saved.key, secret: b.secret ? str(b.secret, 400) : saved.secret, certFp: b.cert_fp !== undefined ? String(b.cert_fp) : saved.certFp };
  const r = await calls.check(cfg);
  res.status(r.ok ? 200 : 400).json(r);
}));

// ── Установка LiveKit на другой сервер по SSH ──
// Действие меняет чужую машину, поэтому, как и установка PostgreSQL, требует пароль того, кто нажал; неверные пароли считаются.
const badPw = new Map();   // id админа → { n, t }
admin.get('/install', wrap(async (req, res) => res.json({ job: lk.job() })));

admin.post('/install/check', wrap(async (req, res) => {
  const r = await lk.check(req.body);
  res.status(r.ok ? 200 : 400).json(r);
}));

// Проверка пароля администратора; при отказе сама отвечает и возвращает false
async function confirmPassword(req, res) {
  const rec = badPw.get(req.user.id);
  if (rec && rec.n >= 5 && Date.now() - rec.t < 10 * 60e3) { res.status(429).json({ error: 'Слишком много неверных паролей, попробуйте через несколько минут' }); return false; }
  const pw = String(req.body?.admin_password || '');
  const row = pw ? await dal.get('SELECT password_hash FROM users WHERE id = ?', req.user.id) : null;
  if (!row || !bcrypt.compareSync(pw, row.password_hash)) {
    badPw.set(req.user.id, { n: (rec && Date.now() - rec.t < 10 * 60e3 ? rec.n : 0) + 1, t: Date.now() });
    res.status(403).json({ error: 'Неверный пароль' });
    return false;
  }
  badPw.delete(req.user.id);
  return true;
}

// Данные подключения целиком, с секретом: чтобы подключить к этому серверу звонков другой сервер чата. Секрет — как пароль,
// поэтому отдаётся только по паролю администратора, а факт выдачи пишется в аудит (без самих значений)
admin.post('/credentials', wrap(async (req, res) => {
  if (!(await confirmPassword(req, res))) return;
  const c = await calls.getConfig();
  if (!(c.url && c.key && c.secret)) return res.status(400).json({ error: 'Подключение к серверу звонков ещё не настроено' });
  logAudit(req, 'security', 'Звонки: данные подключения скопированы', c.url);
  res.json({ url: c.url, key: c.key, secret: c.secret });
}));

admin.post('/install', wrap(async (req, res) => {
  if (!(await confirmPassword(req, res))) return;
  const b = req.body || {}, mode = ['public', 'proxy'].includes(b.mode) ? b.mode : 'lan';
  const target = `${String(b.host || '').slice(0, 80)}${mode === 'public' ? ' (публичный, ' + String(b.domain || '').slice(0, 80) + ')' : mode === 'proxy' ? ' (за обратным прокси, ' + String(b.domain || '').slice(0, 80) + ')' : ' (локальная сеть)'}`;
  const r = await lk.start(b, async result => {
    // Данные подключения подставляются в настройки сами; включает звонки администратор
    await calls.saveConfig({ url: result.url, key: result.key, secret: result.secret, public: !!result.public });
    logAudit(req, 'server', 'Установка LiveKit по SSH: завершена', result.url);
  }, err => logAudit(req, 'server', 'Установка LiveKit по SSH: не удалась', String(err).slice(0, 120)));
  if (r.error) return res.status(r.error === 'Установка уже идёт' ? 409 : 400).json(r);
  logAudit(req, 'server', 'Установка LiveKit по SSH: начата', target);
  res.status(202).json(r);
}));

// ── Доступ к нашему серверу звонков для других серверов: отдельная пара ключей на каждый, любую можно отозвать ──
// Пары лежат в конфиге LiveKit рядом с основной; менять его админка может по SSH-ключу без пароля (настраивается один раз).
const keysRes = (res, r) => (r.error ? res.status(r.status || 400).json(r) : res.json(r));
admin.get('/keys', wrap(async (req, res) => res.json(await lkk.view())));
// Включить управление без пароля: один раз по паролю root сервера LiveKit (он нигде не сохраняется), отпечаток подтверждён заранее
admin.post('/keys/ssh', wrap(async (req, res) => {
  if (!(await confirmPassword(req, res))) return;
  const r = await lkk.sshOn(req.body);
  logAudit(req, 'security', r.error ? 'Звонки: управление ключами без пароля не настроено' : 'Звонки: управление ключами без пароля включено', r.error ? String(r.error).slice(0, 120) : String(req.body?.host || '').slice(0, 80));
  keysRes(res, r);
}));
admin.post('/keys/ssh/off', wrap(async (req, res) => {
  if (!(await confirmPassword(req, res))) return;
  const r = await lkk.sshOff({ password: String(req.body?.ssh_password || ''), localOnly: !!req.body?.local_only });
  if (!r.error) logAudit(req, 'security', 'Звонки: управление ключами без пароля выключено', req.body?.local_only ? 'только в админке' : '—');
  keysRes(res, r);
}));
admin.post('/keys', wrap(async (req, res) => {
  const r = await lkk.create(req.body?.name);
  if (!r.error) logAudit(req, 'security', 'Звонки: создана пара ключей для сервера', r.name);
  keysRes(res, r);
}));
admin.post('/keys/:id/revoke', wrap(async (req, res) => {
  const r = await lkk.revoke(String(req.params.id));
  if (!r.error) logAudit(req, 'security', 'Звонки: пара ключей отозвана', r.name);
  keysRes(res, r);
}));
// Данные пары целиком, с секретом: только по паролю администратора, значения в аудит не попадают
admin.post('/keys/:id/reveal', wrap(async (req, res) => {
  if (!(await confirmPassword(req, res))) return;
  const r = await lkk.reveal(String(req.params.id));
  if (!r.error) logAudit(req, 'security', 'Звонки: данные пары ключей показаны', r.name);
  keysRes(res, r);
}));
admin.delete('/keys/:id', wrap(async (req, res) => keysRes(res, await lkk.purge(String(req.params.id)))));

module.exports = { user, admin };
