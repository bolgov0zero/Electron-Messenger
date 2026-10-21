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
const { someAsync } = require('./aiter.js');
const dal = require('./dal');
const spaces = require('./spaces');

const F = () => require('./federation');
const wsm = () => require('./ws');
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const MAX_SERVERS = 40;
const MAX_MEMBERS = 5000;
const me = async () => (await F().identity());

const spaceByUid = async uid => (await dal.get('SELECT * FROM workspaces WHERE fed_uid = ?', uid));
const spaceById = async id => (await dal.get('SELECT * FROM workspaces WHERE id = ?', id));
const hostOfUid = uid => String(uid).split(':')[0];
const nodes = async uid => (await dal.all('SELECT * FROM fed_space_servers WHERE space_uid = ? ORDER BY created_at, rowid', uid));
const activeNodes = async uid => (await nodes(uid)).filter(n => n.state === 'active');
const node = async (uid, inst) => (await dal.get('SELECT * FROM fed_space_servers WHERE space_uid = ? AND instance_id = ?', uid, inst));
const isActiveIn = async (uid, inst) => (await node(uid, inst))?.state === 'active';
const sharedSpaces = async () => (await dal.all('SELECT * FROM workspaces WHERE fed_uid IS NOT NULL'));
const getS = async (k, d = '') => (await dal.get('SELECT value FROM settings WHERE key = ?', k))?.value ?? d;
const setS = async (k, v) => (await dal.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, String(v)));
const delS = async k => (await dal.run('DELETE FROM settings WHERE key = ?', k));

