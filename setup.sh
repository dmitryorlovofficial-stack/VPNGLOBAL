#!/usr/bin/env bash
# ============================================================
# setup.sh — Установка панели управления VPN-серверами
#
# Панель — ТОЛЬКО управление. Она НЕ является VPN-сервером.
# VPN-серверы добавляются и настраиваются через веб-интерфейс.
#
# Запуск: chmod +x setup.sh && sudo ./setup.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/.setup.conf"

# === Цвета ===
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

# ============================================================
# Ввод параметров
# ============================================================
ask() {
    local prompt="$1"
    local default="$2"
    local result

    if [[ -n "$default" ]]; then
        read -rp "$(echo -e "${CYAN}  $prompt${NC} [${YELLOW}${default}${NC}]: ")" result
        echo "${result:-$default}"
    else
        while true; do
            read -rp "$(echo -e "${CYAN}  $prompt${NC}: ")" result
            if [[ -n "$result" ]]; then
                echo "$result"
                return
            fi
            echo -e "  ${RED}Это поле обязательно${NC}" >&2
        done
    fi
}

ask_pass() {
    local prompt="$1"
    local default="${2:-}"
    local result

    if [[ -n "$default" ]]; then
        read -srp "$(echo -e "${CYAN}  $prompt${NC} [${YELLOW}****${NC}]: ")" result
        echo >&2
        echo "${result:-$default}"
    else
        while true; do
            read -srp "$(echo -e "${CYAN}  $prompt${NC}: ")" result
            echo >&2
            if [[ -n "$result" ]]; then
                echo "$result"
                return
            fi
            echo -e "  ${RED}Это поле обязательно${NC}" >&2
        done
    fi
}

# ============================================================
# Сбор конфигурации
# ============================================================
collect_input() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════════╗"
    echo "║     VPN Panel — Панель управления серверами      ║"
    echo "║                                                  ║"
    echo "║  Панель НЕ является VPN-сервером.                ║"
    echo "║  VPN-серверы добавляются через веб-интерфейс.    ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo -e "${NC}"

    # Загрузка сохранённых значений
    if [[ -f "$CONFIG_FILE" ]]; then
        echo -e "${GREEN}Найдена конфигурация предыдущего запуска.${NC}"
        read -rp "$(echo -e "${CYAN}  Использовать сохранённые значения? (y/n)${NC} [${YELLOW}y${NC}]: ")" use_saved
        if [[ "${use_saved:-y}" == "y" ]]; then
            source "$CONFIG_FILE"
            echo -e "${GREEN}  Конфигурация загружена${NC}\n"
            show_config_summary
            read -rp "$(echo -e "\n${CYAN}  Всё верно? Начать установку? (y/n)${NC} [${YELLOW}y${NC}]: ")" confirm
            if [[ "${confirm:-y}" == "y" ]]; then
                return
            fi
            echo
        fi
    fi

    # --- Панель управления ---
    echo -e "\n${BLUE}━━━ Панель управления ━━━${NC}"
    PANEL_PORT=$(ask "Порт веб-панели" "${PANEL_PORT:-9443}")
    PANEL_ADMIN_USER=$(ask "Логин администратора" "${PANEL_ADMIN_USER:-admin}")
    PANEL_ADMIN_PASS=$(ask_pass "Пароль администратора" "${PANEL_ADMIN_PASS:-}")

    # --- База данных (пароль генерируется автоматически) ---
    DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"

    # JWT secret
    PANEL_SECRET_KEY="${PANEL_SECRET_KEY:-$(openssl rand -hex 32)}"

    # --- Подтверждение ---
    echo
    show_config_summary

    echo
    read -rp "$(echo -e "${CYAN}  Всё верно? Начать установку? (y/n)${NC} [${YELLOW}y${NC}]: ")" confirm
    if [[ "${confirm:-y}" != "y" ]]; then
        log_error "Установка отменена"
        exit 0
    fi

    save_config
}

