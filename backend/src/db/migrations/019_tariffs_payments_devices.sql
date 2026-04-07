-- Тарифы
CREATE TABLE IF NOT EXISTS tariffs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    duration_days INT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Платежи
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    tariff_id INT REFERENCES tariffs(id),
    amount DECIMAL(10,2) NOT NULL,
    label VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    yoomoney_operation_id VARCHAR(255),
    client_id INT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    paid_at TIMESTAMPTZ
);

-- Устройства клиентов (HWID)
CREATE TABLE IF NOT EXISTS client_devices (
    id SERIAL PRIMARY KEY,
    sub_token VARCHAR(64) NOT NULL,
    hwid VARCHAR(255) NOT NULL,
    device_name VARCHAR(255),
    device_type VARCHAR(50),
    app_name VARCHAR(100),
    last_ip VARCHAR(45),
    first_seen TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    is_revoked BOOLEAN DEFAULT FALSE,
    UNIQUE(sub_token, hwid)
);

CREATE INDEX IF NOT EXISTS idx_client_devices_sub_token ON client_devices(sub_token);
CREATE INDEX IF NOT EXISTS idx_client_devices_hwid ON client_devices(hwid);

-- Email и expires_at для клиентов
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS device_limit INT DEFAULT 0;

-- SSH passphrase
ALTER TABLE servers ADD COLUMN IF NOT EXISTS ssh_key_passphrase TEXT;
