// Сервис для взаимодействия с AdGuard Home API
// Панель хранит подключения к внешним серверам AdGuard Home и проксирует API
const http = require('http');
const https = require('https');
const { queryOne, queryAll, query } = require('../db/postgres');

const DEFAULT_TIMEOUT = 15000;

// ============================================================
// HTTP-клиент для AdGuard Home API
// ============================================================

/**
 * Выполнить HTTP-запрос к AdGuard Home API
 */
function _httpRequest(url, method, body, { username, password, timeout = DEFAULT_TIMEOUT }) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const isHttps = parsed.protocol === 'https:';
        const transport = isHttps ? https : http;

        const auth = Buffer.from(`${username}:${password}`).toString('base64');

        const reqOptions = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: method.toUpperCase(),
            timeout,
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json',
            },
            // Для self-signed сертификатов
            rejectUnauthorized: false,
        };

        const req = transport.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    // AdGuard может возвращать пустой ответ (200 OK без тела)
                    const json = data.trim() ? JSON.parse(data) : { ok: true };
                    if (res.statusCode >= 400) {
                        const msg = json.message || json.error || `HTTP ${res.statusCode}`;
                        const err = new Error(msg);
                        err.statusCode = res.statusCode;
                        reject(err);
                    } else {
                        resolve(json);
                    }
                } catch {
                    if (res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
                    } else {
                        // Текстовый ответ — некоторые endpoint'ы AdGuard возвращают plain text
                        resolve(data.trim() || 'OK');
                    }
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (body && method.toUpperCase() !== 'GET') {
            req.write(JSON.stringify(body));
        }

        req.end();
    });
}

/**
 * Получить конфиг сервера из БД и выполнить запрос к AdGuard API
 */
async function _request(serverId, method, path, body = null) {
    const server = await queryOne('SELECT * FROM adguard_servers WHERE id = $1', [serverId]);
    if (!server) throw new Error(`AdGuard сервер #${serverId} не найден`);

    const baseUrl = server.url.replace(/\/$/, '');
    const url = `${baseUrl}${path}`;

    return _httpRequest(url, method, body, {
        username: server.username,
        password: server.password,
    });
}

// ============================================================
// CRUD подключений
// ============================================================

async function listServers() {
    return queryAll('SELECT id, name, url, username, status, last_check, created_at FROM adguard_servers ORDER BY id');
}

async function getServer(id) {
    const server = await queryOne('SELECT id, name, url, username, status, last_check, created_at FROM adguard_servers WHERE id = $1', [id]);
    if (!server) throw new Error('AdGuard сервер не найден');
    return server;
}

async function createServer({ name, url, username, password }) {
    if (!name || !url || !username || !password) {
        throw new Error('Все поля обязательны: name, url, username, password');
    }

    // Нормализуем URL
    let normalizedUrl = url.replace(/\/$/, '');
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        normalizedUrl = `http://${normalizedUrl}`;
    }

    const result = await queryOne(
        `INSERT INTO adguard_servers (name, url, username, password) VALUES ($1, $2, $3, $4) RETURNING id`,
        [name, normalizedUrl, username, password]
    );

    // Тестируем подключение
    let status = 'unknown';
    try {
        await _httpRequest(`${normalizedUrl}/control/status`, 'GET', null, {
            username, password,
        });
        status = 'online';
    } catch {
        status = 'offline';
    }

    await query('UPDATE adguard_servers SET status = $1, last_check = NOW() WHERE id = $2', [status, result.id]);

    return { id: result.id, status };
}

async function updateServer(id, { name, url, username, password }) {
    const server = await queryOne('SELECT * FROM adguard_servers WHERE id = $1', [id]);
    if (!server) throw new Error('AdGuard сервер не найден');

    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (url !== undefined) {
        let normalizedUrl = url.replace(/\/$/, '');
        if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
            normalizedUrl = `http://${normalizedUrl}`;
        }
        fields.push(`url = $${idx++}`);
        values.push(normalizedUrl);
    }
    if (username !== undefined) { fields.push(`username = $${idx++}`); values.push(username); }
    if (password !== undefined) { fields.push(`password = $${idx++}`); values.push(password); }

    if (fields.length === 0) throw new Error('Нет полей для обновления');

    values.push(id);
    await query(`UPDATE adguard_servers SET ${fields.join(', ')} WHERE id = $${idx}`, values);

    return { ok: true };
}

async function deleteServer(id) {
    const result = await query('DELETE FROM adguard_servers WHERE id = $1', [id]);
    return { ok: true };
}

async function testConnection(id) {
    try {
        const result = await _request(id, 'GET', '/control/status');
        await query('UPDATE adguard_servers SET status = $1, last_check = NOW() WHERE id = $2', ['online', id]);
        return { ok: true, status: 'online', data: result };
    } catch (err) {
        await query('UPDATE adguard_servers SET status = $1, last_check = NOW() WHERE id = $2', ['offline', id]);
        throw new Error(`Ошибка подключения: ${err.message}`);
    }
}

// ============================================================
// Проксирование AdGuard Home API
// ============================================================

// Статус
async function getStatus(id) {
    return _request(id, 'GET', '/control/status');
}

// DNS
async function getDnsConfig(id) {
    return _request(id, 'GET', '/control/dns_info');
}

async function setDnsConfig(id, config) {
    return _request(id, 'POST', '/control/dns_config', config);
}

// Фильтрация
async function getFiltering(id) {
    return _request(id, 'GET', '/control/filtering/status');
}

async function setFiltering(id, config) {
    return _request(id, 'POST', '/control/filtering/config', config);
}

async function addFilterList(id, data) {
    return _request(id, 'POST', '/control/filtering/add_url', data);
}

async function removeFilterList(id, data) {
    return _request(id, 'POST', '/control/filtering/remove_url', data);
}

async function refreshFilters(id) {
    return _request(id, 'POST', '/control/filtering/refresh', { whitelist: false });
}

// Клиенты
async function getClients(id) {
    return _request(id, 'GET', '/control/clients');
}

async function addClient(id, data) {
    return _request(id, 'POST', '/control/clients/add', data);
}

async function updateClient(id, data) {
    return _request(id, 'POST', '/control/clients/update', data);
}

async function deleteClient(id, data) {
    return _request(id, 'POST', '/control/clients/delete', data);
}

// Query Log
async function getQueryLog(id, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const path = qs ? `/control/querylog?${qs}` : '/control/querylog';
    return _request(id, 'GET', path);
}

// Статистика
async function getStats(id) {
    return _request(id, 'GET', '/control/stats');
}

// DHCP
async function getDhcpStatus(id) {
    return _request(id, 'GET', '/control/dhcp/status');
}

// Защита вкл/выкл
async function setProtection(id, enabled) {
    return _request(id, 'POST', '/control/dns_config', { protection_enabled: enabled });
}

module.exports = {
    // CRUD
    listServers,
    getServer,
    createServer,
    updateServer,
    deleteServer,
    testConnection,
    // API proxy
    getStatus,
    getDnsConfig,
    setDnsConfig,
    getFiltering,
    setFiltering,
    addFilterList,
    removeFilterList,
    refreshFilters,
    getClients,
    addClient,
    updateClient,
    deleteClient,
    getQueryLog,
    getStats,
    getDhcpStatus,
    setProtection,
};
