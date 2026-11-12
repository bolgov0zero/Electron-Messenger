-- Цитата: выделенный фрагмент сообщения, на которое отвечают (простой текст, до 500 символов)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_quote TEXT;
