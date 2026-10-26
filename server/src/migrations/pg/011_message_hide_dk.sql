-- Уведомление «Electron» скрыто от устройства, о входе которого оно (notify.js): ключ этого устройства
ALTER TABLE messages ADD COLUMN IF NOT EXISTS hide_dk BIGINT;
