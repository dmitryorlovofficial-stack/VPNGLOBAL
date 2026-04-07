-- Схема базы данных VPN-панели (устаревшая, SQLite)
-- ВНИМАНИЕ: Актуальная схема — PostgreSQL миграции в migrations/

-- Пользователи панели (администраторы и обычные пользователи)
CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    totp_secret TEXT,                           -- Секрет для 2FA (TOTP)
    role TEXT NOT NULL DEFAULT 'user',           -- 'admin' или 'user'
    max_vpn_clients INTEGER NOT NULL DEFAULT 5,  -- Лимит VPN-клиентов
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Клиенты VPN
CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    note TEXT,
    private_key TEXT NOT NULL,
    public_key TEXT NOT NULL,
    preshared_key TEXT,
    ip_address TEXT UNIQUE NOT NULL,
    dns TEXT DEFAULT '1.1.1.1, 8.8.8.8',
    traffic_limit_bytes INTEGER DEFAULT 0,      -- 0 = безлимит
    upload_bytes INTEGER DEFAULT 0,
    download_bytes INTEGER DEFAULT 0,
    is_blocked INTEGER DEFAULT 0,
    endpoint TEXT,                                -- Публичный IP:PORT клиента (из WG)
    owner_id INTEGER REFERENCES admins(id),      -- Владелец (пользователь панели)
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_handshake DATETIME
);

-- История трафика (для графиков)
CREATE TABLE IF NOT EXISTS traffic_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    rx_bytes INTEGER,
    tx_bytes INTEGER,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Настройки (ключ-значение)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Логи событий
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT,                                 -- info, warning, error
    category TEXT,                              -- auth, client, server, system
    message TEXT,
    details TEXT,                               -- JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для ускорения запросов
CREATE INDEX IF NOT EXISTS idx_traffic_history_client ON traffic_history(client_id);
CREATE INDEX IF NOT EXISTS idx_traffic_history_time ON traffic_history(recorded_at);
CREATE INDEX IF NOT EXISTS idx_logs_category ON logs(category);
CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(created_at);
CREATE INDEX IF NOT EXISTS idx_clients_blocked ON clients(is_blocked);
CREATE INDEX IF NOT EXISTS idx_clients_owner ON clients(owner_id);
