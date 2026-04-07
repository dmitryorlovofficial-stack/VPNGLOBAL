// API маршруты для управления AdGuard Home серверами
const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('../auth/jwt');
const adguardService = require('../services/adguard');

// Все роуты требуют авторизации (admin)
router.use(authMiddleware);
router.use(adminOnly);

// ─── CRUD подключений ────────────────────────────────────────

// GET /api/adguard/servers — список подключений
router.get('/servers', async (req, res) => {
    try {
        const servers = await adguardService.listServers();
        res.json(servers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/adguard/servers — добавить подключение
router.post('/servers', async (req, res) => {
    try {
        const result = await adguardService.createServer(req.body);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PUT /api/adguard/servers/:id — обновить подключение
router.put('/servers/:id', async (req, res) => {
    try {
        const result = await adguardService.updateServer(parseInt(req.params.id), req.body);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE /api/adguard/servers/:id — удалить подключение
router.delete('/servers/:id', async (req, res) => {
    try {
        const result = await adguardService.deleteServer(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/adguard/servers/:id/test — тест подключения
router.post('/servers/:id/test', async (req, res) => {
    try {
        const result = await adguardService.testConnection(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Проксирование API ──────────────────────────────────────

// GET /api/adguard/servers/:id/status — статус AdGuard
router.get('/servers/:id/status', async (req, res) => {
    try {
        const result = await adguardService.getStatus(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/adguard/servers/:id/dns — DNS конфигурация
router.get('/servers/:id/dns', async (req, res) => {
    try {
        const result = await adguardService.getDnsConfig(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/adguard/servers/:id/dns — обновить DNS конфигурацию
router.post('/servers/:id/dns', async (req, res) => {
    try {
        const result = await adguardService.setDnsConfig(parseInt(req.params.id), req.body);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/adguard/servers/:id/filtering — фильтрация
router.get('/servers/:id/filtering', async (req, res) => {
    try {
        const result = await adguardService.getFiltering(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/adguard/servers/:id/filtering — обновить фильтрацию
router.post('/servers/:id/filtering', async (req, res) => {
    try {
        const result = await adguardService.setFiltering(parseInt(req.params.id), req.body);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/adguard/servers/:id/filtering/add — добавить фильтр-лист
router.post('/servers/:id/filtering/add', async (req, res) => {
    try {
        const result = await adguardService.addFilterList(parseInt(req.params.id), req.body);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/adguard/servers/:id/filtering/remove — удалить фильтр-лист
router.post('/servers/:id/filtering/remove', async (req, res) => {
    try {
        const result = await adguardService.removeFilterList(parseInt(req.params.id), req.body);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/adguard/servers/:id/filtering/refresh — обновить фильтры
router.post('/servers/:id/filtering/refresh', async (req, res) => {
    try {
        const result = await adguardService.refreshFilters(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/adguard/servers/:id/clients — клиенты
router.get('/servers/:id/clients', async (req, res) => {
    try {
        const result = await adguardService.getClients(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/adguard/servers/:id/clients/add — добавить клиента
router.post('/servers/:id/clients/add', async (req, res) => {
    try {
        const result = await adguardService.addClient(parseInt(req.params.id), req.body);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/adguard/servers/:id/clients/update — обновить клиента
router.post('/servers/:id/clients/update', async (req, res) => {
    try {
        const result = await adguardService.updateClient(parseInt(req.params.id), req.body);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/adguard/servers/:id/clients/delete — удалить клиента
router.post('/servers/:id/clients/delete', async (req, res) => {
    try {
        const result = await adguardService.deleteClient(parseInt(req.params.id), req.body);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/adguard/servers/:id/querylog — лог DNS-запросов
router.get('/servers/:id/querylog', async (req, res) => {
    try {
        const params = { ...req.query };
        delete params.id;
        const result = await adguardService.getQueryLog(parseInt(req.params.id), params);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/adguard/servers/:id/stats — статистика
router.get('/servers/:id/stats', async (req, res) => {
    try {
        const result = await adguardService.getStats(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/adguard/servers/:id/protection — вкл/выкл защиту
router.post('/servers/:id/protection', async (req, res) => {
    try {
        const { enabled } = req.body;
        const result = await adguardService.setProtection(parseInt(req.params.id), enabled);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
