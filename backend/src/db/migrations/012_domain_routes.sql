-- Доменная маршрутизация: разные домены → разные Exit серверы
CREATE TABLE IF NOT EXISTS domain_routes (
    id SERIAL PRIMARY KEY,
    server_group_id INTEGER NOT NULL REFERENCES server_groups(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    domains TEXT[] NOT NULL,
    target_server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 0,
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dr_group ON domain_routes(server_group_id);
CREATE INDEX IF NOT EXISTS idx_dr_target ON domain_routes(target_server_id);
