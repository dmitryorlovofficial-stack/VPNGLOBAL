// GET /api/health — проверка жизни агента
const express = require('express');
const router = express.Router();
const os = require('os');

router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        hostname: os.hostname(),
        uptime: Math.floor(process.uptime()),
        agentVersion: req.agentVersion,
    });
});

module.exports = router;
