-- ============================================================
-- Миграция 014: Общий sub_token для группы протоколов одного клиента
-- ============================================================

-- Убираем уникальный индекс (теперь несколько clients могут иметь один sub_token)
DROP INDEX IF EXISTS idx_clients_sub_token;

-- Создаём обычный индекс для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_clients_sub_token ON clients(sub_token) WHERE sub_token IS NOT NULL;

-- Объединяем sub_token для существующих групп (name + owner_id)
-- Берём первый не-null sub_token из группы и назначаем всем участникам
UPDATE clients c
SET sub_token = g.shared_token
FROM (
    SELECT name, owner_id,
           MIN(sub_token) as shared_token
    FROM clients
    WHERE sub_token IS NOT NULL AND owner_id IS NOT NULL
    GROUP BY name, owner_id
    HAVING COUNT(DISTINCT sub_token) > 1
) g
WHERE c.name = g.name
  AND c.owner_id = g.owner_id
  AND c.sub_token IS NOT NULL
  AND c.sub_token != g.shared_token;

-- Для клиентов без sub_token в группе — дать тот же токен
UPDATE clients c
SET sub_token = g.shared_token
FROM (
    SELECT name, owner_id,
           MIN(sub_token) as shared_token
    FROM clients
    WHERE sub_token IS NOT NULL AND owner_id IS NOT NULL
    GROUP BY name, owner_id
) g
WHERE c.name = g.name
  AND c.owner_id = g.owner_id
  AND c.sub_token IS NULL
  AND g.shared_token IS NOT NULL;
