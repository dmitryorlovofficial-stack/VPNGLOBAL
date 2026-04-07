-- Миграция 006: Xray-цепочки (proxy chain) между серверами
-- link_type определяет тип связи: WG-туннель или Xray-цепочка

-- Тип связи
ALTER TABLE server_links ADD COLUMN IF NOT EXISTS link_type VARCHAR(10) DEFAULT 'wg';

-- Xray-специфичные поля
ALTER TABLE server_links ADD COLUMN IF NOT EXISTS xray_protocol VARCHAR(30);       -- vless, vmess, trojan
ALTER TABLE server_links ADD COLUMN IF NOT EXISTS xray_port INTEGER;               -- порт inbound на exit-сервере
ALTER TABLE server_links ADD COLUMN IF NOT EXISTS xray_uuid TEXT;                  -- UUID для аутентификации
ALTER TABLE server_links ADD COLUMN IF NOT EXISTS xray_settings JSONB DEFAULT '{}';         -- flow, alterId и т.д.
ALTER TABLE server_links ADD COLUMN IF NOT EXISTS xray_stream_settings JSONB DEFAULT '{}';  -- transport + security
