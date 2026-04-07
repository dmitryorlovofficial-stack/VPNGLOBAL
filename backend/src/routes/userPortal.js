const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { queryAll, queryOne } = require('../db/postgres');
const { generateToken, verifyToken } = require('../auth/jwt');
const xrayService = require('../services/xray');

// In-memory code store
const codes = new Map();
const CODE_TTL = 5 * 60 * 1000; // 5 min

// Cleanup expired codes every minute
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of codes) {
        if (now > val.expires) codes.delete(key);
    }
}, 60 * 1000);

// Subscriber auth middleware
function subscriberAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    try {
        const decoded = verifyToken(authHeader.split(' ')[1]);
        if (decoded.role !== 'subscriber') {
            return res.status(403).json({ error: 'Нет доступа' });
        }
        req.subscriber = decoded;
        next();
    } catch {
        return res.status(401).json({ error: 'Сессия истекла' });
    }
}

// POST /send-code
router.post('/send-code', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'Введите корректный email' });
        }

        // Find client by email
        const client = await queryOne(
            'SELECT id, email, sub_token, name FROM clients WHERE LOWER(email) = LOWER($1) LIMIT 1',
            [email.trim()]
        );

        // Если клиент не найден — регистрируем (без VPN конфига, создастся после оплаты)
        let isNewUser = false;
        let clientData = client;
        if (!client) {
            isNewUser = true;
            clientData = { email: email.trim(), name: email.split('@')[0], sub_token: null };
        }

        // Generate 6-digit code
        const code = String(crypto.randomInt(100000, 999999));
        codes.set(email.toLowerCase(), {
            code,
            sub_token: clientData.sub_token,
            name: clientData.name,
            email: email.trim(),
            isNewUser,
            expires: Date.now() + CODE_TTL,
            attempts: 0,
        });

        // Send email
        try {
            const { sendCode } = require('../services/mailer');
            await sendCode(email.trim(), code);
        } catch (err) {
            console.error('[USER-PORTAL] Email send error:', err.message);
            return res.status(500).json({ error: 'Ошибка отправки кода. Проверьте настройки SMTP.' });
        }

        res.json({ success: true, message: 'Код отправлен на email' });
    } catch (err) {
        console.error('[USER-PORTAL] send-code error:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// POST /verify-code
router.post('/verify-code', async (req, res) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) {
            return res.status(400).json({ error: 'Введите email и код' });
        }

        const stored = codes.get(email.toLowerCase());
        if (!stored) {
            return res.status(400).json({ error: 'Код не найден или истёк. Запросите новый.' });
        }

        if (Date.now() > stored.expires) {
            codes.delete(email.toLowerCase());
            return res.status(400).json({ error: 'Код истёк. Запросите новый.' });
        }

        stored.attempts++;
        if (stored.attempts > 5) {
            codes.delete(email.toLowerCase());
            return res.status(429).json({ error: 'Слишком много попыток. Запросите новый код.' });
        }

        if (stored.code !== code.trim()) {
            return res.status(400).json({ error: 'Неверный код' });
        }

        // Success — remove code and generate JWT
        codes.delete(email.toLowerCase());

        const token = generateToken(0, email.toLowerCase(), 'subscriber');
        // Store sub_token in a custom claim by re-signing
        const jwt = require('jsonwebtoken');
        const SECRET = process.env.PANEL_SECRET_KEY || 'default-secret-change-me';
        const subscriberToken = jwt.sign(
            { sub_token: stored.sub_token, email: email.toLowerCase(), name: stored.name, role: 'subscriber' },
            SECRET,
            { expiresIn: '7d' }
        );

        res.json({ success: true, token: subscriberToken, user: { name: stored.name, email } });
    } catch (err) {
        console.error('[USER-PORTAL] verify-code error:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// GET /me — subscription data
router.get('/me', subscriberAuth, async (req, res) => {
    try {
        const { sub_token } = req.subscriber;

        // Get all clients with this sub_token
        const clients = await queryAll(
            'SELECT * FROM clients WHERE sub_token = $1 ORDER BY protocol',
            [sub_token]
        );

        if (!clients || clients.length === 0 || !sub_token) {
            // Новый пользователь без подписки — показать тарифы
            const tariffs = await queryAll('SELECT id, name, duration_days, price, description FROM tariffs WHERE is_active = TRUE ORDER BY sort_order, price');
            return res.json({
                status: 'no_subscription',
                name: req.subscriber.name || req.subscriber.email?.split('@')[0] || '?',
                email: req.subscriber.email,
                tariffs,
                devices: [],
                sub_url: null,
            });
        }

        const first = clients[0];

        // Traffic
        let totalUpload = 0, totalDownload = 0, totalLimit = 0;
        for (const c of clients) {
            totalUpload += parseInt(c.upload_bytes) || 0;
            totalDownload += parseInt(c.download_bytes) || 0;
            totalLimit += parseInt(c.traffic_limit_bytes) || 0;
        }

        // Status
        const isBlocked = clients.every(c => c.is_blocked);
        const expiresAt = first.expires_at;
        const isExpired = expiresAt && new Date(expiresAt) < new Date();
        let status = 'active';
        if (isBlocked) status = 'blocked';
        else if (isExpired) status = 'expired';
        else if (totalLimit > 0 && (totalUpload + totalDownload) >= totalLimit) status = 'traffic_exceeded';

        // Devices
        const devices = await queryAll(
            'SELECT * FROM client_devices WHERE sub_token = $1 ORDER BY last_seen DESC',
            [sub_token]
        );

        // Subscription link
        const subUrl = process.env.PANEL_DOMAIN
            ? `https://${process.env.PANEL_DOMAIN}/api/sub/${sub_token}`
            : `/api/sub/${sub_token}`;

        // Servers / locations
        const serverIds = [...new Set(clients.map(c => c.server_id).filter(Boolean))];
        let servers = [];
        if (serverIds.length > 0) {
            servers = await queryAll(
                `SELECT DISTINCT s.name FROM servers s
                 JOIN server_group_members sgm ON sgm.server_id = s.id
                 WHERE sgm.role = 'exit'
                 ORDER BY s.name`
            );
        }

        res.json({
            name: first.name,
            email: first.email,
            status,
            sub_url: subUrl,
            sub_token,
            traffic: {
                upload: totalUpload,
                download: totalDownload,
                total: totalUpload + totalDownload,
                limit: totalLimit,
            },
            expires_at: expiresAt,
            devices: devices.map(d => ({
                id: d.id,
                device_name: d.device_name,
                device_type: d.device_type,
                app_name: d.app_name,
                last_ip: d.last_ip,
                last_seen: d.last_seen,
                is_revoked: d.is_revoked,
            })),
            device_limit: parseInt(first.device_limit) || 0,
            servers,
            created_at: first.created_at,
        });
    } catch (err) {
        console.error('[USER-PORTAL] /me error:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// DELETE /devices/:deviceId — удалить устройство
router.delete('/devices/:deviceId', subscriberAuth, async (req, res) => {
    try {
        const { sub_token } = req.subscriber;
        const { deviceId } = req.params;
        const { query } = require('../db/postgres');
        await query(
            'DELETE FROM client_devices WHERE id = $1 AND sub_token = $2',
            [deviceId, sub_token]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
