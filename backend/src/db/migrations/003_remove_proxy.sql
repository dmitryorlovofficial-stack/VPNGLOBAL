-- ============================================================
-- Миграция 003: Удаление Dante SOCKS5 прокси
-- Xray-core полностью заменяет прокси-функциональность
-- ============================================================

-- Удаляем индексы прокси
DROP INDEX IF EXISTS idx_proxy_users_server;
DROP INDEX IF EXISTS idx_proxy_users_owner;

-- Удаляем таблицу прокси-пользователей
DROP TABLE IF EXISTS proxy_users;

-- Удаляем колонку лимита прокси у пользователей панели
ALTER TABLE admins DROP COLUMN IF EXISTS max_proxy_users;

-- Удаляем протокол socks5 из серверов
DELETE FROM server_protocols WHERE protocol = 'socks5';

-- Удаляем настройку порта SOCKS5
DELETE FROM settings WHERE key = 'socks5_port_server2';
