// JWT авторизация и middleware (PostgreSQL)
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const { queryOne, query } = require('../db/postgres');

const SECRET = process.env.PANEL_SECRET_KEY || 'default-secret-change-me';
const TOKEN_EXPIRY = '24h';

// Генерация JWT-токена
function generateToken(userId, username, role) {
    return jwt.sign({ id: userId, username, role }, SECRET, { expiresIn: TOKEN_EXPIRY });
}

// Проверка JWT-токена
function verifyToken(token) {
    return jwt.verify(token, SECRET);
}

// Middleware авторизации
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = verifyToken(token);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Невалидный или истёкший токен' });
    }
}

// Middleware только для администраторов
function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Доступ только для администратора' });
    }
    next();
}

// Авторизация: проверка логина/пароля
async function authenticateUser(username, password, totpCode) {
    const admin = await queryOne('SELECT * FROM admins WHERE username = $1', [username]);

    if (!admin) {
        return { success: false, error: 'Неверный логин или пароль' };
    }

    if (!bcrypt.compareSync(password, admin.password_hash)) {
        return { success: false, error: 'Неверный логин или пароль' };
    }

    // Проверка 2FA
    if (admin.totp_secret) {
        if (!totpCode) {
            return { success: false, error: 'Требуется код 2FA', requires2fa: true };
        }
        const isValid = authenticator.verify({ token: totpCode, secret: admin.totp_secret });
        if (!isValid) {
            return { success: false, error: 'Неверный код 2FA' };
        }
    }

    const token = generateToken(admin.id, admin.username, admin.role);
    return {
        success: true,
        token,
        user: {
            id: admin.id,
            username: admin.username,
            role: admin.role,
            max_vpn_clients: admin.max_vpn_clients,
        },
    };
}

// Смена пароля
async function changePassword(userId, oldPassword, newPassword) {
    const admin = await queryOne('SELECT * FROM admins WHERE id = $1', [userId]);

    if (!admin || !bcrypt.compareSync(oldPassword, admin.password_hash)) {
        return { success: false, error: 'Неверный текущий пароль' };
    }

    const hash = bcrypt.hashSync(newPassword, 12);
    await query('UPDATE admins SET password_hash = $1 WHERE id = $2', [hash, userId]);
    return { success: true };
}

// Настройка 2FA
async function setup2FA(userId) {
    const secret = authenticator.generateSecret();
    const admin = await queryOne('SELECT username FROM admins WHERE id = $1', [userId]);
    const otpauth = authenticator.keyuri(admin.username, 'VPN-Panel', secret);
    return { secret, otpauth };
}

// Активация 2FA
async function enable2FA(userId, secret, token) {
    const isValid = authenticator.verify({ token, secret });
    if (!isValid) {
        return { success: false, error: 'Неверный код подтверждения' };
    }
    await query('UPDATE admins SET totp_secret = $1 WHERE id = $2', [secret, userId]);
    return { success: true };
}

// Отключение 2FA
async function disable2FA(userId) {
    await query('UPDATE admins SET totp_secret = NULL WHERE id = $1', [userId]);
    return { success: true };
}

module.exports = {
    generateToken,
    verifyToken,
    authMiddleware,
    adminOnly,
    authenticateUser,
    changePassword,
    setup2FA,
    enable2FA,
    disable2FA,
};