# ============================================================
# Сводка параметров
# ============================================================
show_config_summary() {
    echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║              Сводка параметров                  ║${NC}"
    echo -e "${CYAN}╠══════════════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}║${NC} ${BLUE}Панель:${NC}"
    echo -e "${CYAN}║${NC}   Порт:       ${YELLOW}${PANEL_PORT}${NC}"
    echo -e "${CYAN}║${NC}   Логин:      ${YELLOW}${PANEL_ADMIN_USER}${NC}"
    echo -e "${CYAN}║${NC}"
    echo -e "${CYAN}║${NC} ${BLUE}Примечание:${NC}"
    echo -e "${CYAN}║${NC}   VPN-серверы добавляются через веб-панель."
    echo -e "${CYAN}║${NC}   WireGuard/Xray настраиваются через панель."
    echo -e "${CYAN}║${NC}   HTTPS (SSL) настраивается в Настройки → SSL."
    echo -e "${CYAN}║${NC}   Подключение к серверам по SSH (ключ/пароль)."
    echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
}

# ============================================================
# Сохранение конфигурации
# ============================================================
save_config() {
    _esc() { printf '%s' "$1" | sed "s/'/'\\\\''/g"; }

    {
        echo "# Конфигурация VPN Panel ($(date))"
        printf "PANEL_PORT='%s'\n" "$(_esc "$PANEL_PORT")"
        printf "PANEL_ADMIN_USER='%s'\n" "$(_esc "$PANEL_ADMIN_USER")"
        printf "PANEL_ADMIN_PASS='%s'\n" "$(_esc "$PANEL_ADMIN_PASS")"
        printf "PANEL_SECRET_KEY='%s'\n" "$(_esc "$PANEL_SECRET_KEY")"
        printf "DB_PASSWORD='%s'\n" "$(_esc "$DB_PASSWORD")"
    } > "$CONFIG_FILE"

    chmod 600 "$CONFIG_FILE"
    log_info "Конфигурация сохранена в ${CONFIG_FILE}"
}

# ============================================================
# Проверки
# ============================================================
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "Скрипт должен быть запущен от root (sudo ./setup.sh)"
        exit 1
    fi
}

check_os() {
    if [[ ! -f /etc/os-release ]]; then
        log_error "Не удалось определить ОС"
        exit 1
    fi
    . /etc/os-release
    if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
        log_warn "Скрипт тестирован на Ubuntu/Debian. Текущая ОС: $ID"
    fi
    log_info "ОС: $PRETTY_NAME"
}

# ============================================================
# Установка зависимостей (только Docker)
# ============================================================
install_dependencies() {
    log_step "Установка зависимостей"

    apt-get update -qq
    apt-get install -y -qq \
        curl \
        wget \
        openssl \
        ca-certificates \
        gnupg \
        lsb-release

    # Docker
    if ! command -v docker &>/dev/null; then
        log_info "Устанавливаю Docker..."
        curl -fsSL https://get.docker.com | sh
        systemctl enable --now docker
    else
        log_info "Docker уже установлен: $(docker --version)"
    fi

    # Docker Compose plugin
    if ! docker compose version &>/dev/null; then
        log_info "Устанавливаю Docker Compose..."
        if [[ ! -f /etc/apt/sources.list.d/docker.list ]]; then
            install -m 0755 -d /etc/apt/keyrings
            curl -fsSL "https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg" \
                | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
            chmod a+r /etc/apt/keyrings/docker.gpg
            echo \
                "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
                https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") \
                $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
                > /etc/apt/sources.list.d/docker.list
            apt-get update -qq
        fi
        if ! apt-get install -y -qq docker-compose-plugin 2>/dev/null; then
            log_warn "Пакет docker-compose-plugin не найден, ставлю standalone..."
            COMPOSE_VERSION=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest | grep tag_name | cut -d '"' -f 4)
            COMPOSE_VERSION="${COMPOSE_VERSION:-v2.24.5}"
            curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" \
                -o /usr/local/bin/docker-compose
            chmod +x /usr/local/bin/docker-compose
            mkdir -p /usr/local/lib/docker/cli-plugins
            ln -sf /usr/local/bin/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
        fi
    else
        log_info "Docker Compose уже установлен"
    fi

    log_info "Зависимости установлены"
}

