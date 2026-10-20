// Федерация серверов: управление соединениями из админки и публичная ручка подключения по ключу активации.
// Сама логика обмена — в federation.js.
const express = require('express');
const { authMiddleware, adminMiddleware } = require('../auth');
const { logAudit } = require('../audit');
const fed = require('../federation');

// ── Админка ──
const admin = express.Router();
admin.use(authMiddleware, adminMiddleware);

const view = () => ({
  me: fed.identity(),
  peers: fed.peersInfo(),
  rules: {
    new_per_hour: Math.max(1, Number(fed.getS('fed_new_per_hour', '20')) || 20),
    invites_per_hour: Math.max(1, Number(fed.getS('fed_invites_per_hour', '20')) || 20),
    groups_in: fed.getS('fed_groups_in', '1') === '1',
  },
});
admin.get('/', (req, res) => res.json(view()));
// Сводка для блока на главной: период day | week | month
admin.get('/stats', (req, res) => res.json(fed.statsView(String(req.query.period || 'day'))));

// Имя, адрес и (один раз) идентификатор этого сервера
admin.put('/identity', (req, res) => {
  const r = fed.setIdentity({ id: req.body?.id, name: req.body?.name, url: req.body?.url });
  if (r.error) return res.status(400).json(r);
  logAudit(req, 'server', 'Федерация: настройки сервера', fed.identity().id || '—');
  res.json(view());
});
admin.put('/rules', (req, res) => {
  const b = req.body || {};
  const num = v => { const n = Math.floor(Number(v)); return n >= 1 && n <= 500 ? n : null; };
  if (b.new_per_hour !== undefined) { const n = num(b.new_per_hour); if (!n) return res.status(400).json({ error: 'Число от 1 до 500' }); fed.setS('fed_new_per_hour', n); }
  if (b.invites_per_hour !== undefined) { const n = num(b.invites_per_hour); if (!n) return res.status(400).json({ error: 'Число от 1 до 500' }); fed.setS('fed_invites_per_hour', n); }
  if (b.groups_in !== undefined) { fed.setS('fed_groups_in', b.groups_in ? '1' : '0'); logAudit(req, 'server', 'Федерация: приглашения в группы с других серверов', b.groups_in ? 'принимаются' : 'не принимаются'); }
  res.json(view());
});

admin.post('/invites', (req, res) => {
  const r = fed.createInvite();
  if (r.error) return res.status(400).json(r);
  logAudit(req, 'security', 'Федерация: создан ключ активации', null);
  res.json(r);
});
admin.post('/key/preview', (req, res) => {
  const r = fed.previewKey(req.body?.key);
  res.status(r.error ? 400 : 200).json(r);
});
admin.post('/connect', async (req, res) => {
  const r = await fed.connectWithKey(req.body?.key);
  if (r.error) return res.status(400).json(r);
  logAudit(req, 'security', 'Федерация: подключён сервер', `${r.peer.name} (${r.peer.instance_id})`);
  res.json(view());
});
const peerName = id => fed.peersInfo().find(p => p.id === id)?.name || String(id);
admin.post('/peers/:id/pause', (req, res) => {
  const id = Number(req.params.id), name = peerName(id);
  if (!fed.pausePeer(id)) return res.status(404).json({ error: 'Соединение не найдено' });
  logAudit(req, 'security', 'Федерация: соединение приостановлено', name);
  res.json(view());
});
admin.post('/peers/:id/resume', (req, res) => {
  const id = Number(req.params.id);
  if (!fed.resumePeer(id)) return res.status(404).json({ error: 'Соединение не найдено' });
  logAudit(req, 'security', 'Федерация: соединение возобновлено', peerName(id));
  res.json(view());
});
admin.delete('/peers/:id', (req, res) => {
  const id = Number(req.params.id), name = peerName(id);
  if (!fed.deletePeer(id)) return res.status(404).json({ error: 'Соединение не найдено' });
  logAudit(req, 'security', 'Федерация: соединение удалено', name);
  res.json(view());
});

// ── Публичная ручка: партнёр, получивший наш ключ, предъявляет его и свой публичный ключ ──
const pub = express.Router();
const hits = new Map();
const tooMany = ip => {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60000);
  list.push(now); hits.set(ip, list);
  return list.length > 20;
};
pub.post('/connect/begin', (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: 'too_many' });
  const r = fed.connectBegin(req.body?.inv);
  if (r.status !== 200) return res.status(r.status).json({ error: r.error });
  res.json({ nonce: r.nonce });
});
pub.post('/connect', (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: 'too_many' });
  const r = fed.acceptConnect(req.body);
  if (r.status !== 200) return res.status(r.status).json({ error: r.error });
  logAudit({ user: null, ip: req.ip }, 'security', 'Федерация: к нам подключился сервер', String(req.body?.name || req.body?.id || '').slice(0, 60));
  res.json({ ok: true, id: r.id, name: r.name, pub: r.pub, ack: r.ack });
});

module.exports = { admin, pub };
