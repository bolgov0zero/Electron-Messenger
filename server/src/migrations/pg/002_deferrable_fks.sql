-- Внешние ключи можно проверять в конце транзакции: так при переносе данных из SQLite
-- таблицы грузятся в любом порядке (SET CONSTRAINTS ALL DEFERRED). В обычной работе
-- проверка по-прежнему идёт сразу после каждой команды.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
           WHERE contype = 'f' AND connamespace = current_schema()::regnamespace AND NOT condeferrable
  LOOP
    EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY IMMEDIATE', r.tbl, r.conname);
  END LOOP;
END $$;
