-- HWID: ограничение количества устройств на клиента
-- VPN-приложения (V2RayNG, Hiddify, Streisand) отправляют идентификатор устройства
-- через заголовки при обращении к subscription URL

-- Лимит устройств на клиенте (0 = без ограничений)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS device_limit INTEGER DEFAULT 0;

-- Таблица устройств клиента
CREATE TABLE IF NOT EXISTS client_devices (
    id              SERIAL PRIMARY KEY,
    -- sub_token, не client_id — одна подписка = все протоколы клиента
    sub_token       VARCHAR(64) NOT NULL,
    -- Уникальный идентификатор устройства (из заголовков VPN-приложения)
    hwid            VARCHAR(255) NOT NULL,
    -- Информация об устройстве
    device_name     VARCHAR(255),
    device_type     VARCHAR(50),   -- android, ios, windows, macos, linux, unknown
    app_name        VARCHAR(100),  -- V2RayNG, Hiddify, Streisand, etc.
    -- IP с которого последний раз обращались
    last_ip         VARCHAR(45),
    first_seen      TIMESTAMPTZ DEFAULT NOW(),
    last_seen       TIMESTAMPTZ DEFAULT NOW(),
    -- Можно отозвать конкретное устройство
    is_revoked      BOOLEAN DEFAULT FALSE,
    UNIQUE(sub_token, hwid)
);

CREATE INDEX IF NOT EXISTS idx_client_devices_sub_token ON client_devices(sub_token);
CREATE INDEX IF NOT EXISTS idx_client_devices_hwid ON client_devices(hwid);
