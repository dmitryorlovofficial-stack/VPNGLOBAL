// Маршруты авторизации (PostgreSQL)
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authenticateUser, generateToken, authMiddleware, changePassword, setup2FA, enable2FA, disable2FA } = require('../auth/jwt');
const { validateTelegramAuth } = require('../auth/telegram');
const { query, queryOne, queryAll } = require('../db/postgres');

// Получить Telegram-настройки из БД (settings table)
async function getTelegramSettings() {
    const rows = await queryAll(
        "SELECT key, value FROM settings WHERE key IN ('telegram_bot_token', 'telegram_bot_username')"
    );
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return {
        bot_token: (map.telegram_bot_token || '').trim(),
        bot_username: (map.telegram_bot_username || '').trim().replace(/^@/, ''),
    };
}

// GET /api/auth/telegram-config (публичный, без авторизации)
router.get('/telegram-config', async (req, res) => {
    const tg = await getTelegramSettings();
    res.json({ bot_username: tg.bot_username, enabled: !!tg.bot_token });
});

// POST /api/auth/telegram — Вход через Telegram
router.post('/telegram', async (req, res) => {
    try {
        const tg = await getTelegramSettings();
        if (!tg.bot_token) {
            return res.status(400).json({ error: 'Telegram авторизация не настроена' });
        }

        const tgData = req.body;
        if (!validateTelegramAuth(tgData, tg.bot_token)) {
            return res.status(401).json({ error: 'Невалидные данные Telegram' });
        }

        const admin = await queryOne('SELECT * FROM admins WHERE telegram_id = $1', [tgData.id]);
        if (!admin) {
            return res.json({ needsRegistration: true, telegram_id: parseInt(tgData.id) });
        }

        // Обновляем данные Telegram при каждом входе
        await query(
            `UPDATE admins SET telegram_username = $1, telegram_first_name = $2,
             telegram_photo_url = $3 WHERE id = $4`,
            [tgData.username || null, tgData.first_name || null, tgData.photo_url || null, admin.id]
        );

        await query(
            `INSERT INTO logs (level, category, message, details)
             VALUES ('info', 'auth', $1, $2)`,
            [`Вход через Telegram: ${admin.username}`, JSON.stringify({ ip: req.ip, telegram_id: tgData.id })]
        );

        const token = generateToken(admin.id, admin.username, admin.role);
        res.json({
            success: true,
            token,
            user: {
                id: admin.id,
                username: admin.username,
                role: admin.role,
                max_vpn_clients: admin.max_vpn_clients,
            },
        });
    } catch (err) {
        console.error('[AUTH] telegram login error:', err.message);
        res.status(500).json({ error: 'Ошибка авторизации через Telegram' });
    }
});

// POST /api/auth/telegram-register — Регистрация через Telegram + инвайт-код
router.post('/telegram-register', async (req, res) => {
    try {
        const tg = await getTelegramSettings();
        if (!tg.bot_token) {
            return res.status(400).json({ error: 'Telegram авторизация не настроена' });
        }

        const { invite_code, ...tgData } = req.body;
        if (!invite_code) {
            return res.status(400).json({ error: 'Требуется инвайт-код' });
        }

        if (!validateTelegramAuth(tgData, tg.bot_token)) {
            return res.status(401).json({ error: 'Невалидные данные Telegram' });
        }

        // Проверяем инвайт
        const invite = await queryOne('SELECT * FROM invite_codes WHERE code = $1', [invite_code]);
        if (!invite) {
            return res.status(400).json({ error: 'Невалидный инвайт-код' });
        }
        if (invite.used_count >= invite.max_uses) {
            return res.status(400).json({ error: 'Инвайт-код уже использован' });
        }
        if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Инвайт-код истёк' });
        }

        // Проверяем что telegram_id не занят
        const existing = await queryOne('SELECT id FROM admins WHERE telegram_id = $1', [tgData.id]);
        if (existing) {
            return res.status(409).json({ error: 'Этот Telegram аккаунт уже зарегистрирован' });
        }

        // Генерируем уникальный username
        let username = tgData.username || `tg_${tgData.id}`;
        const existingUser = await queryOne('SELECT id FROM admins WHERE username = $1', [username]);
        if (existingUser) {
            username = `tg_${tgData.id}`;
        }

        // Создаём пользователя
        const user = await queryOne(
            `INSERT INTO admins (username, password_hash, role, max_vpn_clients,
             telegram_id, telegram_username, telegram_first_name, telegram_photo_url)
             VALUES ($1, NULL, 'user', $2, $3, $4, $5, $6)
             RETURNING id, username, role, max_vpn_clients`,
            [username, invite.max_vpn_clients, parseInt(tgData.id),
             tgData.username || null, tgData.first_name || null, tgData.photo_url || null]
        );

        // Инкрементируем использование инвайта
        await query('UPDATE invite_codes SET used_count = used_count + 1 WHERE id = $1', [invite.id]);

        await query(
            `INSERT INTO logs (level, category, message, details)
             VALUES ('info', 'auth', $1, $2)`,
            [`Регистрация через Telegram: ${username}`, JSON.stringify({
                ip: req.ip, telegram_id: tgData.id, invite_code,
            })]
        );

        const token = generateToken(user.id, user.username, user.role);
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                max_vpn_clients: user.max_vpn_clients,
            },
        });
    } catch (err) {
        console.error('[AUTH] telegram register error:', err.message);
        res.status(500).json({ error: 'Ошибка регистрации через Telegram' });
    }
});