// ─────────────────────────── дерево и маршруты ───────────────────────────
let routeCache = null;
async function edgesOf(uid) {
  const act = await activeNodes(uid), ids = new Set(act.map(n => n.instance_id));
  return act.filter(n => n.parent && ids.has(n.parent)).map(n => ({ a: n.parent, b: n.instance_id }));
}
// dest → сосед, через которого до него добираться (по всем пространствам, в которых мы состоим)
async function routes() {
  if (routeCache) return routeCache;
  const myId = (await me()).id, adj = new Map();
  const add = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const w of (await sharedSpaces())) {
    if (!(await isActiveIn(w.fed_uid, myId))) continue;
    (await edgesOf(w.fed_uid)).forEach(e => { add(e.a, e.b); add(e.b, e.a); });
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
async function nextHop(dest) { return (await routes()).get(String(dest)) || null; }
// Можно ли переслать кадр от from к to: оба в одном пространстве вместе с нами
async function mayRelay(from, to) {
  const myId = (await me()).id;
  return (await someAsync((await sharedSpaces()), async w => (await isActiveIn(w.fed_uid, myId)) && (await isActiveIn(w.fed_uid, from)) && (await isActiveIn(w.fed_uid, to))));
}

// Сквозные записи в fed_peers: по одной на сервер из наших пространств, с которым нет прямого соединения
async function syncVirtual() {
  invalidate();
  const myId = (await me()).id;
  if (!myId) return;
  const want = new Map();
  for (const w of (await sharedSpaces())) {
    const list = await activeNodes(w.fed_uid);
    if (!list.some(n => n.instance_id === myId)) continue;
    list.forEach(n => { if (n.instance_id !== myId && !want.has(n.instance_id)) want.set(n.instance_id, n); });
  }
  for (const [inst, n] of want) {
    if ((await F().realPeerByInstance(inst))) continue;
    const cur = await F().peerByInstance(inst);
    if (!cur) await dal.run("INSERT INTO fed_peers (instance_id, name, url, pub, role, status, virt) VALUES (?, ?, NULL, ?, 'out', 'active', 1)", inst, n.name, n.pub);
    else if (cur.pub !== n.pub) { await F().endVirtual(cur.id, true); await dal.run('UPDATE fed_peers SET pub = ?, name = ? WHERE id = ?', n.pub, n.name, cur.id); }
    else if (cur.name !== n.name) await dal.run('UPDATE fed_peers SET name = ? WHERE id = ?', n.name, cur.id);
  }
  for (const p of (await dal.all('SELECT * FROM fed_peers WHERE virt = 1'))) {
    if (want.has(p.instance_id)) continue;
    await F().endVirtual(p.id, true);
    await dal.run('DELETE FROM fed_peers WHERE id = ?', p.id);
  }
}

// ─────────────────────────── отправка ───────────────────────────
async function sendTo(inst, ev, dedupe) {
  const p = await F().peerByInstance(inst);
  if (!p || p.status !== 'active') return false;
  if (dedupe) {
    // В очереди хранится только последнее состояние: старые такие же события вытесняются
    const prefix = `{"k":"${ev.k}","uid":${JSON.stringify(ev.uid)}`;
    await dal.run('DELETE FROM fed_outbox WHERE peer_id = ? AND substr(ev, 1, ?) = ?', p.id, prefix.length, prefix);
  }
  await F().enqueue(p.id, ev);
  return true;
}
const treeOf = async uid => (await activeNodes(uid)).map(n => ({ id: n.instance_id, name: n.name, pub: n.pub, p: n.parent }));
async function broadcastTree(uid, only) {
  const w = await spaceByUid(uid);
  if (!w || w.fed_host !== (await me()).id) return;
  const t = await treeOf(uid);
  for (const n of (await activeNodes(uid))) if (n.instance_id !== (await me()).id && (!only || n.instance_id === only)) await sendTo(n.instance_id, { k: 'sp_tree', uid, name: w.name, tree: t }, true);
}

// ─────────────────────────── включение и приглашения ───────────────────────────
async function enableShared(wsId) {
  const id = await me();
  if (!id.configured) return { error: 'Сначала настройте федерацию: задайте идентификатор сервера' };
  const w = await spaceById(wsId);
  if (!w) return { error: 'Пространство не найдено' };
  if (w.fed_uid) return { ok: true };
  if (w.id === spaces.DEFAULT_WS) return { error: 'Основное пространство нельзя сделать общим: оно используется по умолчанию' };
  const uid = `${id.id}:${w.id}`;
  await dal.tx(() => (async () => {
    await dal.run('UPDATE workspaces SET fed_uid = ?, fed_host = ? WHERE id = ?', uid, id.id, w.id);
    await dal.run("INSERT OR REPLACE INTO fed_space_servers (space_uid, instance_id, name, pub, parent, state) VALUES (?, ?, ?, ?, '', 'active')", uid, id.id, id.name, id.pub);
  })());
  invalidate();
  return { ok: true, uid };
}
async function disableShared(wsId) {
  const w = await spaceById(wsId);
  if (!w || !w.fed_uid) return { ok: true };
  if (w.fed_host !== (await me()).id) return { error: 'Выключить общее пространство может только его хозяин' };
  for (const id of (await deepestFirst(w.fed_uid, (await activeNodes(w.fed_uid)).map(n => n.instance_id)))) if (id !== (await me()).id) await sendTo(id, { k: 'sp_gone', uid: w.fed_uid, why: 'off' });
  await dropMirror(w.fed_uid);
  return { ok: true };
}

// Предложить пространство серверу inst. Хозяин приглашает сразу, участник просит хозяина
async function offerServer(wsId, inst) {
  const w = await spaceById(wsId);
  if (!w || !w.fed_uid) return { error: 'Пространство не общее' };
  const myId = (await me()).id, uid = w.fed_uid;
  if (!(await isActiveIn(uid, myId))) return { error: 'Вы не участник этого пространства' };
  inst = String(inst || '').toLowerCase();
  const peer = await F().realPeerByInstance(inst);
  if (!peer || peer.status !== 'active') return { error: 'С этим сервером нет прямого подключения. Подключите его в разделе «Федерации».' };
  if ((await nodes(uid)).some(n => n.instance_id === inst)) return { error: 'Этот сервер уже в пространстве или приглашён' };
  if ((await nodes(uid)).length >= MAX_SERVERS) return { error: `В пространстве не может быть больше ${MAX_SERVERS} серверов` };
  if (!F().isOnline(peer.id)) return { error: 'Сервер сейчас недоступен: приглашение можно отправить, когда есть связь' };
  if (!peer.sp) return { error: 'Этот сервер ещё не поддерживает общие пространства: пусть его администратор обновит сервер' };
  if (w.fed_host === myId) {
    await dal.run("INSERT OR REPLACE INTO fed_space_servers (space_uid, instance_id, name, pub, parent, state) VALUES (?, ?, ?, ?, ?, 'offered')", uid, inst, peer.name, peer.pub, myId);
    await sendOffer(uid, inst);
    return { ok: true, invited: true };
  }
  // Участник: просьба хозяину
  const t = { id: inst, name: peer.name, pub: peer.pub };
  const done = await sendTo(w.fed_host, { k: 'sp_ask', uid, target: t });
  if (!done) return { error: 'Нет связи с хозяином пространства' };
  await dal.run("INSERT OR REPLACE INTO fed_space_servers (space_uid, instance_id, name, pub, parent, state) VALUES (?, ?, ?, ?, ?, 'asked')", uid, inst, peer.name, peer.pub, myId);
  return { ok: true, asked: true };
}
async function sendOffer(uid, inst) {
  const w = await spaceByUid(uid), h = await node(uid, w.fed_host);
  await sendTo(inst, { k: 'sp_offer', uid, name: w.name, host: { id: w.fed_host, name: h?.name || w.fed_host, pub: h?.pub || '' }, tree: (await treeOf(uid)) });
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

async function recvOffer(peer, ev) {
  if (peer.virt) return;
  const uid = str(ev.uid, 80);
  if (!/^[a-z0-9._-]+:\d+$/.test(uid) || !ID_RE.test(hostOfUid(uid))) return;
  const tree = validTree(uid, ev.tree);
  if (!tree || !tree.some(t => t.id === peer.instance_id)) return await sendTo(peer.instance_id, { k: 'sp_decline', uid, why: 'bad' });
  if ((await someAsync(tree, async t => t.id === (await me()).id)) || (await spaceByUid(uid)) || (await dal.get('SELECT 1 FROM fed_space_offers WHERE space_uid = ?', uid))) return await sendTo(peer.instance_id, { k: 'sp_decline', uid, why: 'have' });
  await dal.run('INSERT INTO fed_space_offers (space_uid, host, name, from_inst, tree) VALUES (?, ?, ?, ?, ?)', uid, hostOfUid(uid), str(ev.name, 60) || 'Пространство', peer.instance_id, JSON.stringify(tree));
  try { wsm().broadcastAdmins?.({ type: 'fed_space_offer' }); } catch {}
}

async function uniqueWsName(base, hostName) {
  const taken = async x => !!(await dal.get('SELECT 1 FROM workspaces WHERE name = ?', x));
  let n = String(base).slice(0, 60);
  if (!(await taken(n))) return n;
  n = `${base} (${hostName})`.slice(0, 60);
  if (!(await taken(n))) return n;
  for (let i = 2; ; i++) { n = `${base} ${i}`.slice(0, 60); if (!(await taken(n))) return n; }
}

// attachWsId — объединить с существующим локальным пространством (оно становится общим вместо создания нового)
async function acceptOffer(uid, attachWsId) {
  const o = await dal.get('SELECT * FROM fed_space_offers WHERE space_uid = ?', uid);
  if (!o) return { error: 'Приглашение не найдено' };
  const id = await me();
  if (!id.configured) return { error: 'Сначала настройте федерацию' };
  let tree; try { tree = validTree(uid, JSON.parse(o.tree)); } catch { tree = null; }
  if (!tree) { await dal.run('DELETE FROM fed_space_offers WHERE space_uid = ?', uid); return { error: 'Приглашение повреждено' }; }
  const from = await F().realPeerByInstance(o.from_inst);
  if (!from || from.status !== 'active') return { error: 'Нет подключения к серверу, приславшему приглашение' };
  const hostName = tree.find(t => t.id === o.host)?.name || o.host;
  let attach = null;
  if (attachWsId) {
    attach = await spaceById(Number(attachWsId));
    if (!attach) return { error: 'Пространство для объединения не найдено' };
    if (attach.fed_uid) return { error: 'Это пространство уже общее' };
    if (attach.id === spaces.DEFAULT_WS) return { error: 'Основное пространство нельзя сделать общим: оно используется по умолчанию' };
  }
  let name;
  if (attach) {
    // Название у общего пространства задаёт хозяин: наше переименовывается, если отличается (в том числе регистром)
    name = String(attach.name) === String(o.name) ? attach.name : (async () => {
      const taken = async x => !!(await dal.get('SELECT 1 FROM workspaces WHERE name = ? AND id != ?', x, attach.id));
      let n = String(o.name).slice(0, 60);
      if ((await taken(n))) n = `${o.name} (${hostName})`.slice(0, 60);
      for (let i = 2; (await taken(n)); i++) n = `${o.name} ${i}`.slice(0, 60);
      return n;
    })();
  } else name = await uniqueWsName(o.name, hostName);
  let wsRowId = null;
  await dal.tx(() => (async () => {
    if (attach) { await dal.run('UPDATE workspaces SET name = ?, fed_uid = ?, fed_host = ? WHERE id = ?', name, uid, o.host, attach.id); wsRowId = attach.id; }
    else wsRowId = Number((await dal.run('INSERT INTO workspaces (name, fed_uid, fed_host) VALUES (?, ?, ?)', name, uid, o.host)).lastInsertRowid);
    await setS('fedsp_name:' + uid, o.name);
    for (const t of tree) (await dal.run("INSERT OR REPLACE INTO fed_space_servers (space_uid, instance_id, name, pub, parent, state) VALUES (?, ?, ?, ?, ?, 'active')", uid, t.id, t.name, t.id === o.from_inst ? from.pub : t.pub, t.p)) ;
    await dal.run("INSERT OR REPLACE INTO fed_space_servers (space_uid, instance_id, name, pub, parent, state) VALUES (?, ?, ?, ?, ?, 'active')", uid, id.id, id.name, id.pub, o.from_inst);
    await dal.run('DELETE FROM fed_space_offers WHERE space_uid = ?', uid);
  })());
  await syncVirtual();
  await sendTo(o.from_inst, { k: 'sp_accept', uid, name: id.name });
  if (attach) { await membersChanged([wsRowId]); directoryChanged(); }   // люди объединённого пространства сразу становятся видны остальным серверам
  return { ok: true, name, attached: !!attach };
}
async function declineOffer(uid) {
  const o = await dal.get('SELECT * FROM fed_space_offers WHERE space_uid = ?', uid);
  if (!o) return { error: 'Приглашение не найдено' };
  await dal.run('DELETE FROM fed_space_offers WHERE space_uid = ?', uid);
  await sendTo(o.from_inst, { k: 'sp_decline', uid, why: 'no' });
  return { ok: true };
}

// Сосед принял приглашение
async function recvAccept(peer, ev) {
  const uid = str(ev.uid, 80), w = await spaceByUid(uid), n = w && (await node(uid, peer.instance_id));
  if (!n || n.state !== 'offered' || n.parent !== (await me()).id) return;
  const before = new Set((await activeNodes(uid)).map(x => x.instance_id));
  await dal.run("UPDATE fed_space_servers SET state = 'active' WHERE space_uid = ? AND instance_id = ?", uid, peer.instance_id);
  invalidate();
  if (w.fed_host === (await me()).id) { await syncVirtual(); await broadcastTree(uid); await afterTreeChange(uid, before); }
  else await sendTo(w.fed_host, { k: 'sp_joined', uid, node: { id: n.instance_id, name: n.name, pub: n.pub, p: (await me()).id } });
}
async function recvDecline(peer, ev) {
  const uid = str(ev.uid, 80), n = await node(uid, peer.instance_id);
  if (n && n.state !== 'active' && n.parent === (await me()).id) { await dal.run('DELETE FROM fed_space_servers WHERE space_uid = ? AND instance_id = ?', uid, peer.instance_id); }
}
// Участник просит добавить сервер (мы — хозяин)
async function recvAsk(peer, ev) {
  const uid = str(ev.uid, 80), w = await spaceByUid(uid);
  if (!w || w.fed_host !== (await me()).id || !(await isActiveIn(uid, peer.instance_id))) return;
  const t = ev.target || {}, id = String(t.id || '');
  if (!ID_RE.test(id) || !F().validPub(t.pub) || (await node(uid, id)) || id === (await me()).id) return;
  if ((await dal.get('SELECT 1 FROM fed_space_asks WHERE space_uid = ? AND target = ?', uid, id))) return;
  await dal.run('INSERT INTO fed_space_asks (space_uid, proposer, target, target_name, target_pub) VALUES (?, ?, ?, ?, ?)', uid, peer.instance_id, id, str(t.name, 60) || id, t.pub);
}
async function approveAsk(askId) {
  const a = await dal.get('SELECT * FROM fed_space_asks WHERE id = ?', askId);
  if (!a) return { error: 'Просьба не найдена' };
  await dal.run('UPDATE fed_space_asks SET approved = 1 WHERE id = ?', askId);
  await sendTo(a.proposer, { k: 'sp_go', uid: a.space_uid, target: a.target });
  return { ok: true };
}
async function declineAsk(askId) {
  const a = await dal.get('SELECT * FROM fed_space_asks WHERE id = ?', askId);
  if (!a) return { error: 'Просьба не найдена' };
  await dal.run('DELETE FROM fed_space_asks WHERE id = ?', askId);
  await sendTo(a.proposer, { k: 'sp_nogo', uid: a.space_uid, target: a.target });
  return { ok: true };
}
// Хозяин одобрил: приглашаем сами (должно быть прямое соединение)
async function recvGo(peer, ev) {
  const uid = str(ev.uid, 80), w = await spaceByUid(uid), inst = str(ev.target, 40);
  if (!w || peer.instance_id !== w.fed_host) return;
  const n = await node(uid, inst);
  if (!n || n.state !== 'asked' || n.parent !== (await me()).id) return;
  const p = await F().realPeerByInstance(inst);
  if (!p || p.status !== 'active') { await dal.run('DELETE FROM fed_space_servers WHERE space_uid = ? AND instance_id = ?', uid, inst); return; }
  await dal.run("UPDATE fed_space_servers SET state = 'offered' WHERE space_uid = ? AND instance_id = ?", uid, inst);
  await sendOffer(uid, inst);
}
async function recvNogo(peer, ev) {
  const uid = str(ev.uid, 80), w = await spaceByUid(uid);
  if (w && peer.instance_id === w.fed_host) await dal.run("DELETE FROM fed_space_servers WHERE space_uid = ? AND instance_id = ? AND state = 'asked'", uid, str(ev.target, 40));
}
// Сосед сообщает хозяину, что приглашённый сервер вступил
async function recvJoined(peer, ev) {
  const uid = str(ev.uid, 80), w = await spaceByUid(uid), nd = ev.node || {};
  if (!w || w.fed_host !== (await me()).id || !(await isActiveIn(uid, peer.instance_id))) return;
  const id = String(nd.id || '');
  const ask = await dal.get('SELECT * FROM fed_space_asks WHERE space_uid = ? AND proposer = ? AND target = ? AND approved = 1', uid, peer.instance_id, id);
  if (!ask || nd.p !== peer.instance_id || !F().validPub(nd.pub) || (await node(uid, id))?.state === 'active') return;
  const before = new Set((await activeNodes(uid)).map(x => x.instance_id));
  await dal.run("INSERT OR REPLACE INTO fed_space_servers (space_uid, instance_id, name, pub, parent, state) VALUES (?, ?, ?, ?, ?, 'active')", uid, id, str(nd.name, 60) || id, nd.pub, peer.instance_id);
  await dal.run('DELETE FROM fed_space_asks WHERE id = ?', ask.id);
  await syncVirtual();
  await broadcastTree(uid);
  await afterTreeChange(uid, before);
}

// ─────────────────────────── дерево у участников ───────────────────────────
async function recvTree(peer, ev) {
  const uid = str(ev.uid, 80), w = await spaceByUid(uid);
  if (!w || peer.instance_id !== hostOfUid(uid) || w.fed_host !== peer.instance_id) return;
  const tree = validTree(uid, ev.tree);
  if (!tree) return;
  const myId = (await me()).id;
  if (!tree.some(t => t.id === myId)) { await dropMirror(uid); return; }
  const before = new Set((await activeNodes(uid)).map(n => n.instance_id));
  await dal.tx(() => (async () => {
    const keep = new Set(tree.map(t => t.id));
    for (const n of (await activeNodes(uid))) if (!keep.has(n.instance_id)) await dal.run('DELETE FROM fed_space_servers WHERE space_uid = ? AND instance_id = ?', uid, n.instance_id);
    for (const t of tree) {
      const real = t.id !== myId ? (await F().realPeerByInstance(t.id)) : null;
      const pub = real ? real.pub : t.pub;   // ключ прямого соседа знаем сами и чужому слову не верим
      const keepState = await node(uid, t.id);
      await dal.run("INSERT OR REPLACE INTO fed_space_servers (space_uid, instance_id, name, pub, parent, state, created_at) VALUES (?, ?, ?, ?, ?, 'active', COALESCE(?, unixepoch()))", uid, t.id, t.id === myId ? (await me()).name : t.name, t.id === myId ? (await me()).pub : pub, t.p, keepState?.created_at ?? null);
    }
  })());
  // название хозяина могло смениться
  const hostName = str(ev.name, 60);
  if (hostName && hostName !== (await getS('fedsp_name:' + uid))) {
    await setS('fedsp_name:' + uid, hostName);
    try { await dal.run('UPDATE workspaces SET name = ? WHERE id = ?', (await uniqueWsName(hostName, tree.find(t => t.id === peer.instance_id)?.name || peer.instance_id)), w.id); } catch {}
  }
  await syncVirtual();
  await afterTreeChange(uid, before);
}
// Дерево изменилось: рассказываем свой состав новым серверам, применяем отложенные списки, обновляем клиентов
async function afterTreeChange(uid, before) {
  const myId = (await me()).id;
  for (const n of (await activeNodes(uid))) {
    if (n.instance_id === myId) continue;
    if (!before || !before.has(n.instance_id)) await sendMembers(uid, n.instance_id);
    const pend = pendingMembers.get(uid + '|' + n.instance_id);
    if (pend) { pendingMembers.delete(uid + '|' + n.instance_id); const p = await F().peerByInstance(n.instance_id); if (p) await applyMembers(p, pend); }
  }
  // убрали сервер: его людей из пространства убираем
  const w = await spaceByUid(uid);
  if (w) {
    const keep = new Set((await activeNodes(uid)).map(n => n.instance_id));
    const gone = (await dal.all(`SELECT DISTINCT u.fed_instance AS inst FROM user_workspaces m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.is_bot = 2`, w.id)).filter(r => !keep.has(r.inst));
    for (const r of gone) (await dropShadows(w.id, r.inst)) ;
  }
  directoryChanged();
}
async function dropShadows(wsId, inst) {
  await dal.run(`DELETE FROM user_workspaces WHERE workspace_id = ? AND user_id IN (SELECT id FROM users WHERE is_bot = 2 AND fed_instance = ?)`, wsId, inst);
}
function directoryChanged() {
  try { wsm().broadcastAll({ type: 'directory_changed' }); wsm().broadcastAll({ type: 'presence_refresh' }); } catch {}
}

// Убрать сервер (и его ветку) из пространства. Хозяин убирает любого, участник может убрать только себя (выйти)
async function removeServer(wsId, inst) {
  const w = await spaceById(wsId);
  if (!w || !w.fed_uid) return { error: 'Пространство не общее' };
  const uid = w.fed_uid, myId = (await me()).id;
  inst = String(inst || '');
  if (w.fed_host !== myId) {
    if (inst !== myId) return { error: 'Убрать другой сервер может только хозяин пространства' };
    await sendTo(w.fed_host, { k: 'sp_leave', uid });
    await dropMirror(uid);
    return { ok: true, left: true };
  }
  if (inst === myId) return { error: 'Хозяин не может выйти: выключите «Общее» в настройках пространства' };
  const n = await node(uid, inst);
  if (!n) return { error: 'Сервер не найден' };
  const sub = await subtree(uid, inst);
  for (const id of (await deepestFirst(uid, sub))) if ((await node(uid, id))?.state === 'active') await sendTo(id, { k: 'sp_gone', uid, why: id === inst ? 'removed' : 'branch' });
  await dal.tx(() => (async () => {
    for (const id of sub) (await dal.run('DELETE FROM fed_space_servers WHERE space_uid = ? AND instance_id = ?', uid, id)) ;
    await dal.run('DELETE FROM fed_space_asks WHERE space_uid = ? AND (proposer IN (' + sub.map(() => '?').join(',') + ') OR target IN (' + sub.map(() => '?').join(',') + '))', uid, ...sub, ...sub);
  })());
  await syncVirtual();
  await broadcastTree(uid);
  await afterTreeChange(uid, null);
  return { ok: true };
}
// Сначала самые дальние: их сообщения идут через ближние серверы, а те после своего «ухода» уже не пересылают чужие кадры
async function deepestFirst(uid, ids) {
  const all = await nodes(uid), depth = id => { let d = 0, cur = all.find(n => n.instance_id === id); while (cur && cur.parent && d < 50) { d++; cur = all.find(n => n.instance_id === cur.parent); } return d; };
  return [...ids].sort((a, b) => depth(b) - depth(a));
}
async function subtree(uid, inst) {
  const all = await nodes(uid), out = [inst];
  for (let i = 0; i < out.length; i++) all.filter(n => n.parent === out[i]).forEach(n => { if (!out.includes(n.instance_id)) out.push(n.instance_id); });
  return out;
}
async function recvLeave(peer, ev) {
  const uid = str(ev.uid, 80), w = await spaceByUid(uid);
  if (!w || w.fed_host !== (await me()).id || !(await isActiveIn(uid, peer.instance_id))) return;
  await removeServer(w.id, peer.instance_id);
}
async function recvGone(peer, ev) {
  const uid = str(ev.uid, 80), w = await spaceByUid(uid);
  if (w && peer.instance_id === hostOfUid(uid)) await dropMirror(uid);
}
// Пространство перестало быть общим: у нас оно остаётся обычным, а чужие люди из него уходят
async function dropMirror(uid) {
  const w = await spaceByUid(uid);
  if (!w) return;
  await dal.tx(() => (async () => {
    await dal.run(`DELETE FROM user_workspaces WHERE workspace_id = ? AND user_id IN (SELECT id FROM users WHERE is_bot = 2)`, w.id);
    await dal.run('UPDATE workspaces SET fed_uid = NULL, fed_host = NULL WHERE id = ?', w.id);
    await dal.run('DELETE FROM fed_space_servers WHERE space_uid = ?', uid);
    await dal.run('DELETE FROM fed_space_asks WHERE space_uid = ?', uid);
    await dal.run('DELETE FROM fed_space_offers WHERE space_uid = ?', uid);
    await delS('fedsp_name:' + uid);
  })());
  linkInfo.delete(uid);
  await syncVirtual();
  directoryChanged();
}
// Соединение с сервером удалено вручную: его ветка уходит из наших пространств
async function onPeerRemoved(inst) {
  const myId = (await me()).id;
  for (const w of (await sharedSpaces())) {
    const uid = w.fed_uid, n = await node(uid, inst);
    if (!n) continue;
    if (w.fed_host === myId) await removeServer(w.id, inst);
    else if (inst === w.fed_host || (n.parent !== myId && (await node(uid, myId))?.parent === inst)) await dropMirror(uid);   // отрезаны от хозяина
    else if (n.parent === myId) {
      await sendTo(w.fed_host, { k: 'sp_cut', uid, inst });
      for (const id of (await subtree(uid, inst))) (await dal.run('DELETE FROM fed_space_servers WHERE space_uid = ? AND instance_id = ?', uid, id)) ;
    }
  }
  await syncVirtual();
}
// Сосед сообщил, что отключил ветку (хозяину)
async function recvCut(peer, ev) {
  const uid = str(ev.uid, 80), w = await spaceByUid(uid), inst = str(ev.inst, 40), n = w && (await node(uid, inst));
  if (!n || w.fed_host !== (await me()).id || n.parent !== peer.instance_id) return;
  await removeServer(w.id, inst);
}

// ─────────────────────────── состав ───────────────────────────
const pendingMembers = new Map();
async function localMembers(wsId) {
  return await dal.all(`SELECT u.id, u.username, u.display_name, u.tag FROM user_workspaces m JOIN users u ON u.id = m.user_id
    WHERE m.workspace_id = ? AND COALESCE(u.is_bot, 0) = 0 AND COALESCE(u.banned, 0) = 0 ORDER BY u.id`, wsId);
}
async function sendMembers(uid, toInst) {
  const w = await spaceByUid(uid), myId = (await me()).id;
  if (!w || !(await isActiveIn(uid, myId))) return;
  const list = (await localMembers(w.id)).slice(0, MAX_MEMBERS).map(u => ({ l: u.username, n: u.display_name, t: u.tag || '', a: F().avatarVersion(u.id) }));
  for (const n of (await activeNodes(uid))) {
    if (n.instance_id === myId || (toInst && n.instance_id !== toInst)) continue;
    await sendTo(n.instance_id, { k: 'sp_members', uid, list }, true);
  }
}
let membersTimer = null;
const membersDirty = new Set();
// Состав какого-то пространства (или всех: ids пуст) изменился — отправляем остальным серверам, собирая частые правки
async function membersChanged(wsIds) {
  const all = !wsIds || !wsIds.length;
  (all ? (await sharedSpaces()) : (await Promise.all(wsIds.map(id => spaceById(id)))).filter(Boolean)).forEach(w => { if (w.fed_uid) membersDirty.add(w.fed_uid); });
  if (!membersDirty.size || membersTimer) return;
  membersTimer = setTimeout(async () => {
    membersTimer = null;
    const list = [...membersDirty]; membersDirty.clear();
    for (const uid of list) { try { await sendMembers(uid); } catch (e) { console.warn('[Fed] состав:', e.message); } } ;
  }, 1200);
  membersTimer.unref?.();
}
async function recvMembers(peer, ev) {
  const uid = str(ev.uid, 80), w = await spaceByUid(uid);
  if (!w || !Array.isArray(ev.list)) return;
  if (!(await isActiveIn(uid, peer.instance_id))) {
    // Дерево с этим сервером ещё не дошло до нас: держим список и применим, когда придёт
    if (pendingMembers.size < 200) pendingMembers.set(uid + '|' + peer.instance_id, ev);
    return;
  }
  await applyMembers(peer, ev);
}
async function applyMembers(peer, ev) {
  const uid = str(ev.uid, 80), w = await spaceByUid(uid);
  if (!w || !(await isActiveIn(uid, peer.instance_id)) || !(await isActiveIn(uid, (await me()).id))) return;
  const inst = peer.instance_id, have = new Set();
  const ins = 'INSERT OR IGNORE INTO user_workspaces (user_id, workspace_id) VALUES (?, ?)';
  let changed = 0;
  for (const it of ev.list.slice(0, MAX_MEMBERS)) {
    const login = str(it?.l, 64);
    if (!login) continue;
    const sh = await F().ensureShadow(peer, login, str(it.n, 80), it.a === undefined ? undefined : str(it.a, 40));
    if (!sh) continue;
    have.add(sh.id);
    changed += (await dal.run(ins, sh.id, w.id)).changes;
    if (it.t !== undefined) await F().setShadowTag(sh, str(it.t, 40));
  }
  const cur = await dal.all(`SELECT m.user_id FROM user_workspaces m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.is_bot = 2 AND u.fed_instance = ?`, w.id, inst);
  for (const r of cur) if (!have.has(r.user_id)) { await dal.run('DELETE FROM user_workspaces WHERE workspace_id = ? AND user_id = ?', w.id, r.user_id); changed++; }
  if (changed) { directoryChanged(); await syncPresence(peer.id); }
}

// ─────────────────────────── статусы ───────────────────────────
async function peersOfSpacesFor(userId) {
  const myId = (await me()).id, out = new Set();
  const rows = await dal.all('SELECT w.fed_uid FROM user_workspaces m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? AND w.fed_uid IS NOT NULL', userId);
  for (const r of rows) for (const n of (await activeNodes(r.fed_uid))) if (n.instance_id !== myId) out.add(n.instance_id);
  return out;
}
async function presenceOut(userId, status, lastSeen, mobile) {
  const u = await dal.get('SELECT username, is_bot FROM users WHERE id = ?', userId);
  if (!u || u.is_bot) return;
  for (const inst of (await peersOfSpacesFor(userId))) {
    const p = await F().peerByInstance(inst);
    if (p && F().isOnline(p.id)) F().sendLive(p.id, { k: 'spp', from: u.username, status, last_seen: lastSeen || null, mob: mobile ? 1 : undefined });
  }
}
async function syncPresence(peerId) {
  const p = await F().peerRow(peerId);
  if (!p || !F().isOnline(peerId)) return;
  const myId = (await me()).id, seen = new Set();
  for (const w of (await sharedSpaces())) {
    if (!(await isActiveIn(w.fed_uid, myId)) || !(await isActiveIn(w.fed_uid, p.instance_id))) continue;
    for (const m of (await localMembers(w.id))) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const st = wsm().getStatus(m.id);
      const last = (await dal.get('SELECT last_seen_at FROM users WHERE id = ?', m.id))?.last_seen_at;
      F().sendLive(peerId, { k: 'spp', from: m.username, status: st, last_seen: st === 'offline' ? last : null, mob: wsm().getMobile(m.id) ? 1 : undefined });
    }
  }
}
async function recvPresence(peer, ev) {
  const sh = await F().remoteUser(peer, ev.from), st = ev.status;
  if (!sh || !['online', 'away', 'offline'].includes(st)) return;
  const shared = await dal.get('SELECT 1 FROM user_workspaces m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? AND w.fed_uid IS NOT NULL LIMIT 1', sh.id);
  if (!shared) return;
  await wsm().setRemoteStatus(sh.id, st, st === 'offline' ? Math.floor(Number(ev.last_seen)) || 0 : 0, ev.mob === 1);
}

// ─────────────────────────── связь и состояние линий ───────────────────────────
const linkInfo = new Map();   // uid → Map('a|b' → { on, at })
async function onLink(peer, up) {
  invalidate();
  if (!up) return;
  const myId = (await me()).id;
  for (const w of (await sharedSpaces())) {
    if (!(await isActiveIn(w.fed_uid, myId)) || !(await isActiveIn(w.fed_uid, peer.instance_id))) continue;
    await sendMembers(w.fed_uid, peer.instance_id);
    if (w.fed_host === myId) await broadcastTree(w.fed_uid, peer.instance_id);
  }
}
async function reportLinks() {
  const myId = (await me()).id;
  if (!myId) return;
  for (const w of (await sharedSpaces())) {
    const uid = w.fed_uid;
    if (!(await isActiveIn(uid, myId))) continue;
    const mine = (await Promise.all((await edgesOf(uid)).filter(e => e.a === myId || e.b === myId).map(async e => {
      const other = e.a === myId ? e.b : e.a, p = await F().realPeerByInstance(other);
      return [e.a, e.b, p && F().isOnline(p.id) ? 1 : 0, p && p.role === 'out' ? myId : other];   // кто подключается: тот, кто вводил ключ активации
    })));
    const m = linkInfo.get(uid) || new Map();
    linkInfo.set(uid, m);
    mine.forEach(([a, b, on, from]) => m.set(a + '|' + b, { on: !!on, at: Date.now(), from }));
    for (const n of (await activeNodes(uid))) {
      if (n.instance_id === myId) continue;
      const p = await F().peerByInstance(n.instance_id);
      if (p && F().isOnline(p.id)) F().sendLive(p.id, { k: 'sp_links', uid, links: mine });
    }
  }
}
async function recvLinks(peer, ev) {
  const uid = str(ev.uid, 80);
  if (!(await spaceByUid(uid)) || !(await isActiveIn(uid, peer.instance_id)) || !Array.isArray(ev.links)) return;
  const m = linkInfo.get(uid) || new Map();
  linkInfo.set(uid, m);
  for (const l of ev.links.slice(0, 200)) if (Array.isArray(l)) m.set(`${str(l[0], 40)}|${str(l[1], 40)}`, { on: !!l[2], at: Date.now(), from: ID_RE.test(String(l[3] || '')) ? String(l[3]) : '' });
}

// ─────────────────────────── карта ───────────────────────────
async function mapData() {
  const id = await me();
  if (!id.configured) return { configured: false, nodes: [], edges: [], spaces: [] };
  const myId = id.id, byNode = new Map(), edges = new Map(), spaceList = [];
  const addNode = (inst, name, pub, extra = {}) => {
    const cur = byNode.get(inst) || { id: inst, name, self: inst === myId, spaces: [], people: 0, fp: pub ? F().fingerprint(pub) : '', pub, direct: false };
    Object.assign(cur, extra);
    byNode.set(inst, cur);
    return cur;
  };
  addNode(myId, id.name, id.pub, { online: true });
  const keyOk = new Map((await dal.all('SELECT instance_id, pub FROM fed_key_checks')).map(r => [r.instance_id, r.pub]));
  // Прямые соединения
  for (const p of (await dal.all('SELECT * FROM fed_peers WHERE virt = 0'))) {
    const on = p.status === 'active' && F().isOnline(p.id);
    addNode(p.instance_id, p.name, p.pub, { direct: true, online: on, paused: p.status !== 'active' });
    const k = [myId, p.instance_id].sort().join('|');
    edges.set(k, { a: myId, b: p.instance_id, on, spaces: [], direct: true, from: p.role === 'out' ? myId : p.instance_id });
  }
  // Пространства
  const colorOf = i => i % 6;
  for (const [i, w] of Array.from((await sharedSpaces())).entries()) {
    const uid = w.fed_uid, act = await activeNodes(uid);
    if (!act.some(n => n.instance_id === myId)) continue;
    const info = linkInfo.get(uid) || new Map();
    const sp = { uid, id: w.id, name: w.name, host: w.fed_host, is_host: w.fed_host === myId, color: colorOf(i), servers: [], people: 0 };
    for (const n of act) {
      const cnt = n.instance_id === myId ? (await localMembers(w.id)).length
        : (await dal.get(`SELECT COUNT(*) c FROM user_workspaces m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.is_bot = 2 AND u.fed_instance = ?`, w.id, n.instance_id)).c;
      const nd = addNode(n.instance_id, n.name, n.pub);
      nd.spaces.push({ uid, people: cnt });
      sp.servers.push(n.instance_id);
      sp.people += cnt;
    }
    for (const e of (await edgesOf(uid))) {
      const k = [e.a, e.b].sort().join('|');
      let on = null;
      if (e.a === myId || e.b === myId) { const other = e.a === myId ? e.b : e.a; const p = await F().realPeerByInstance(other); on = !!(p && F().isOnline(p.id)); }
      else { const li = info.get(e.a + '|' + e.b); if (li && Date.now() - li.at < 45000) on = li.on; }
      const cur = edges.get(k) || { a: e.a, b: e.b, on, spaces: [] };
      cur.on = on; cur.spaces.push(uid);
      if (!cur.from) { const li = info.get(e.a + '|' + e.b); if (li && li.from) cur.from = li.from; }
      edges.set(k, cur);
    }
    spaceList.push(sp);
  } ;
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
    n.ver = n.self ? F().ownVersion() : ((await F().peerByInstance(n.id))?.ver || '');
    delete n.pub;
  }
  return { configured: true, me: myId, nodes: [...byNode.values()], edges: [...edges.values()], spaces: spaceList };
}
async function verifyKey(inst) {
  const n = await dal.get("SELECT pub FROM fed_space_servers WHERE instance_id = ? LIMIT 1", String(inst));
  if (!n) return { error: 'Сервер не найден' };
  await dal.run('INSERT OR REPLACE INTO fed_key_checks (instance_id, pub) VALUES (?, ?)', String(inst), n.pub);
  return { ok: true };
}

