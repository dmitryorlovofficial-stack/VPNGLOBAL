// Маршруты дашборда (PostgreSQL)
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../auth/jwt');
const { queryOne, queryAll } = require('../db/postgres');
const monitorService = require('../services/monitor');

router.use(authMiddleware);

// GET /api/dashboard
router.get('/', async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin';
        const stats = isAdmin
            ? await getDashboardStats()
            : await getUserDashboardStats(req.user.id);

        const result = { ...stats };

        if (isAdmin) {
            // Собираем статусы всех серверов (метрики обновляются мониторингом)
            const servers = await queryAll(
                "SELECT id, name, status, cpu_percent, ram_total_mb, ram_used_mb, disk_total_gb, disk_used_gb, uptime_seconds FROM servers ORDER BY id"
            );

            result.servers = { list: servers };
        }

        res.json(result);
    } catch (err) {
        console.error('[DASHBOARD]', err);
        res.status(500).json({ error: 'Ошибка получения данных дашборда' });
    }
});

// Общая статистика (admin)
async function getDashboardStats() {
    const totalClients = await queryOne('SELECT COUNT(*) as count FROM clients');
    const blockedClients = await queryOne('SELECT COUNT(*) as count FROM clients WHERE is_blocked = TRUE');

    const onlineThreshold = new Date(Date.now() - 15 * 1000).toISOString();
    const wgHandshakeThreshold = new Date(Date.now() - 150 * 1000).toISOString();
    const onlineClients = await queryOne(
        `SELECT COUNT(*) as count FROM clients
         WHERE is_blocked = FALSE AND (last_connected > $1 OR (last_connected IS NULL AND last_handshake > $2))`,
        [onlineThreshold, wgHandshakeThreshold]
    );

    const traffic = await queryOne(
        'SELECT COALESCE(SUM(upload_bytes), 0) as upload, COALESCE(SUM(download_bytes), 0) as download FROM clients'
    );

    const today = new Date().toISOString().split('T')[0];
    const todayTraffic = await queryOne(
        `SELECT COALESCE(SUM(rx_bytes), 0) as rx, COALESCE(SUM(tx_bytes), 0) as tx
         FROM traffic_history WHERE recorded_at >= $1`,
        [today + 'T00:00:00']
    );

    const totalServers = await queryOne('SELECT COUNT(*) as count FROM servers');

    return {
        clients: {
            total: parseInt(totalClients.count),
            online: parseInt(onlineClients.count),
            blocked: parseInt(blockedClients.count),
        },
        traffic: {
            totalUpload: parseInt(traffic.upload),
            totalDownload: parseInt(traffic.download),
            todayRx: parseInt(todayTraffic.rx),
            todayTx: parseInt(todayTraffic.tx),
        },
        serversCount: parseInt(totalServers.count),
    };
}

// Статистика для обычного пользователя
async function getUserDashboardStats(ownerId) {
    const totalClients = await queryOne('SELECT COUNT(*) as count FROM clients WHERE owner_id = $1', [ownerId]);
    const blockedClients = await queryOne('SELECT COUNT(*) as count FROM clients WHERE is_blocked = TRUE AND owner_id = $1', [ownerId]);

    const onlineThreshold = new Date(Date.now() - 15 * 1000).toISOString();
    const wgHandshakeThreshold = new Date(Date.now() - 150 * 1000).toISOString();
    const onlineClients = await queryOne(
        `SELECT COUNT(*) as count FROM clients
         WHERE is_blocked = FALSE AND owner_id = $3 AND (last_connected > $1 OR (last_connected IS NULL AND last_handshake > $2))`,
        [onlineThreshold, wgHandshakeThreshold, ownerId]
    );

    const traffic = await queryOne(
        'SELECT COALESCE(SUM(upload_bytes), 0) as upload, COALESCE(SUM(download_bytes), 0) as download FROM clients WHERE owner_id = $1',
        [ownerId]
    );

    const today = new Date().toISOString().split('T')[0];
    const todayTraffic = await queryOne(
        `SELECT COALESCE(SUM(h.rx_bytes), 0) as rx, COALESCE(SUM(h.tx_bytes), 0) as tx
         FROM traffic_history h
         INNER JOIN clients c ON c.id = h.client_id
         WHERE h.recorded_at >= $1 AND c.owner_id = $2`,
        [today + 'T00:00:00', ownerId]
    );

    return {
        clients: {
            total: parseInt(totalClients.count),
            online: parseInt(onlineClients.count),
            blocked: parseInt(blockedClients.count),
        },
        traffic: {
            totalUpload: parseInt(traffic.upload),
            totalDownload: parseInt(traffic.download),
            todayRx: parseInt(todayTraffic.rx),
            todayTx: parseInt(todayTraffic.tx),
        },
    };
}

// GET /api/dashboard/traffic
router.get('/traffic', async (req, res) => {
    const { period, client_id } = req.query;
    const isAdmin = req.user.role === 'admin';

    if (!isAdmin && !client_id) {
        const clientIds = await queryAll('SELECT id FROM clients WHERE owner_id = $1', [req.user.id]);
        if (clientIds.length === 0) return res.json([]);
        const ids = clientIds.map(c => c.id);
        const data = await monitorService.getTrafficChartData(period || '24h', null, ids);
        return res.json(data);
    }

    const data = await monitorService.getTrafficChartData(period || '24h', client_id ? parseInt(client_id) : null);
    res.json(data);
});

module.exports = router;
