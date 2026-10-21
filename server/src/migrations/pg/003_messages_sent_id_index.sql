-- «Последнее сообщение чата» берётся по (время, id): с id в индексе PostgreSQL читает одну
-- строку, а не сортирует всю переписку. Прежний индекс (chat_id, sent_at) этим заменяется.
CREATE INDEX IF NOT EXISTS idx_messages_chat_sent_id ON messages (chat_id, sent_at, id);
DROP INDEX IF EXISTS idx_messages_chat_sent;
