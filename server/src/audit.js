// Аудит-лог действий в админ-панели — кто, когда, что сделал. Общий модуль,
// а не часть admin.js, потому что часть чувствительных действий (например,
// удаление комнаты) живёт в chats.js под отдельным admin-гейтом.
const db = require('./db');

// category — одна из moderation/rooms/server/security (см. вкладку «Аудит-лог»
// в админке). target — короткое человекочитаемое описание, а не json: так
// проще искать и читать глазами.
function logAudit(req, category, action, target) {
  try {
    db.prepare('INSERT INTO admin_audit_log (actor_id, category, action, target, ip) VALUES (?, ?, ?, ?, ?)')
      .run(req.user?.id || null, category, action, target || null, req.ip || null);
  } catch (e) { console.warn('[Audit] не удалось записать событие:', e.message); }
}

module.exports = { logAudit };
