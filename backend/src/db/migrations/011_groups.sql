-- Группы серверов
CREATE TABLE IF NOT EXISTS server_groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Члены группы серверов (сервер + роль entry/exit)
CREATE TABLE IF NOT EXISTS server_group_members (
    id SERIAL PRIMARY KEY,
    server_group_id INTEGER NOT NULL REFERENCES server_groups(id) ON DELETE CASCADE,
    server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    role VARCHAR(10) NOT NULL CHECK (role IN ('entry', 'exit')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(server_group_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_sgm_group ON server_group_members(server_group_id);
CREATE INDEX IF NOT EXISTS idx_sgm_server ON server_group_members(server_id);

-- Группы клиентов
CREATE TABLE IF NOT EXISTS client_groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    server_group_id INTEGER REFERENCES server_groups(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cg_server_group ON client_groups(server_group_id);

-- Связь клиента с группой
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_group_id INTEGER REFERENCES client_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_clients_group ON clients(client_group_id);

-- Привязка туннеля к группе серверов (для авто-управления)
ALTER TABLE server_links ADD COLUMN IF NOT EXISTS server_group_id INTEGER REFERENCES server_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sl_server_group ON server_links(server_group_id);
