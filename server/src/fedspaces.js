// Общие пространства между серверами федерации.
//
// Рабочее пространство можно сделать «общим»: люди нескольких серверов состоят в нём и видят друг друга так, как если бы были
// на одном сервере (списки, поиск, статусы, «печатает»), могут писать друг другу и создавать группы.
//
// Устройство:
//  • Пространство принадлежит серверу-хозяину (workspaces.fed_uid = «хозяин:номер»). У остальных серверов его зеркало: такая же
//    запись workspaces с теми же fed_uid/fed_host. Хозяин держит дерево серверов (fed_space_servers) и рассылает его всем участникам;
//    у остальных это копия. Ребро дерева — прямое соединение двух серверов, поэтому дерево может быть звездой или каскадом.
//  • Хозяин приглашает сервер, с которым у него прямое соединение. Участник дерева расширяет его дальше только с одобрения хозяина:
//    просит (sp_ask), хозяин одобряет (sp_go), участник приглашает соседа сам. Администратор приглашённого сервера принимает или отклоняет.
//  • Каждый сервер ведёт состав своего пространства сам и управляет только своими людьми. Остальным он отправляет полный список
//    своих людей (sp_members): у них создаются «теневые» пользователи, входящие в то же пространство. Это и даёт взаимную видимость.
//  • Между серверами, которые не соединены напрямую, работают «сквозные» каналы (federation.js): шифрованный туннель поверх конверта,
//    пересылаемого соседями по дереву. Промежуточный сервер видит «кто с кем», но не содержимое.
//  • Статусы людей идут отдельным эфемерным событием spp всем серверам пространства, а не только взаимным контактам.
const db = require('./db');
const spaces = require('./spaces');

const F = () => require('./federation');
const wsm = () => require('./ws');
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const MAX_SERVERS = 40;
const MAX_MEMBERS = 5000;
const me = () => F().identity();

const spaceByUid = uid => db.prepare('SELECT * FROM workspaces WHERE fed_uid = ?').get(uid);
const spaceById = id => db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
const hostOfUid = uid => String(uid).split(':')[0];
const nodes = uid => db.prepare('SELECT * FROM fed_space_servers WHERE space_uid = ? ORDER BY created_at, rowid').all(uid);
const activeNodes = uid => nodes(uid).filter(n => n.state === 'active');
const node = (uid, inst) => db.prepare('SELECT * FROM fed_space_servers WHERE space_uid = ? AND instance_id = ?').get(uid, inst);
const isActiveIn = (uid, inst) => node(uid, inst)?.state === 'active';
const sharedSpaces = () => db.prepare('SELECT * FROM workspaces WHERE fed_uid IS NOT NULL').all();
const getS = (k, d = '') => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? d;
const setS = (k, v) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, String(v));
const delS = k => db.prepare('DELETE FROM settings WHERE key = ?').run(k);

// ─────────────────────────── дерево и маршруты ───────────────────────────
let routeCache = null;
function edgesOf(uid) {
  const act = activeNodes(uid), ids = new Set(act.map(n => n.instance_id));
  return act.filter(n => n.parent && ids.has(n.parent)).map(n => ({ a: n.parent, b: n.instance_id }));
}
// dest → сосед, через которого до него добираться (по всем пространствам, в которых мы состоим)
function routes() {
  if (routeCache) return routeCache;
  const myId = me().id, adj = new Map();
  const add = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const w of sharedSpaces()) {
    if (!isActiveIn(w.fed_uid, myId)) continue;
    edgesOf(w.fed_uid).forEach(e => { add(e.a, e.b); add(e.b, e.a); });
  }
  const first = new Map(), seen = new Set([myId]), q = [];
  for (const n of adj.get(myId) || []) { first.set(n, n); seen.add(n); q.push(n); }
  while (q.length) {
    const u = q.shift();
    for (const v of adj.get(u) || []) if (!seen.has(v)) { seen.add(v); first.set(v, first.get(u)); q.push(v); }
  }
  routeCache = first;
  return first;
}
const invalidate = () => { routeCache = null; };
function nextHop(dest) { return routes().get(String(dest)) || null; }
// Можно ли переслать кадр от from к to: оба в одном пространстве вместе с нами
function mayRelay(from, to) {
  const myId = me().id;
  return sharedSpaces().some(w => isActiveIn(w.fed_uid, myId) && isActiveIn(w.fed_uid, from) && isActiveIn(w.fed_uid, to));
}

// Сквозные записи в fed_peers: по одной на сервер из наших пространств, с которым нет прямого соединения
function syncVirtual() {
  invalidate();
  const myId = me().id;
  if (!myId) return;
  const want = new Map();
  for (const w of sharedSpaces()) {
    const list = activeNodes(w.fed_uid);
    if (!list.some(n => n.instance_id === myId)) continue;
    list.forEach(n => { if (n.instance_id !== myId && !want.has(n.instance_id)) want.set(n.instance_id, n); });
  }
  for (const [inst, n] of want) {
    if (F().realPeerByInstance(inst)) continue;
    const cur = F().peerByInstance(inst);
    if (!cur) db.prepare("INSERT INTO fed_peers (instance_id, name, url, pub, role, status, virt) VALUES (?, ?, NULL, ?, 'out', 'active', 1)").run(inst, n.name, n.pub);
    else if (cur.pub !== n.pub) { F().endVirtual(cur.id, true); db.prepare('UPDATE fed_peers SET pub = ?, name = ? WHERE id = ?').run(n.pub, n.name, cur.id); }
    else if (cur.name !== n.name) db.prepare('UPDATE fed_peers SET name = ? WHERE id = ?').run(n.name, cur.id);
  }
  for (const p of db.prepare('SELECT * FROM fed_peers WHERE virt = 1').all()) {
    if (want.has(p.instance_id)) continue;
    F().endVirtual(p.id, true);
    db.prepare('DELETE FROM fed_peers WHERE id = ?').run(p.id);
  }
}

