-- ============================================================
-- Миграция 015: Авторизация через Telegram + Инвайт-коды
-- ============================================================

-- Telegram поля в таблице admins
ALTER TABLE admins ADD COLUMN IF NOT EXISTS telegram_id BIGINT UNIQUE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(100);
ALTER TABLE admins ADD COLUMN IF NOT EXISTS telegram_first_name VARCHAR(100);
ALTER TABLE admins ADD COLUMN IF NOT EXISTS telegram_photo_url TEXT;

-- password_hash может быть NULL для Telegram-only пользователей
ALTER TABLE admins ALTER COLUMN password_hash DROP NOT NULL;

-- Таблица инвайт-кодов
CREATE TABLE IF NOT EXISTS invite_codes (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(32) UNIQUE NOT NULL,
    created_by      INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    max_uses        INTEGER DEFAULT 1,
    used_count      INTEGER DEFAULT 0,
    max_vpn_clients INTEGER DEFAULT 5,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Индекс для быстрого поиска по telegram_id
CREATE INDEX IF NOT EXISTS idx_admins_telegram_id ON admins(telegram_id);
