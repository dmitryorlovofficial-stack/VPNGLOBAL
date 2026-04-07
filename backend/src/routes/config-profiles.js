// API маршруты для Config Profiles + Snippets
const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('../auth/jwt');
const profileService = require('../services/config-profiles');

router.use(authMiddleware);
router.use(adminOnly);

// =================== Profiles ===================

// GET /api/config-profiles — список профилей
router.get('/', async (req, res) => {
    try {
        const profiles = await profileService.listProfiles();
        res.json(profiles);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/config-profiles/:id — профиль с деталями
router.get('/:id', async (req, res) => {
    try {
        const profile = await profileService.getProfile(parseInt(req.params.id));
        if (!profile) return res.status(404).json({ error: 'Профиль не найден' });
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/config-profiles — создать профиль
router.post('/', async (req, res) => {
    try {
        const { name, description, base_config, inbound_defaults, server_group_id } = req.body;
        if (!name) return res.status(400).json({ error: 'Имя обязательно' });
        const profile = await profileService.createProfile({ name, description, base_config, inbound_defaults, server_group_id });
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/config-profiles/:id — обновить профиль
router.put('/:id', async (req, res) => {
    try {
        const profile = await profileService.updateProfile(parseInt(req.params.id), req.body);
        if (!profile) return res.status(404).json({ error: 'Профиль не найден или нечего обновлять' });
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/config-profiles/:id — удалить профиль
router.delete('/:id', async (req, res) => {
    try {
        const result = await profileService.deleteProfile(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/config-profiles/:id/snippets — привязать сниппеты к профилю
router.put('/:id/snippets', async (req, res) => {
    try {
        const { snippet_ids } = req.body;
        if (!Array.isArray(snippet_ids)) return res.status(400).json({ error: 'snippet_ids должен быть массивом' });
        const result = await profileService.setProfileSnippets(parseInt(req.params.id), snippet_ids);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/config-profiles/:id/assign/:serverId — назначить профиль серверу
router.post('/:id/assign/:serverId', async (req, res) => {
    try {
        const result = await profileService.assignProfileToServer(
            parseInt(req.params.serverId),
            parseInt(req.params.id)
        );
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/config-profiles/server/:serverId/effective — эффективный профиль сервера
router.get('/server/:serverId/effective', async (req, res) => {
    try {
        const profile = await profileService.getEffectiveProfile(parseInt(req.params.serverId));
        res.json(profile || { message: 'Нет профиля' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =================== Snippets ===================

// GET /api/config-profiles/snippets/all — все сниппеты
router.get('/snippets/all', async (req, res) => {
    try {
        const snippets = await profileService.listSnippets();
        res.json(snippets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/config-profiles/snippets/:id — один сниппет
router.get('/snippets/:id', async (req, res) => {
    try {
        const snippet = await profileService.getSnippet(parseInt(req.params.id));
        if (!snippet) return res.status(404).json({ error: 'Сниппет не найден' });
        res.json(snippet);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/config-profiles/snippets — создать сниппет
router.post('/snippets', async (req, res) => {
    try {
        const { name, description, type, content, sort_order } = req.body;
        if (!name || !type || !content) return res.status(400).json({ error: 'name, type, content обязательны' });
        const snippet = await profileService.createSnippet({ name, description, type, content, sort_order });
        res.json(snippet);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/config-profiles/snippets/:id — обновить сниппет
router.put('/snippets/:id', async (req, res) => {
    try {
        const snippet = await profileService.updateSnippet(parseInt(req.params.id), req.body);
        if (!snippet) return res.status(404).json({ error: 'Сниппет не найден или нечего обновлять' });
        res.json(snippet);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/config-profiles/snippets/:id — удалить сниппет
router.delete('/snippets/:id', async (req, res) => {
    try {
        const result = await profileService.deleteSnippet(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
