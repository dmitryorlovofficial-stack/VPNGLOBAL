// Маршруты управления SSL (Let's Encrypt через certbot Docker)
const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('../auth/jwt');
const { query, queryOne } = require('../db/postgres');
const { execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

const SSL_ENV_PATH = '/app/configs/ssl.env';
const LETSENCRYPT_LIVE = '/etc/letsencrypt/live';

router.use(authMiddleware, adminOnly);

// ─── Утилиты ────────────────────────────────────────────────

// Валидация домена (защита от shell injection)
function isValidDomain(d) {
    return /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(d) && d.length <= 253;
}

function isValidEmail(e) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
}

// Читаем ssl.env
function readSslEnv() {
    try {
        const content = fs.readFileSync(SSL_ENV_PATH, 'utf8');
        const env = {};
        content.split('\n').forEach(line => {
            const idx = line.indexOf('=');
            if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        });
        return env;
    } catch {
        return {};
    }
}

// Пишем ssl.env
function writeSslEnv(domain, enabled = true) {
    fs.writeFileSync(SSL_ENV_PATH, [
        `SSL_ENABLED=${enabled ? 'true' : 'false'}`,
        `PANEL_DOMAIN=${domain || ''}`,
        ''
    ].join('\n'));
}

// Информация о сертификате
function getCertInfo(domain) {
    if (!domain) return { exists: false };

    const certPath = `${LETSENCRYPT_LIVE}/${domain}/fullchain.pem`;
    const keyPath = `${LETSENCRYPT_LIVE}/${domain}/privkey.pem`;

    try {
        if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
            return { exists: false, domain };
        }
        const certPem = fs.readFileSync(certPath, 'utf8');
        const x509 = new crypto.X509Certificate(certPem);
        const validTo = new Date(x509.validTo);
        const daysLeft = Math.floor((validTo - new Date()) / (1000 * 60 * 60 * 24));

        return {
            exists: true,
            domain,
            validFrom: x509.validFrom,
            validTo: x509.validTo,
            daysLeft,
            issuer: x509.issuer,
        };
    } catch (err) {
        return { exists: false, domain, error: err.message };
    }
}