// ─────────────────────────── отправка ───────────────────────────
function sendTo(inst, ev, dedupe) {
  const p = F().peerByInstance(inst);
  if (!p || p.status !== 'active') return false;
  if (dedupe) {
    // В очереди хранится только последнее состояние: старые такие же события вытесняются
    const prefix = `{"k":"${ev.k}","uid":${JSON.stringify(ev.uid)}`;
    db.prepare('DELETE FROM fed_outbox WHERE peer_id = ? AND substr(ev, 1, ?) = ?').run(p.id, prefix.length, prefix);
  }
  F().enqueue(p.id, ev);
  return true;
}
const treeOf = uid => activeNodes(uid).map(n => ({ id: n.instance_id, name: n.name, pub: n.pub, p: n.parent }));
function broadcastTree(uid, only) {
  const w = spaceByUid(uid);
  if (!w || w.fed_host !== me().id) return;
  const t = treeOf(uid);
  for (const n of activeNodes(uid)) if (n.instance_id !== me().id && (!only || n.instance_id === only)) sendTo(n.instance_id, { k: 'sp_tree', uid, name: w.name, tree: t }, true);
}

// ─────────────────────────── включение и приглашения ───────────────────────────
function enableShared(wsId) {
  const id = me();
  if (!id.configured) return { error: 'Сначала настройте федерацию: задайте идентификатор сервера' };
  const w = spaceById(wsId);
  if (!w) return { error: 'Пространство не найдено' };
  if (w.fed_uid) return { ok: true };
  const uid = `${id.id}:${w.id}`;
  db.transaction(() => {
    db.prepare('UPDATE workspaces SET fed_uid = ?, fed_host = ? WHERE id = ?').run(uid, id.id, w.id);
    db.prepare("INSERT OR REPLACE INTO fed_space_servers (space_uid, instance_id, name, pub, parent, state) VALUES (?, ?, ?, ?, '', 'active')").run(uid, id.id, id.name, id.pub);
  })();
  invalidate();
  return { ok: true, uid };
}
function disableShared(wsId) {
  const w = spaceById(wsId);
  if (!w || !w.fed_uid) return { ok: true };
  if (w.fed_host !== me().id) return { error: 'Выключить общее пространство может только его хозяин' };
  for (const id of deepestFirst(w.fed_uid, activeNodes(w.fed_uid).map(n => n.instance_id))) if (id !== me().id) sendTo(id, { k: 'sp_gone', uid: w.fed_uid, why: 'off' });
  dropMirror(w.fed_uid);
  return { ok: true };
}

// Предложить пространство серверу inst. Хозяин приглашает сразу, участник просит хозяина
function offerServer(wsId, inst) {
  const w = spaceById(wsId);
  if (!w || !w.fed_uid) return { error: 'Пространство не общее' };
  const myId = me().id, uid = w.fed_uid;
  if (!isActiveIn(uid, myId)) return { error: 'Вы не участник этого пространства' };
  inst = String(inst || '').toLowerCase();
  const peer = F().realPeerByInstance(inst);
  if (!peer || peer.status !== 'active') return { error: 'С этим сервером нет прямого подключения. Подключите его в разделе «Федерации».' };
  if (nodes(uid).some(n => n.instance_id === inst)) return { error: 'Этот сервер уже в пространстве или приглашён' };
  if (nodes(uid).length >= MAX_SERVERS) return { error: `В пространстве не может быть больше ${MAX_SERVERS} серверов` };
  if (!F().isOnline(peer.id)) return { error: 'Сервер сейчас недоступен: приглашение можно отправить, когда есть связь' };
  if (!peer.sp) return { error: 'Этот сервер ещё не поддерживает общие пространства: пусть его администратор обновит сервер' };
  if (w.fed_host === myId) {
    db.prepare("INSERT OR REPLACE INTO fed_space_servers (space_uid, instance_id, name, pub, parent, state) VALUES (?, ?, ?, ?, ?, 'offered')").run(uid, inst, peer.name, peer.pub, myId);
    sendOffer(uid, inst);
    return { ok: true, invited: true };
  }
  // Участник: просьба хозяину
  const t = { id: inst, name: peer.name, pub: peer.pub };
  const done = sendTo(w.fed_host, { k: 'sp_ask', uid, target: t });
  if (!done) return { error: 'Нет связи с хозяином пространства' };
  db.prepare("INSERT OR REPLACE INTO fed_space_servers (space_uid, instance_id, name, pub, parent, state) VALUES (?, ?, ?, ?, ?, 'asked')").run(uid, inst, peer.name, peer.pub, myId);
  return { ok: true, asked: true };
}
function sendOffer(uid, inst) {
  const w = spaceByUid(uid), h = node(uid, w.fed_host);
  sendTo(inst, { k: 'sp_offer', uid, name: w.name, host: { id: w.fed_host, name: h?.name || w.fed_host, pub: h?.pub || '' }, tree: treeOf(uid) });
}

