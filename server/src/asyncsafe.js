'use strict';
// Express 4 не ловит отказ промиса из async-обработчика: запрос повисает, а
// процесс получает необработанное отклонение. Подключается один раз в index.js
// до создания маршрутов и передаёт такие ошибки в обычный next(err).
const Layer = require('express/lib/router/layer');
const orig = Layer.prototype.handle_request;
Layer.prototype.handle_request = function (req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return next();
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (e) { next(e); }
};
Layer.prototype.handle_request.orig = orig;
