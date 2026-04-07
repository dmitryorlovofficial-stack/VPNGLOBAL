// Маршруты управления серверами
// SSH — только для тестирования подключения и bootstrap
// Все остальные операции через vpn-node агент (HTTP API)
const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { authMiddleware, adminOnly } = require('../auth/jwt');
const { query, queryOne, queryAll } = require('../db/postgres');
const sshManager = require('../services/ssh-manager');
const nodeClient = require('../services/node-client');
const bootstrap = require('../services/bootstrap');

router.use(authMiddleware);
router.use(adminOnly);

// GET /api/servers — Список всех серверов
router.get('/', async (req, res) => {
    try {
        const servers = await queryAll(`
            SELECT s.*,
                (SELECT COUNT(*) FROM clients WHERE server_id = s.id) as client_count,
                (SELECT COUNT(*) FROM server_links WHERE from_server_id = s.id OR to_server_id = s.id) as link_count
            FROM servers s
            ORDER BY s.created_at ASC
        `);

        // Протоколы для каждого сервера
        for (const server of servers) {
            server.protocols = await queryAll(
                'SELECT protocol, status, port FROM server_protocols WHERE server_id = $1',
                [server.id]
            );
        }

        res.json(servers);
    } catch (err) {
        console.error('[SERVERS]', err);
        res.status(500).json({ error: 'Ошибка получения списка серверов' });
    }
});

