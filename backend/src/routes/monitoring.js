// Маршруты мониторинга серверов — полный API
// Все данные через vpn-node агент (HTTP API) + БД
const express = require('express');
const router = express.Router();
const { param, query: qv } = require('express-validator');
const { authMiddleware, adminOnly } = require('../auth/jwt');
const { query, queryOne, queryAll } = require('../db/postgres');
const nodeClient = require('../services/node-client');
const monitorService = require('../services/monitor');

router.use(authMiddleware);
router.use(adminOnly);

// =================== Обзор всех серверов ===================

// GET /api/monitoring/overview — Все серверы с метриками и статусами сервисов
router.get('/overview', async (req, res) => {
    try {
        const servers = await queryAll(`
            SELECT s.id, s.name, s.host, s.ipv4, s.ipv6, s.role, s.status,
                   s.agent_status, s.agent_port,
                   s.cpu_percent, s.ram_total_mb, s.ram_used_mb,
                   s.disk_total_gb, s.disk_used_gb, s.uptime_seconds,
                   s.os_info, s.kernel, s.main_iface,
                   s.last_seen, s.updated_at
            FROM servers s ORDER BY s.id
        `);

        // Для каждого сервера подтягиваем протоколы, клиентов и линки
        for (const srv of servers) {
            srv.protocols = await queryAll(
                'SELECT protocol, status, port FROM server_protocols WHERE server_id = $1',
                [srv.id]
            );

            const cc = await queryOne(
                'SELECT COUNT(*) as c FROM clients WHERE server_id = $1', [srv.id]
            );
            srv.client_count = parseInt(cc.c);

            const lc = await queryOne(
                'SELECT COUNT(*) as c FROM server_links WHERE (from_server_id = $1 OR to_server_id = $1) AND status = \'active\'',
                [srv.id]
            );
            srv.active_links = parseInt(lc.c);
        }

        // Сводная статистика
        const totalServers = servers.length;
        const onlineServers = servers.filter(s => s.status === 'online').length;
        const agentsActive = servers.filter(s => s.agent_status === 'active').length;
        const totalClients = servers.reduce((sum, s) => sum + s.client_count, 0);

        const avgCpu = onlineServers > 0
            ? Math.round(servers.filter(s => s.status === 'online').reduce((sum, s) => sum + (s.cpu_percent || 0), 0) / onlineServers)
            : 0;

        res.json({
            summary: {
                totalServers,
                onlineServers,
                offlineServers: totalServers - onlineServers,
                agentsActive,
                agentsTotal: servers.filter(s => s.agent_status !== 'none').length,
                totalClients,
                avgCpu,
            },
            servers,
        });
    } catch (err) {
        console.error('[MONITORING]', err);
        res.status(500).json({ error: 'Ошибка получения обзора' });
    }
});

// =================== Метрики конкретного сервера ===================

// GET /api/monitoring/servers/:id/metrics — Живые метрики с агента
router.get('/servers/:id/metrics', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT id, name, agent_status FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });

    try {
        const metrics = await nodeClient.getMetrics(server.id);
        res.json({ serverId: server.id, name: server.name, live: true, ...metrics });
    } catch (err) {
        // Fallback на метрики из БД
        const dbMetrics = await queryOne(
            `SELECT cpu_percent, ram_total_mb, ram_used_mb, disk_total_gb, disk_used_gb,
                    uptime_seconds, last_seen, updated_at
             FROM servers WHERE id = $1`, [server.id]
        );
        res.json({
            serverId: server.id, name: server.name, live: false,
            cpu: dbMetrics.cpu_percent,
            ram: { total: (dbMetrics.ram_total_mb || 0) * 1024 * 1024, used: (dbMetrics.ram_used_mb || 0) * 1024 * 1024 },
            disk: { total: (dbMetrics.disk_total_gb || 0) * 1024 * 1024 * 1024, used: (dbMetrics.disk_used_gb || 0) * 1024 * 1024 * 1024 },
            uptime: dbMetrics.uptime_seconds,
            lastSeen: dbMetrics.last_seen,
            error: err.message,
        });
    }
});

// =================== Статус сервисов ===================