// ─────────────────────────── для админки ───────────────────────────
async function adminInfo(w) {
  if (!w.fed_uid) return { shared: false };
  const uid = w.fed_uid, myId = (await me()).id;
  const list = (await Promise.all((await nodes(uid)).map(async n => {
    const real = n.instance_id !== myId ? (await F().realPeerByInstance(n.instance_id)) : null;
    const people = n.instance_id === myId ? (await localMembers(w.id)).length
      : (await dal.get(`SELECT COUNT(*) c FROM user_workspaces m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.is_bot = 2 AND u.fed_instance = ?`, w.id, n.instance_id)).c;
    return { id: n.instance_id, name: n.name, parent: n.parent, state: n.state, self: n.instance_id === myId, host: n.instance_id === w.fed_host, direct: !!real, online: n.instance_id === myId ? true : !!(real ? F().isOnline(real.id) : ((await F().peerByInstance(n.instance_id)) && F().isOnline((await F().peerByInstance(n.instance_id)).id))), people, ver: n.instance_id === myId ? F().ownVersion() : ((await F().peerByInstance(n.instance_id))?.ver || '') };
  })));
  return {
    shared: true, uid, host: w.fed_host, is_host: w.fed_host === myId, servers: list,
    asks: w.fed_host === myId ? (await dal.all('SELECT id, proposer, target, target_name, approved FROM fed_space_asks WHERE space_uid = ?', uid)) : [],
  };
}
async function offersList() {
  return (await Promise.all((await dal.all('SELECT space_uid AS uid, host, name, from_inst, created_at FROM fed_space_offers ORDER BY created_at')).map(async o => {
    let tree = []; try { tree = JSON.parse((await dal.get('SELECT tree FROM fed_space_offers WHERE space_uid = ?', o.uid)).tree); } catch {}
    // Локальные пространства, с которыми можно объединить; совпадающее по имени предлагается по умолчанию
    const local = await dal.all(`SELECT w.id, w.name,
        (SELECT COUNT(*) FROM user_workspaces m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = w.id AND COALESCE(u.is_bot, 0) = 0) AS users
      FROM workspaces w WHERE w.fed_uid IS NULL AND w.id != ? ORDER BY w.name`, spaces.DEFAULT_WS);
    const same = local.find(w => w.name.toLowerCase() === String(o.name).toLowerCase());
    return { ...o, host_name: tree.find(t => t.id === o.host)?.name || o.host, from_name: (await F().realPeerByInstance(o.from_inst))?.name || o.from_inst, servers: tree.map(t => t.name), local, same: same ? same.id : null };
  })));
}
// Соединения, которым можно предложить пространство: прямые, активные, ещё не в нём
async function candidates(w) {
  if (!w.fed_uid) return [];
  const have = new Set((await nodes(w.fed_uid)).map(n => n.instance_id));
  return (await dal.all("SELECT instance_id, name, sp FROM fed_peers WHERE virt = 0 AND status = 'active' ORDER BY name"))
    .filter(p => !have.has(p.instance_id)).map(p => ({ id: p.instance_id, name: p.name, ok: !!p.sp }));
}

