// SSH-менеджер — только для bootstrap (установка Docker + агента)
// Все остальные операции через vpn-node агент (HTTP API)
const { NodeSSH } = require('node-ssh');
const { queryOne } = require('../db/postgres');

class SSHManager {
    constructor() {
        this.connections = new Map();
        this.cleanupInterval = setInterval(() => this._cleanup(), 5 * 60 * 1000);
    }

    // Получить конфиг подключения из БД
    async _getServerConfig(serverId) {
        const server = await queryOne(
            'SELECT * FROM servers WHERE id = $1', [serverId]
        );
        if (!server) throw new Error(`Сервер #${serverId} не найден`);
        return server;
    }

    // Подключиться к серверу по SSH
    async connect(serverId) {
        const existing = this.connections.get(serverId);
        if (existing && existing.ssh.isConnected()) {
            existing.lastUsed = new Date();
            return existing.ssh;
        }

        const server = await this._getServerConfig(serverId);

        const ssh = new NodeSSH();
        const config = {
            host: server.ipv6 || server.ipv4 || server.host,
            port: server.ssh_port || 22,
            username: server.ssh_user || 'root',
            readyTimeout: 15000,
        };

        if (server.ssh_auth_type === 'key' && server.ssh_key) {
            config.privateKey = server.ssh_key;
            if (server.ssh_key_passphrase) config.passphrase = server.ssh_key_passphrase;
        } else if (server.ssh_password) {
            config.password = server.ssh_password;
        } else {
            config.privateKeyPath = '/root/.ssh/id_rsa';
        }

        try {
            await ssh.connect(config);
            this.connections.set(serverId, { ssh, lastUsed: new Date() });
            console.log(`[SSH] Подключено к серверу #${serverId} (${server.name})`);
            return ssh;
        } catch (err) {
            console.error(`[SSH] Ошибка подключения к #${serverId}:`, err.message);
            throw err;
        }
    }

    // Проверить подключение к серверу
    async testConnection(serverConfig) {
        const ssh = new NodeSSH();
        const config = {
            host: serverConfig.ipv6 || serverConfig.ipv4 || serverConfig.host,
            port: serverConfig.ssh_port || 22,
            username: serverConfig.ssh_user || 'root',
            readyTimeout: 10000,
        };

        if (serverConfig.ssh_auth_type === 'key' && serverConfig.ssh_key) {
            config.privateKey = serverConfig.ssh_key;
            if (serverConfig.ssh_key_passphrase) config.passphrase = serverConfig.ssh_key_passphrase;
        } else if (serverConfig.ssh_password) {
            config.password = serverConfig.ssh_password;
        } else {
            config.privateKeyPath = '/root/.ssh/id_rsa';
        }

        try {
            await ssh.connect(config);
            const uptime = await ssh.execCommand('uptime -s');
            const hostname = await ssh.execCommand('hostname');
            ssh.dispose();
            return {
                connected: true,
                uptime: uptime.stdout.trim(),
                hostname: hostname.stdout.trim(),
            };
        } catch (err) {
            return { connected: false, error: err.message };
        }
    }

    // Отключиться от сервера
    disconnect(serverId) {
        const conn = this.connections.get(serverId);
        if (conn) {
            conn.ssh.dispose();
            this.connections.delete(serverId);
        }
    }

    // Очистка неиспользуемых подключений (> 10 мин)
    _cleanup() {
        const now = Date.now();
        for (const [id, conn] of this.connections) {
            if (now - conn.lastUsed.getTime() > 10 * 60 * 1000) {
                conn.ssh.dispose();
                this.connections.delete(id);
                console.log(`[SSH] Закрыто неиспользуемое подключение к #${id}`);
            }
        }
    }
}

// Singleton
const sshManager = new SSHManager();
module.exports = sshManager;
