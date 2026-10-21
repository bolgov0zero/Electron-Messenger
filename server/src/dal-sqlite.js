'use strict';
// ── СЛОЙ ДОСТУПА К ДАННЫМ ──
//
// Единый асинхронный интерфейс к базе. Весь код сервера обращается к данным
// только через него, а не через db.prepare(): так движок (SQLite сейчас,
// PostgreSQL позже) можно заменить в одном месте, а не в 800 вызовах.
//
//   await dal.get(sql, ...params)   → строка или undefined
//   await dal.all(sql, ...params)   → массив строк
//   await dal.run(sql, ...params)   → { changes, lastId }
//   await dal.tx(async () => { ... }) → транзакция: всё, что вызвано внутри
//                                      (dal.get/all/run, в том числе из других
//                                      функций), идёт в неё
//
// Параметры позиционные (?). Результат транзакции — то, что вернула функция;
// исключение откатывает всё.
//
// SQLite выполняется синхронно и на одном соединении, поэтому транзакция
// захватывает его целиком: запросы остальных обработчиков ждут её конца. Иначе
// они попали бы внутрь чужой транзакции и откатывались бы вместе с ней.

const { AsyncLocalStorage } = require('async_hooks');
const db = require('./db');

const cache = new Map();
function prep(sql) {
  let s = cache.get(sql);
  if (!s) {
    // Запросы с переменным числом ? (IN (...)) дают много разных строк: не даём кэшу расти без предела
    if (cache.size >= 500) cache.clear();
    s = db.prepare(sql); cache.set(sql, s);
  }
  return s;
}

// lastInsertRowid оставлен под старым именем: прежний код читает его из результата
const base = {
  get: (sql, ...p) => prep(sql).get(...p),
  all: (sql, ...p) => prep(sql).all(...p),
  run: (sql, ...p) => { const r = prep(sql).run(...p); const id = Number(r.lastInsertRowid); return { changes: r.changes, lastId: id, lastInsertRowid: id }; },
};

// Внутри функции транзакции (и во всём, что она вызывает, сколько бы await ни
// было) запросы идут напрямую в открытую транзакцию, а не встают в очередь за
// ней. Без этого вспомогательная функция, вызванная из транзакции, ждала бы её
// конца и сама же её держала — взаимная блокировка.
const als = new AsyncLocalStorage();

let active = null;   // промис идущей или ожидающей очереди транзакции
let tail = Promise.resolve();

function query(kind) {
  return (sql, ...p) => {
    if (als.getStore() || !active) { try { return Promise.resolve(base[kind](sql, ...p)); } catch (e) { return Promise.reject(e); } }
    return active.then(() => base[kind](sql, ...p));
  };
}

function tx(fn) {
  // Вложенная транзакция присоединяется к внешней
  if (als.getStore()) return Promise.resolve().then(fn);
  const run = tail.then(() => als.run(true, async () => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = await fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
  }));
  const mine = run.then(() => {}, () => {});
  tail = mine;
  active = mine;
  mine.then(() => { if (active === mine) active = null; });
  return run;
}

module.exports = {
  get: query('get'),
  all: query('all'),
  run: query('run'),
  tx,
  // Транзакции SQLite и так выполняются по одной
  lock: async () => {},
  // SQLite открывается синхронно при загрузке db.js, схема создаётся там же
  init: async () => {},
  close: async () => { db.close(); },
};