function validTree(uid, tree, requireHost = true) {
  if (!Array.isArray(tree) || !tree.length || tree.length > MAX_SERVERS) return null;
  const host = hostOfUid(uid), out = [], ids = new Set();
  for (const t of tree) {
    const id = String(t?.id || '');
    if (!ID_RE.test(id) || ids.has(id) || !F().validPub(t.pub)) return null;
    ids.add(id);
    out.push({ id, name: str(t.name, 60) || id, pub: t.pub, p: str(t.p, 40) });
  }
  const hn = out.find(t => t.id === host);
  if (requireHost && (!hn || hn.p)) return null;
  // у каждого, кроме хозяина, родитель есть в дереве, и цикла нет
  for (const t of out) {
    if (t.id === host) continue;
    let cur = t, hops = 0;
    while (cur && cur.id !== host && hops++ <= MAX_SERVERS) cur = out.find(x => x.id === cur.p);
    if (!cur || cur.id !== host) return null;
  }
  return out;
}

function recvOffer(peer, ev) {
  if (peer.virt) return;
  const uid = str(ev.uid, 80);
  if (!/^[a-z0-9._-]+:\d+$/.test(uid) || !ID_RE.test(hostOfUid(uid))) return;
  const tree = validTree(uid, ev.tree);
  if (!tree || !tree.some(t => t.id === peer.instance_id)) return sendTo(peer.instance_id, { k: 'sp_decline', uid, why: 'bad' });
  if (tree.some(t => t.id === me().id) || spaceByUid(uid) || db.prepare('SELECT 1 FROM fed_space_offers WHERE space_uid = ?').get(uid)) return sendTo(peer.instance_id, { k: 'sp_decline', uid, why: 'have' });
  db.prepare('INSERT INTO fed_space_offers (space_uid, host, name, from_inst, tree) VALUES (?, ?, ?, ?, ?)').run(uid, hostOfUid(uid), str(ev.name, 60) || 'Пространство', peer.instance_id, JSON.stringify(tree));
  try { wsm().broadcastAdmins?.({ type: 'fed_space_offer' }); } catch {}
}

function uniqueWsName(base, hostName) {
  const taken = x => !!db.prepare('SELECT 1 FROM workspaces WHERE name = ?').get(x);
  let n = String(base).slice(0, 60);
  if (!taken(n)) return n;
  n = `${base} (${hostName})`.slice(0, 60);
  if (!taken(n)) return n;
  for (let i = 2; ; i++) { n = `${base} ${i}`.slice(0, 60); if (!taken(n)) return n; }
}

function acceptOffer(uid) {
  const o = db.prepare('SELECT * FROM fed_space_offers WHERE space_uid = ?').get(uid);
  if (!o) return { error: 'Приглашение не найдено' };
  const id = me();
  if (!id.configured) return { error: 'Сначала настройте федерацию' };
  let tree; try { tree = validTree(uid, JSON.parse(o.tree)); } catch { tree = null; }
  if (!tree) { db.prepare('DELETE FROM fed_space_offers WHERE space_uid = ?').run(uid); return { error: 'Приглашение повреждено' }; }
  const from = F().realPeerByInstance(o.from_inst);
  if (!from || from.status !== 'active') return { error: 'Нет подключения к серверу, приславшему приглашение' };
  const hostName = tree.find(t => t.id === o.host)?.name || o.host;
  const name = uniqueWsName(o.name, hostName);
  db.transaction(() => {
    db.prepare('INSERT INTO workspaces (name, fed_uid, fed_host) VALUES (?, ?, ?)').run(name, uid, o.host);
    setS('fedsp_name:' + uid, o.name);
    tree.forEach(t => db.prepare("INSERT OR REPLACE INTO fed_space_servers (space_uid, instance_id, name, pub, parent, state) VALUES (?, ?, ?, ?, ?, 'active')").run(uid, t.id, t.name, t.id === o.from_inst ? from.pub : t.pub, t.p));
    db.prepare("INSERT OR REPLACE INTO fed_space_servers (space_uid, instance_id, name, pub, parent, state) VALUES (?, ?, ?, ?, ?, 'active')").run(uid, id.id, id.name, id.pub, o.from_inst);
    db.prepare('DELETE FROM fed_space_offers WHERE space_uid = ?').run(uid);
  })();
  syncVirtual();
  sendTo(o.from_inst, { k: 'sp_accept', uid, name: id.name });
  return { ok: true, name };
}
function declineOffer(uid) {
  const o = db.prepare('SELECT * FROM fed_space_offers WHERE space_uid = ?').get(uid);
  if (!o) return { error: 'Приглашение не найдено' };
  db.prepare('DELETE FROM fed_space_offers WHERE space_uid = ?').run(uid);
  sendTo(o.from_inst, { k: 'sp_decline', uid, why: 'no' });
  return { ok: true };
}

