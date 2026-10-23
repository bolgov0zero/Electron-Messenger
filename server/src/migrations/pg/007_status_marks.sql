-- Статусы доставки и прочтения: строка на сообщение и получателя (message_status) заменена
-- отметками «доставлено до N» / «прочитано до N» на человека и чат и журналом времени за
-- окно status_window_days (src/statusmarks.js). Та же миграция для SQLite — в db.js.

ALTER TABLE chat_read_state ADD COLUMN IF NOT EXISTS delivered_id BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS status_log (
  chat_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  kind    TEXT   NOT NULL,
  bucket  BIGINT NOT NULL,
  upto_id BIGINT NOT NULL,
  ts      BIGINT NOT NULL,
  PRIMARY KEY (chat_id, user_id, kind, bucket)
);
CREATE INDEX IF NOT EXISTS idx_status_log_msg ON status_log(chat_id, upto_id);
CREATE INDEX IF NOT EXISTS idx_status_log_at  ON status_log(ts);

INSERT INTO chat_read_state (user_id, chat_id, last_read_id, delivered_id)
SELECT ms.user_id, m.chat_id,
       COALESCE(MAX(CASE WHEN ms.read_at IS NOT NULL THEN m.id END), 0),
       COALESCE(MAX(CASE WHEN ms.delivered_at IS NOT NULL OR ms.read_at IS NOT NULL THEN m.id END), 0)
FROM message_status ms JOIN messages m ON m.id = ms.message_id
GROUP BY ms.user_id, m.chat_id
ON CONFLICT (user_id, chat_id) DO UPDATE SET
  last_read_id = GREATEST(chat_read_state.last_read_id, EXCLUDED.last_read_id),
  delivered_id = GREATEST(chat_read_state.delivered_id, EXCLUDED.delivered_id);

-- Журнал времени за окно (по умолчанию 7 дней; 0 — не хранить) только для чатов до 100 участников
INSERT INTO status_log (chat_id, user_id, kind, bucket, upto_id, ts)
SELECT m.chat_id, ms.user_id, 'r', ms.read_at / 60, MAX(m.id), MAX(ms.read_at)
FROM message_status ms JOIN messages m ON m.id = ms.message_id
WHERE ms.read_at >= extract(epoch from now())::bigint - COALESCE((SELECT value::bigint FROM settings WHERE key = 'status_window_days'), 7) * 86400
  AND COALESCE((SELECT value::bigint FROM settings WHERE key = 'status_window_days'), 7) > 0
  AND m.chat_id IN (SELECT chat_id FROM chat_members GROUP BY chat_id HAVING COUNT(*) <= 100)
GROUP BY m.chat_id, ms.user_id, ms.read_at / 60
ON CONFLICT (chat_id, user_id, kind, bucket) DO NOTHING;

INSERT INTO status_log (chat_id, user_id, kind, bucket, upto_id, ts)
SELECT m.chat_id, ms.user_id, 'd', ms.delivered_at / 60, MAX(m.id), MAX(ms.delivered_at)
FROM message_status ms JOIN messages m ON m.id = ms.message_id
WHERE ms.delivered_at >= extract(epoch from now())::bigint - COALESCE((SELECT value::bigint FROM settings WHERE key = 'status_window_days'), 7) * 86400
  AND COALESCE((SELECT value::bigint FROM settings WHERE key = 'status_window_days'), 7) > 0
  AND m.chat_id IN (SELECT chat_id FROM chat_members GROUP BY chat_id HAVING COUNT(*) <= 100)
GROUP BY m.chat_id, ms.user_id, ms.delivered_at / 60
ON CONFLICT (chat_id, user_id, kind, bucket) DO NOTHING;

-- С какого момента журнал полон: время показывается только для сообщений новее этой границы
-- (только если статусы были: на пустой базе при переносе из SQLite эту настройку принесёт копия данных)
INSERT INTO settings (key, value)
SELECT 'status_log_from', (extract(epoch from now())::bigint - COALESCE((SELECT value::bigint FROM settings WHERE key = 'status_window_days'), 7) * 86400)::text
WHERE EXISTS (SELECT 1 FROM message_status)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
UPDATE settings SET value = extract(epoch from now())::bigint::text
WHERE key = 'status_log_from' AND COALESCE((SELECT value::bigint FROM settings WHERE key = 'status_window_days'), 7) = 0;

DROP TABLE message_status;
