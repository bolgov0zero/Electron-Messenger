// Федерация серверов: управление соединениями из админки и публичная ручка подключения по ключу активации.
// Сама логика обмена — в federation.js.
const express = require('express');
const { authMiddleware, adminMiddleware } = require('../auth');
const { logAudit } = require('../audit');
const fed = require('../federation');
const fsp = require('../fedspaces');

// ── Админка ──
const admin = express.Router();
admin.use(authMiddleware, adminMiddleware);

const view = async () => ({
  me: (await fed.identity()),
  peers: (await fed.peersInfo()),
  rules: {
    new_per_hour: Math.max(1, Number((await fed.getS('fed_new_per_hour', '20'))) || 20),
    invites_per_hour: Math.max(1, Number((await fed.getS('fed_invites_per_hour', '20'))) || 20),
    groups_in: (await fed.getS('fed_groups_in', '1')) === '1',
  },
});
admin.get('/', async (req, res) => res.json((await view())));
// Карта серверов и общих пространств
admin.get('/map', async (req, res) => res.json((await fsp.mapData())));
admin.post('/verify', async (req, res) => {
  const r = await fsp.verifyKey(req.body?.instance);
  if (r.error) return res.status(404).json(r);
  logAudit(req, 'security', 'Федерация: ключ сервера сверен', String(req.body.instance).slice(0, 40));
  res.json(r);
});
// Сводка для блока на главной: период day | week | month
// Главная опрашивает сводку раз в 2 секунды: ответ на один и тот же период держим секунду, чтобы несколько открытых админок не множили выборки
const statsMemo = new Map();
admin.get('/stats', async (req, res) => {
  const period = ['week', 'month'].includes(req.query.period) ? req.query.period : 'day', hit = statsMemo.get(period);
  if (hit && Date.now() - hit.at < 1000) return res.json(await hit.p);
  const p = fed.statsView(period); statsMemo.set(period, { at: Date.now(), p });
  try { res.json(await p); } catch (e) { statsMemo.delete(period); throw e; }
});

// Имя, адрес и (один раз) идентификатор этого сервера
admin.put('/identity', async (req, res) => {
  const r = await fed.setIdentity({ id: req.body?.id, name: req.body?.name, url: req.body?.url });
  if (r.error) return res.status(400).json(r);
  logAudit(req, 'server', 'Федерация: настройки сервера', (await fed.identity()).id || '—');
  res.json((await view()));
});
admin.put('/rules', async (req, res) => {
  const b = req.body || {};
  const num = v => { const n = Math.floor(Number(v)); return n >= 1 && n <= 500 ? n : null; };
  if (b.new_per_hour !== undefined) { const n = num(b.new_per_hour); if (!n) return res.status(400).json({ error: 'Число от 1 до 500' }); await fed.setS('fed_new_per_hour', n); }
  if (b.invites_per_hour !== undefined) { const n = num(b.invites_per_hour); if (!n) return res.status(400).json({ error: 'Число от 1 до 500' }); await fed.setS('fed_invites_per_hour', n); }
  if (b.groups_in !== undefined) { await fed.setS('fed_groups_in', b.groups_in ? '1' : '0'); logAudit(req, 'server', 'Федерация: приглашения в группы с других серверов', b.groups_in ? 'принимаются' : 'не принимаются'); }
  res.json((await view()));
});

admin.post('/invites', async (req, res) => {
  const r = await fed.createInvite();
  if (r.error) return res.status(400).json(r);
  logAudit(req, 'security', 'Федерация: создан ключ активации', null);
  res.json(r);
});
admin.post('/key/preview', async (req, res) => {
  const r = await fed.previewKey(req.body?.key);
  res.status(r.error ? 400 : 200).json(r);
});
admin.post('/connect', async (req, res) => {
  const r = await fed.connectWithKey(req.body?.key);
  if (r.error) return res.status(400).json(r);
  logAudit(req, 'security', 'Федерация: подключён сервер', `${r.peer.name} (${r.peer.instance_id})`);
  res.json((await view()));
});
const peerName = async id => (await fed.peersInfo()).find(p => p.id === id)?.name || String(id);
admin.post('/peers/:id/pause', async (req, res) => {
  const id = Number(req.params.id), name = await peerName(id);
  if (!(await fed.pausePeer(id))) return res.status(404).json({ error: 'Соединение не найдено' });
  logAudit(req, 'security', 'Федерация: соединение приостановлено', name);
  res.json((await view()));
});
admin.post('/peers/:id/resume', async (req, res) => {
  const id = Number(req.params.id);
  if (!(await fed.resumePeer(id))) return res.status(404).json({ error: 'Соединение не найдено' });
  logAudit(req, 'security', 'Федерация: соединение возобновлено', (await peerName(id)));
  res.json((await view()));
});
admin.delete('/peers/:id', async (req, res) => {
  const id = Number(req.params.id), name = await peerName(id);
  if (!(await fed.deletePeer(id))) return res.status(404).json({ error: 'Соединение не найдено' });
  logAudit(req, 'security', 'Федерация: соединение удалено', name);
  res.json((await view()));
});

// ── Публичная ручка: партнёр, получивший наш ключ, предъявляет его и свой публичный ключ ──
const pub = express.Router();
const hits = new Map();
const tooMany = ip => {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60000);
  list.push(now); hits.set(ip, list);
  return list.length > 20;
};
pub.post('/connect/begin', async (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: 'too_many' });
  const r = await fed.connectBegin(req.body?.inv);
  if (r.status !== 200) return res.status(r.status).json({ error: r.error });
  res.json({ nonce: r.nonce });
});
pub.post('/connect', async (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: 'too_many' });
  const r = await fed.acceptConnect(req.body);
  if (r.status !== 200) return res.status(r.status).json({ error: r.error });
  logAudit({ user: null, ip: req.ip }, 'security', 'Федерация: к нам подключился сервер', String(req.body?.name || req.body?.id || '').slice(0, 60));
  res.json({ ok: true, id: r.id, name: r.name, pub: r.pub, ack: r.ack });
});

module.exports = { admin, pub };
