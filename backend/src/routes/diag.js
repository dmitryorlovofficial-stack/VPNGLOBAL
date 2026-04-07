// Диагностика — VLESS only (WG removed)
const express = require('express');
const router = express.Router();
const { queryAll } = require('../db/postgres');
const { authMiddleware } = require('../auth/jwt');
router.use(authMiddleware);

// GET /api/diag/wg — stub (WG diagnostics removed)
router.get('/wg', async (req, res) => {
    res.json({ message: 'WG diagnostics removed - VLESS only' });
});

module.exports = router;