// Сосед принял приглашение
function recvAccept(peer, ev) {
  const uid = str(ev.uid, 80), w = spaceByUid(uid), n = w && node(uid, peer.instance_id);
  if (!n || n.state !== 'offered' || n.parent !== me().id) return;
  const before = new Set(activeNodes(uid).map(x => x.instance_id));
  db.prepare("UPDATE fed_space_servers SET state = 'active' WHERE space_uid = ? AND instance_id = ?").run(uid, peer.instance_id);
  invalidate();
  if (w.fed_host === me().id) { syncVirtual(); broadcastTree(uid); afterTreeChange(uid, before); }
  else sendTo(w.fed_host, { k: 'sp_joined', uid, node: { id: n.instance_id, name: n.name, pub: n.pub, p: me().id } });
}
function recvDecline(peer, ev) {
  const uid = str(ev.uid, 80), n = node(uid, peer.instance_id);
  if (n && n.state !== 'active' && n.parent === me().id) { db.prepare('DELETE FROM fed_space_servers WHERE space_uid = ? AND instance_id = ?').run(uid, peer.instance_id); }
}
// Участник просит добавить сервер (мы — хозяин)
function recvAsk(peer, ev) {
  const uid = str(ev.uid, 80), w = spaceByUid(uid);
  if (!w || w.fed_host !== me().id || !isActiveIn(uid, peer.instance_id)) return;
  const t = ev.target || {}, id = String(t.id || '');
  if (!ID_RE.test(id) || !F().validPub(t.pub) || node(uid, id) || id === me().id) return;
  if (db.prepare('SELECT 1 FROM fed_space_asks WHERE space_uid = ? AND target = ?').get(uid, id)) return;
  db.prepare('INSERT INTO fed_space_asks (space_uid, proposer, target, target_name, target_pub) VALUES (?, ?, ?, ?, ?)').run(uid, peer.instance_id, id, str(t.name, 60) || id, t.pub);
}
function approveAsk(askId) {
  const a = db.prepare('SELECT * FROM fed_space_asks WHERE id = ?').get(askId);
  if (!a) return { error: 'Просьба не найдена' };
  db.prepare('UPDATE fed_space_asks SET approved = 1 WHERE id = ?').run(askId);
  sendTo(a.proposer, { k: 'sp_go', uid: a.space_uid, target: a.target });
  return { ok: true };
}
function declineAsk(askId) {
  const a = db.prepare('SELECT * FROM fed_space_asks WHERE id = ?').get(askId);
  if (!a) return { error: 'Просьба не найдена' };
  db.prepare('DELETE FROM fed_space_asks WHERE id = ?').run(askId);
  sendTo(a.proposer, { k: 'sp_nogo', uid: a.space_uid, target: a.target });
  return { ok: true };
}
// Хозяин одобрил: приглашаем сами (должно быть прямое соединение)
function recvGo(peer, ev) {
  const uid = str(ev.uid, 80), w = spaceByUid(uid), inst = str(ev.target, 40);
  if (!w || peer.instance_id !== w.fed_host) return;
  const n = node(uid, inst);
  if (!n || n.state !== 'asked' || n.parent !== me().id) return;
  const p = F().realPeerByInstance(inst);
  if (!p || p.status !== 'active') { db.prepare('DELETE FROM fed_space_servers WHERE space_uid = ? AND instance_id = ?').run(uid, inst); return; }
  db.prepare("UPDATE fed_space_servers SET state = 'offered' WHERE space_uid = ? AND instance_id = ?").run(uid, inst);
  sendOffer(uid, inst);
}
function recvNogo(peer, ev) {
  const uid = str(ev.uid, 80), w = spaceByUid(uid);
  if (w && peer.instance_id === w.fed_host) db.prepare("DELETE FROM fed_space_servers WHERE space_uid = ? AND instance_id = ? AND state = 'asked'").run(uid, str(ev.target, 40));
}
// Сосед сообщает хозяину, что приглашённый сервер вступил
function recvJoined(peer, ev) {
  const uid = str(ev.uid, 80), w = spaceByUid(uid), nd = ev.node || {};
  if (!w || w.fed_host !== me().id || !isActiveIn(uid, peer.instance_id)) return;
  const id = String(nd.id || '');
  const ask = db.prepare('SELECT * FROM fed_space_asks WHERE space_uid = ? AND proposer = ? AND target = ? AND approved = 1').get(uid, peer.instance_id, id);
  if (!ask || nd.p !== peer.instance_id || !F().validPub(nd.pub) || node(uid, id)?.state === 'active') return;
  const before = new Set(activeNodes(uid).map(x => x.instance_id));
  db.prepare("INSERT OR REPLACE INTO fed_space_servers (space_uid, instance_id, name, pub, parent, state) VALUES (?, ?, ?, ?, ?, 'active')").run(uid, id, str(nd.name, 60) || id, nd.pub, peer.instance_id);
  db.prepare('DELETE FROM fed_space_asks WHERE id = ?').run(ask.id);
  syncVirtual();
  broadcastTree(uid);
  afterTreeChange(uid, before);
}

// ─────────────────────────── дерево у участников ───────────────────────────
function recvTree(peer, ev) {
  const uid = str(ev.uid, 80), w = spaceByUid(uid);
  if (!w || peer.instance_id !== hostOfUid(uid) || w.fed_host !== peer.instance_id) return;
  const tree = validTree(uid, ev.tree);
  if (!tree) return;
  const myId = me().id;
  if (!tree.some(t => t.id === myId)) { dropMirror(uid); return; }
  const before = new Set(activeNodes(uid).map(n => n.instance_id));
  db.transaction(() => {
    const keep = new Set(tree.map(t => t.id));
    for (const n of activeNodes(uid)) if (!keep.has(n.instance_id)) db.prepare('DELETE FROM fed_space_servers WHERE space_uid = ? AND instance_id = ?').run(uid, n.instance_id);
    for (const t of tree) {
      const real = t.id !== myId ? F().realPeerByInstance(t.id) : null;
      const pub = real ? real.pub : t.pub;   // ключ прямого соседа знаем сами и чужому слову не верим
      const keepState = node(uid, t.id);
      db.prepare("INSERT OR REPLACE INTO fed_space_servers (space_uid, instance_id, name, pub, parent, state, created_at) VALUES (?, ?, ?, ?, ?, 'active', COALESCE(?, unixepoch()))")
        .run(uid, t.id, t.id === myId ? me().name : t.name, t.id === myId ? me().pub : pub, t.p, keepState?.created_at ?? null);
    }
  })();
  // название хозяина могло смениться
  const hostName = str(ev.name, 60);
  if (hostName && hostName !== getS('fedsp_name:' + uid)) {
    setS('fedsp_name:' + uid, hostName);
    try { db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(uniqueWsName(hostName, tree.find(t => t.id === peer.instance_id)?.name || peer.instance_id), w.id); } catch {}
  }
  syncVirtual();
  afterTreeChange(uid, before);
}
// Дерево изменилось: рассказываем свой состав новым серверам, применяем отложенные списки, обновляем клиентов
function afterTreeChange(uid, before) {
  const myId = me().id;
  for (const n of activeNodes(uid)) {
    if (n.instance_id === myId) continue;
    if (!before || !before.has(n.instance_id)) sendMembers(uid, n.instance_id);
    const pend = pendingMembers.get(uid + '|' + n.instance_id);
    if (pend) { pendingMembers.delete(uid + '|' + n.instance_id); const p = F().peerByInstance(n.instance_id); if (p) applyMembers(p, pend); }
  }
  // убрали сервер: его людей из пространства убираем
  const w = spaceByUid(uid);
  if (w) {
    const keep = new Set(activeNodes(uid).map(n => n.instance_id));
    const gone = db.prepare(`SELECT DISTINCT u.fed_instance AS inst FROM user_workspaces m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.is_bot = 2`).all(w.id).filter(r => !keep.has(r.inst));
    gone.forEach(r => dropShadows(w.id, r.inst));
  }
  directoryChanged();
}
function dropShadows(wsId, inst) {
  db.prepare(`DELETE FROM user_workspaces WHERE workspace_id = ? AND user_id IN (SELECT id FROM users WHERE is_bot = 2 AND fed_instance = ?)`).run(wsId, inst);
}
function directoryChanged() {
  try { wsm().broadcastAll({ type: 'directory_changed' }); wsm().broadcastAll({ type: 'presence_refresh' }); } catch {}
}

