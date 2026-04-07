const nodemailer = require('nodemailer');
const dns = require('dns');

let transporter = null;
let lastConfig = '';

async function getSmtpConfig() {
    const { queryAll } = require('../db/postgres');
    const keys = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from'];
    const rows = await queryAll("SELECT key, value FROM settings WHERE key = ANY($1)", [keys]);
    const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const port = parseInt(cfg.smtp_port || process.env.SMTP_PORT || '465');
    return {
        host: cfg.smtp_host || process.env.SMTP_HOST || '',
        port,
        secure: port === 465,
        user: cfg.smtp_user || process.env.SMTP_USER || '',
        pass: cfg.smtp_pass || process.env.SMTP_PASS || '',
        from: cfg.smtp_from || process.env.SMTP_FROM || cfg.smtp_user || '',
    };
}

// Resolve hostname to IPv6 first, fall back to IPv4
function resolveHost(hostname) {
    return new Promise((resolve) => {
        // Try IPv6 first
        dns.resolve6(hostname, (err, addrs) => {
            if (!err && addrs && addrs.length > 0) {
                return resolve({ ip: addrs[0], servername: hostname });
            }
            // Fallback to IPv4
            dns.resolve4(hostname, (err, addrs) => {
                if (!err && addrs && addrs.length > 0) {
                    return resolve({ ip: addrs[0], servername: hostname });
                }
                // Use hostname as-is
                resolve({ ip: hostname, servername: null });
            });
        });
    });
}

async function getTransporter() {
    const cfg = await getSmtpConfig();
    const configKey = JSON.stringify(cfg);
    
    if (!transporter || configKey !== lastConfig) {
        if (!cfg.host || !cfg.user || !cfg.pass) {
            throw new Error('SMTP не настроен. Настройки → Почта.');
        }

        // Resolve to IPv6 if possible (many VPS block IPv4 SMTP)
        const resolved = await resolveHost(cfg.host);

        transporter = nodemailer.createTransport({
            host: resolved.ip,
            port: cfg.port,
            secure: cfg.secure,
            auth: { user: cfg.user, pass: cfg.pass },
            tls: {
                rejectUnauthorized: false,
                servername: resolved.servername || cfg.host,
            },
            connectionTimeout: 15000,
            socketTimeout: 15000,
        });
        lastConfig = configKey;
    }
    return { transporter, from: cfg.from };
}

async function sendCode(email, code) {
    const { transporter: t, from } = await getTransporter();
    const html = `
        <div style="font-family: -apple-system, sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px; text-align: center;">
            <h2 style="color: #fff; background: #1a1a2e; padding: 20px; border-radius: 12px; margin-bottom: 20px;">VPN Panel</h2>
            <p style="color: #333; font-size: 16px; margin-bottom: 8px;">Ваш код для входа:</p>
            <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #3b82f6; padding: 20px; background: #f0f4ff; border-radius: 12px; margin: 20px 0;">${code}</div>
            <p style="color: #888; font-size: 13px;">Код действителен 5 минут</p>
        </div>
    `;
    await t.sendMail({ from, to: email, subject: 'Код для входа — VPN', html });
}

async function testConnection() {
    transporter = null;
    const { transporter: t } = await getTransporter();
    await t.verify();
    return { success: true };
}

module.exports = { sendCode, testConnection };
