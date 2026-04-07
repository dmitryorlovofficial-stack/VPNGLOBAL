#!/bin/bash
# Деплой VPN Panel на сервер
SERVER="root@46.149.75.98"
REMOTE_DIR="/opt/vpn-panel"

echo "=== Копируем файлы на сервер ==="
scp backend/src/index.js "$SERVER:$REMOTE_DIR/backend/src/index.js"
scp backend/src/services/wireguard.js "$SERVER:$REMOTE_DIR/backend/src/services/wireguard.js"
scp backend/src/services/xray.js "$SERVER:$REMOTE_DIR/backend/src/services/xray.js"
scp backend/src/services/groups.js "$SERVER:$REMOTE_DIR/backend/src/services/groups.js"
scp backend/src/services/node-client.js "$SERVER:$REMOTE_DIR/backend/src/services/node-client.js"
scp backend/src/routes/diag.js "$SERVER:$REMOTE_DIR/backend/src/routes/diag.js"
scp agent/src/routes/wg.js "$SERVER:$REMOTE_DIR/agent/src/routes/wg.js"
scp agent/src/routes/system.js "$SERVER:$REMOTE_DIR/agent/src/routes/system.js"

echo ""
echo "=== Пересобираем и запускаем ==="
ssh "$SERVER" "cd $REMOTE_DIR && docker compose build --no-cache && docker compose up -d"

echo ""
echo "=== Готово! ==="
echo "1. Обнови агенты в панели (Серверы → каждый → Обновить агент)"
echo "2. Смени группу и проверь WG"
echo "3. Диагностика: панель → DevTools → Console → "
echo '   fetch("/api/diag/wg",{headers:{"Authorization":"Bearer "+localStorage.getItem("token")}}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,2)))'