// Убрать сервер (и его ветку) из пространства. Хозяин убирает любого, участник может убрать только себя (выйти)
function removeServer(wsId, inst) {
  const w = spaceById(wsId);
  if (!w || !w.fed_uid) return { error: 'Пространство не общее' };
  const uid = w.fed_uid, myId = me().id;
  inst = String(inst || '');
  if (w.fed_host !== myId) {
    if (inst !== myId) return { error: 'Убрать другой сервер может только хозяин пространства' };
    sendTo(w.fed_host, { k: 'sp_leave', uid });
    dropMirror(uid);
    return { ok: true, left: true };
  }
  if (inst === myId) return { error: 'Хозяин не может выйти: выключите «Общее» в настройках пространства' };
  const n = node(uid, inst);
  if (!n) return { error: 'Сервер не найден' };
  const sub = subtree(uid, inst);
  for (const id of deepestFirst(uid, sub)) if (node(uid, id)?.state === 'active') sendTo(id, { k: 'sp_gone', uid, why: id === inst ? 'removed' : 'branch' });
  db.transaction(() => {
    sub.forEach(id => db.prepare('DELETE FROM fed_space_servers WHERE space_uid = ? AND instance_id = ?').run(uid, id));
    db.prepare('DELETE FROM fed_space_asks WHERE space_uid = ? AND (proposer IN (' + sub.map(() => '?').join(',') + ') OR target IN (' + sub.map(() => '?').join(',') + '))').run(uid, ...sub, ...sub);
  })();
  syncVirtual();
  broadcastTree(uid);
  afterTreeChange(uid, null);
  return { ok: true };
}
// Сначала самые дальние: их сообщения идут через ближние серверы, а те после своего «ухода» уже не пересылают чужие кадры
function deepestFirst(uid, ids) {
  const all = nodes(uid), depth = id => { let d = 0, cur = all.find(n => n.instance_id === id); while (cur && cur.parent && d < 50) { d++; cur = all.find(n => n.instance_id === cur.parent); } return d; };
  return [...ids].sort((a, b) => depth(b) - depth(a));
}
function subtree(uid, inst) {
  const all = nodes(uid), out = [inst];
  for (let i = 0; i < out.length; i++) all.filter(n => n.parent === out[i]).forEach(n => { if (!out.includes(n.instance_id)) out.push(n.instance_id); });
  return out;
}
function recvLeave(peer, ev) {
  const uid = str(ev.uid, 80), w = spaceByUid(uid);
  if (!w || w.fed_host !== me().id || !isActiveIn(uid, peer.instance_id)) return;
  removeServer(w.id, peer.instance_id);
}
function recvGone(peer, ev) {
  const uid = str(ev.uid, 80), w = spaceByUid(uid);
  if (w && peer.instance_id === hostOfUid(uid)) dropMirror(uid);
}
// Пространство перестало быть общим: у нас оно остаётся обычным, а чужие люди из него уходят
function dropMirror(uid) {
  const w = spaceByUid(uid);
  if (!w) return;
  db.transaction(() => {
    db.prepare(`DELETE FROM user_workspaces WHERE workspace_id = ? AND user_id IN (SELECT id FROM users WHERE is_bot = 2)`).run(w.id);
    db.prepare('UPDATE workspaces SET fed_uid = NULL, fed_host = NULL WHERE id = ?').run(w.id);
    db.prepare('DELETE FROM fed_space_servers WHERE space_uid = ?').run(uid);
    db.prepare('DELETE FROM fed_space_asks WHERE space_uid = ?').run(uid);
    db.prepare('DELETE FROM fed_space_offers WHERE space_uid = ?').run(uid);
    delS('fedsp_name:' + uid);
  })();
  linkInfo.delete(uid);
  syncVirtual();
  directoryChanged();
}
// Соединение с сервером удалено вручную: его ветка уходит из наших пространств
function onPeerRemoved(inst) {
  const myId = me().id;
  for (const w of sharedSpaces()) {
    const uid = w.fed_uid, n = node(uid, inst);
    if (!n) continue;
    if (w.fed_host === myId) removeServer(w.id, inst);
    else if (inst === w.fed_host || (n.parent !== myId && node(uid, myId)?.parent === inst)) dropMirror(uid);   // отрезаны от хозяина
    else if (n.parent === myId) {
      sendTo(w.fed_host, { k: 'sp_cut', uid, inst });
      subtree(uid, inst).forEach(id => db.prepare('DELETE FROM fed_space_servers WHERE space_uid = ? AND instance_id = ?').run(uid, id));
    }
  }
  syncVirtual();
}
// Сосед сообщил, что отключил ветку (хозяину)
function recvCut(peer, ev) {
  const uid = str(ev.uid, 80), w = spaceByUid(uid), inst = str(ev.inst, 40), n = w && node(uid, inst);
  if (!n || w.fed_host !== me().id || n.parent !== peer.instance_id) return;
  removeServer(w.id, inst);
}

