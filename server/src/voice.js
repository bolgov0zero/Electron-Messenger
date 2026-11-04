// Голосовые сообщения: включает и выключает администратор (настройки → «Звонки и голос»).
// Выключены — клиенты не показывают микрофон, а загрузка записи отклоняется. Уже отправленные голосовые по-прежнему воспроизводятся.
const dal = require('./dal');

const KEY = 'voice_enabled';
// По умолчанию включены: ключа нет — значит, администратор их не выключал
const isOn = async () => (await dal.get('SELECT value FROM settings WHERE key = ?', KEY))?.value !== '0';
async function setOn(on) {
  await dal.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', KEY, on ? '1' : '0');
}

module.exports = { isOn, setOn };
