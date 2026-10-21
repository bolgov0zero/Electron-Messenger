'use strict';
// Режим обслуживания: пока включён, запись в базу запрещена. Нужен на время переноса или восстановления:
// всё, что записалось бы параллельно, потерялось бы или попало бы в неполные данные.
// Запросы на чтение работают; изменяющие запросы клиентов получают 503, а любая попытка записи из кода
// (фоновые задачи, федерация) отклоняется на уровне dal. Сама операция пишет через privileged().
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
let reason = null;
let since = 0;
module.exports = {
  on(why) { reason = why || 'maintenance'; since = Date.now(); },
  off() { reason = null; },
  // Внутри privileged() запрет не действует: только для той цепочки вызовов, которая выполняет обслуживание
  isOn: () => reason !== null && !als.getStore(),
  info: () => (reason === null ? null : { reason, since }),
  privileged: fn => als.run(true, fn),
};
