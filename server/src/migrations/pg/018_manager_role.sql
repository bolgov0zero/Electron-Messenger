-- Роль «Менеджер»: урезанный админ (см. auth.js, staffMiddleware). is_admin у менеджера всегда 0.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_manager BIGINT DEFAULT 0;
