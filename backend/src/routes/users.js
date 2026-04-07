// Маршруты управления пользователями панели (PostgreSQL, admin only)
const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const { authMiddleware, adminOnly } = require('../auth/jwt');
const { query, queryOne, queryAll } = require('../db/postgres');

router.use(authMiddleware);
router.use(adminOnly);

// GET /api/users
router.get('/', async (req, res) => {
    const users = await queryAll(`
        SELECT a.id, a.username, a.role, a.max_vpn_clients, a.created_at,
               (SELECT COUNT(*) FROM clients WHERE owner_id = a.id) as vpn_count
        FROM admins a
        ORDER BY a.created_at DESC
    `);
    res.json(users);
});

// POST /api/users
router.post('/', [
    body('username').isString().trim().isLength({ min: 3, max: 32 }),
    body('password').isString().isLength({ min: 6 }),
    body('max_vpn_clients').optional().isInt({ min: 0, max: 100 }),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Некорректные данные', details: errors.array() });
    }

    const { username, password, max_vpn_clients } = req.body;

    const existing = await queryOne('SELECT id FROM admins WHERE username = $1', [username]);
    if (existing) {
        return res.status(409).json({ error: 'Пользователь с таким логином уже существует' });
    }

    const hash = bcrypt.hashSync(password, 12);
    const user = await queryOne(
        `INSERT INTO admins (username, password_hash, role, max_vpn_clients)
         VALUES ($1, $2, 'user', $3)
         RETURNING id, username, role, max_vpn_clients, created_at`,
        [username, hash, max_vpn_clients ?? 5]
    );

    await query(
        `INSERT INTO logs (level, category, message, details)
         VALUES ('info', 'auth', $1, $2)`,
        [`Создан пользователь: ${username}`, JSON.stringify({ by: req.user.username })]
    );

    res.status(201).json(user);
});

// PUT /api/users/:id
router.put('/:id', [
    param('id').isInt(),
    body('max_vpn_clients').optional().isInt({ min: 0, max: 100 }),
    body('password').optional().isString().isLength({ min: 6 }),
], async (req, res) => {
    const user = await queryOne('SELECT * FROM admins WHERE id = $1', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    if (user.role === 'admin' && user.id !== req.user.id) {
        return res.status(403).json({ error: 'Нельзя редактировать другого администратора' });
    }

    const { max_vpn_clients, password } = req.body;

    if (max_vpn_clients !== undefined) {
        await query('UPDATE admins SET max_vpn_clients = $1 WHERE id = $2', [max_vpn_clients, req.params.id]);
    }
    if (password) {
        const hash = bcrypt.hashSync(password, 12);
        await query('UPDATE admins SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
    }

    const updated = await queryOne(`
        SELECT a.id, a.username, a.role, a.max_vpn_clients, a.created_at,
               (SELECT COUNT(*) FROM clients WHERE owner_id = a.id) as vpn_count
        FROM admins a WHERE a.id = $1
    `, [req.params.id]);

    res.json(updated);
});

// DELETE /api/users/:id
router.delete('/:id', param('id').isInt(), async (req, res) => {
    const user = await queryOne('SELECT * FROM admins WHERE id = $1', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.role === 'admin') return res.status(403).json({ error: 'Нельзя удалить администратора' });
    if (user.id === req.user.id) return res.status(403).json({ error: 'Нельзя удалить самого себя' });

    const xrayService = require('../services/xray');

    // Удаляем VPN-клиентов и собираем серверы для редеплоя
    const userClients = await queryAll('SELECT * FROM clients WHERE owner_id = $1', [user.id]);
    const serversToRedeploy = new Set();
    for (const client of userClients) {
        if (client.server_id) serversToRedeploy.add(client.server_id);
    }
    await query('DELETE FROM clients WHERE owner_id = $1', [user.id]);
    // Редеплой Xray убирает удалённых клиентов из конфига (WG peers + VLESS users)
    for (const serverId of serversToRedeploy) {
        try { await xrayService.deployConfig(serverId); } catch {}
    }

    // Удаляем пользователя
    await query('DELETE FROM admins WHERE id = $1', [user.id]);

    await query(
        `INSERT INTO logs (level, category, message, details)
         VALUES ('info', 'auth', $1, $2)`,
        [`Удалён пользователь: ${user.username}`, JSON.stringify({
            by: req.user.username,
            deletedClients: userClients.length,
        })]
    );

    res.json({ success: true });
});

module.exports = router;
