// Маршруты настроек панели (PostgreSQL)
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authMiddleware, adminOnly } = require('../auth/jwt');
const { query, queryOne, queryAll, transaction } = require('../db/postgres');
const { generateBackup, restoreBackup } = require('../utils/config-generator');

router.use(authMiddleware);

// GET /api/settings
router.get('/', async (req, res) => {
    const rows = await queryAll('SELECT key, value FROM settings');
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json(settings);
});

// PUT /api/settings (admin)
router.put('/', adminOnly, async (req, res) => {
    const updates = req.body;
    if (typeof updates !== 'object' || Array.isArray(updates)) {
        return res.status(400).json({ error: 'Ожидается объект настроек' });
    }

    try {
        await transaction(async (client) => {
            for (const [key, value] of Object.entries(updates)) {
                await client.query(
                    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
                    [key, String(value)]
                );
            }
        });

        await query(
            `INSERT INTO logs (level, category, message, details)
             VALUES ('info', 'system', 'Настройки обновлены', $1)`,
            [JSON.stringify(Object.keys(updates))]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/settings/backup (admin)
router.post('/backup', adminOnly, async (req, res) => {
    try {
        const backup = await generateBackup();
        await query(
            `INSERT INTO logs (level, category, message)
             VALUES ('info', 'system', 'Создан бэкап конфигурации')`
        );
        res.json(backup);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/settings/restore (admin)
router.post('/restore', adminOnly, async (req, res) => {
    try {
        const result = await restoreBackup(req.body);
        await query(
            `INSERT INTO logs (level, category, message, details)
             VALUES ('info', 'system', 'Восстановлено из бэкапа', $1)`,
            [JSON.stringify(result)]
        );
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// GET /api/logs (или /api/settings/logs)
router.get('/logs', async (req, res) => {
    const { level, category, search, server_id, page, limit } = req.query;
    const params = [];
    const $ = (val) => { params.push(val); return `$${params.length}`; };

    let sql = 'SELECT l.*, s.name as server_name FROM logs l LEFT JOIN servers s ON s.id = l.server_id WHERE 1=1';

    if (level) sql += ` AND l.level = ${$(level)}`;
    if (category) sql += ` AND l.category = ${$(category)}`;
    if (search) sql += ` AND l.message ILIKE ${$(`%${search}%`)}`;
    if (server_id) sql += ` AND l.server_id = ${$(parseInt(server_id))}`;

    const countSql = sql.replace(/SELECT\s+[\s\S]*?\s+FROM/, 'SELECT COUNT(*) as count FROM');
    const countResult = await queryOne(countSql, params);
    const total = parseInt(countResult.count);

    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * pageSize;

    sql += ` ORDER BY l.created_at DESC LIMIT ${$(pageSize)} OFFSET ${$(offset)}`;

    const logs = await queryAll(sql, params);

    res.json({
        logs,
        pagination: { page: pageNum, limit: pageSize, total, pages: Math.ceil(total / pageSize) },
    });
});

module.exports = router;
