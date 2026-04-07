// HTTP-клиент для взаимодействия с vpn-node агентом на серверах
// Заменяет SSH-команды на HTTP API вызовы
const http = require('http');
const https = require('https');
const { queryOne } = require('../db/postgres');

class NodeClient {
    constructor() {
        this.defaultTimeout = 30000;
        this.longTimeout = 180000; // Для install операций
    }

    /**
     * Получить конфиг подключения к агенту из БД
     */
    async _getAgentConfig(serverId) {
        const server = await queryOne(
            'SELECT id, name, host, ipv4, ipv6, agent_port, agent_api_key, agent_status FROM servers WHERE id = $1',
            [serverId]
        );
        if (!server) throw new Error(`Сервер #${serverId} не найден`);
        if (!server.agent_api_key) throw new Error(`Агент не настроен на сервере #${serverId} (${server.name})`);
        return server;
    }

    /**
     * HTTP-запрос к агенту
     */
    async request(serverId, method, path, body = null, options = {}) {
        const server = await this._getAgentConfig(serverId);
        const timeout = options.timeout || this.defaultTimeout;
        const retries = options.retries !== undefined ? options.retries : 1;

        const host = server.ipv4 || server.host || server.ipv6;
        if (!host) throw new Error(`Нет IP-адреса для сервера #${serverId}`);

        const port = server.agent_port || 8443;
        // IPv6 адреса нужно обернуть в [] для URL
        const urlHost = host.includes(':') ? `[${host}]` : host;
        const url = `http://${urlHost}:${port}${path}`;

        let lastError;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const result = await this._httpRequest(url, method, body, {
                    timeout,
                    headers: {
                        'X-API-Key': server.agent_api_key,
                        'Content-Type': 'application/json',
                    },
                });
                return result;
            } catch (err) {
                lastError = err;
                if (attempt < retries) {
                    // Exponential backoff: 1s, 2s
                    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                }
            }
        }

        throw new Error(`Агент #${serverId} (${server.name}) недоступен: ${lastError.message}`);
    }

    /**
     * Низкоуровневый HTTP-запрос
     */
    _httpRequest(url, method, body, options = {}) {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const isHttps = parsed.protocol === 'https:';
            const transport = isHttps ? https : http;

            const headers = { ...(options.headers || {}) };
            // Всегда ставим Content-Type для запросов с body
            if (body && method.toUpperCase() !== 'GET') {
                headers['Content-Type'] = 'application/json';
            }

            const reqOptions = {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: method.toUpperCase(),
                headers,
                timeout: options.timeout || 30000,
            };

            // new URL().hostname для IPv6 возвращает в скобках: [2a14:...]
            // http.request ожидает чистый адрес без скобок
            if (reqOptions.hostname.startsWith('[') && reqOptions.hostname.endsWith(']')) {
                reqOptions.hostname = reqOptions.hostname.slice(1, -1);
            }

            const req = transport.request(reqOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            const msg = json.details
                                ? `${json.error || 'Error'}: ${typeof json.details === 'string' ? json.details.slice(0, 1000) : JSON.stringify(json.details).slice(0, 1000)}`
                                : (json.error || `HTTP ${res.statusCode}`);
                            const err = new Error(msg);
                            err.statusCode = res.statusCode;
                            err.response = json;
                            reject(err);
                        } else {
                            resolve(json);
                        }
                    } catch {
                        if (res.statusCode >= 400) {
                            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                        } else {
                            resolve(data);
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

    // =================== System ===================

    async healthCheck(serverId) {
        return this.request(serverId, 'GET', '/api/health', null, { retries: 1, timeout: 10000 });
    }

    async getMetrics(serverId) {
        return this.request(serverId, 'GET', '/api/metrics');
    }

    async getSystemInfo(serverId) {
        return this.request(serverId, 'GET', '/api/system/info');
    }

    async reboot(serverId) {
        return this.request(serverId, 'POST', '/api/system/reboot', null, { retries: 0 });
    }

    async ping(serverId, host, count = 3, timeout = 5) {
        return this.request(serverId, 'POST', '/api/system/ping', { host, count, timeout });
    }

    async setupRoutes(serverId, rules) {
        return this.request(serverId, 'POST', '/api/system/routes', { rules });
    }

    async getSystemLogs(serverId, lines = 100, service = null) {
        const qs = service ? `?lines=${lines}&service=${service}` : `?lines=${lines}`;
        return this.request(serverId, 'GET', `/api/system/logs${qs}`);
    }

    async getConnections(serverId) {
        return this.request(serverId, 'GET', '/api/system/connections');
    }

    async getProcesses(serverId) {
        return this.request(serverId, 'GET', '/api/system/processes');
    }

    // =================== Xray ===================

    async xrayInstall(serverId) {
        return this.request(serverId, 'POST', '/api/xray/install', null, { timeout: this.longTimeout });
    }

    async xrayUninstall(serverId) {
        return this.request(serverId, 'POST', '/api/xray/uninstall', null, { timeout: 60000 });
    }

    async xrayStatus(serverId) {
        return this.request(serverId, 'GET', '/api/xray/status');
    }

    async xrayRestart(serverId) {
        return this.request(serverId, 'POST', '/api/xray/restart');
    }

    async xrayStop(serverId) {
        return this.request(serverId, 'POST', '/api/xray/stop');
    }

    async xrayDeployConfig(serverId, config) {
        return this.request(serverId, 'POST', '/api/xray/deploy-config', { config });
    }

    async xrayStats(serverId, apiPort = 10085) {
        return this.request(serverId, 'GET', `/api/xray/stats?apiPort=${apiPort}`);
    }

    async xrayResetStats(serverId, apiPort = 10085) {
        return this.request(serverId, 'POST', `/api/xray/stats/reset?apiPort=${apiPort}`);
    }

    async xrayGenerateKeys(serverId) {
        return this.request(serverId, 'POST', '/api/xray/generate-keys');
    }

    async xrayAccessLog(serverId, lines = 500) {
        return this.request(serverId, 'GET', `/api/xray/access-log?lines=${lines}`);
    }

    async xrayTruncateAccessLog(serverId) {
        return this.request(serverId, 'POST', '/api/xray/access-log/truncate');
    }

    // gRPC HandlerService — управление без перезапуска

    async xrayGrpcAddUser(serverId, { inboundTag, protocol, email, id, password }, apiPort = 10085) {
        return this.request(serverId, 'POST', `/api/xray/grpc/add-user?apiPort=${apiPort}`, {
            inboundTag, protocol, email, id, password,
        });
    }

    async xrayGrpcRemoveUser(serverId, { inboundTag, email }, apiPort = 10085) {
        return this.request(serverId, 'POST', `/api/xray/grpc/remove-user?apiPort=${apiPort}`, {
            inboundTag, email,
        });
    }

    async xrayWriteConfig(serverId, config) {
        return this.request(serverId, 'POST', '/api/xray/write-config', { config });
    }

    async xrayGetConfig(serverId) {
        return this.request(serverId, 'GET', '/api/xray/config');
    }

    // =================== Stub Site (nginx) ===================

    async stubSiteDeploy(serverId, { files, domain, internalPort }) {
        return this.request(serverId, 'POST', '/api/stub-site/deploy', {
            files, domain, internalPort,
        }, { timeout: 60000 });
    }

    async stubSiteStatus(serverId) {
        return this.request(serverId, 'GET', '/api/stub-site/status');
    }

    async stubSiteStop(serverId) {
        return this.request(serverId, 'POST', '/api/stub-site/stop');
    }

    async stubSiteRestart(serverId) {
        return this.request(serverId, 'POST', '/api/stub-site/restart');
    }

    async stubSiteRemove(serverId) {
        return this.request(serverId, 'DELETE', '/api/stub-site');
    }

    // =================== Stub Site SSL ===================

    async stubSiteObtainSSL(serverId, { domain, email, internalPort }) {
        return this.request(serverId, 'POST', '/api/stub-site/ssl/obtain', {
            domain, email, internalPort,
        }, { timeout: this.longTimeout });
    }

    async stubSiteSSLStatus(serverId, domain) {
        return this.request(serverId, 'GET', `/api/stub-site/ssl/status?domain=${encodeURIComponent(domain || '')}`);
    }

    async stubSiteRenewSSL(serverId, { domain, internalPort }) {
        return this.request(serverId, 'POST', '/api/stub-site/ssl/renew', {
            domain, internalPort,
        }, { timeout: 120000 });
    }
}

// Singleton
const nodeClient = new NodeClient();
module.exports = nodeClient;
