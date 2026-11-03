-- Журнал звонков: хронология (позвонил, ответил, вошёл, вышел, показал экран, завершил) и устройства людей, JSON.
ALTER TABLE call_log ADD COLUMN IF NOT EXISTS detail TEXT;
