-- ============================================================
-- Миграция 004: Удаление концепции локального сервера
-- Панель — только управление, все VPN-серверы удалённые (SSH)
-- ============================================================

-- Удаляем локальные серверы (они больше не управляются панелью)
DELETE FROM clients WHERE server_id IN (SELECT id FROM servers WHERE is_local = TRUE);
DELETE FROM server_protocols WHERE server_id IN (SELECT id FROM servers WHERE is_local = TRUE);
DELETE FROM servers WHERE is_local = TRUE;

-- Удаляем колонку is_local
ALTER TABLE servers DROP COLUMN IF EXISTS is_local;
