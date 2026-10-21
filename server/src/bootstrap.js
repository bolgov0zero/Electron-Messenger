'use strict';
// Начальные данные для новой базы PostgreSQL. В SQLite то же самое делает db.js
// при загрузке. Все шаги повторяемы: на уже заполненной базе ничего не меняют.
const bcrypt = require('bcryptjs');

async function run(dal) {
  // Основное пространство с номером 1; после явного номера сдвигаем счётчик
  await dal.run("INSERT OR IGNORE INTO workspaces (id, name) VALUES (1, 'Основное')");
  await dal.run("SELECT setval(pg_get_serial_sequence('workspaces', 'id'), GREATEST((SELECT MAX(id) FROM workspaces), 1))");

  // Администратор по умолчанию
  if ((await dal.get('SELECT COUNT(*) AS c FROM users')).c === 0) {
    const r = await dal.run('INSERT INTO users (username, password_hash, display_name, is_admin, must_change_password) VALUES (?, ?, ?, 1, 1)',
      'admin', bcrypt.hashSync('admin', 10), 'Administrator');
    await dal.run('INSERT INTO user_workspaces (user_id, workspace_id) VALUES (?, 1) ON CONFLICT DO NOTHING', r.lastId);
    console.log('Created default admin: admin / admin (потребуется смена пароля при первом входе)');
  }

  // Системный пользователь для объявлений (is_bot=1, скрыт из обычных списков)
  if (!(await dal.get("SELECT id FROM users WHERE username = '__system__'"))) {
    const r = await dal.run("INSERT INTO users (username, password_hash, display_name, is_bot) VALUES ('__system__', '', 'Система', 1)");
    await dal.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('system_user_id', ?)", String(r.lastId));
  }
}

module.exports = { run };
