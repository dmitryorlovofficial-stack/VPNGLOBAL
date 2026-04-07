// API маршруты для управления сайтами-заглушками
const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('../auth/jwt');
const stubSiteService = require('../services/stub-site');

// Все роуты требуют авторизации (admin)
router.use(authMiddleware);
router.use(adminOnly);

// GET /api/stub-sites/templates — список шаблонов
router.get('/templates', async (req, res) => {
    try {
        const templates = stubSiteService.listTemplates();
        res.json(templates);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/stub-sites/servers/:serverId — статус заглушки на сервере
router.get('/servers/:serverId', async (req, res) => {
    try {
        const status = await stubSiteService.getStubSiteStatus(parseInt(req.params.serverId));
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/stub-sites/servers/:serverId/deploy — развернуть заглушку
router.post('/servers/:serverId/deploy', async (req, res) => {
    try {
        const serverId = parseInt(req.params.serverId);
        const { templateId, variables, customFiles, internalPort, autoUpdateDest } = req.body;

        const result = await stubSiteService.deployStubSite(serverId, {
            templateId,
            variables,
            customFiles,
            internalPort,
            autoUpdateDest,
        });

        res.json(result);
    } catch (err) {
        console.error('[STUB-SITES] Deploy error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/stub-sites/servers/:serverId/stop — остановить nginx
router.post('/servers/:serverId/stop', async (req, res) => {
    try {
        const result = await stubSiteService.stopStubSite(parseInt(req.params.serverId));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/stub-sites/servers/:serverId — удалить заглушку
router.delete('/servers/:serverId', async (req, res) => {
    try {
        const result = await stubSiteService.removeStubSite(parseInt(req.params.serverId));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── SSL ─────────────────────────────────────────────────────

// POST /api/stub-sites/servers/:serverId/ssl/obtain — получить SSL-сертификат
router.post('/servers/:serverId/ssl/obtain', async (req, res) => {
    try {
        const serverId = parseInt(req.params.serverId);
        const { domain, email } = req.body;
        const result = await stubSiteService.obtainSSL(serverId, domain, email);
        res.json(result);
    } catch (err) {
        console.error('[STUB-SITES] SSL obtain error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/stub-sites/servers/:serverId/ssl/status — статус SSL
router.get('/servers/:serverId/ssl/status', async (req, res) => {
    try {
        const result = await stubSiteService.getSSLStatus(parseInt(req.params.serverId));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/stub-sites/servers/:serverId/ssl/renew — обновить SSL
router.post('/servers/:serverId/ssl/renew', async (req, res) => {
    try {
        const result = await stubSiteService.renewSSL(parseInt(req.params.serverId));
        res.json(result);
    } catch (err) {
        console.error('[STUB-SITES] SSL renew error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
