// Маршруты управления Xray-цепочками между серверами
const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { authMiddleware } = require('../auth/jwt');
const tunnelService = require('../services/tunnel');

router.use(authMiddleware);

// Только админ
function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Только для администраторов' });
    }
    next();
}

router.use(adminOnly);

// GET /api/tunnels — Список всех связей
router.get('/', async (req, res) => {
    try {
        const tunnels = await tunnelService.getTunnels();
        res.json(tunnels);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/tunnels — Создать Xray-цепочку
router.post('/', [
    body('from_server_id').isInt(),
    body('to_server_id').isInt(),
    body('name').optional().isString(),
    body('endpoint_mode').optional().isIn(['ipv4', 'ipv6']),
    body('xray_protocol').optional().isIn(['vless']),
    body('xray_port').optional().isInt({ min: 1, max: 65535 }),
    body('xray_settings').optional().isObject(),
    body('xray_stream_settings').optional().isObject(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Некорректные данные', details: errors.array() });
    }

    try {
        const tunnel = await tunnelService.createTunnel(req.body);
        res.status(201).json(tunnel);
    } catch (err) {
        console.error('[TUNNELS] Create error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/tunnels/:id — Удалить цепочку
router.delete('/:id', param('id').isInt(), async (req, res) => {
    try {
        const result = await tunnelService.deleteTunnel(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/tunnels/:id/restart — Перезапустить цепочку
router.post('/:id/restart', param('id').isInt(), async (req, res) => {
    try {
        const result = await tunnelService.restartTunnel(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/tunnels/:id/status — Проверить статус цепочки
router.post('/:id/status', param('id').isInt(), async (req, res) => {
    try {
        const status = await tunnelService.checkTunnelStatus(parseInt(req.params.id));
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
