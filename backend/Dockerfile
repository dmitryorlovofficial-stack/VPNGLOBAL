# Dockerfile для backend панели управления VPN
# Панель — только управление через SSH, WireGuard на ней не нужен
FROM node:20-alpine

# Системные зависимости
# openssh-client — SSH-подключения к VPN-серверам
# postgresql-client — pg_isready, psql для отладки
RUN for i in 1 2 3 4 5; do \
      apk add --no-cache \
        openssh-client \
        curl \
        openssl \
        postgresql-client \
        docker-cli \
      && break || echo "apk retry $i..." && sleep 3; \
    done

WORKDIR /app

COPY package.json ./
RUN for i in 1 2 3 4 5; do \
      npm install --production && break || \
      echo "npm install retry $i..." && sleep 5; \
    done

COPY src/ ./src/
COPY stub-templates/ ./stub-templates/

RUN mkdir -p /app/data /app/configs

EXPOSE 3000

CMD ["node", "src/index.js"]
