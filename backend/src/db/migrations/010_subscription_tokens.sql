-- ============================================================
-- Миграция 010: Subscription tokens для автообновления конфигов
-- ============================================================

-- Уникальный токен для subscription URL (публичный, без авторизации)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sub_token VARCHAR(32);

-- Генерируем токены для всех существующих клиентов (md5 всегда доступна)
UPDATE clients SET sub_token = md5(random()::text || id::text || now()::text) WHERE sub_token IS NULL;

-- Уникальный индекс
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_sub_token ON clients(sub_token) WHERE sub_token IS NOT NULL;
