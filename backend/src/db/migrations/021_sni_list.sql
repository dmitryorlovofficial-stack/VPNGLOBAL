-- SNI list для генерации нескольких конфигов в подписке
-- (для разных операторов мобильной связи: max.ru, vk.com, ya.ru и т.д.)
ALTER TABLE xray_inbounds ADD COLUMN IF NOT EXISTS sni_list JSONB DEFAULT '[]';