# ============================================================
# Настройка Docker: DNS + IPv6 (для SSH к IPv6-серверам)
# ============================================================
configure_docker() {
    local DAEMON_JSON="/etc/docker/daemon.json"
    local NEEDS_RESTART=false

    # Читаем текущий конфиг или создаём пустой
    local CONFIG='{}'
    if [[ -f "$DAEMON_JSON" ]] && [[ -s "$DAEMON_JSON" ]]; then
        CONFIG=$(cat "$DAEMON_JSON")
    fi

    # Обновляем через python3 (добавляем DNS + IPv6 если нет)
    local NEW_CONFIG
    NEW_CONFIG=$(python3 -c "
import json, sys
try:
    d = json.loads('''$CONFIG''')
except:
    d = {}
changed = False
if 'dns' not in d:
    d['dns'] = ['8.8.8.8', '1.1.1.1']
    changed = True
if not d.get('ipv6'):
    d['ipv6'] = True
    d['ip6tables'] = True
    d['experimental'] = True
    d['fixed-cidr-v6'] = 'fd00:d0c:a001::/48'
    changed = True
json.dump(d, sys.stdout, indent=2)
print()
print('CHANGED' if changed else 'OK', file=sys.stderr)
" 2>/tmp/docker_cfg_status || echo '{"dns":["8.8.8.8","1.1.1.1"],"ipv6":true,"ip6tables":true,"experimental":true,"fixed-cidr-v6":"fd00:d0c:a001::/48"}')

    local STATUS
    STATUS=$(cat /tmp/docker_cfg_status 2>/dev/null || echo "CHANGED")
    rm -f /tmp/docker_cfg_status

    if [[ "$STATUS" == "CHANGED" ]]; then
        echo "$NEW_CONFIG" > "$DAEMON_JSON"
        log_info "Docker: DNS + IPv6 настроены"
        systemctl restart docker
        sleep 3
    else
        log_info "Docker: конфигурация актуальна"
    fi
}

# ============================================================
# Открываем порты в файрволе (панель + SSL)
# ============================================================
configure_firewall() {
    log_step "Настройка файрвола"

    # Всегда открываем 80/443 — SSL настраивается через панель
    local PORTS=("${PANEL_PORT}/tcp" "80/tcp" "443/tcp")

    if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
        for port in "${PORTS[@]}"; do
            ufw allow "$port" comment "VPN Panel"
        done
        log_info "ufw: порты ${PORTS[*]} открыты"
    elif command -v firewall-cmd &>/dev/null && systemctl is-active --quiet firewalld; then
        for port in "${PORTS[@]}"; do
            firewall-cmd --permanent --add-port="$port"
        done
        firewall-cmd --reload
        log_info "firewalld: порты ${PORTS[*]} открыты"
    else
        log_info "Файрвол не обнаружен или неактивен — пропускаю"
    fi
}

# ============================================================
# Создание .env файла
# ============================================================
create_env_file() {
    log_step "Создание .env файла"

    {
        echo "# VPN Panel — Конфигурация"
        echo "# Сгенерировано setup.sh $(date)"
        echo ""
        echo "# Панель"
        printf 'PANEL_PORT=%s\n' "${PANEL_PORT}"
        printf 'PANEL_ADMIN_USER=%s\n' "${PANEL_ADMIN_USER}"
        printf 'PANEL_ADMIN_PASS=%s\n' "${PANEL_ADMIN_PASS}"
        printf 'PANEL_SECRET_KEY=%s\n' "${PANEL_SECRET_KEY}"
        echo ""
        echo "# База данных"
        printf 'DB_PASSWORD=%s\n' "${DB_PASSWORD}"
    } > "${SCRIPT_DIR}/.env"

    chmod 600 "${SCRIPT_DIR}/.env"

    # Копия для backend
    cp "${SCRIPT_DIR}/.env" "${SCRIPT_DIR}/backend/.env"

    log_info ".env файл создан"
}

# ============================================================
# Создание директорий
# ============================================================
create_directories() {
    log_step "Создание директорий"

    mkdir -p "${SCRIPT_DIR}/backend/data"
    mkdir -p "${SCRIPT_DIR}/configs"
    # Директории для SSL (Let's Encrypt через панель)
    mkdir -p /etc/letsencrypt
    mkdir -p /var/lib/letsencrypt
    mkdir -p /var/www/acme-challenge/.well-known/acme-challenge

    log_info "Директории готовы"
}

# ============================================================
# Сборка и запуск
# ============================================================
deploy_panel() {
    log_step "Сборка и запуск панели"

    cd "$SCRIPT_DIR"

    # Останавливаем старые контейнеры и удаляем volumes
    # (PostgreSQL создаст БД заново с паролем из .env)
    docker compose down -v 2>/dev/null || true

    # Собираем
    log_info "Сборка образов (может занять 1-3 минуты)..."
    docker compose build --no-cache

    # Запускаем
    docker compose up -d

    # Ждём backend
    log_info "Ожидание запуска backend..."
    for i in $(seq 1 30); do
        if curl -sf http://localhost:3000/api/health &>/dev/null; then
            log_info "Backend запущен"
            break
        fi
        if [[ $i -eq 30 ]]; then
            log_warn "Backend не ответил за 60 секунд. Проверьте: docker compose logs backend"
        fi
        sleep 2
    done

    log_info "Панель запущена"
}

# ============================================================
# Статус
# ============================================================
show_status() {
    log_step "Проверка статуса"

    echo -e "\n${GREEN}▸ Docker-контейнеры:${NC}"
    docker compose -f "${SCRIPT_DIR}/docker-compose.yml" ps

    # Определяем IP
    local PUBLIC_IP
    PUBLIC_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')

    echo -e "\n${CYAN}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║         Панель управления установлена!           ║${NC}"
    echo -e "${CYAN}╠══════════════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  ${BLUE}Адрес:${NC}  ${GREEN}http://${PUBLIC_IP}:${PANEL_PORT}${NC}"
    echo -e "${CYAN}║${NC}  ${BLUE}Логин:${NC}  ${YELLOW}${PANEL_ADMIN_USER}${NC}"
    echo -e "${CYAN}║${NC}  ${BLUE}Пароль:${NC} ${YELLOW}${PANEL_ADMIN_PASS}${NC}"
    echo -e "${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  ${BLUE}Следующие шаги:${NC}"
    echo -e "${CYAN}║${NC}  1. Откройте панель в браузере"
    echo -e "${CYAN}║${NC}  2. Добавьте VPN-сервер (Серверы → Добавить)"
    echo -e "${CYAN}║${NC}     Укажите IP, SSH-порт, логин/пароль или ключ"
    echo -e "${CYAN}║${NC}  3. Нажмите «Тест SSH» для проверки подключения"
    echo -e "${CYAN}║${NC}  4. Нажмите «Deploy Agent» — установит Docker-агент"
    echo -e "${CYAN}║${NC}     (Docker + vpn-node-agent контейнер)"
    echo -e "${CYAN}║${NC}  5. Нажмите «Сканировать» для обнаружения ПО"
    echo -e "${CYAN}║${NC}  6. Создайте VPN-клиентов (Клиенты → Добавить)"
    echo -e "${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  ${BLUE}HTTPS:${NC}"
    echo -e "${CYAN}║${NC}  Настройки → SSL → укажите домен → получить сертификат"
    echo -e "${CYAN}║${NC}  (Let's Encrypt, бесплатно, автообновление)"
    echo -e "${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}  ${BLUE}Управление:${NC}"
    echo -e "${CYAN}║${NC}  Логи:       docker compose logs -f"
    echo -e "${CYAN}║${NC}  Перезапуск: docker compose restart"
    echo -e "${CYAN}║${NC}  Остановка:  docker compose down"
    echo -e "${CYAN}║${NC}  Обновление: git pull && docker compose up -d --build"
    echo -e "${CYAN}║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
}

# ============================================================
# Основной поток
# ============================================================
main() {
    check_root
    check_os
    collect_input
    echo
    log_step "Начинаю установку"
    install_dependencies
    configure_docker
    configure_firewall
    create_directories
    create_env_file
    deploy_panel
    show_status

    log_info "Установка завершена!"
}

main "$@"
