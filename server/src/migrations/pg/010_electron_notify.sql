-- Уведомления «Electron» (notify.js): служебный чат человека с системой, сообщение с кнопкой, адрес входа устройства
ALTER TABLE chats ADD COLUMN IF NOT EXISTS system_kind TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS actions TEXT;
ALTER TABLE device_keys ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE device_keys ADD COLUMN IF NOT EXISTS last_ip TEXT;
