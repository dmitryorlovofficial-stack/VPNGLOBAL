const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { queryAll, queryOne, query } = require('../db/postgres');

// Генерация уникального label для платежа
function generateLabel() {
    return 'vpn_' + crypto.randomBytes(8).toString('hex');
}

// POST /api/payments/create — создать платёж (user portal)
router.post('/create', async (req, res) => {
    try {
        const { email, tariff_id } = req.body;
        if (!email || !tariff_id) return res.status(400).json({ error: 'email and tariff_id required' });

        const tariff = await queryOne('SELECT * FROM tariffs WHERE id = $1 AND is_active = TRUE', [tariff_id]);
        if (!tariff) return res.status(404).json({ error: 'Тариф не найден' });

        const label = generateLabel();
        const settings = {};
        const rows = await queryAll("SELECT key, value FROM settings WHERE key IN ('yoomoney_wallet', 'yoomoney_secret')");
        rows.forEach(r => settings[r.key] = r.value);

        if (!settings.yoomoney_wallet) return res.status(500).json({ error: 'ЮMoney кошелёк не настроен' });

        // Сохраняем платёж
        await query(
            'INSERT INTO payments (user_email, tariff_id, amount, label, status) VALUES ($1,$2,$3,$4,$5)',
            [email, tariff_id, tariff.price, label, 'pending']
        );

        // Формируем URL оплаты
        const paymentUrl = `https://yoomoney.ru/quickpay/confirm.xml?receiver=${settings.yoomoney_wallet}&quickpay-form=button&paymentType=AC&sum=${tariff.price}&label=${label}&successURL=${encodeURIComponent(req.headers.origin || 'https://' + req.headers.host)}/user`;

        res.json({ payment_url: paymentUrl, label });
    } catch (err) {
        console.error('[PAYMENT] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/payments/yoomoney-webhook — уведомление от ЮMoney
router.post('/yoomoney-webhook', express.urlencoded({ extended: false }), async (req, res) => {
    try {
        const { notification_type, operation_id, amount, currency, datetime, sender, codepro, label, sha1_hash } = req.body;

        console.log('[YOOMONEY] Webhook:', JSON.stringify(req.body));

        // Проверяем подпись
        const settings = {};
        const rows = await queryAll("SELECT key, value FROM settings WHERE key IN ('yoomoney_secret')");
        rows.forEach(r => settings[r.key] = r.value);

        const secret = settings.yoomoney_secret || '';
        const checkString = [notification_type, operation_id, amount, currency, datetime, sender, codepro, secret, label].join('&');
        const hash = crypto.createHash('sha1').update(checkString).digest('hex');

        if (hash !== sha1_hash) {
            console.log('[YOOMONEY] Invalid signature');
            return res.status(400).send('Invalid signature');
        }

        if (codepro === 'true') {
            console.log('[YOOMONEY] Code-protected payment, skipping');
            return res.status(200).send('OK');
        }

        // Ищем платёж
        const payment = await queryOne('SELECT * FROM payments WHERE label = $1', [label]);
        if (!payment) {
            console.log('[YOOMONEY] Payment not found for label:', label);
            return res.status(200).send('OK');
        }

        if (payment.status === 'paid') {
            return res.status(200).send('Already processed');
        }

        // Проверяем сумму
        if (parseFloat(amount) < parseFloat(payment.amount)) {
            console.log('[YOOMONEY] Underpayment:', amount, '<', payment.amount);
            return res.status(200).send('Underpayment');
        }

        // Помечаем как оплачено
        await query(
            'UPDATE payments SET status = $1, yoomoney_operation_id = $2, paid_at = NOW() WHERE id = $3',
            ['paid', operation_id, payment.id]
        );

        // Создаём или продлеваем VPN
        await activateSubscription(payment);

        console.log('[YOOMONEY] Payment processed:', label, payment.user_email);
        res.status(200).send('OK');
    } catch (err) {
        console.error('[YOOMONEY] Webhook error:', err.message);
        res.status(200).send('Error logged');
    }
});

// Активация подписки после оплаты
async function activateSubscription(payment) {
    const tariff = await queryOne('SELECT * FROM tariffs WHERE id = $1', [payment.tariff_id]);
    if (!tariff) return;

    // Ищем существующего клиента по email
    let client = await queryOne(
        "SELECT * FROM clients WHERE email = $1 AND protocol = 'vless' ORDER BY id LIMIT 1",
        [payment.user_email]
    );

    if (client) {
        // Продлеваем: от текущего expires_at или от NOW()
        const baseDate = client.expires_at && new Date(client.expires_at) > new Date()
            ? new Date(client.expires_at)
            : new Date();
        const newExpiry = new Date(baseDate);
        newExpiry.setDate(newExpiry.getDate() + tariff.duration_days);

        await query(
            "UPDATE clients SET expires_at = $1, is_blocked = FALSE WHERE sub_token = $2",
            [newExpiry.toISOString(), client.sub_token]
        );

        await query('UPDATE payments SET client_id = $1 WHERE id = $2', [client.id, payment.id]);
        console.log('[PAYMENT] Extended subscription for', payment.user_email, 'until', newExpiry.toISOString());
    } else {
        // Создаём нового клиента через API (auto_all)
        const subToken = crypto.randomBytes(16).toString('hex');
        const xrayUuid = crypto.randomUUID();
        const newExpiry = new Date();
        newExpiry.setDate(newExpiry.getDate() + tariff.duration_days);

        // Находим все inbound'ы для VLESS
        const inbounds = await queryAll(
            "SELECT xi.*, s.name as server_name FROM xray_inbounds xi JOIN servers s ON s.id = xi.server_id WHERE xi.protocol = 'vless' AND xi.is_enabled = TRUE"
        );

        for (const inbound of inbounds) {
            const newClient = await queryOne(
                `INSERT INTO clients (name, email, protocol, server_id, xray_inbound_id, xray_uuid, sub_token, is_blocked, expires_at, owner_id)
                 VALUES ($1, $2, 'vless', $3, $4, $5, $6, FALSE, $7, 1)
                 RETURNING *`,
                [payment.user_email.split('@')[0], payment.user_email, inbound.server_id, inbound.id, xrayUuid, subToken, newExpiry.toISOString()]
            );

            if (!payment.client_id) {
                await query('UPDATE payments SET client_id = $1 WHERE id = $2', [newClient.id, payment.id]);
            }
        }

        // Deploy Xray config
        try {
            const xrayService = require('../services/xray');
            const servers = await queryAll('SELECT id FROM servers WHERE is_active = TRUE');
            for (const s of servers) {
                await xrayService.deployConfig(s.id);
            }
            console.log('[PAYMENT] New client created and deployed for', payment.user_email);
        } catch (err) {
            console.error('[PAYMENT] Deploy error:', err.message);
        }
    }
}

// GET /api/payments — список платежей (admin)
router.get('/', async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const payments = await queryAll(
        'SELECT p.*, t.name as tariff_name FROM payments p LEFT JOIN tariffs t ON t.id = p.tariff_id ORDER BY p.created_at DESC LIMIT 100'
    );
    res.json(payments);
});

module.exports = router;
