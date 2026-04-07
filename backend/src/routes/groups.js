// Маршруты управления группами серверов и клиентов
const express = require('express');
const router = express.Router();
const { param, body, validationResult } = require('express-validator');
const { authMiddleware } = require('../auth/jwt');
const groupsService = require('../services/groups');

router.use(authMiddleware);

// Только admin
function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Только для администраторов' });
    }
    next();
}
router.use(adminOnly);

// ============================================================
// Server Groups
// ============================================================

// GET /api/groups/servers
router.get('/servers', async (req, res) => {
    try {
        const groups = await groupsService.getServerGroups();
        res.json(groups);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/groups/servers/:id
router.get('/servers/:id', param('id').isInt(), async (req, res) => {
    try {
        const group = await groupsService.getServerGroup(parseInt(req.params.id));
        res.json(group);
    } catch (err) {
        res.status(err.message.includes('не найдена') ? 404 : 500).json({ error: err.message });
    }
});

// POST /api/groups/servers
router.post('/servers', [
    body('name').isString().trim().notEmpty(),
    body('description').optional().isString(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Некорректные данные' });
    try {
        const group = await groupsService.createServerGroup(req.body);
        res.status(201).json(group);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PUT /api/groups/servers/:id
router.put('/servers/:id', [
    param('id').isInt(),
    body('name').optional().isString().trim(),
    body('description').optional().isString(),
], async (req, res) => {
    try {
        const group = await groupsService.updateServerGroup(parseInt(req.params.id), req.body);
        res.json(group);
    } catch (err) {
        res.status(err.message.includes('не найдена') ? 404 : 400).json({ error: err.message });
    }
});

// DELETE /api/groups/servers/:id
router.delete('/servers/:id', param('id').isInt(), async (req, res) => {
    try {
        await groupsService.deleteServerGroup(parseInt(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(err.message.includes('не найдена') ? 404 : 500).json({ error: err.message });
    }
});

// ============================================================
// Server Group Members
// ============================================================

// POST /api/groups/servers/:id/members — добавить сервер в группу
router.post('/servers/:id/members', [
    param('id').isInt(),
    body('server_id').isInt(),
    body('role').isIn(['entry', 'exit']),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Некорректные данные' });
    try {
        const result = await groupsService.addServerToGroup(
            parseInt(req.params.id),
            req.body.server_id,
            req.body.role
        );
        res.status(201).json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE /api/groups/servers/:id/members/:serverId — убрать сервер из группы
router.delete('/servers/:id/members/:serverId', [
    param('id').isInt(),
    param('serverId').isInt(),
], async (req, res) => {
    try {
        const result = await groupsService.removeServerFromGroup(
            parseInt(req.params.id),
            parseInt(req.params.serverId)
        );
        res.json(result);
    } catch (err) {
        res.status(err.message.includes('не найден') ? 404 : 500).json({ error: err.message });
    }
});

// ============================================================
// Client Groups
// ============================================================

// GET /api/groups/clients
router.get('/clients', async (req, res) => {
    try {
        const groups = await groupsService.getClientGroups();
        res.json(groups);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/groups/clients/:id
router.get('/clients/:id', param('id').isInt(), async (req, res) => {
    try {
        const group = await groupsService.getClientGroup(parseInt(req.params.id));
        res.json(group);
    } catch (err) {
        res.status(err.message.includes('не найдена') ? 404 : 500).json({ error: err.message });
    }
});

// POST /api/groups/clients
router.post('/clients', [
    body('name').isString().trim().notEmpty(),
    body('description').optional().isString(),
    body('server_group_id').optional().isInt(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Некорректные данные' });
    try {
        const group = await groupsService.createClientGroup(req.body);
        res.status(201).json(group);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PUT /api/groups/clients/:id
router.put('/clients/:id', [
    param('id').isInt(),
    body('name').optional().isString().trim(),
    body('description').optional().isString(),
], async (req, res) => {
    try {
        const group = await groupsService.updateClientGroup(parseInt(req.params.id), req.body);
        res.json(group);
    } catch (err) {
        res.status(err.message.includes('не найдена') ? 404 : 400).json({ error: err.message });
    }
});

// DELETE /api/groups/clients/:id
router.delete('/clients/:id', param('id').isInt(), async (req, res) => {
    try {
        await groupsService.deleteClientGroup(parseInt(req.params.id));
        res.json({ success: true });
    } catch (err) {
        res.status(err.message.includes('не найдена') ? 404 : 500).json({ error: err.message });
    }
});

// ============================================================
// Операции над группами
// ============================================================

// PUT /api/groups/clients/:id/server-group — сменить привязку к группе серверов
router.put('/clients/:id/server-group', [
    param('id').isInt(),
    body('server_group_id').isInt(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Некорректные данные' });
    try {
        const result = await groupsService.switchClientGroupServerGroup(
            parseInt(req.params.id),
            req.body.server_group_id
        );
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/groups/clients/bulk-move — массовое перемещение клиентов
router.post('/clients/bulk-move', [
    body('client_ids').isArray({ min: 1 }),
    body('target_group_id').isInt(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Некорректные данные' });
    try {
        const result = await groupsService.bulkMoveClients(
            req.body.client_ids,
            req.body.target_group_id
        );
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ============================================================
// Доменная маршрутизация
// ============================================================

// GET /api/groups/servers/:id/domain-routes
router.get('/servers/:id/domain-routes', param('id').isInt(), async (req, res) => {
    try {
        const routes = await groupsService.getDomainRoutes(parseInt(req.params.id));
        res.json(routes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/groups/servers/:id/domain-routes
router.post('/servers/:id/domain-routes', [
    param('id').isInt(),
    body('name').isString().trim().notEmpty(),
    body('domains').isArray({ min: 1 }),
    body('target_server_id').isInt(),
    body('priority').optional().isInt(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Некорректные данные' });
    try {
        const route = await groupsService.createDomainRoute({
            server_group_id: parseInt(req.params.id),
            ...req.body,
        });
        res.status(201).json(route);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PUT /api/groups/servers/:id/domain-routes/:rid
router.put('/servers/:id/domain-routes/:rid', [
    param('id').isInt(),
    param('rid').isInt(),
], async (req, res) => {
    try {
        const route = await groupsService.updateDomainRoute(parseInt(req.params.rid), req.body);
        res.json(route);
    } catch (err) {
        res.status(err.message.includes('не найден') ? 404 : 400).json({ error: err.message });
    }
});

// DELETE /api/groups/servers/:id/domain-routes/:rid
router.delete('/servers/:id/domain-routes/:rid', [
    param('id').isInt(),
    param('rid').isInt(),
], async (req, res) => {
    try {
        await groupsService.deleteDomainRoute(parseInt(req.params.rid));
        res.json({ success: true });
    } catch (err) {
        res.status(err.message.includes('не найден') ? 404 : 500).json({ error: err.message });
    }
});

// POST /api/groups/servers/:id/sync-clients — Синхронизировать клиентов на Entry inbound'ы
router.post('/servers/:id/sync-clients', param('id').isInt(), async (req, res) => {
    try {
        const moved = await groupsService.syncGroupClientInbounds(parseInt(req.params.id));
        res.json({ success: true, clients_moved: moved });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
