-- Сайты-заглушки для маскировки Xray Reality серверов
CREATE TABLE IF NOT EXISTS stub_sites (
    id              SERIAL PRIMARY KEY,
    server_id       INTEGER UNIQUE REFERENCES servers(id) ON DELETE CASCADE,
    template_id     VARCHAR(50),
    status          VARCHAR(20) DEFAULT 'inactive',
    internal_port   INTEGER DEFAULT 8444,
    domain          VARCHAR(255),
    variables       JSONB DEFAULT '{}',
    custom_files    JSONB DEFAULT '{}',
    auto_update_dest BOOLEAN DEFAULT TRUE,
    deployed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stub_sites_server ON stub_sites(server_id);
