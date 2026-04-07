#!/bin/bash
# Деплой VPN Panel на сервер с паролем
SERVER="46.149.75.98"
USER="root"
PASS="D3LBysa9dr5%nUx23~Dj"
REMOTE_DIR="/opt/vpn-panel"

FILES=(
    "backend/src/index.js"
    "backend/src/services/wireguard.js"
    "backend/src/services/xray.js"
    "backend/src/services/groups.js"
    "backend/src/services/node-client.js"
    "backend/src/routes/diag.js"
    "agent/src/routes/wg.js"
    "agent/src/routes/system.js"
)

echo "=== Копируем файлы на сервер ==="
for f in "${FILES[@]}"; do
    echo "  → $f"
    expect -c "
        spawn scp -o StrictHostKeyChecking=no \"$f\" ${USER}@${SERVER}:${REMOTE_DIR}/${f}
        expect {
            \"*assword*\" { send \"${PASS}\r\"; exp_continue }
            eof
        }
    " 2>/dev/null || \
    expect -c "
        spawn /usr/bin/scp -o StrictHostKeyChecking=no \"$f\" ${USER}@${SERVER}:${REMOTE_DIR}/${f}
        expect {
            \"*assword*\" { send \"${PASS}\r\"; exp_continue }
            eof
        }
    " 2>/dev/null
done

echo ""
echo "=== Пересобираем и запускаем ==="
expect -c "
    spawn ssh -o StrictHostKeyChecking=no ${USER}@${SERVER} \"cd ${REMOTE_DIR} && docker compose build --no-cache && docker compose up -d\"
    expect {
        \"*assword*\" { send \"${PASS}\r\"; exp_continue }
        eof
    }
"

echo ""
echo "=== Готово! ==="
echo "1. Обнови агенты в панели (Серверы → каждый → Обновить агент)"
echo "2. Смени группу и проверь WG"
