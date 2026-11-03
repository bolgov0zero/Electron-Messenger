-- Журнал звонков для раздела «Звонки» в админке: чат, вид (direct | group | conf), имена на момент звонка, участники, чужой сервер, запись.
ALTER TABLE call_log ADD COLUMN IF NOT EXISTS chat_id BIGINT;
ALTER TABLE call_log ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE call_log ADD COLUMN IF NOT EXISTS caller_name TEXT;
ALTER TABLE call_log ADD COLUMN IF NOT EXISTS callee_name TEXT;
ALTER TABLE call_log ADD COLUMN IF NOT EXISTS members TEXT;
ALTER TABLE call_log ADD COLUMN IF NOT EXISTS peer_server TEXT;
ALTER TABLE call_log ADD COLUMN IF NOT EXISTS recorded INTEGER NOT NULL DEFAULT 0;
