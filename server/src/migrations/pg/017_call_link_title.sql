-- Название звонка по ссылке: задаётся при создании, видно гостю на странице входа, в заголовке окна звонка и в журнале звонков.
ALTER TABLE call_links ADD COLUMN IF NOT EXISTS title TEXT;
