#!/bin/sh
# Генерация nginx-конфига с динамическим портом панели + SSL (Let's Encrypt)
#
# Переменные окружения:
#   PANEL_PORT   — HTTP порт (по умолчанию 9443)
#   BACKEND_URL  — адрес backend (по умолчанию http://backend:3000)
#   SSL_ENABLED  — "true" для HTTPS на 443 с Let's Encrypt
#   PANEL_DOMAIN — домен для SSL-сертификата

LISTEN_PORT="${PANEL_PORT:-9443}"
BACKEND="${BACKEND_URL:-http://backend:3000}"

# SSL конфиг: сначала из файла ssl.env (панель), потом из env vars (docker-compose)
if [ -f /app/configs/ssl.env ]; then
    . /app/configs/ssl.env
fi

SSL="${SSL_ENABLED:-false}"
DOMAIN="${PANEL_DOMAIN:-}"

CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
KEY_PATH="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"

if [ "$SSL" = "true" ] && [ -n "$DOMAIN" ] && [ -f "$CERT_PATH" ] && [ -f "$KEY_PATH" ]; then
    # ═══════════════════════════════════════════════════
    # Режим 1: HTTPS (сертификат есть)
    # ═══════════════════════════════════════════════════
    cat > /etc/nginx/conf.d/default.conf << NGINXEOF
# HTTP: ACME challenge + redirect на HTTPS
server {
    listen 80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/acme-challenge;
        try_files \$uri =404;
    }

    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

# HTTPS
server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    # SSL-сертификат (Let's Encrypt)
    ssl_certificate     ${CERT_PATH};
    ssl_certificate_key ${KEY_PATH};

    # TLS 1.2+ только
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate ${CERT_PATH};
    resolver 8.8.8.8 1.1.1.1 valid=300s;
    resolver_timeout 5s;

    # HSTS
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # SSL сессии
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;

    root /usr/share/nginx/html;
    index index.html;

    # Таймауты для SSH-операций
    proxy_read_timeout 300s;
    proxy_connect_timeout 10s;
    proxy_send_timeout 300s;

    location /api/ {
        proxy_pass ${BACKEND};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
NGINXEOF

    echo "[NGINX] HTTPS: ${DOMAIN}, :80 (redirect) + :443 (SSL), proxy -> ${BACKEND}"

elif [ "$SSL" = "true" ] && [ -n "$DOMAIN" ]; then
    # ═══════════════════════════════════════════════════
    # Режим 2: SSL включён, но сертификата ещё нет
    # HTTP на порту 80 для ACME challenge + обычный контент
    # ═══════════════════════════════════════════════════
    cat > /etc/nginx/conf.d/default.conf << NGINXEOF
server {
    listen 80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/acme-challenge;
        try_files \$uri =404;
    }

    root /usr/share/nginx/html;
    index index.html;

    proxy_read_timeout 300s;
    proxy_connect_timeout 10s;
    proxy_send_timeout 300s;

    location /api/ {
        proxy_pass ${BACKEND};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
NGINXEOF

    echo "[NGINX] ВНИМАНИЕ: SSL включён, но сертификат не найден: ${CERT_PATH}"
    echo "[NGINX] HTTP на :80 (ACME challenge). Запустите certbot, затем перезапустите контейнер."

else
    # ═══════════════════════════════════════════════════
    # Режим 3: HTTP (без SSL, текущее поведение)
    # ═══════════════════════════════════════════════════
    cat > /etc/nginx/conf.d/default.conf << NGINXEOF
server {
    listen ${LISTEN_PORT};
    root /usr/share/nginx/html;
    index index.html;

    # Увеличенные таймауты для SSH-операций
    proxy_read_timeout 300s;
    proxy_connect_timeout 10s;
    proxy_send_timeout 300s;

    location /api/ {
        proxy_pass ${BACKEND};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Кеширование статики
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
NGINXEOF

    echo "[NGINX] HTTP на порту ${LISTEN_PORT}, proxy -> ${BACKEND}"
fi

exec nginx -g 'daemon off;'
