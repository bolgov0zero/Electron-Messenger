'use strict';
// Ссылки на видеозвонок для гостей: создание и управление (человек с правом), вход сотрудника, вход и опрос гостя.
// Правила и устройство — в ../calllinks.js
const express = require('express');
const { authMiddleware } = require('../auth');
const calls = require('../calls');
const links = require('../calllinks');

const wrap = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof calls.CallError) return res.status(e.status).json({ error: e.message, code: e.code });
    console.warn('[Ссылки на звонок]', e.message);
    res.status(500).json({ error: 'Не удалось выполнить действие' });
  }
};

// ── Для людей с учётной записью ──
const user = express.Router();
user.use(authMiddleware);
user.use((req, res, next) => (req.user.is_guest ? res.status(403).json({ error: 'Недоступно гостю', code: 'guest_forbidden' }) : next()));

// Можно ли мне создавать ссылки и какие у меня есть
user.get('/', wrap(async (req, res) => res.json({ can_create: await links.canCreate(req.user.id), ...(await links.list(req.user.id)) })));
user.post('/', wrap(async (req, res) => res.json(await links.create(req.user.id, req.body?.ttl))));
user.delete('/:id', wrap(async (req, res) => res.json(await links.remove(req.user.id, req.params.id))));
user.post('/:id/end', wrap(async (req, res) => res.json(await links.endByOwner(req.user.id, req.params.id))));

// Сотрудник открыл ссылку (в клиенте или в браузере со своей сессией): входит в звонок без подтверждения
user.post('/join', wrap(async (req, res) => res.json(await links.joinEmployee(req.user, req.body?.token, !!req.body?.page))));
user.post('/beat', wrap(async (req, res) => { links.beat(req.user.id); res.json({ ok: true }); }));
user.post('/leave', wrap(async (req, res) => { await links.leave(req.user.id); res.json({ ok: true }); }));

// Решения администратора звонка
user.get('/:id/state', wrap(async (req, res) => res.json(await links.ownerState(req.user.id, req.params.id))));
user.post('/:id/admit', wrap(async (req, res) => res.json(await links.admit(req.user.id, req.params.id, req.body?.guest_id === 'all' ? 'all' : Number(req.body?.guest_id)))));
user.post('/:id/reject', wrap(async (req, res) => res.json(await links.reject(req.user.id, req.params.id, Number(req.body?.guest_id)))));
user.post('/:id/kick', wrap(async (req, res) => res.json(await links.kick(req.user.id, req.params.id, req.body?.key))));

// ── Для гостя: без входа, по ссылке и ключу устройства ──
// Перебор токенов бесполезен (192 бита), но лишние попытки режем: по адресу считаем неудачи, а новые просьбы впустить — отдельно
const WIN = 10 * 60e3;
const fails = new Map(), asks = new Map();
const hit = (m, ip) => { const f = m.get(ip), t = Date.now(); const cur = f && t - f.t < WIN ? f : { n: 0, t }; cur.n++; m.set(ip, cur); return cur.n; };
const over = (m, ip, max) => { const f = m.get(ip); return !!f && Date.now() - f.t < WIN && f.n >= max; };
setInterval(() => { const t = Date.now(); for (const m of [fails, asks]) for (const [k, v] of m) if (t - v.t > WIN) m.delete(k); }, 5 * 60e3).unref();

const TEXT = {
  not_found: 'Ссылка не найдена или срок её действия закончился',
  expired: 'Срок действия ссылки закончился',
  name_required: 'Введите имя (от 2 до 60 символов)',
  busy: 'Слишком много ожидающих: попробуйте позже',
};
const guest = express.Router();
const tooMany = (req, res) => (over(fails, req.ip, 30) ? (res.status(429).json({ error: 'Слишком много попыток, попробуйте позже' }), true) : false);
const bad = (req, res, r) => { if (r.code !== 'name_required') hit(fails, req.ip); return res.status(r.status).json({ code: r.code, error: TEXT[r.code] || 'Ошибка' }); };
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

guest.get('/link/:token', wrap(async (req, res) => {
  if (tooMany(req, res)) return;
  const r = await links.peek(str(req.params.token, 100));
  if (r.status !== 200) return bad(req, res, r);
  res.json({ owner: r.owner, expires_at: r.expires_at, live: r.live });
}));
guest.post('/join', wrap(async (req, res) => {
  if (tooMany(req, res)) return;
  if (over(asks, req.ip, 20)) return res.status(429).json({ error: 'Слишком много попыток, попробуйте позже' });
  const b = req.body || {};
  const r = await links.guestJoin(str(b.token, 100), str(b.name, 200), str(b.device_key, 100));
  if (r.status !== 200) return bad(req, res, r);
  if (r.state === 'wait') hit(asks, req.ip);
  res.json({ state: r.state, name: r.name, device_key: r.device_key });
}));
guest.post('/status', wrap(async (req, res) => {
  const b = req.body || {};
  const r = await links.guestStatus(str(b.token, 100), str(b.device_key, 100));
  res.json({ state: r.state, until: r.until, admin_in: r.admin_in, participants: r.participants });
}));
guest.post('/enter', wrap(async (req, res) => {
  if (tooMany(req, res)) return;
  const b = req.body || {};
  res.json(await links.guestEnter(str(b.token, 100), str(b.device_key, 100)));
}));
guest.post('/leave', wrap(async (req, res) => { const b = req.body || {}; await links.guestLeave(str(b.token, 100), str(b.device_key, 100)); res.json({ ok: true }); }));

module.exports = { user, guest };