// ─────────────────────────── состав ───────────────────────────
const pendingMembers = new Map();
function localMembers(wsId) {
  return db.prepare(`SELECT u.id, u.username, u.display_name FROM user_workspaces m JOIN users u ON u.id = m.user_id
    WHERE m.workspace_id = ? AND COALESCE(u.is_bot, 0) = 0 AND COALESCE(u.banned, 0) = 0 ORDER BY u.id`).all(wsId);
}
function sendMembers(uid, toInst) {
  const w = spaceByUid(uid), myId = me().id;
  if (!w || !isActiveIn(uid, myId)) return;
  const list = localMembers(w.id).slice(0, MAX_MEMBERS).map(u => ({ l: u.username, n: u.display_name, a: F().avatarVersion(u.id) }));
  for (const n of activeNodes(uid)) {
    if (n.instance_id === myId || (toInst && n.instance_id !== toInst)) continue;
    sendTo(n.instance_id, { k: 'sp_members', uid, list }, true);
  }
}
let membersTimer = null;
const membersDirty = new Set();
// Состав какого-то пространства (или всех: ids пуст) изменился — отправляем остальным серверам, собирая частые правки
function membersChanged(wsIds) {
  const all = !wsIds || !wsIds.length;
  (all ? sharedSpaces() : wsIds.map(spaceById).filter(Boolean)).forEach(w => { if (w.fed_uid) membersDirty.add(w.fed_uid); });
  if (!membersDirty.size || membersTimer) return;
  membersTimer = setTimeout(() => {
    membersTimer = null;
    const list = [...membersDirty]; membersDirty.clear();
    list.forEach(uid => { try { sendMembers(uid); } catch (e) { console.warn('[Fed] состав:', e.message); } });
  }, 1200);
  membersTimer.unref?.();
}
function recvMembers(peer, ev) {
  const uid = str(ev.uid, 80), w = spaceByUid(uid);
  if (!w || !Array.isArray(ev.list)) return;
  if (!isActiveIn(uid, peer.instance_id)) {
    // Дерево с этим сервером ещё не дошло до нас: держим список и применим, когда придёт
    if (pendingMembers.size < 200) pendingMembers.set(uid + '|' + peer.instance_id, ev);
    return;
  }
  applyMembers(peer, ev);
}
function applyMembers(peer, ev) {
  const uid = str(ev.uid, 80), w = spaceByUid(uid);
  if (!w || !isActiveIn(uid, peer.instance_id) || !isActiveIn(uid, me().id)) return;
  const inst = peer.instance_id, have = new Set();
  const ins = db.prepare('INSERT OR IGNORE INTO user_workspaces (user_id, workspace_id) VALUES (?, ?)');
  let changed = 0;
  for (const it of ev.list.slice(0, MAX_MEMBERS)) {
    const login = str(it?.l, 64);
    if (!login) continue;
    const sh = F().ensureShadow(peer, login, str(it.n, 80), it.a === undefined ? undefined : str(it.a, 40));
    if (!sh) continue;
    have.add(sh.id);
    changed += ins.run(sh.id, w.id).changes;
  }
  const cur = db.prepare(`SELECT m.user_id FROM user_workspaces m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.is_bot = 2 AND u.fed_instance = ?`).all(w.id, inst);
  for (const r of cur) if (!have.has(r.user_id)) { db.prepare('DELETE FROM user_workspaces WHERE workspace_id = ? AND user_id = ?').run(w.id, r.user_id); changed++; }
  if (changed) { directoryChanged(); syncPresence(peer.id); }
}

// ─────────────────────────── статусы ───────────────────────────
function peersOfSpacesFor(userId) {
  const myId = me().id, out = new Set();
  const rows = db.prepare('SELECT w.fed_uid FROM user_workspaces m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? AND w.fed_uid IS NOT NULL').all(userId);
  for (const r of rows) for (const n of activeNodes(r.fed_uid)) if (n.instance_id !== myId) out.add(n.instance_id);
  return out;
}
function presenceOut(userId, status, lastSeen, mobile) {
  const u = db.prepare('SELECT username, is_bot FROM users WHERE id = ?').get(userId);
  if (!u || u.is_bot) return;
  for (const inst of peersOfSpacesFor(userId)) {
    const p = F().peerByInstance(inst);
    if (p && F().isOnline(p.id)) F().sendLive(p.id, { k: 'spp', from: u.username, status, last_seen: lastSeen || null, mob: mobile ? 1 : undefined });
  }
}
function syncPresence(peerId) {
  const p = F().peerRow(peerId);
  if (!p || !F().isOnline(peerId)) return;
  const myId = me().id, seen = new Set();
  for (const w of sharedSpaces()) {
    if (!isActiveIn(w.fed_uid, myId) || !isActiveIn(w.fed_uid, p.instance_id)) continue;
    for (const m of localMembers(w.id)) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const st = wsm().getStatus(m.id);
      const last = db.prepare('SELECT last_seen_at FROM users WHERE id = ?').get(m.id)?.last_seen_at;
      F().sendLive(peerId, { k: 'spp', from: m.username, status: st, last_seen: st === 'offline' ? last : null, mob: wsm().getMobile(m.id) ? 1 : undefined });
    }
  }
}
function recvPresence(peer, ev) {
  const sh = F().remoteUser(peer, ev.from), st = ev.status;
  if (!sh || !['online', 'away', 'offline'].includes(st)) return;
  const shared = db.prepare('SELECT 1 FROM user_workspaces m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? AND w.fed_uid IS NOT NULL LIMIT 1').get(sh.id);
  if (!shared) return;
  wsm().setRemoteStatus(sh.id, st, st === 'offline' ? Math.floor(Number(ev.last_seen)) || 0 : 0, ev.mob === 1);
}

