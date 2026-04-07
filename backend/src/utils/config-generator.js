// Утилиты генерации конфигов и бэкапов (PostgreSQL)
const { queryAll, query, transaction } = require('../db/postgres');

// Генерация бэкапа
async function generateBackup() {
    const clients = await queryAll('SELECT * FROM clients');
    const settings = await queryAll('SELECT * FROM settings');
    const admins = await queryAll('SELECT id, username, totp_secret, role, max_vpn_clients, created_at FROM admins');
    const servers = await queryAll('SELECT * FROM servers');
    const serverLinks = await queryAll('SELECT * FROM server_links');

    return {
        version: '2.0',
        exportedAt: new Date().toISOString(),
        clients,
        settings: Object.fromEntries(settings.map(s => [s.key, s.value])),
        admins,
        servers,
        serverLinks,
    };
}

// Восстановление из бэкапа
async function restoreBackup(data) {
    if (!data.version || !data.clients) {
        throw new Error('Невалидный формат бэкапа');
    }

    await transaction(async (client) => {
        // Восстановление клиентов
        if (data.clients && data.clients.length > 0) {
            for (const c of data.clients) {
                await client.query(
                    `INSERT INTO clients (name, email, note, private_key, public_key, preshared_key,
                        ip_address, dns, traffic_limit_bytes, upload_bytes, download_bytes,
                        is_blocked, expires_at, created_at, last_handshake, protocol)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
                     ON CONFLICT DO NOTHING`,
                    [c.name, c.email, c.note, c.private_key, c.public_key,
                     c.preshared_key, c.ip_address, c.dns, c.traffic_limit_bytes,
                     c.upload_bytes, c.download_bytes, c.is_blocked, c.expires_at,
                     c.created_at, c.last_handshake, c.protocol || 'vless']
                );
            }
        }

        // Настройки
        if (data.settings) {
            for (const [key, value] of Object.entries(data.settings)) {
                await client.query(
                    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
                    [key, value]
                );
            }
        }

    });

    return { success: true, clientsRestored: data.clients?.length || 0 };
}

// Форматирование байтов
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = { generateBackup, restoreBackup, formatBytes };
