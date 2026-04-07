// Маршруты управления VPN-клиентами (PostgreSQL, мульти-протокол)
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { authMiddleware } = require('../auth/jwt');
const { query, queryOne, queryAll, transaction } = require('../db/postgres');
const xrayService = require('../services/xray');
const { generateQRPng, generateQRDataUrl } = require('../utils/qrcode');

const XRAY_PROTOCOLS = ['vless'];

router.use(authMiddleware);

// GET /api/clients
router.get('/', async (req, res) => {
    const { search, status, sort, order, page, limit, protocol: filterProto, group_id } = req.query;
    const isAdmin = req.user.role === 'admin';
    const params = [];
    const $ = (val) => { params.push(val); return `$${params.length}`; };

    let sql = isAdmin
        ? `SELECT c.*, a.username as owner_username, cg.name as client_group_name,
               (SELECT COUNT(*) FROM client_devices cd WHERE cd.sub_token = c.sub_token AND cd.is_revoked = FALSE AND cd.hwid NOT LIKE 'auto-%') as device_count
           FROM clients c LEFT JOIN admins a ON a.id = c.owner_id
           LEFT JOIN client_groups cg ON cg.id = c.client_group_id
           WHERE c.is_chain = FALSE`
        : `SELECT c.*, cg.name as client_group_name,
               (SELECT COUNT(*) FROM client_devices cd WHERE cd.sub_token = c.sub_token AND cd.is_revoked = FALSE AND cd.hwid NOT LIKE 'auto-%') as device_count
           FROM clients c
           LEFT JOIN client_groups cg ON cg.id = c.client_group_id
           WHERE c.owner_id = ${$(req.user.id)} AND c.is_chain = FALSE`;

    if (search) {
        const like = `%${search}%`;
        sql += ` AND (c.name ILIKE ${$(like)} OR c.ip_address ILIKE ${$(like)} OR c.note ILIKE ${$(like)})`;
    }

    // Фильтр по протоколу
    if (filterProto) {
        sql += ` AND c.protocol = ${$(filterProto)}`;
    }

    // Фильтр по группе клиентов
    if (group_id) {
        if (group_id === 'none') {
            sql += ' AND c.client_group_id IS NULL';
        } else {
            sql += ` AND c.client_group_id = ${$(parseInt(group_id))}`;
        }
    }

    if (status === 'blocked') {
        sql += ' AND c.is_blocked = TRUE';
    } else if (status === 'active') {
        sql += ' AND c.is_blocked = FALSE';
    } else if (status === 'online') {
        const onlineOt = new Date(Date.now() - 15 * 1000).toISOString();
        sql += ` AND c.is_blocked = FALSE AND c.last_connected > ${$(onlineOt)}`;
    }

    // Сортировка
    const validSorts = ['name', 'ip_address', 'created_at', 'upload_bytes', 'download_bytes', 'last_handshake', 'protocol'];
    const sortField = validSorts.includes(sort) ? sort : 'created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    const sortCol = `c.${sortField}`;

    // Подсчёт
    const countSql = `SELECT COUNT(*) as count FROM (${sql}) as _sub`;
    const countResult = await queryOne(countSql, params);
    const total = parseInt(countResult.count);

    sql += ` ORDER BY ${sortCol} ${sortOrder}`;

    // Пагинация
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * pageSize;
    sql += ` LIMIT ${$(pageSize)} OFFSET ${$(offset)}`;

    const clients = await queryAll(sql, params);

    // Пороги онлайн:
    // Сбор данных каждые 5 сек → порог 15с (3 пропущенных цикла = offline)
    const onlineThreshold = Date.now() - 15 * 1000;
    const enriched = clients.map(c => {
        return {
            ...c,
            is_online: !c.is_blocked && (
                c.last_connected && new Date(c.last_connected).getTime() > onlineThreshold
            ),
            total_traffic: (parseInt(c.upload_bytes) || 0) + (parseInt(c.download_bytes) || 0),
        };
    });

    res.json({
        clients: enriched,
        pagination: { page: pageNum, limit: pageSize, total, pages: Math.ceil(total / pageSize) },
    });
});

