-- ============================================================
-- Миграция 013: Добавить поле socks_password для SOCKS5 прокси
-- Хранит plaintext пароль для SOCKS5 аккаунтов в Xray
-- ============================================================

ALTER TABLE admins ADD COLUMN IF NOT EXISTS socks_password TEXT;