// POST /api/auth/telegram-link — Привязать Telegram к существующему аккаунту
router.post('/telegram-link', authMiddleware, async (req, res) => {
    try {
        const tg = await getTelegramSettings();
        if (!tg.bot_token) {
            return res.status(400).json({ error: 'Telegram авторизация не настроена' });
        }

        const tgData = req.body;
        if (!validateTelegramAuth(tgData, tg.bot_token)) {
            return res.status(401).json({ error: 'Невалидные данные Telegram' });
        }

        // Проверяем что telegram_id не занят другим
        const other = await queryOne(
            'SELECT id FROM admins WHERE telegram_id = $1 AND id != $2',
            [tgData.id, req.user.id]
        );
        if (other) {
            return res.status(409).json({ error: 'Этот Telegram уже привязан к другому аккаунту' });
        }

        await query(
            `UPDATE admins SET telegram_id = $1, telegram_username = $2,
             telegram_first_name = $3, telegram_photo_url = $4 WHERE id = $5`,
            [parseInt(tgData.id), tgData.username || null, tgData.first_name || null,
             tgData.photo_url || null, req.user.id]
        );

        await query(
            `INSERT INTO logs (level, category, message, details)
             VALUES ('info', 'auth', $1, $2)`,
            [`Привязан Telegram к ${req.user.username}`, JSON.stringify({
                telegram_id: tgData.id, telegram_username: tgData.username,
            })]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('[AUTH] telegram link error:', err.message);
        res.status(500).json({ error: 'Ошибка привязки Telegram' });
    }
});

// POST /api/auth/login
router.post('/login', [
    body('username').isString().trim().notEmpty(),
    body('password').isString().notEmpty(),
    body('totp_code').optional().isString(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Некорректные данные', details: errors.array() });
    }

    const { username, password, totp_code } = req.body;
    const result = await authenticateUser(username, password, totp_code);

    if (!result.success) {
        await query(
            `INSERT INTO logs (level, category, message, details)
             VALUES ('warning', 'auth', $1, $2)`,
            [`Неудачная попытка входа: ${username}`, JSON.stringify({ ip: req.ip })]
        );
        const status = result.requires2fa ? 200 : 401;
        return res.status(status).json(result);
    }

    await query(
        `INSERT INTO logs (level, category, message, details)
         VALUES ('info', 'auth', $1, $2)`,
        [`Успешный вход: ${username}`, JSON.stringify({ ip: req.ip })]
    );

    res.json(result);
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, async (req, res) => {
    await query(
        `INSERT INTO logs (level, category, message) VALUES ('info', 'auth', $1)`,
        [`Выход: ${req.user.username}`]
    );
    res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
    const admin = await queryOne(
        `SELECT id, username, totp_secret, role, max_vpn_clients, created_at,
         telegram_id, telegram_username, telegram_first_name, telegram_photo_url
         FROM admins WHERE id = $1`,
        [req.user.id]
    );
    if (!admin) return res.status(404).json({ error: 'Пользователь не найден' });

    const response = {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        has2fa: !!admin.totp_secret,
        max_vpn_clients: admin.max_vpn_clients,
        createdAt: admin.created_at,
        telegram_id: admin.telegram_id || null,
        telegram_username: admin.telegram_username || null,
        telegram_photo_url: admin.telegram_photo_url || null,
    };

    if (admin.role === 'user') {
        const vpn = await queryOne('SELECT COUNT(*) as c FROM clients WHERE owner_id = $1', [admin.id]);
        response.vpn_count = parseInt(vpn.c);
    }

    res.json(response);
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, [
    body('oldPassword').isString().notEmpty(),
    body('newPassword').isString().isLength({ min: 6 }),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }
    const result = await changePassword(req.user.id, req.body.oldPassword, req.body.newPassword);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
});

// 2FA
router.post('/2fa/setup', authMiddleware, async (req, res) => {
    const result = await setup2FA(req.user.id);
    res.json(result);
});

router.post('/2fa/enable', authMiddleware, [
    body('secret').isString().notEmpty(),
    body('token').isString().notEmpty(),
], async (req, res) => {
    const result = await enable2FA(req.user.id, req.body.secret, req.body.token);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
});

router.post('/2fa/disable', authMiddleware, async (req, res) => {
    const result = await disable2FA(req.user.id);
    res.json(result);
});

module.exports = router;
