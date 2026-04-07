-- Config Profiles: именованные Xray-конфигурации для серверов/групп
CREATE TABLE IF NOT EXISTS config_profiles (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT,
    -- Базовый Xray JSON конфиг (dns, routing, policy и т.д.)
    base_config     JSONB DEFAULT '{}',
    -- Настройки inbound'ов по-умолчанию
    inbound_defaults JSONB DEFAULT '{}',
    -- Привязка к группе серверов (NULL = глобальный)
    server_group_id INTEGER REFERENCES server_groups(id) ON DELETE SET NULL,
    is_default      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Config Snippets: переиспользуемые фрагменты конфигурации
CREATE TABLE IF NOT EXISTS config_snippets (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT,
    -- Тип сниппета: dns, routing_rule, outbound, policy, transport
    type            VARCHAR(30) NOT NULL,
    -- JSON содержимое сниппета
    content         JSONB NOT NULL,
    -- Порядок применения (для routing rules)
    sort_order      INTEGER DEFAULT 0,
    is_enabled      BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Связь: какие сниппеты входят в какие профили
CREATE TABLE IF NOT EXISTS config_profile_snippets (
    profile_id      INTEGER REFERENCES config_profiles(id) ON DELETE CASCADE,
    snippet_id      INTEGER REFERENCES config_snippets(id) ON DELETE CASCADE,
    sort_order      INTEGER DEFAULT 0,
    PRIMARY KEY (profile_id, snippet_id)
);

-- Привязка серверов к профилям (сервер может иметь свой профиль)
ALTER TABLE servers ADD COLUMN IF NOT EXISTS config_profile_id INTEGER REFERENCES config_profiles(id) ON DELETE SET NULL;

-- Дефолтный профиль
INSERT INTO config_profiles (name, description, is_default, base_config) VALUES (
    'Default',
    'Стандартный профиль Xray',
    TRUE,
    '{
        "dns": {
            "servers": ["https+local://1.1.1.1/dns-query", "localhost"],
            "queryStrategy": "UseIP"
        },
        "policy": {
            "levels": {"0": {"statsUserUplink": true, "statsUserDownlink": true}},
            "system": {"statsInboundUplink": true, "statsInboundDownlink": true}
        }
    }'::jsonb
) ON CONFLICT (name) DO NOTHING;

-- Дефолтные сниппеты
INSERT INTO config_snippets (name, description, type, content, sort_order) VALUES
    ('block-ads', 'Блокировка рекламных доменов', 'routing_rule', '{
        "type": "field",
        "domain": ["geosite:category-ads-all"],
        "outboundTag": "blocked"
    }'::jsonb, 10),
    ('block-cn', 'Блокировка китайских доменов', 'routing_rule', '{
        "type": "field",
        "domain": ["geosite:cn"],
        "outboundTag": "blocked"
    }'::jsonb, 20),
    ('direct-ru', 'Прямой доступ к российским сайтам', 'routing_rule', '{
        "type": "field",
        "domain": ["geosite:category-gov-ru", "domain:gosuslugi.ru", "domain:mos.ru"],
        "outboundTag": "direct"
    }'::jsonb, 30),
    ('cloudflare-dns', 'Cloudflare DNS over HTTPS', 'dns', '{
        "servers": ["https+local://1.1.1.1/dns-query", "https+local://1.0.0.1/dns-query"]
    }'::jsonb, 0),
    ('google-dns', 'Google DNS over HTTPS', 'dns', '{
        "servers": ["https+local://8.8.8.8/dns-query", "https+local://8.8.4.4/dns-query"]
    }'::jsonb, 0)
ON CONFLICT (name) DO NOTHING;
