-- SSL-поля для stub_sites
ALTER TABLE stub_sites ADD COLUMN IF NOT EXISTS ssl_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE stub_sites ADD COLUMN IF NOT EXISTS ssl_domain VARCHAR(255);
ALTER TABLE stub_sites ADD COLUMN IF NOT EXISTS ssl_email VARCHAR(255);
ALTER TABLE stub_sites ADD COLUMN IF NOT EXISTS ssl_expires_at TIMESTAMPTZ;

-- Таблица AdGuard Home подключений
CREATE TABLE IF NOT EXISTS adguard_servers (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    url         VARCHAR(500) NOT NULL,
    username    VARCHAR(100) NOT NULL,
    password    VARCHAR(255) NOT NULL,
    status      VARCHAR(20) DEFAULT 'unknown',
    last_check  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
