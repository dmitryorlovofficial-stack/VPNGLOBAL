// Сервис WireGuard — ключи, IP-аллокация, клиентские конфиги
// WG протокол обрабатывается Xray WireGuard inbound (не kernel wg0)
const { queryOne, queryAll, query } = require('../db/postgres');
const nodeClient = require('./node-client');

// Генерация ключей WireGuard через агента
async function generateKeyPair(serverId) {
    const keys = await nodeClient.wgKeygen(serverId);
    return {
        privateKey: keys.privateKey.trim(),
        publicKey: keys.publicKey.trim(),
        presharedKey: keys.presharedKey.trim(),
    };
}

// Следующий свободный IP
async function getNextIP() {
    const subnet = process.env.WG0_SUBNET || '10.20.20';
    const used = await queryAll('SELECT ip_address FROM clients');
    const usedIPs = used.map(c => c.ip_address);

    for (let i = 2; i <= 254; i++) {
        const ip = `${subnet}.${i}`;
        if (!usedIPs.includes(ip)) return ip;
    }
    throw new Error('Нет свободных IP-адресов в подсети');
}

// Получить или создать общие WG-ключи (хранятся в settings)
async function getOrCreateMasterKeys(serverId) {
    const rows = await queryAll('SELECT key, value FROM settings WHERE key IN ($1, $2)',
        ['wg_master_private_key', 'wg_master_public_key']);
    const s = {};
    rows.forEach(r => { s[r.key] = r.value; });

    if (s.wg_master_private_key && s.wg_master_public_key) {
        return { privateKey: s.wg_master_private_key, publicKey: s.wg_master_public_key };
    }

    // Генерируем новые мастер-ключи через агент
    const keys = await nodeClient.wgKeygen(serverId);
    const privateKey = keys.privateKey.trim();
    const publicKey = keys.publicKey.trim();

    await query(
        "INSERT INTO settings (key, value) VALUES ('wg_master_private_key', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
        [privateKey]
    );
    await query(
        "INSERT INTO settings (key, value) VALUES ('wg_master_public_key', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
        [publicKey]
    );

    console.log('[WG] Созданы общие мастер-ключи WireGuard');
    return { privateKey, publicKey };
}

// Все серверы с активным WireGuard
async function getAllWgServerIds() {
    const rows = await queryAll(
        `SELECT DISTINCT s.id FROM servers s
         WHERE s.agent_status = 'active' AND (
             EXISTS (SELECT 1 FROM server_protocols sp WHERE sp.server_id = s.id AND sp.protocol = 'wireguard' AND sp.status = 'active')
             OR EXISTS (SELECT 1 FROM clients c WHERE c.server_id = s.id AND c.protocol = 'wireguard' AND c.is_chain = FALSE)
         )`
    );
    return rows.map(r => r.id);
}

// Публичный ключ сервера (из мастер-ключей)
async function getServerPublicKey(serverId) {
    const masterPub = await queryOne("SELECT value FROM settings WHERE key = 'wg_master_public_key'");
    if (masterPub && masterPub.value) return masterPub.value.trim();
    // Fallback: создаём ключи
    const keys = await getOrCreateMasterKeys(serverId);
    return keys.publicKey;
}

// Генерация конфига клиента
async function generateClientConfig(client) {
    const rows = await queryAll('SELECT key, value FROM settings');
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });

    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [client.server_id]);
    const serverPublicKey = await getServerPublicKey(client.server_id);

    const serverIp = server?.wg_domain || server?.domain || server?.ipv4 || server?.host || '0.0.0.0';
    const wgPort = settings.wg0_port || process.env.WG0_PORT || '41920';
    const endpoint = `${serverIp}:${wgPort}`;
    const dns = client.dns || settings.client_dns || '1.1.1.1, 8.8.8.8';
    const mtu = settings.mtu || '1420';
    const keepalive = settings.keepalive || '25';

    return `[Interface]
# ${client.name}
PrivateKey = ${client.private_key}
Address = ${client.ip_address}/24
DNS = ${dns}
MTU = ${mtu}

[Peer]
PublicKey = ${serverPublicKey}
PresharedKey = ${client.preshared_key}
Endpoint = ${endpoint}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = ${keepalive}
`;
}

/**
 * Регистрация WG на сервере (только БД, kernel WG не используется).
 * Xray deployConfig() сам добавляет WG inbound с peers.
 */
async function deployWgConfig(serverId) {
    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [serverId]);
    if (!server) throw new Error('Сервер не найден');

    const rows = await queryAll('SELECT key, value FROM settings');
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });

    const wgPort = parseInt(settings.wg0_port || process.env.WG0_PORT || '41920');
    const subnet = settings.wg0_subnet || process.env.WG0_SUBNET || '10.20.20';
    const subnetCIDR = `${subnet}.0/24`;
    const mainIface = server.main_iface || 'eth0';
    const masterKeys = await getOrCreateMasterKeys(serverId);

    const peersCount = (await queryAll(
        "SELECT 1 FROM clients WHERE protocol = 'wireguard' AND is_chain = FALSE AND is_blocked = FALSE"
    )).length;

    await query(
        `INSERT INTO server_protocols (server_id, protocol, status, port, config)
         VALUES ($1, 'wireguard', 'active', $2, $3)
         ON CONFLICT (server_id, protocol)
         DO UPDATE SET status = 'active', port = $2, config = $3`,
        [serverId, wgPort, JSON.stringify({
            publicKey: masterKeys.publicKey,
            subnet: subnetCIDR,
            mainIface,
        })]
    );

    return { success: true, publicKey: masterKeys.publicKey, peersCount, port: wgPort };
}

// Регистрация WG на всех серверах
async function deployWgConfigToAll() {
    const serverIds = await getAllWgServerIds();
    const results = [];
    for (const sid of serverIds) {
        try {
            await deployWgConfig(sid);
            results.push({ serverId: sid, ok: true });
        } catch (err) {
            console.warn(`[WG] deployWgConfig failed on #${sid}:`, err.message);
            results.push({ serverId: sid, ok: false, error: err.message });
        }
    }
    return results;
}

async function provisionWireGuard(serverId) {
    return deployWgConfig(serverId);
}

// Статус WireGuard на сервере (из БД)
async function getWireGuardStatus(serverId) {
    const proto = await queryOne(
        "SELECT * FROM server_protocols WHERE server_id = $1 AND protocol = 'wireguard'",
        [serverId]
    );

    let config = proto?.config || {};
    if (typeof config === 'string') {
        try { config = JSON.parse(config); } catch { config = {}; }
    }

    const peers = await queryAll(
        "SELECT 1 FROM clients WHERE server_id = $1 AND protocol = 'wireguard' AND is_chain = FALSE AND is_blocked = FALSE",
        [serverId]
    );

    return {
        installed: !!proto,
        running: proto?.status === 'active',
        publicKey: config.publicKey || '',
        listenPort: proto?.port || null,
        peersCount: peers.length,
        subnet: config.subnet || null,
        configInDb: !!proto,
    };
}

module.exports = {
    generateKeyPair,
    getNextIP,
    getServerPublicKey,
    getOrCreateMasterKeys,
    getAllWgServerIds,
    generateClientConfig,
    provisionWireGuard,
    deployWgConfig,
    deployWgConfigToAll,
    getWireGuardStatus,
};
