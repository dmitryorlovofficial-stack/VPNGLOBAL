// Сервис Telegram-бота (PostgreSQL)
const https = require('https');
const { queryOne } = require('../db/postgres');

async function sendMessage(text) {
    const token = (await queryOne("SELECT value FROM settings WHERE key = 'telegram_token'"))?.value;
    const chatId = (await queryOne("SELECT value FROM settings WHERE key = 'telegram_chat_id'"))?.value;
    const enabled = (await queryOne("SELECT value FROM settings WHERE key = 'telegram_enabled'"))?.value;

    if (!token || !chatId || enabled !== '1') {
        return { ok: false, reason: 'Telegram не настроен' };
    }

    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
        const options = {
            hostname: 'api.telegram.org', port: 443,
            path: `/bot${token}/sendMessage`, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(JSON.parse(body)));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function notifyNewClient(clientName, ip) {
    return sendMessage(`<b>Новый клиент</b>\nИмя: ${clientName}\nIP: ${ip}`);
}

function notifyClientBlocked(clientName, reason) {
    return sendMessage(`<b>Клиент заблокирован</b>\nИмя: ${clientName}\nПричина: ${reason}`);
}

function notifyServerDown(serverName) {
    return sendMessage(`<b>Сервер недоступен</b>\n${serverName}`);
}

function notifyServerUp(serverName) {
    return sendMessage(`<b>Сервер восстановлен</b>\n${serverName}`);
}

function sendTestMessage() {
    return sendMessage('<b>Тестовое уведомление</b>\nVPN-панель работает.');
}

module.exports = { sendMessage, notifyNewClient, notifyClientBlocked, notifyServerDown, notifyServerUp, sendTestMessage };