// POST /api/clients — Создание клиента (Xray)
// auto_all=true — автоматически создать клиентов для всех доступных протоколов
router.post('/', [
    body('name').isString().trim().notEmpty(),
    body('note').optional().isString(),
    body('dns').optional().isString(),
    body('server_id').optional().isInt(),
    body('protocol').optional().isString(),
    body('xray_inbound_id').optional().isInt(),
    body('client_group_id').optional().isInt(),
    body('auto_all').optional().isBoolean(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Некорректные данные', details: errors.array() });
    }

    // Проверка лимита
    if (req.user.role !== 'admin') {
        const user = await queryOne('SELECT max_vpn_clients FROM admins WHERE id = $1', [req.user.id]);
        const count = await queryOne('SELECT COUNT(*) as c FROM clients WHERE owner_id = $1', [req.user.id]);
        if (parseInt(count.c) >= user.max_vpn_clients) {
            return res.status(403).json({ error: `Достигнут лимит VPN-клиентов (${user.max_vpn_clients})` });
        }
    }

    const { name, note, dns, email, server_id, protocol, xray_inbound_id, client_group_id, auto_all } = req.body;

    try {
        // ==================== Авто-создание всех протоколов ====================
        if (auto_all) {
            const createdClients = [];
            const serversToRedeploy = new Set();
            // Один sub_token на всю подписку (все протоколы)
            const sharedSubToken = crypto.randomBytes(16).toString('hex');

            // Определяем доступные inbound'ы
            let entryInbounds = [];
            let serverGroupId = null;

            if (client_group_id) {
                const cg = await queryOne('SELECT server_group_id FROM client_groups WHERE id = $1', [client_group_id]);
                serverGroupId = cg?.server_group_id;
            }

            if (serverGroupId) {
                entryInbounds = await queryAll(`
                    SELECT xi.* FROM xray_inbounds xi
                    JOIN server_group_members sgm ON sgm.server_id = xi.server_id
                    WHERE sgm.server_group_id = $1 AND sgm.role = 'entry'
                      AND xi.tag NOT LIKE 'chain-%' AND xi.is_enabled = TRUE
                    ORDER BY xi.protocol, xi.port
                `, [serverGroupId]);
            } else {
                entryInbounds = await queryAll(`
                    SELECT xi.* FROM xray_inbounds xi
                    WHERE xi.tag NOT LIKE 'chain-%' AND xi.is_enabled = TRUE
                    ORDER BY xi.server_id, xi.protocol, xi.port
                `);
            }

            // --- VLESS ---
            const vlessInbound = entryInbounds.find(ib => ib.protocol === 'vless');
            if (vlessInbound) {
                const uuid = crypto.randomUUID();
                const cl = await queryOne(
                    `INSERT INTO clients (name, note, email, protocol, server_id, xray_inbound_id, xray_uuid, xray_email, owner_id, sub_token, client_group_id)
                     VALUES ($1, $2, $3, 'vless', $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
                    [name, note || null, email || null, vlessInbound.server_id, vlessInbound.id, uuid, `${name}@vpn`, req.user.id, sharedSubToken, client_group_id || null]
                );
                createdClients.push(cl);
                serversToRedeploy.add(vlessInbound.server_id);
            }

            // Деплоим Xray конфиги
            for (const sid of serversToRedeploy) {
                try { await xrayService.deployWithEntries(sid); } catch (err) {
                    console.error(`[CLIENTS] Ошибка деплоя #${sid}:`, err.message);
                }
            }

            if (createdClients.length === 0) {
                return res.status(400).json({ error: 'Не найдено доступных inbound\'ов или серверов' });
            }

            await query(
                `INSERT INTO logs (level, category, message, details) VALUES ('info', 'client', $1, $2)`,
                [`Авто-создание клиента: ${name} (${createdClients.map(c => c.protocol).join(', ')})`,
                 JSON.stringify({ ids: createdClients.map(c => c.id), by: req.user.username })]
            );

            return res.status(201).json(createdClients);
        }

        // ==================== Ручное создание — один протокол ====================
        const proto = protocol || 'vless';

        // ==================== Xray протоколы ====================
        if (XRAY_PROTOCOLS.includes(proto)) {
            if (!xray_inbound_id) {
                return res.status(400).json({ error: 'xray_inbound_id обязателен для Xray протоколов' });
            }

            const inbound = await queryOne('SELECT * FROM xray_inbounds WHERE id = $1', [xray_inbound_id]);
            if (!inbound) {
                return res.status(404).json({ error: 'Inbound не найден' });
            }

            const uuid = crypto.randomUUID();
            const xrayEmail = `${name}@vpn`;
            const subToken = crypto.randomBytes(16).toString('hex');

            const client = await queryOne(
                `INSERT INTO clients (name, note, email, protocol, server_id, xray_inbound_id, xray_uuid, xray_email, owner_id, sub_token, client_group_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 RETURNING *`,
                [name, note || null, email || null, inbound.protocol, inbound.server_id, xray_inbound_id, uuid, xrayEmail, req.user.id, subToken, client_group_id || null]
            );

            // Деплоим обновлённый конфиг на сервер (+ Entry-серверы)
            try {
                await xrayService.deployWithEntries(inbound.server_id);
            } catch (err) {
                console.error('[CLIENTS] Ошибка деплоя xray:', err.message);
            }

            await query(
                `INSERT INTO logs (level, category, message, details) VALUES ('info', 'client', $1, $2)`,
                [`Создан Xray клиент: ${name} (${inbound.protocol})`,
                 JSON.stringify({ id: client.id, protocol: inbound.protocol, inbound: inbound.tag, by: req.user.username })]
            );

            return res.status(201).json(client);
        }

        return res.status(400).json({ error: `Неизвестный протокол: ${proto}` });
    } catch (err) {
        console.error('[CLIENTS] Ошибка создания:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/clients/:id
router.get('/:id', param('id').isInt(), async (req, res) => {
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Клиент не найден' });
    if (req.user.role !== 'admin' && client.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа' });
    }

    const onlineThreshold = Date.now() - 15 * 1000;

    client.is_online = !client.is_blocked && (
        client.last_connected && new Date(client.last_connected).getTime() > onlineThreshold
    );
    client.total_traffic = (parseInt(client.upload_bytes) || 0) + (parseInt(client.download_bytes) || 0);
    res.json(client);
});

// PUT /api/clients/:id
router.put('/:id', [
    param('id').isInt(),
    body('name').optional().isString().trim(),
    body('note').optional().isString(),
    body('dns').optional().isString(),
], async (req, res) => {
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Клиент не найден' });
    if (req.user.role !== 'admin' && client.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа' });
    }

    const { name, note, dns, email } = req.body;
    const updated = await queryOne(
        `UPDATE clients SET
            name = COALESCE($1, name),
            note = COALESCE($2, note),
            dns = COALESCE($3, dns),
            email = COALESCE($4, email)
         WHERE id = $5 RETURNING *`,
        [name || null, note || null, dns || null, email !== undefined ? (email || null) : undefined, req.params.id]
    );

    // Если Xray клиент — обновляем email и деплоим
    if (XRAY_PROTOCOLS.includes(client.protocol) && name && name !== client.name) {
        await query(
            'UPDATE clients SET xray_email = $1 WHERE id = $2',
            [`${name}@vpn`, req.params.id]
        );
        if (client.xray_inbound_id) {
            const inbound = await queryOne('SELECT server_id FROM xray_inbounds WHERE id = $1', [client.xray_inbound_id]);
            if (inbound) {
                try { await xrayService.deployWithEntries(inbound.server_id); } catch {}
            }
        }
    }

    res.json(updated);
});

// DELETE /api/clients/:id
router.delete('/:id', param('id').isInt(), async (req, res) => {
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Клиент не найден' });
    if (req.user.role !== 'admin' && client.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа' });
    }

    // Xray — удаляем из конфига
    const serverId = client.xray_inbound_id
        ? (await queryOne('SELECT server_id FROM xray_inbounds WHERE id = $1', [client.xray_inbound_id]))?.server_id
        : null;

    await query('DELETE FROM clients WHERE id = $1', [req.params.id]);

    if (serverId) {
        try { await xrayService.deployWithEntries(serverId); } catch {}
    }

    await query(
        `INSERT INTO logs (level, category, message, details) VALUES ('info', 'client', $1, $2)`,
        [`Удалён клиент: ${client.name}`, JSON.stringify({ id: client.id, protocol: client.protocol })]
    );
    res.json({ success: true });
});

// POST /api/clients/:id/block
router.post('/:id/block', param('id').isInt(), async (req, res) => {
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Клиент не найден' });
    if (req.user.role !== 'admin' && client.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа' });
    }

    await query('UPDATE clients SET is_blocked = TRUE WHERE id = $1', [req.params.id]);

    // Обновляем конфиг (заблокированные не включаются)
    if (client.xray_inbound_id) {
        const inbound = await queryOne('SELECT server_id FROM xray_inbounds WHERE id = $1', [client.xray_inbound_id]);
        if (inbound) {
            try { await xrayService.deployWithEntries(inbound.server_id); } catch {}
        }
    }

    await query(
        `INSERT INTO logs (level, category, message) VALUES ('info', 'client', $1)`,
        [`Заблокирован клиент: ${client.name}`]
    );
    res.json({ success: true });
});

// POST /api/clients/:id/unblock
router.post('/:id/unblock', param('id').isInt(), async (req, res) => {
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Клиент не найден' });
    if (req.user.role !== 'admin' && client.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа' });
    }

    await query('UPDATE clients SET is_blocked = FALSE WHERE id = $1', [req.params.id]);

    // Обновляем конфиг (разблокированный peer добавляется обратно)
    if (client.xray_inbound_id) {
        const inbound = await queryOne('SELECT server_id FROM xray_inbounds WHERE id = $1', [client.xray_inbound_id]);
        if (inbound) {
            try { await xrayService.deployWithEntries(inbound.server_id); } catch {}
        }
    }

    await query(
        `INSERT INTO logs (level, category, message) VALUES ('info', 'client', $1)`,
        [`Разблокирован клиент: ${client.name}`]
    );
    res.json({ success: true });
});

// GET /api/clients/:id/config — Конфиг/share link клиента
router.get('/:id/config', param('id').isInt(), async (req, res) => {
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Клиент не найден' });
    if (req.user.role !== 'admin' && client.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа' });
    }

    try {
        const link = await xrayService.generateShareLink(client.id);
        res.type('text/plain').send(link);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/clients/:id/qr — QR-код конфига/share link
router.get('/:id/qr', param('id').isInt(), async (req, res) => {
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Клиент не найден' });
    if (req.user.role !== 'admin' && client.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа' });
    }

    let configOrLink;
    try {
        configOrLink = await xrayService.generateShareLink(client.id);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }

    if (req.query.format === 'dataurl') {
        const dataUrl = await generateQRDataUrl(configOrLink);
        return res.json({ qr: dataUrl, config: configOrLink, protocol: client.protocol });
    }
    const pngBuffer = await generateQRPng(configOrLink);
    res.type('image/png').send(pngBuffer);
});

// POST /api/clients/:id/reset-traffic
router.post('/:id/reset-traffic', param('id').isInt(), async (req, res) => {
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Клиент не найден' });
    if (req.user.role !== 'admin' && client.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа' });
    }
    await query('UPDATE clients SET upload_bytes = 0, download_bytes = 0 WHERE id = $1', [req.params.id]);
    await query(
        `INSERT INTO logs (level, category, message) VALUES ('info', 'client', $1)`,
        [`Сброшен трафик клиента: ${client.name}`]
    );
    res.json({ success: true });
});

// POST /api/clients/bulk-action
router.post('/bulk-action', [
    body('ids').isArray({ min: 1 }),
    body('action').isIn(['block', 'unblock', 'delete']),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Некорректные данные' });

    const { ids, action } = req.body;
    let count = 0;
    const xrayServersToRedeploy = new Set();

    for (const id of ids) {
        const client = await queryOne('SELECT * FROM clients WHERE id = $1', [id]);
        if (!client) continue;
        if (req.user.role !== 'admin' && client.owner_id !== req.user.id) continue;

        switch (action) {
            case 'block':
                await query('UPDATE clients SET is_blocked = TRUE WHERE id = $1', [id]);
                if (client.xray_inbound_id) {
                    const ib = await queryOne('SELECT server_id FROM xray_inbounds WHERE id = $1', [client.xray_inbound_id]);
                    if (ib) xrayServersToRedeploy.add(ib.server_id);
                }
                count++;
                break;
            case 'unblock':
                await query('UPDATE clients SET is_blocked = FALSE WHERE id = $1', [id]);
                if (client.xray_inbound_id) {
                    const ib = await queryOne('SELECT server_id FROM xray_inbounds WHERE id = $1', [client.xray_inbound_id]);
                    if (ib) xrayServersToRedeploy.add(ib.server_id);
                }
                count++;
                break;
            case 'delete':
                if (client.xray_inbound_id) {
                    const ib = await queryOne('SELECT server_id FROM xray_inbounds WHERE id = $1', [client.xray_inbound_id]);
                    if (ib) xrayServersToRedeploy.add(ib.server_id);
                }
                await query('DELETE FROM clients WHERE id = $1', [id]);
                count++;
                break;
        }
    }

    // Редеплой Xray конфигов (один раз на сервер)
    for (const serverId of xrayServersToRedeploy) {
        try { await xrayService.deployWithEntries(serverId); } catch {}
    }

    await query(
        `INSERT INTO logs (level, category, message, details) VALUES ('info', 'client', $1, $2)`,
        [`Массовое действие: ${action}`, JSON.stringify({ ids, count })]
    );
    res.json({ success: true, affected: count });
});


// ============================================================
// HWID Device Management
// ============================================================

// GET /api/clients/:id/devices — список устройств клиента
router.get('/:id/devices', param('id').isInt(), async (req, res) => {
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Клиент не найден' });
    if (req.user.role !== 'admin' && client.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа' });
    }

    const devices = await queryAll(
        `SELECT * FROM client_devices WHERE sub_token = $1 ORDER BY last_seen DESC`,
        [client.sub_token]
    );

    res.json({
        devices,
        device_limit: parseInt(client.device_limit) || 0,
        total: devices.length,
        active: devices.filter(d => !d.is_revoked && !d.hwid?.startsWith('auto-')).length,
    });
});

// POST /api/clients/:id/devices/:deviceId/revoke — отозвать устройство
router.post('/:id/devices/:deviceId/revoke', [param('id').isInt(), param('deviceId').isInt()], async (req, res) => {
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Клиент не найден' });
    if (req.user.role !== 'admin' && client.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа' });
    }

    await query(
        'UPDATE client_devices SET is_revoked = TRUE WHERE id = $1 AND sub_token = $2',
        [req.params.deviceId, client.sub_token]
    );
    res.json({ success: true });
});

// POST /api/clients/:id/devices/:deviceId/restore — восстановить устройство
router.post('/:id/devices/:deviceId/restore', [param('id').isInt(), param('deviceId').isInt()], async (req, res) => {
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Клиент не найден' });
    if (req.user.role !== 'admin' && client.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа' });
    }

    await query(
        'UPDATE client_devices SET is_revoked = FALSE WHERE id = $1 AND sub_token = $2',
        [req.params.deviceId, client.sub_token]
    );
    res.json({ success: true });
});

// DELETE /api/clients/:id/devices/:deviceId — удалить устройство
router.delete('/:id/devices/:deviceId', [param('id').isInt(), param('deviceId').isInt()], async (req, res) => {
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Клиент не найден' });
    if (req.user.role !== 'admin' && client.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа' });
    }

    await query(
        'DELETE FROM client_devices WHERE id = $1 AND sub_token = $2',
        [req.params.deviceId, client.sub_token]
    );
    res.json({ success: true });
});

// DELETE /api/clients/:id/devices — сбросить все устройства
router.delete('/:id/devices', param('id').isInt(), async (req, res) => {
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Клиент не найден' });
    if (req.user.role !== 'admin' && client.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Нет доступа' });
    }

    await query('DELETE FROM client_devices WHERE sub_token = $1', [client.sub_token]);
    res.json({ success: true });
});

// PUT /api/clients/:id/device-limit — установить лимит устройств
router.put('/:id/device-limit', [param('id').isInt(), body('device_limit').isInt({ min: 0 })], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Некорректные данные' });

    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Клиент не найден' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только для администраторов' });

    // Обновляем лимит для всех клиентов с тем же sub_token (группа подписки)
    await query(
        'UPDATE clients SET device_limit = $1 WHERE sub_token = $2',
        [req.body.device_limit, client.sub_token]
    );
    res.json({ success: true, device_limit: req.body.device_limit });
});

module.exports = router;