// POST /api/servers — Добавить сервер
router.post('/', [
    body('name').isString().trim().notEmpty(),
    body('host').isString().trim().notEmpty(),
    body('ssh_port').optional().isInt({ min: 1, max: 65535 }),
    body('ssh_user').optional().isString(),
    body('ssh_auth_type').optional().isIn(['password', 'key']),
    body('ssh_password').optional().isString(),
    body('ssh_key').optional().isString(),
    body('ssh_key_passphrase').optional().isString(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Некорректные данные', details: errors.array() });
    }

    const {
        name, host, ssh_port, ssh_user, description,
        ssh_auth_type, ssh_password, ssh_key, ssh_key_passphrase, domain
    } = req.body;

    try {
        const server = await queryOne(
            `INSERT INTO servers (name, description, host, domain, ssh_port, ssh_user,
                ssh_auth_type, ssh_password, ssh_key, ssh_key_passphrase, role, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'node','offline')
             RETURNING *`,
            [name, description || null, host, domain || null,
             ssh_port || 22, ssh_user || 'root', ssh_auth_type || 'password',
             ssh_password || null, ssh_key || null, ssh_key_passphrase || null]
        );

        await query(
            `INSERT INTO logs (level, category, server_id, message, details)
             VALUES ('info', 'server', $1, $2, $3)`,
            [server.id, `Добавлен сервер: ${name}`, JSON.stringify({ id: server.id, host })]
        );

        res.status(201).json(server);

        // Авто-провижн в фоне: deploy agent → scan → install Xray
        bootstrap.fullProvision(server.id).catch(err => {
            console.error(`[SERVERS] Авто-провижн #${server.id} ошибка:`, err.message);
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/servers/:id — Детали сервера
router.get('/:id', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });

    // Протоколы
    server.protocols = await queryAll(
        'SELECT * FROM server_protocols WHERE server_id = $1', [server.id]
    );

    // Связи
    server.links = await queryAll(
        `SELECT sl.*, s1.name as from_name, s2.name as to_name
         FROM server_links sl
         LEFT JOIN servers s1 ON s1.id = sl.from_server_id
         LEFT JOIN servers s2 ON s2.id = sl.to_server_id
         WHERE sl.from_server_id = $1 OR sl.to_server_id = $1`,
        [server.id]
    );

    // X-UI
    server.xui = await queryOne(
        'SELECT * FROM xui_instances WHERE server_id = $1', [server.id]
    );

    // Счётчики
    const cc = await queryOne('SELECT COUNT(*) as c FROM clients WHERE server_id = $1', [server.id]);
    server.client_count = parseInt(cc.c);

    res.json(server);
});

// PUT /api/servers/:id — Обновить сервер
router.put('/:id', param('id').isInt(), async (req, res) => {
    const existing = await queryOne('SELECT id FROM servers WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Сервер не найден' });

    // ipv4, ipv6, main_iface — заполняются автоматически через scan
    // role — устанавливается отдельно (по умолчанию 'node')
    const fields = ['name', 'description', 'host', 'domain', 'ssh_port', 'ssh_user',
                    'ssh_auth_type', 'ssh_password', 'ssh_key', 'ssh_key_passphrase', 'role'];
    const sets = [];
    const params = [];
    let idx = 1;

    for (const field of fields) {
        if (req.body[field] !== undefined) {
            sets.push(`${field} = $${idx++}`);
            params.push(req.body[field]);
        }
    }

    if (sets.length === 0) {
        return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const server = await queryOne(
        `UPDATE servers SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        params
    );

    // Сбрасываем SSH-подключение при смене credentials
    sshManager.disconnect(server.id);

    res.json(server);
});

// DELETE /api/servers/:id — Удалить сервер
router.delete('/:id', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });

    sshManager.disconnect(server.id);
    await query('DELETE FROM servers WHERE id = $1', [req.params.id]);

    await query(
        `INSERT INTO logs (level, category, message, details)
         VALUES ('warning', 'server', $1, $2)`,
        [`Удалён сервер: ${server.name}`, JSON.stringify({ id: server.id })]
    );

    res.json({ success: true });
});

// =================== SSH (только для тестирования) ===================

// POST /api/servers/:id/test — Проверить SSH-подключение
router.post('/:id/test', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });

    const result = await sshManager.testConnection(server);

    const newStatus = result.connected ? 'online' : 'offline';
    await query(
        'UPDATE servers SET status = $1, last_seen = CASE WHEN $2 THEN NOW() ELSE last_seen END WHERE id = $3',
        [newStatus, result.connected, server.id]
    );

    res.json(result);
});

// POST /api/servers/test-new — Проверить подключение к новому серверу (до добавления)
router.post('/test-new', [
    body('host').isString().trim().notEmpty(),
    body('ssh_port').optional().isInt(),
    body('ssh_user').optional().isString(),
    body('ssh_auth_type').optional().isIn(['password', 'key']),
    body('ssh_password').optional().isString(),
    body('ssh_key').optional().isString(),
    body('ssh_key_passphrase').optional().isString(),
], async (req, res) => {
    const result = await sshManager.testConnection(req.body);
    res.json(result);
});

// =================== Agent Bootstrap ===================

// POST /api/servers/:id/deploy-agent — Развернуть агента через SSH
router.post('/:id/deploy-agent', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });

    try {
        const result = await bootstrap.deployAgent(server.id);
        res.json(result);
    } catch (err) {
        console.error(`[SERVERS] Deploy agent error #${req.params.id}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/servers/:id/check-agent — Проверить состояние агента
router.post('/:id/check-agent', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });

    try {
        const result = await bootstrap.checkAgent(server.id);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/servers/:id/update-agent — Обновить агента
router.post('/:id/update-agent', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });

    try {
        const result = await bootstrap.updateAgent(server.id);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/servers/:id/remove-agent — Удалить агента
router.post('/:id/remove-agent', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });

    try {
        const result = await bootstrap.removeAgent(server.id);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =================== Через Агент (HTTP API) ===================

// POST /api/servers/:id/scan — Сканировать ПО через агента
router.post('/:id/scan', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });

    try {
        const scan = await nodeClient.getSystemInfo(server.id);

        await query(
            `UPDATE servers SET os_info = $1, kernel = $2,
             main_iface = COALESCE($3, main_iface),
             ipv4 = COALESCE($4, ipv4),
             ipv6 = COALESCE($5, ipv6),
             status = 'online', last_seen = NOW(), updated_at = NOW()
             WHERE id = $6`,
            [scan.os, scan.kernel, scan.mainIface || null,
             scan.ipv4 || null, scan.ipv6 || null, server.id]
        );

        if (scan.xray && scan.xray.installed) {
            await query(
                `INSERT INTO server_protocols (server_id, protocol, status, config)
                 VALUES ($1, 'xray', 'active', $2)
                 ON CONFLICT (server_id, protocol)
                 DO UPDATE SET status = 'active', config = $2`,
                [server.id, JSON.stringify({ version: scan.xray.version })]
            );
        }

        res.json(scan);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/servers/:id/metrics — Текущие метрики через агента
router.get('/:id/metrics', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });

    // Если агент не установлен — возвращаем данные из БД
    if (server.agent_status !== 'active') {
        return res.json({
            cpu: server.cpu_percent || 0,
            ram: { total: server.ram_total_mb || 0, used: server.ram_used_mb || 0 },
            disk: { total: server.disk_total_gb || 0, used: server.disk_used_gb || 0 },
            uptime: server.uptime_seconds || 0,
            source: 'db',
        });
    }

    try {
        const metrics = await nodeClient.getMetrics(server.id);
        res.json(metrics);
    } catch (err) {
        // Fallback на данные из БД при ошибке агента
        res.json({
            cpu: server.cpu_percent || 0,
            ram: { total: server.ram_total_mb || 0, used: server.ram_used_mb || 0 },
            disk: { total: server.disk_total_gb || 0, used: server.disk_used_gb || 0 },
            uptime: server.uptime_seconds || 0,
            source: 'db',
            agentError: err.message,
        });
    }
});

// POST /api/servers/:id/reboot — Перезагрузка сервера через агента
router.post('/:id/reboot', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });

    try {
        const result = await nodeClient.reboot(server.id);
        await query(
            `INSERT INTO logs (level, category, server_id, message)
             VALUES ('warning', 'server', $1, $2)`,
            [server.id, `Перезагрузка сервера: ${server.name}`]
        );
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/servers/:id/restart-agent — Перезапуск Docker-контейнера агента через SSH
router.post('/:id/restart-agent', param('id').isInt(), async (req, res) => {
    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [req.params.id]);
    if (!server) return res.status(404).json({ error: 'Сервер не найден' });

    try {
        const ssh = await sshManager.connect(server.id);
        const exec = async (cmd) => {
            const r = await ssh.execCommand(cmd, { cwd: '/' });
            return r.stdout.trim();
        };

        // Проверяем статус контейнера
        const status = await exec('docker inspect -f "{{.State.Status}}" vpn-node-agent 2>/dev/null');

        if (!status) {
            return res.status(400).json({ error: 'Контейнер агента не найден. Используйте "Установить агент".' });
        }

        // Перезапускаем
        await exec('docker restart vpn-node-agent');

        // Ждём старта
        await new Promise(r => setTimeout(r, 3000));

        // Проверяем health
        let healthy = false;
        try {
            const health = await nodeClient.healthCheck(server.id);
            healthy = health && health.status === 'ok';
        } catch {}

        if (healthy) {
            await query(
                `UPDATE servers SET status = 'online', agent_status = 'active', last_seen = NOW(), updated_at = NOW() WHERE id = $1`,
                [server.id]
            );
        }

        await query(
            `INSERT INTO logs (level, category, server_id, message) VALUES ('info', 'agent', $1, $2)`,
            [server.id, `Перезапуск агента на ${server.name} (healthy: ${healthy})`]
        );

        res.json({ success: true, healthy, containerStatus: status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
