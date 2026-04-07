-- ============================================================
-- Миграция 001: Начальная схема VPN-панели (PostgreSQL)
-- ============================================================

-- Пользователи панели (администраторы и обычные пользователи)
CREATE TABLE IF NOT EXISTS admins (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(100) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    totp_secret     TEXT,
    role            VARCHAR(20) NOT NULL DEFAULT 'user',
    max_vpn_clients INTEGER NOT NULL DEFAULT 5,
    max_proxy_users INTEGER NOT NULL DEFAULT 3,
    allowed_servers INTEGER[],
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Серверы (ноды)
CREATE TABLE IF NOT EXISTS servers (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,

    -- Подключение
    host            VARCHAR(255) NOT NULL,
    ipv4            VARCHAR(45),
    ipv6            VARCHAR(45),
    ssh_port        INTEGER DEFAULT 22,
    ssh_user        VARCHAR(64) DEFAULT 'root',
    ssh_auth_type   VARCHAR(20) DEFAULT 'password',
    ssh_password    TEXT,
    ssh_key         TEXT,

    -- Роль и статус
    role            VARCHAR(20) DEFAULT 'node',
    is_local        BOOLEAN DEFAULT FALSE,
    status          VARCHAR(20) DEFAULT 'offline',
    last_seen       TIMESTAMPTZ,

    -- Сеть
    main_iface      VARCHAR(20),

    -- Метрики (обновляются мониторингом)
    cpu_percent     INTEGER DEFAULT 0,
    ram_total_mb    INTEGER DEFAULT 0,
    ram_used_mb     INTEGER DEFAULT 0,
    disk_total_gb   INTEGER DEFAULT 0,
    disk_used_gb    INTEGER DEFAULT 0,
    os_info         VARCHAR(200),
    kernel          VARCHAR(100),
    uptime_seconds  BIGINT DEFAULT 0,

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Протоколы на серверах
CREATE TABLE IF NOT EXISTS server_protocols (
    id              SERIAL PRIMARY KEY,
    server_id       INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    protocol        VARCHAR(30) NOT NULL,
    status          VARCHAR(20) DEFAULT 'inactive',
    port            INTEGER,
    config          JSONB DEFAULT '{}',
    installed_at    TIMESTAMPTZ,
    UNIQUE(server_id, protocol)
);

-- X-UI инстансы
CREATE TABLE IF NOT EXISTS xui_instances (
    id              SERIAL PRIMARY KEY,
    server_id       INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    panel_url       VARCHAR(500) NOT NULL,
    username        VARCHAR(100),
    password        TEXT,
    api_token       TEXT,
    version         VARCHAR(50),
    status          VARCHAR(20) DEFAULT 'unknown',
    last_sync       TIMESTAMPTZ,
    UNIQUE(server_id)
);

-- X-UI инбаунды
CREATE TABLE IF NOT EXISTS xui_inbounds (
    id              SERIAL PRIMARY KEY,
    xui_instance_id INTEGER REFERENCES xui_instances(id) ON DELETE CASCADE,
    remote_id       INTEGER,
    protocol        VARCHAR(30) NOT NULL,
    tag             VARCHAR(100),
    port            INTEGER,
    listen          VARCHAR(100) DEFAULT '',
    settings        JSONB DEFAULT '{}',
    stream_settings JSONB DEFAULT '{}',
    sniffing        JSONB DEFAULT '{}',
    is_enabled      BOOLEAN DEFAULT TRUE,
    remark          VARCHAR(200),
    up_bytes        BIGINT DEFAULT 0,
    down_bytes      BIGINT DEFAULT 0,
    last_sync       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Связи/цепочки между серверами (WG-туннели)
CREATE TABLE IF NOT EXISTS server_links (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100),
    from_server_id  INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    to_server_id    INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    wg_interface    VARCHAR(20) DEFAULT 'wg1',
    wg_port         INTEGER,
    wg_subnet       VARCHAR(50),
    from_private_key TEXT,
    from_public_key  TEXT,
    to_private_key   TEXT,
    to_public_key    TEXT,
    preshared_key    TEXT,
    route_mode      VARCHAR(30) DEFAULT 'policy',
    route_table     INTEGER DEFAULT 100,
    forward_subnets TEXT[],
    status          VARCHAR(20) DEFAULT 'inactive',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- VPN-клиенты
CREATE TABLE IF NOT EXISTS clients (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    email           VARCHAR(200),
    note            TEXT,

    -- К какому серверу привязан
    server_id       INTEGER REFERENCES servers(id) ON DELETE SET NULL,
    protocol        VARCHAR(30) NOT NULL DEFAULT 'wireguard',

    -- WireGuard
    private_key     TEXT,
    public_key      TEXT,
    preshared_key   TEXT,
    ip_address      VARCHAR(45),
    dns             VARCHAR(200) DEFAULT '1.1.1.1, 8.8.8.8',

    -- Xray (VLESS/VMess/Trojan/SS)
    xui_inbound_id  INTEGER REFERENCES xui_inbounds(id) ON DELETE SET NULL,
    xray_uuid       UUID,
    xray_email      VARCHAR(200),
    xray_settings   JSONB DEFAULT '{}',

    -- Общие
    traffic_limit_bytes BIGINT DEFAULT 0,
    upload_bytes    BIGINT DEFAULT 0,
    download_bytes  BIGINT DEFAULT 0,
    is_blocked      BOOLEAN DEFAULT FALSE,
    endpoint        VARCHAR(100),
    owner_id        INTEGER REFERENCES admins(id),
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_handshake  TIMESTAMPTZ,
    last_connected  TIMESTAMPTZ
);

-- История трафика
CREATE TABLE IF NOT EXISTS traffic_history (
    id          SERIAL PRIMARY KEY,
    client_id   INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    server_id   INTEGER REFERENCES servers(id) ON DELETE SET NULL,
    rx_bytes    BIGINT,
    tx_bytes    BIGINT,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Прокси-пользователи SOCKS5
CREATE TABLE IF NOT EXISTS proxy_users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(100) NOT NULL,
    password        TEXT NOT NULL,
    server_id       INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    is_active       BOOLEAN DEFAULT TRUE,
    is_online       BOOLEAN DEFAULT FALSE,
    current_ip      VARCHAR(45),
    last_connected  TIMESTAMPTZ,
    upload_bytes    BIGINT DEFAULT 0,
    download_bytes  BIGINT DEFAULT 0,
    owner_id        INTEGER REFERENCES admins(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username, server_id)
);

-- Настройки (ключ-значение)
CREATE TABLE IF NOT EXISTS settings (
    key   VARCHAR(100) PRIMARY KEY,
    value TEXT
);

-- Логи событий
CREATE TABLE IF NOT EXISTS logs (
    id          SERIAL PRIMARY KEY,
    level       VARCHAR(20),
    category    VARCHAR(50),
    server_id   INTEGER REFERENCES servers(id) ON DELETE SET NULL,
    message     TEXT,
    details     JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Индексы
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_clients_server ON clients(server_id);
CREATE INDEX IF NOT EXISTS idx_clients_protocol ON clients(protocol);
CREATE INDEX IF NOT EXISTS idx_clients_owner ON clients(owner_id);
CREATE INDEX IF NOT EXISTS idx_clients_blocked ON clients(is_blocked);
CREATE INDEX IF NOT EXISTS idx_proxy_users_server ON proxy_users(server_id);
CREATE INDEX IF NOT EXISTS idx_proxy_users_owner ON proxy_users(owner_id);
CREATE INDEX IF NOT EXISTS idx_server_links_from ON server_links(from_server_id);
CREATE INDEX IF NOT EXISTS idx_server_links_to ON server_links(to_server_id);
CREATE INDEX IF NOT EXISTS idx_server_protocols_server ON server_protocols(server_id);
CREATE INDEX IF NOT EXISTS idx_traffic_history_client ON traffic_history(client_id);
CREATE INDEX IF NOT EXISTS idx_traffic_history_time ON traffic_history(recorded_at);
CREATE INDEX IF NOT EXISTS idx_traffic_history_server ON traffic_history(server_id);
CREATE INDEX IF NOT EXISTS idx_logs_category ON logs(category);
CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_server ON logs(server_id);
CREATE INDEX IF NOT EXISTS idx_xui_inbounds_instance ON xui_inbounds(xui_instance_id);
