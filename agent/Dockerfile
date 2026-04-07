FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Базовые утилиты + Node.js
RUN apt-get update && apt-get install -y \
    iptables \
    iproute2 \
    procps \
    curl \
    unzip \
    iputils-ping \
    ca-certificates \
    gnupg \
    nginx \
    openssl \
    certbot \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Установка Xray — скачиваем бинарник напрямую (без systemd)
RUN ARCH=$(dpkg --print-architecture) \
    && if [ "$ARCH" = "amd64" ]; then XRAY_ARCH="64"; \
       elif [ "$ARCH" = "arm64" ]; then XRAY_ARCH="arm64-v8a"; \
       else XRAY_ARCH="$ARCH"; fi \
    && XRAY_VERSION=$(curl -s https://api.github.com/repos/XTLS/Xray-core/releases/latest | grep '"tag_name"' | head -1 | cut -d '"' -f 4) \
    && curl -L -o /tmp/xray.zip "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-${XRAY_ARCH}.zip" \
    && mkdir -p /usr/local/bin /usr/local/etc/xray /var/log/xray \
    && unzip -o /tmp/xray.zip xray geoip.dat geosite.dat -d /usr/local/bin \
    && chmod +x /usr/local/bin/xray \
    && rm /tmp/xray.zip

# Рабочая директория
WORKDIR /app

# Зависимости
COPY package.json ./
RUN npm install --production

# Исходники
COPY src/ ./src/

# Порт агента
EXPOSE 8443
EXPOSE 80

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://[::1]:8443/api/health || curl -sf http://127.0.0.1:8443/api/health || exit 1

CMD ["node", "src/index.js"]