// ─────────────────────────── связь и состояние линий ───────────────────────────
const linkInfo = new Map();   // uid → Map('a|b' → { on, at })
function onLink(peer, up) {
  invalidate();
  if (!up) return;
  const myId = me().id;
  for (const w of sharedSpaces()) {
    if (!isActiveIn(w.fed_uid, myId) || !isActiveIn(w.fed_uid, peer.instance_id)) continue;
    sendMembers(w.fed_uid, peer.instance_id);
    if (w.fed_host === myId) broadcastTree(w.fed_uid, peer.instance_id);
  }
}
function reportLinks() {
  const myId = me().id;
  if (!myId) return;
  for (const w of sharedSpaces()) {
    const uid = w.fed_uid;
    if (!isActiveIn(uid, myId)) continue;
    const mine = edgesOf(uid).filter(e => e.a === myId || e.b === myId).map(e => {
      const other = e.a === myId ? e.b : e.a, p = F().realPeerByInstance(other);
      return [e.a, e.b, p && F().isOnline(p.id) ? 1 : 0];
    });
    const m = linkInfo.get(uid) || new Map();
    linkInfo.set(uid, m);
    mine.forEach(([a, b, on]) => m.set(a + '|' + b, { on: !!on, at: Date.now() }));
    for (const n of activeNodes(uid)) {
      if (n.instance_id === myId) continue;
      const p = F().peerByInstance(n.instance_id);
      if (p && F().isOnline(p.id)) F().sendLive(p.id, { k: 'sp_links', uid, links: mine });
    }
  }
}
function recvLinks(peer, ev) {
  const uid = str(ev.uid, 80);
  if (!spaceByUid(uid) || !isActiveIn(uid, peer.instance_id) || !Array.isArray(ev.links)) return;
  const m = linkInfo.get(uid) || new Map();
  linkInfo.set(uid, m);
  for (const l of ev.links.slice(0, 200)) if (Array.isArray(l)) m.set(`${str(l[0], 40)}|${str(l[1], 40)}`, { on: !!l[2], at: Date.now() });
}