// ─────────────────────────── общее ───────────────────────────
async function handle(peer, ev) {
  if (!(await me()).configured) return;
  switch (ev.k) {
    case 'sp_offer': return await recvOffer(peer, ev);
    case 'sp_accept': return await recvAccept(peer, ev);
    case 'sp_decline': return await recvDecline(peer, ev);
    case 'sp_ask': return await recvAsk(peer, ev);
    case 'sp_go': return await recvGo(peer, ev);
    case 'sp_nogo': return await recvNogo(peer, ev);
    case 'sp_joined': return await recvJoined(peer, ev);
    case 'sp_tree': return await recvTree(peer, ev);
    case 'sp_members': return await recvMembers(peer, ev);
    case 'sp_leave': return await recvLeave(peer, ev);
    case 'sp_gone': return await recvGone(peer, ev);
    case 'sp_cut': return await recvCut(peer, ev);
    case 'sp_links': return await recvLinks(peer, ev);
  }
}

let started = false;
async function start() {
  if (started) return;
  started = true;
  await syncVirtual();
  let n = 0;
  const t = setInterval(async () => {
    try {
      await F().virtualTick();
      if (n % 2 === 0) await reportLinks();
      if (n % 24 === 0 && n) await membersChanged();   // раз в две минуты пересылаем состав заново: на случай пропущенных правок
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
