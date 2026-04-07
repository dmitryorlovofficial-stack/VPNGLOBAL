// Маршруты управления Xray-core
const express = require('express');
const router = express.Router();
const { body, param, query: queryValidator, validationResult } = require('express-validator');
const { authMiddleware } = require('../auth/jwt');
const xrayService = require('../services/xray');

router.use(authMiddleware);

// Только админ может управлять Xray
function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Только для администраторов' });
    }
    next();
}

router.use(adminOnly);

// ============================================================
// Управление Xray на серверах
// ============================================================

// POST /api/xray/servers/:id/install — Установить Xray
router.post('/servers/:id/install', param('id').isInt(), async (req, res) => {
    try {
        const result = await xrayService.installXray(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        console.error('[XRAY API] Install error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/xray/servers/:id/uninstall — Удалить Xray
router.post('/servers/:id/uninstall', param('id').isInt(), async (req, res) => {
    try {
        const result = await xrayService.uninstallXray(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/xray/servers/:id/status — Статус Xray
router.get('/servers/:id/status', param('id').isInt(), async (req, res) => {
    try {
        const status = await xrayService.getXrayStatus(parseInt(req.params.id));
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/xray/servers/:id/restart — Перезапустить Xray
router.post('/servers/:id/restart', param('id').isInt(), async (req, res) => {
    try {
        const result = await xrayService.restartXray(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/xray/servers/:id/stop — Остановить Xray
router.post('/servers/:id/stop', param('id').isInt(), async (req, res) => {
    try {
        const result = await xrayService.stopXray(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/xray/servers/:id/deploy-config — Деплой конфига
router.post('/servers/:id/deploy-config', param('id').isInt(), async (req, res) => {
    try {
        const force = req.body?.force === true || req.query.force === '1';
        const result = await xrayService.deployConfig(parseInt(req.params.id), { force });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/xray/servers/:id/config — Посмотреть текущий конфиг
router.get('/servers/:id/config', param('id').isInt(), async (req, res) => {
    try {
        const config = await xrayService.buildXrayConfig(parseInt(req.params.id));
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/xray/servers/:id/reality-keys — Сгенерировать Reality ключи
router.post('/servers/:id/reality-keys', param('id').isInt(), async (req, res) => {
    try {
        const keys = await xrayService.generateRealityKeys(parseInt(req.params.id));
        keys.shortId = xrayService.generateShortId();
        res.json(keys);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// CRUD Inbounds
// ============================================================

// GET /api/xray/inbounds/all — Все inbound'ы со всех серверов (для формы клиента)
// ?server_group_id=N — фильтр по группе серверов (только Entry серверы — клиенты подключаются к ним)
router.get('/inbounds/all', async (req, res) => {
    try {
        const opts = {};
        if (req.query.server_group_id) {
            opts.serverGroupId = parseInt(req.query.server_group_id);
        }
        const inbounds = await xrayService.getAllInbounds(opts);
        res.json(inbounds);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/xray/inbounds?server_id=N
router.get('/inbounds', async (req, res) => {
    try {
        const serverId = parseInt(req.query.server_id);
        if (!serverId) return res.status(400).json({ error: 'server_id обязателен' });
        const inbounds = await xrayService.getInbounds(serverId);
        res.json(inbounds);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/xray/inbounds/:id
router.get('/inbounds/:id', param('id').isInt(), async (req, res) => {
    try {
        const inbound = await xrayService.getInbound(parseInt(req.params.id));
        if (!inbound) return res.status(404).json({ error: 'Inbound не найден' });
        res.json(inbound);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/xray/inbounds
router.post('/inbounds', [
    body('server_id').isInt(),
    body('tag').isString().trim().notEmpty(),
    body('protocol').isIn(['vless']),
    body('port').isInt({ min: 1, max: 65535 }),
    body('listen').optional().isString(),
    body('settings').optional().isObject(),
    body('stream_settings').optional().isObject(),
    body('sniffing').optional().isObject(),
    body('remark').optional().isString(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Некорректные данные', details: errors.array() });
    }

    try {
        const inbound = await xrayService.createInbound(req.body.server_id, req.body);
        res.status(201).json(inbound);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/xray/inbounds/:id
router.put('/inbounds/:id', param('id').isInt(), async (req, res) => {
    try {
        const updated = await xrayService.updateInbound(parseInt(req.params.id), req.body);
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/xray/inbounds/:id
router.delete('/inbounds/:id', param('id').isInt(), async (req, res) => {
    try {
        const result = await xrayService.deleteInbound(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Клиенты в inbounds
// ============================================================

// POST /api/xray/inbounds/:id/clients — Добавить клиента в inbound
router.post('/inbounds/:id/clients', [
    param('id').isInt(),
    body('client_id').isInt(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Некорректные данные', details: errors.array() });
    }

    try {
        const result = await xrayService.addClientToInbound(req.body.client_id, parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/xray/inbounds/:inbId/clients/:clientId — Удалить клиента из inbound
router.delete('/inbounds/:inbId/clients/:clientId', [
    param('inbId').isInt(),
    param('clientId').isInt(),
], async (req, res) => {
    try {
        const result = await xrayService.removeClientFromInbound(parseInt(req.params.clientId));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Share links
// ============================================================

// GET /api/xray/clients/:id/share-link
router.get('/clients/:id/share-link', param('id').isInt(), async (req, res) => {
    try {
        const link = await xrayService.generateShareLink(parseInt(req.params.id));
        res.json({ link });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// Утилиты
// ============================================================

// GET /api/xray/uuid — Сгенерировать UUID
router.get('/uuid', (req, res) => {
    res.json({ uuid: xrayService.generateUUID() });
});

module.exports = router;
