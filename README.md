# VPN Panel

Панель управления VPN-серверами. Поддержка Xray (VLESS Reality) и WireGuard.

Панель **не является VPN-сервером** — она управляет удалёнными серверами через SSH + Docker-агент.

## Быстрый старт

```bash
# На сервере (Ubuntu/Debian, root):
git clone https://github.com/dmitryorlovofficial-stack/VPNGLOBAL.git
cd VPNGLOBAL
chmod +x setup.sh
sudo ./setup.sh
```

Скрипт спросит порт панели, логин и пароль администратора, затем установит Docker, соберёт и запустит контейнеры.

## Ручная установка

```bash
cp .env.example .env
# Отредактируйте .env — задайте пароли и секреты
nano .env

# Создайте директории
mkdir -p backend/data configs /etc/letsencrypt /var/www/acme-challenge

# Запуск
docker compose up -d
```

## Управление

```bash
# Логи
docker compose logs -f

# Перезапуск
docker compose restart

# Остановка
docker compose down

# Обновление
git pull && docker compose up -d --build
```

## Архитектура

| Сервис | Описание | Порт |
|--------|----------|------|
| **frontend** | React + Nginx | 9443 (настраивается) |
| **backend** | Node.js + Express API | 3000 |
| **postgres** | PostgreSQL 16 | 5432 (localhost) |
| **agent** | Docker-агент на VPN-серверах | 8443 |

## Возможности

- Управление несколькими VPN-серверами
- Xray (VLESS Reality, VMess, Trojan, Shadowsocks)
- WireGuard
- Мониторинг трафика и серверов
- Подписки и QR-коды для клиентов
- SSL (Let's Encrypt)
- Stub-сайты (маскировка)
- Группы клиентов с лимитами
- Тарифы и платежи
- Пользовательский портал
- Telegram-интеграция
