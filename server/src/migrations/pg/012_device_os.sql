-- Система устройства (macOS / Windows / Linux): приложение присылает её при входе, админка показывает в списке устройств.
ALTER TABLE device_keys ADD COLUMN IF NOT EXISTS os TEXT NOT NULL DEFAULT '';
