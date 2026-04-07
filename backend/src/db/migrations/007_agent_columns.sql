-- Миграция 007: Docker-агент (vpn-node) на каждом управляемом сервере
-- Панель управляет серверами через HTTP API агента, SSH только для bootstrap

-- Подключение к агенту
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_port INTEGER DEFAULT 8443;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_api_key TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_status VARCHAR(20) DEFAULT 'none';
-- agent_status: 'none' | 'deploying' | 'active' | 'unreachable' | 'error'