// GET /api/monitoring/servers/:id/services — Статусы WG + Xray + Agent
router.get('/servers/:id/services', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });

    const result = {
        serverId: server.id,
        name: server.name,
        agent: { status: server.agent_status, port: server.agent_port },
        wireguard: { installed: false, running: false },
        xray: { installed: false, running: false },
    };

    if (server.agent_status !== 'active') {
        return res.json(result);
    }

    // WireGuard
    try {
        const wg = await nodeClient.wgStatus(server.id);
        result.wireguard = {
            installed: wg.installed !== false,
            running: wg.running !== false,
            version: wg.version,
            listenPort: wg.listenPort,
            peersCount: wg.peersCount || 0,
            publicKey: wg.publicKey,
        };
    } catch (err) {
        result.wireguard.error = err.message;
    }

    // Xray
    try {
        const xr = await nodeClient.xrayStatus(server.id);
        result.xray = {
            installed: xr.installed !== false,
            running: xr.running !== false,
            version: xr.version,
            pid: xr.pid,
        };
    } catch (err) {
        result.xray.error = err.message;
    }

    // Agent health
    try {
        const health = await nodeClient.healthCheck(server.id);
        result.agent.healthy = true;
        result.agent.agentVersion = health.agentVersion;
        result.agent.uptime = health.uptime;
        result.agent.hostname = health.hostname;
    } catch (err) {
        result.agent.healthy = false;
        result.agent.error = err.message;
    }

    res.json(result);
});

// =================== Здоровье инфраструктуры ===================

// GET /api/monitoring/health — Туннели, сервисы, проблемы
router.get('/health', async (req, res) => {
    try {
        // Туннели
        const tunnels = await queryAll(`
            SELECT sl.*, s1.name as from_name, s2.name as to_name
            FROM server_links sl
            LEFT JOIN servers s1 ON s1.id = sl.from_server_id
            LEFT JOIN servers s2 ON s2.id = sl.to_server_id
            ORDER BY sl.id
        `);

        // Серверы с проблемами
        const problems = [];

        const servers = await queryAll('SELECT id, name, status, agent_status FROM servers');
        for (const srv of servers) {
            if (srv.status === 'offline') {
                problems.push({ severity: 'error', server: srv.name, message: 'Сервер офлайн' });
            }
            // agent_status 'unreachable' больше не используется
            if (srv.agent_status === 'error') {
                problems.push({ severity: 'error', server: srv.name, message: 'Ошибка агента' });
            }
            if (srv.agent_status === 'none') {
                problems.push({ severity: 'info', server: srv.name, message: 'Агент не установлен' });
            }
        }

        // Туннели с проблемами
        for (const t of tunnels) {
            if (t.status === 'error') {
                problems.push({
                    severity: 'error',
                    server: `${t.from_name} → ${t.to_name}`,
                    message: `Туннель ${t.link_type.toUpperCase()} в ошибке`,
                });
            }
        }

        res.json({
            tunnels,
            problems: problems.sort((a, b) => {
                const order = { error: 0, warning: 1, info: 2 };
                return (order[a.severity] || 3) - (order[b.severity] || 3);
            }),
            healthy: problems.filter(p => p.severity === 'error').length === 0,
        });
    } catch (err) {
        console.error('[MONITORING]', err);
        res.status(500).json({ error: 'Ошибка проверки здоровья' });
    }
});

// =================== Алерты / последние проблемы ===================