// ─────────────────────────── карта ───────────────────────────
function mapData() {
  const id = me();
  if (!id.configured) return { configured: false, nodes: [], edges: [], spaces: [] };
  const myId = id.id, byNode = new Map(), edges = new Map(), spaceList = [];
  const addNode = (inst, name, pub, extra = {}) => {
    const cur = byNode.get(inst) || { id: inst, name, self: inst === myId, spaces: [], people: 0, fp: pub ? F().fingerprint(pub) : '', pub, direct: false };
    Object.assign(cur, extra);
    byNode.set(inst, cur);
    return cur;
  };
  addNode(myId, id.name, id.pub, { online: true });
  const keyOk = new Map(db.prepare('SELECT instance_id, pub FROM fed_key_checks').all().map(r => [r.instance_id, r.pub]));
  // Прямые соединения
  for (const p of db.prepare('SELECT * FROM fed_peers WHERE virt = 0').all()) {
    const on = p.status === 'active' && F().isOnline(p.id);
    addNode(p.instance_id, p.name, p.pub, { direct: true, online: on, paused: p.status !== 'active' });
    const k = [myId, p.instance_id].sort().join('|');
    edges.set(k, { a: myId, b: p.instance_id, on, spaces: [], direct: true });
  }
  // Пространства
  const colorOf = i => i % 6;
  sharedSpaces().forEach((w, i) => {
    const uid = w.fed_uid, act = activeNodes(uid);
    if (!act.some(n => n.instance_id === myId)) return;
    const info = linkInfo.get(uid) || new Map();
    const sp = { uid, id: w.id, name: w.name, host: w.fed_host, is_host: w.fed_host === myId, color: colorOf(i), servers: [], people: 0 };
    for (const n of act) {
      const cnt = n.instance_id === myId ? localMembers(w.id).length
        : db.prepare(`SELECT COUNT(*) c FROM user_workspaces m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.is_bot = 2 AND u.fed_instance = ?`).get(w.id, n.instance_id).c;
      const nd = addNode(n.instance_id, n.name, n.pub);
      nd.spaces.push({ uid, people: cnt });
      sp.servers.push(n.instance_id);
      sp.people += cnt;
    }
    for (const e of edgesOf(uid)) {
      const k = [e.a, e.b].sort().join('|');
      let on = null;
      if (e.a === myId || e.b === myId) { const other = e.a === myId ? e.b : e.a; const p = F().realPeerByInstance(other); on = !!(p && F().isOnline(p.id)); }
      else { const li = info.get(e.a + '|' + e.b); if (li && Date.now() - li.at < 45000) on = li.on; }
      const cur = edges.get(k) || { a: e.a, b: e.b, on, spaces: [] };
      cur.on = on; cur.spaces.push(uid);
      edges.set(k, cur);
    }
    spaceList.push(sp);
  });
  // Доступность дальних серверов: по пути из рёбер, о которых известно, что они работают
  const adj = new Map();
  for (const e of edges.values()) { (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push(e); (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push(e); }
  const state = new Map([[myId, true]]), q = [myId];
  while (q.length) {
    const u = q.shift();
    for (const e of adj.get(u) || []) {
      const v = e.a === u ? e.b : e.a;
      if (state.has(v)) continue;
      const s = state.get(u) === true && e.on === true ? true : (e.on === false || state.get(u) === false ? false : null);
      state.set(v, s); q.push(v);
    }
  }
  for (const n of byNode.values()) {
    n.online = n.self ? true : (state.has(n.id) ? state.get(n.id) : null);
    n.people = n.spaces.reduce((a, s) => a + s.people, 0);
    n.verified = n.self ? true : (n.direct ? true : keyOk.get(n.id) === n.pub);
    delete n.pub;
  }
  return { configured: true, me: myId, nodes: [...byNode.values()], edges: [...edges.values()], spaces: spaceList };
}
function verifyKey(inst) {
  const n = db.prepare("SELECT pub FROM fed_space_servers WHERE instance_id = ? LIMIT 1").get(String(inst));
  if (!n) return { error: 'Сервер не найден' };
  db.prepare('INSERT OR REPLACE INTO fed_key_checks (instance_id, pub) VALUES (?, ?)').run(String(inst), n.pub);
  return { ok: true };
}

// ─────────────────────────── для админки ───────────────────────────
function adminInfo(w) {
  if (!w.fed_uid) return { shared: false };
  const uid = w.fed_uid, myId = me().id;
  const list = nodes(uid).map(n => {
    const real = n.instance_id !== myId ? F().realPeerByInstance(n.instance_id) : null;
    const people = n.instance_id === myId ? localMembers(w.id).length
      : db.prepare(`SELECT COUNT(*) c FROM user_workspaces m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.is_bot = 2 AND u.fed_instance = ?`).get(w.id, n.instance_id).c;
    return { id: n.instance_id, name: n.name, parent: n.parent, state: n.state, self: n.instance_id === myId, host: n.instance_id === w.fed_host, direct: !!real, online: n.instance_id === myId ? true : !!(real ? F().isOnline(real.id) : (F().peerByInstance(n.instance_id) && F().isOnline(F().peerByInstance(n.instance_id).id))), people };
  });
  return {
    shared: true, uid, host: w.fed_host, is_host: w.fed_host === myId, servers: list,
    asks: w.fed_host === myId ? db.prepare('SELECT id, proposer, target, target_name, approved FROM fed_space_asks WHERE space_uid = ?').all(uid) : [],
  };
}
function offersList() {
  return db.prepare('SELECT space_uid AS uid, host, name, from_inst, created_at FROM fed_space_offers ORDER BY created_at').all().map(o => {
    let tree = []; try { tree = JSON.parse(db.prepare('SELECT tree FROM fed_space_offers WHERE space_uid = ?').get(o.uid).tree); } catch {}
    return { ...o, host_name: tree.find(t => t.id === o.host)?.name || o.host, from_name: F().realPeerByInstance(o.from_inst)?.name || o.from_inst, servers: tree.map(t => t.name) };
  });
}
// Соединения, которым можно предложить пространство: прямые, активные, ещё не в нём
function candidates(w) {
  if (!w.fed_uid) return [];
  const have = new Set(nodes(w.fed_uid).map(n => n.instance_id));
  return db.prepare("SELECT instance_id, name, sp FROM fed_peers WHERE virt = 0 AND status = 'active' ORDER BY name").all()
    .filter(p => !have.has(p.instance_id)).map(p => ({ id: p.instance_id, name: p.name, ok: !!p.sp }));
}

// ─────────────────────────── общее ───────────────────────────
function handle(peer, ev) {
  if (!me().configured) return;
  switch (ev.k) {
    case 'sp_offer': return recvOffer(peer, ev);
    case 'sp_accept': return recvAccept(peer, ev);
    case 'sp_decline': return recvDecline(peer, ev);
    case 'sp_ask': return recvAsk(peer, ev);
    case 'sp_go': return recvGo(peer, ev);
    case 'sp_nogo': return recvNogo(peer, ev);
    case 'sp_joined': return recvJoined(peer, ev);
    case 'sp_tree': return recvTree(peer, ev);
    case 'sp_members': return recvMembers(peer, ev);
    case 'sp_leave': return recvLeave(peer, ev);
    case 'sp_gone': return recvGone(peer, ev);
    case 'sp_cut': return recvCut(peer, ev);
    case 'sp_links': return recvLinks(peer, ev);
  }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  syncVirtual();
  let n = 0;
  const t = setInterval(() => {
    try {
      F().virtualTick();
      if (n % 2 === 0) reportLinks();
      if (n % 24 === 0 && n) membersChanged();   // раз в две минуты пересылаем состав заново: на случай пропущенных правок
      n++;
    } catch (e) { console.warn('[Fed] пространства:', e.message); }
  }, 5000);
  t.unref?.();
}

module.exports = {
  start, handle, nextHop, mayRelay, onLink, onPeerRemoved, syncVirtual,
  enableShared, disableShared, offerServer, removeServer, acceptOffer, declineOffer, approveAsk, declineAsk,
  membersChanged, presenceOut, syncPresence, recvPresence, broadcastTree,
  mapData, verifyKey, adminInfo, offersList, candidates,
};
