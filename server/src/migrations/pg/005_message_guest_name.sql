-- Гость по ссылке после окончания срока удаляется целиком; имя и метка остаются у его сообщений (см. guest.js)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS guest_tag TEXT;