// GET /api/monitoring/alerts?limit=20 — Последние алерты из логов
router.get('/alerts', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const alerts = await queryAll(
            `SELECT id, level, category, server_id, message, details, created_at
             FROM logs
             WHERE level IN ('warning', 'error')
             ORDER BY created_at DESC LIMIT $1`,
            [limit]
        );

        res.json(alerts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =================== Принудительное обновление ===================

// POST /api/monitoring/refresh — Обновить метрики всех серверов
router.post('/refresh', async (req, res) => {
    try {
        const servers = await queryAll("SELECT id, name FROM servers WHERE agent_status = 'active'");
        const results = [];

        await Promise.allSettled(
            servers.map(async (srv) => {
                try {
                    const metrics = await nodeClient.getMetrics(srv.id);
                    const ramTotalMb = Math.round((metrics.ram?.total || 0) / 1024 / 1024);
                    const ramUsedMb = Math.round((metrics.ram?.used || 0) / 1024 / 1024);
                    const diskTotalGb = Math.round((metrics.disk?.total || 0) / 1024 / 1024 / 1024);
                    const diskUsedGb = Math.round((metrics.disk?.used || 0) / 1024 / 1024 / 1024);

                    await query(
                        `UPDATE servers SET
                            status = 'online', last_seen = NOW(), updated_at = NOW(),
                            cpu_percent = $1, ram_total_mb = $2, ram_used_mb = $3,
                            disk_total_gb = $4, disk_used_gb = $5, uptime_seconds = $6
                         WHERE id = $7`,
                        [metrics.cpu, ramTotalMb, ramUsedMb, diskTotalGb, diskUsedGb, metrics.uptime || 0, srv.id]
                    );

                    results.push({ id: srv.id, name: srv.name, ok: true });
                } catch (err) {
                    // Refresh не меняет status — за это отвечает cron мониторинг с grace period
                    // Только обновляем updated_at
                    await query("UPDATE servers SET updated_at = NOW() WHERE id = $1", [srv.id]);
                    results.push({ id: srv.id, name: srv.name, ok: false, error: err.message });
                }
            })
        );

        res.json({ refreshed: results.filter(r => r.ok).length, total: servers.length, results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =================== Трафик ===================

// GET /api/monitoring/traffic?period=24h&server_id=1 — График трафика
router.get('/traffic', async (req, res) => {
    try {
        const { period, server_id } = req.query;

        if (server_id) {
            // Трафик по серверу — берём client_ids этого сервера
            const clientIds = await queryAll('SELECT id FROM clients WHERE server_id = $1', [parseInt(server_id)]);
            if (clientIds.length === 0) return res.json([]);
            const ids = clientIds.map(c => c.id);
            const data = await monitorService.getTrafficChartData(period || '24h', null, ids);
            return res.json(data);
        }

        // Общий трафик
        const data = await monitorService.getTrafficChartData(period || '24h');
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =================== Управление сервисами ===================

// POST /api/monitoring/servers/:id/restart-service — Перезапуск сервиса
router.post('/servers/:id/restart-service', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT id, name, agent_status FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });
    if (server.agent_status !== 'active') return res.status(400).json({ error: 'Агент не активен' });

    const { service } = req.body;
    if (!['wireguard', 'xray'].includes(service)) {
        return res.status(400).json({ error: 'Неизвестный сервис. Допустимо: wireguard, xray' });
    }

    try {
        let result;
        if (service === 'wireguard') {
            // WG теперь через Xray WG inbound — редеплоим Xray
            const xrayService = require('../services/xray');
            result = await xrayService.deployConfig(server.id, { force: true });
        } else {
            result = await nodeClient.xrayRestart(server.id);
        }

        await query(
            `INSERT INTO logs (level, category, server_id, message)
             VALUES ('info', 'server', $1, $2)`,
            [server.id, `Перезапущен ${service} на ${server.name}`]
        );

        res.json({ ok: true, service, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/monitoring/servers/:id/stop-service — Остановка сервиса
router.post('/servers/:id/stop-service', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT id, name, agent_status FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });
    if (server.agent_status !== 'active') return res.status(400).json({ error: 'Агент не активен' });

    const { service } = req.body;
    if (service !== 'xray') {
        return res.status(400).json({ error: 'Остановка поддерживается только для xray' });
    }

    try {
        const result = await nodeClient.xrayStop(server.id);
        await query(
            `INSERT INTO logs (level, category, server_id, message)
             VALUES ('warning', 'server', $1, $2)`,
            [server.id, `Остановлен ${service} на ${server.name}`]
        );

        res.json({ ok: true, service, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/monitoring/servers/:id/agent-health — Подробный health агента
router.get('/servers/:id/agent-health', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT id, name, agent_status, agent_port FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });

    try {
        const health = await nodeClient.healthCheck(server.id);
        // Обновляем статус в БД если был unreachable
        if (server.agent_status !== 'active') {
            await query("UPDATE servers SET agent_status = 'active' WHERE id = $1", [server.id]);
        }
        res.json({ ok: true, ...health });
    } catch (err) {
        // Не меняем agent_status — серверы считаются активными
        res.json({ ok: false, error: err.message });
    }
});

// =================== Логи и диагностика сервера ===================

// GET /api/monitoring/servers/:id/logs?lines=100&service=xray — Системные логи
router.get('/servers/:id/logs', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT id, name, agent_status FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });
    if (server.agent_status !== 'active') return res.status(400).json({ error: 'Агент не активен' });

    try {
        const { lines, service } = req.query;
        const result = await nodeClient.getSystemLogs(server.id, parseInt(lines) || 100, service || null);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/monitoring/servers/:id/connections — Сетевые подключения
router.get('/servers/:id/connections', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT id, name, agent_status FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });
    if (server.agent_status !== 'active') return res.status(400).json({ error: 'Агент не активен' });

    try {
        const result = await nodeClient.getConnections(server.id);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/monitoring/servers/:id/processes — Топ процессов
router.get('/servers/:id/processes', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT id, name, agent_status FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });
    if (server.agent_status !== 'active') return res.status(400).json({ error: 'Агент не активен' });

    try {
        const result = await nodeClient.getProcesses(server.id);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
