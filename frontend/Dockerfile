# Dockerfile для frontend — сборка + nginx
FROM node:20-alpine AS build

WORKDIR /app
COPY package.json ./
# Retry при DNS-ошибках npm (EAI_AGAIN)
RUN for i in 1 2 3 4 5; do \
      npm install && break || \
      echo "npm install retry $i..." && sleep 5; \
    done
COPY . .
RUN npm run build

# Финальный образ — nginx
FROM nginx:alpine

# Копируем собранный фронтенд
COPY --from=build /app/dist /usr/share/nginx/html

# Скрипт запуска: генерирует nginx.conf с нужным портом (PANEL_PORT)
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
