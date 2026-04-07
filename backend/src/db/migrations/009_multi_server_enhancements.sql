-- ============================================================
-- Миграция 009: Мульти-сервер — домены, синхронизация WG, скрытие chain-клиентов
-- ============================================================

-- Домен сервера (для клиентских конфигов, share links — вместо IP)
ALTER TABLE servers ADD COLUMN IF NOT EXISTS domain VARCHAR(255);

-- Флаг системных/chain клиентов (скрываются из списка VPN-клиентов)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_chain BOOLEAN DEFAULT FALSE;

-- Ретроактивно помечаем существующие chain-клиенты
UPDATE clients SET is_chain = TRUE WHERE name LIKE 'chain-%';

-- Индекс для фильтрации
CREATE INDEX IF NOT EXISTS idx_clients_is_chain ON clients(is_chain);
