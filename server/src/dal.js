'use strict';
// ── СЛОЙ ДОСТУПА К ДАННЫМ ──
//
// Единый асинхронный интерфейс к базе. Весь код сервера обращается к данным
// только через него, а не к драйверу: движок выбирается здесь, один раз.
//
//   await dal.get(sql, ...params)   → строка или undefined
//   await dal.all(sql, ...params)   → массив строк
//   await dal.run(sql, ...params)   → { changes, lastId, lastInsertRowid }
//   await dal.tx(async () => { ... }) → транзакция: всё, что вызвано внутри
//                                      (dal.get/all/run, в том числе из других
//                                      функций), идёт в неё
//   await dal.lock(имя)              → внутри dal.tx: замок на имя до конца транзакции
//                                      (PostgreSQL; в SQLite транзакции и так идут по одной)
//   dal.pg                           → true, если движок PostgreSQL
//
// Параметры позиционные (?). Запросы пишутся на общем подмножестве SQL, близком
// к SQLite; для PostgreSQL они переводятся автоматически (dialect.js). То, что
// иначе не выражается (полнотекстовый поиск, форматирование дат), в коде
// пишется отдельно для каждого движка с проверкой dal.pg.
//
// Движок: переменная окружения DATABASE_URL (postgres://…) включает
// PostgreSQL, без неё работает SQLite (DB_PATH).
//
// Перед первым запросом PostgreSQL нужен await dal.init() — он подключается и
// применяет миграции схемы. Для SQLite init() ничего не делает.

const pg = !!process.env.DATABASE_URL;
const engine = pg ? require('./dal-pg') : require('./dal-sqlite');

module.exports = {
  pg,
  engine: pg ? 'postgresql' : 'sqlite',
  get: engine.get,
  all: engine.all,
  run: engine.run,
  tx: engine.tx,
  lock: engine.lock,
  init: engine.init,
  close: engine.close,
};
