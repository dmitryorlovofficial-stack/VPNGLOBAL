-- Миграция 005: Выбор IPv4/IPv6 для внешнего подключения WG-туннелей
-- Внутри туннеля всегда IPv4 (10.x.x.x), а снаружи — IPv4 или IPv6 endpoint

ALTER TABLE server_links ADD COLUMN IF NOT EXISTS endpoint_mode VARCHAR(10) DEFAULT 'ipv4';
