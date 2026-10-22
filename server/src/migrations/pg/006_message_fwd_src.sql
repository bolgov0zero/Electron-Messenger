-- Какое сообщение переслано: номер исходного (при пересылке пересланного — самого первого). По нему считается отметка «переслали N раз»
ALTER TABLE messages ADD COLUMN IF NOT EXISTS fwd_src BIGINT;
CREATE INDEX IF NOT EXISTS idx_messages_fwd_src ON messages(fwd_src) WHERE fwd_src IS NOT NULL;