// Exec с логированием
function dockerExec(cmd, timeout = 120000) {
    console.log(`[SSL] exec: ${cmd}`);
    return execSync(cmd, { timeout, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
}

// ─── GET /api/ssl/status ─────────────────────────────────────
router.get('/status', async (req, res) => {
    try {
        const sslEnv = readSslEnv();
        const domain = sslEnv.PANEL_DOMAIN || '';
        const enabled = sslEnv.SSL_ENABLED === 'true';

        if (!domain) {
            return res.json({ configured: false, enabled: false });
        }

        const cert = getCertInfo(domain);

        res.json({
            configured: true,
            enabled,
            domain,
            hasCert: cert.exists,
            validFrom: cert.validFrom || null,
            validTo: cert.validTo || null,
            daysLeft: cert.daysLeft ?? null,
            issuer: cert.issuer || null,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/ssl/obtain — получить сертификат ──────────────
router.post('/obtain', async (req, res) => {
    const { domain, email } = req.body;

    if (!domain || !isValidDomain(domain)) {
        return res.status(400).json({ error: 'Некорректный домен' });
    }
    if (email && !isValidEmail(email)) {
        return res.status(400).json({ error: 'Некорректный email' });
    }

    try {
        // Проверяем, может сертификат уже есть
        const existing = getCertInfo(domain);
        if (existing.exists && existing.daysLeft > 30) {
            // Уже есть валидный сертификат — просто включаем SSL
            writeSslEnv(domain, true);
            try { dockerExec('docker restart vpn-panel-frontend', 30000); } catch {}
            return res.json({
                success: true,
                message: `Сертификат уже существует (осталось ${existing.daysLeft} дней). SSL включён.`,
                cert: existing,
            });
        }

        // 1. Останавливаем frontend (освобождаем порт 80)
        console.log('[SSL] Останавливаю frontend для получения сертификата...');
        try { dockerExec('docker stop vpn-panel-frontend', 30000); } catch {}

        // Ждём освобождения порта
        await new Promise(r => setTimeout(r, 2000));

        // 2. Запускаем certbot через Docker
        const emailArg = email
            ? `--email ${email}`
            : '--register-unsafely-without-email';

        const cmd = [
            'docker run --rm --name certbot-obtain',
            '--network host',
            '-v /etc/letsencrypt:/etc/letsencrypt',
            '-v /var/lib/letsencrypt:/var/lib/letsencrypt',
            'certbot/certbot certonly --standalone',
            `-d ${domain}`,
            '--non-interactive --agree-tos',
            emailArg,
        ].join(' ');

        const output = dockerExec(cmd, 180000);
        console.log('[SSL] certbot output:', output);

        // 3. Проверяем, что сертификат появился
        const cert = getCertInfo(domain);
        if (!cert.exists) {
            throw new Error('Сертификат не найден после certbot');
        }

        // 4. Записываем ssl.env
        writeSslEnv(domain, true);

        // 5. Запускаем frontend (теперь с HTTPS)
        console.log('[SSL] Запускаю frontend с HTTPS...');
        try { dockerExec('docker start vpn-panel-frontend', 30000); } catch {}

        res.json({
            success: true,
            message: 'SSL-сертификат получен и активирован',
            cert,
        });
    } catch (err) {
        console.error('[SSL] Ошибка получения сертификата:', err.message);
        // Обязательно перезапускаем frontend
        try { dockerExec('docker start vpn-panel-frontend', 30000); } catch {}
        res.status(500).json({
            error: `Не удалось получить сертификат: ${err.message}`,
            hint: 'Проверьте: 1) DNS домена указывает на этот сервер 2) Порт 80 доступен извне',
        });
    }
});

// ─── POST /api/ssl/renew — принудительное обновление ─────────
router.post('/renew', async (req, res) => {
    try {
        const sslEnv = readSslEnv();
        const domain = sslEnv.PANEL_DOMAIN;

        if (!domain) {
            return res.status(400).json({ error: 'SSL не настроен' });
        }

        const cmd = [
            'docker run --rm',
            '-v /etc/letsencrypt:/etc/letsencrypt',
            '-v /var/lib/letsencrypt:/var/lib/letsencrypt',
            '-v /var/www/acme-challenge:/var/www/acme-challenge',
            'certbot/certbot renew --force-renewal',
        ].join(' ');

        const output = dockerExec(cmd, 180000);
        console.log('[SSL] renew output:', output);

        // Перезагружаем nginx
        try { dockerExec('docker exec vpn-panel-frontend nginx -s reload', 10000); } catch {
            try { dockerExec('docker restart vpn-panel-frontend', 30000); } catch {}
        }

        const cert = getCertInfo(domain);
        res.json({ success: true, cert });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── DELETE /api/ssl — отключить SSL ─────────────────────────
router.delete('/', async (req, res) => {
    try {
        writeSslEnv('', false);
        try { dockerExec('docker restart vpn-panel-frontend', 30000); } catch {}
        res.json({ success: true, message: 'SSL отключён. Панель работает по HTTP.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Периодическая проверка и автообновление ──────────────────
let renewalTimer = null;

function startAutoRenewal() {
    // Проверяем раз в 12 часов
    const INTERVAL = 12 * 60 * 60 * 1000;

    async function check() {
        try {
            const sslEnv = readSslEnv();
            if (sslEnv.SSL_ENABLED !== 'true' || !sslEnv.PANEL_DOMAIN) return;

            const cert = getCertInfo(sslEnv.PANEL_DOMAIN);
            if (!cert.exists || cert.daysLeft > 30) return;

            console.log(`[SSL] Сертификат истекает через ${cert.daysLeft} дней. Автообновление...`);

            const cmd = [
                'docker run --rm',
                '-v /etc/letsencrypt:/etc/letsencrypt',
                '-v /var/lib/letsencrypt:/var/lib/letsencrypt',
                '-v /var/www/acme-challenge:/var/www/acme-challenge',
                'certbot/certbot renew',
            ].join(' ');

            dockerExec(cmd, 180000);

            // Reload nginx
            try { dockerExec('docker exec vpn-panel-frontend nginx -s reload', 10000); } catch {
                try { dockerExec('docker restart vpn-panel-frontend', 30000); } catch {}
            }

            console.log('[SSL] Автообновление завершено');
        } catch (err) {
            console.error('[SSL] Ошибка автообновления:', err.message);
        }
    }

    // Первая проверка через 1 минуту после старта
    setTimeout(check, 60000);
    renewalTimer = setInterval(check, INTERVAL);
}

module.exports = router;
module.exports.startAutoRenewal = startAutoRenewal;
