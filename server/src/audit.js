// Аудит-лог действий в админ-панели — кто, когда, что сделал. Общий модуль,
// а не часть admin.js, потому что часть чувствительных действий (например,
// удаление комнаты) живёт в chats.js под отдельным admin-гейтом.
const dal = require('./dal');

// category — одна из moderation/rooms/server/security (см. вкладку «Аудит-лог»
// в админке). target — короткое человекочитаемое описание, а не json: так
// проще искать и читать глазами.
// Возвращает промис, но вызывающему ждать его не нужно: сбой записи в лог не
// должен ломать само действие.
function logAudit(req, category, action, target) {
  return dal.run('INSERT INTO admin_audit_log (actor_id, category, action, target, ip) VALUES (?, ?, ?, ?, ?)',
    req.user?.id || null, category, action, target || null, req.ip || null)
    .catch(e => console.warn('[Audit] не удалось записать событие:', e.message));
}

module.exports = { logAudit };
