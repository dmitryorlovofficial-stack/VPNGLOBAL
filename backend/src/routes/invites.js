// Маршруты управления инвайт-кодами (admin only)
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { authMiddleware, adminOnly } = require('../auth/jwt');
const { query, queryOne, queryAll } = require('../db/postgres');

router.use(authMiddleware);
router.use(adminOnly);

// GET /api/invites — список инвайтов
router.get('/', async (req, res) => {
    try {
        const invites = await queryAll(`
            SELECT ic.*, a.username as created_by_name
            FROM invite_codes ic
            LEFT JOIN admins a ON a.id = ic.created_by
            ORDER BY ic.created_at DESC
        `);
        res.json(invites);
    } catch (err) {
        console.error('[INVITES] list error:', err.message);
        res.status(500).json({ error: 'Ошибка получения инвайтов' });
    }
});

// POST /api/invites — создать инвайт-код
router.post('/', async (req, res) => {
    try {
        const { max_uses = 1, max_vpn_clients = 5, expires_hours } = req.body;
        const code = crypto.randomBytes(8).toString('hex'); // 16 символов

        const expires_at = expires_hours
            ? new Date(Date.now() + parseInt(expires_hours) * 3600000).toISOString()
            : null;

        const invite = await queryOne(
            `INSERT INTO invite_codes (code, created_by, max_uses, max_vpn_clients, expires_at)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [code, req.user.id, max_uses, max_vpn_clients, expires_at]
        );

        await query(
            `INSERT INTO logs (level, category, message, details)
             VALUES ('info', 'auth', $1, $2)`,
            [`Создан инвайт-код: ${code}`, JSON.stringify({
                by: req.user.username, max_uses, max_vpn_clients, expires_hours,
            })]
        );

        res.status(201).json(invite);
    } catch (err) {
        console.error('[INVITES] create error:', err.message);
        res.status(500).json({ error: 'Ошибка создания инвайта' });
    }
});

// DELETE /api/invites/:id — удалить инвайт
router.delete('/:id', async (req, res) => {
    try {
        const invite = await queryOne('SELECT * FROM invite_codes WHERE id = $1', [req.params.id]);
        if (!invite) return res.status(404).json({ error: 'Инвайт не найден' });

        await query('DELETE FROM invite_codes WHERE id = $1', [req.params.id]);

        await query(
            `INSERT INTO logs (level, category, message, details)
             VALUES ('info', 'auth', $1, $2)`,
            [`Удалён инвайт-код: ${invite.code}`, JSON.stringify({ by: req.user.username })]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('[INVITES] delete error:', err.message);
        res.status(500).json({ error: 'Ошибка удаления инвайта' });
    }
});

module.exports = router;
