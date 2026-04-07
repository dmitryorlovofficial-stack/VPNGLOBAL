-- ============================================================
-- Миграция 002: Xray-core (прямое управление, без 3X-UI)
-- ============================================================

-- Xray инстансы на серверах (1 на сервер)
CREATE TABLE IF NOT EXISTS xray_instances (
    id              SERIAL PRIMARY KEY,
    server_id       INTEGER UNIQUE REFERENCES servers(id) ON DELETE CASCADE,
    version         VARCHAR(50),
    status          VARCHAR(20) DEFAULT 'unknown',   -- unknown, active, stopped, error
    api_port        INTEGER DEFAULT 10085,            -- gRPC stats API port
    config_hash     VARCHAR(64),                      -- SHA256 deployed config
    last_sync       TIMESTAMPTZ,
    installed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Xray inbounds (прямое управление)
CREATE TABLE IF NOT EXISTS xray_inbounds (
    id              SERIAL PRIMARY KEY,
    server_id       INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    tag             VARCHAR(100) NOT NULL,
    protocol        VARCHAR(30) NOT NULL,             -- vless, vmess, trojan, shadowsocks
    port            INTEGER NOT NULL,
    listen          VARCHAR(100) DEFAULT '0.0.0.0',
    settings        JSONB DEFAULT '{}',               -- protocol-specific
    stream_settings JSONB DEFAULT '{}',               -- transport + TLS/Reality
    sniffing        JSONB DEFAULT '{"enabled":true,"destOverride":["http","tls"]}',
    is_enabled      BOOLEAN DEFAULT TRUE,
    remark          VARCHAR(200),
    up_bytes        BIGINT DEFAULT 0,
    down_bytes      BIGINT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(server_id, tag),
    UNIQUE(server_id, port)
);

-- Связь клиентов с Xray inbounds
ALTER TABLE clients ADD COLUMN IF NOT EXISTS xray_inbound_id
    INTEGER REFERENCES xray_inbounds(id) ON DELETE SET NULL;

-- Индексы
CREATE INDEX IF NOT EXISTS idx_xray_instances_server ON xray_instances(server_id);
CREATE INDEX IF NOT EXISTS idx_xray_inbounds_server ON xray_inbounds(server_id);
CREATE INDEX IF NOT EXISTS idx_clients_xray_inbound ON clients(xray_inbound_id);
