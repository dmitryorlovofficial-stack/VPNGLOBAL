// Валидация данных Telegram Login Widget (HMAC-SHA256)
const crypto = require('crypto');

/**
 * Проверяет подлинность данных от Telegram Login Widget.
 * https://core.telegram.org/widgets/login#checking-authorization
 *
 * @param {Object} data - данные от виджета (id, first_name, username, photo_url, auth_date, hash)
 * @param {string} botToken - токен Telegram-бота
 * @returns {boolean}
 */
function validateTelegramAuth(data, botToken) {
    if (!data || !data.hash || !data.id || !data.auth_date) return false;
    if (!botToken) return false;

    // auth_date не старше 5 минут
    const now = Math.floor(Date.now() / 1000);
    if (now - parseInt(data.auth_date) > 300) return false;

    // Собираем data_check_string: сортированные key=value через \n (без hash)
    const { hash, ...rest } = data;
    const checkString = Object.keys(rest)
        .sort()
        .map(k => `${k}=${rest[k]}`)
        .join('\n');

    // secret_key = SHA256(bot_token)
    const secretKey = crypto.createHash('sha256').update(botToken).digest();

    // hmac = HMAC-SHA256(secret_key, data_check_string)
    const hmac = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

    return hmac === hash;
}

module.exports = { validateTelegramAuth };
