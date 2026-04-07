const express = require('express');
const router = express.Router();
const { queryAll, queryOne, query } = require('../db/postgres');
const { authMiddleware, adminOnly } = require('../auth/jwt');

// GET /api/tariffs — список тарифов (публичный)
router.get('/', async (req, res) => {
    const tariffs = await queryAll(
        'SELECT id, name, duration_days, price, description, is_active, sort_order FROM tariffs WHERE is_active = TRUE ORDER BY sort_order, price'
    );
    res.json(tariffs);
});

// GET /api/tariffs/all — все тарифы (admin)
router.get('/all', authMiddleware, adminOnly, async (req, res) => {
    const tariffs = await queryAll('SELECT * FROM tariffs ORDER BY sort_order, price');
    res.json(tariffs);
});

// POST /api/tariffs — создать тариф (admin)
router.post('/', authMiddleware, adminOnly, async (req, res) => {
    const { name, duration_days, price, description, is_active, sort_order } = req.body;
    if (!name || !duration_days || !price) return res.status(400).json({ error: 'name, duration_days, price required' });
    const result = await queryOne(
        'INSERT INTO tariffs (name, duration_days, price, description, is_active, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [name, parseInt(duration_days), parseFloat(price), description || '', is_active !== false, parseInt(sort_order) || 0]
    );
    res.json(result);
});

// PUT /api/tariffs/:id — обновить тариф (admin)
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
    const { name, duration_days, price, description, is_active, sort_order } = req.body;
    await query(
        'UPDATE tariffs SET name=$1, duration_days=$2, price=$3, description=$4, is_active=$5, sort_order=$6 WHERE id=$7',
        [name, parseInt(duration_days), parseFloat(price), description || '', is_active !== false, parseInt(sort_order) || 0, req.params.id]
    );
    res.json({ success: true });
});

// DELETE /api/tariffs/:id — удалить тариф (admin)
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
    await query('DELETE FROM tariffs WHERE id = $1', [req.params.id]);
    res.json({ success: true });
});

module.exports = router;
