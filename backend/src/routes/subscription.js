// Публичный endpoint подписки (без авторизации)
// VPN-клиенты (V2RayNG, Hiddify, Streisand, Shadowrocket) автоматически
// забирают актуальный конфиг по этому URL
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { queryAll, queryOne, query } = require('../db/postgres');
const xrayService = require('../services/xray');

const XRAY_PROTOCOLS = ['vless'];

/**
 * Извлечь HWID и информацию об устройстве из заголовков запроса.
 * Разные VPN-приложения отправляют разные заголовки:
 * - V2RayNG: X-Device-Id, User-Agent содержит "V2RayNG"
 * - Hiddify: X-Device-Id или Hiddify-Device-Id
 * - Streisand: X-Device-Id
 * - Shadowrocket: User-Agent содержит "Shadowrocket"
 * - Sing-box: User-Agent содержит "sing-box"
 * - NekoBox: User-Agent содержит "NekoBox"
 */

/**
 * Определить бренд устройства из модели в User-Agent
 */
function detectBrand(model) {
    const m = model.toUpperCase();
    // Samsung: SM-XXXXX
    if (m.includes('SAMSUNG')) return model;
    if (m.startsWith('SM-')) return 'Samsung ' + model;
    // Xiaomi/Redmi/POCO
    if (m.includes('XIAOMI')) return model;
    if (m.includes('REDMI') || m.includes('POCO') || m.startsWith('M200') || m.startsWith('220')) return 'Xiaomi ' + model;
    // Google Pixel
    if (m.includes('PIXEL')) return 'Google ' + model;
    // Huawei
    if (m.includes('HUAWEI')) return model;
    if (m.startsWith('VOG-') || m.startsWith('ELS-') || m.startsWith('NOH-')) return 'Huawei ' + model;
    // OnePlus
    if (m.includes('ONEPLUS')) return model;
    if (m.startsWith('KB200') || m.startsWith('IN20') || m.startsWith('LE2')) return 'OnePlus ' + model;
    // OPPO/Realme
    if (m.includes('OPPO')) return model;
    if (m.includes('CPH')) return 'OPPO ' + model;
    if (m.includes('REALME')) return model;
    if (m.startsWith('RMX')) return 'Realme ' + model;
    // Vivo
    if (m.includes('VIVO')) return model;
    if (m.startsWith('V2')) return 'Vivo ' + model;
    // Honor
    if (m.includes('HONOR')) return model;
    // Nothing
    if (m.includes('NOTHING') || m.startsWith('A063')) return 'Nothing ' + model;
    return model;
}

function extractDeviceInfo(req) {
    const ua = req.headers['user-agent'] || '';

    // HWID: пробуем несколько заголовков (Remnawave-compatible + другие)
    let hwid = req.headers['x-hwid']
        || req.headers['x-device-id']
        || req.headers['hiddify-device-id']
        || req.headers['device-id']
        || null;

    // IP: приоритет заголовкам nginx, затем req.ip
    const ip = req.headers['x-real-ip']
        || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || (req.ip && !req.ip.startsWith('172.') && !req.ip.startsWith('::ffff:172.') ? req.ip : null)
        || req.connection?.remoteAddress
        || null;

    if (!hwid && ua && ip) {
        hwid = 'auto-' + crypto.createHash('sha256').update(ua + '::' + ip).digest('hex').substring(0, 16);
    }

    if (!hwid) return null;

    // Определяем тип устройства, приложение и модель из User-Agent
    let deviceType = 'unknown';
    let appName = 'unknown';
    let appVersion = '';
    let deviceName = null;

    if (ua.includes('V2RayNG') || ua.includes('v2rayNG')) {
        appName = 'V2RayNG';
        deviceType = 'android';
        const m = ua.match(/V2RayNG\/([\d.]+)/i);
        if (m) appVersion = m[1];
    } else if (ua.includes('Hiddify')) {
        appName = 'Hiddify';
        const m = ua.match(/Hiddify\/([\d.]+)/);
        if (m) appVersion = m[1];
        if (ua.includes('Android')) deviceType = 'android';
        else if (ua.includes('iOS') || ua.includes('iPhone')) deviceType = 'ios';
        else if (ua.includes('Windows')) deviceType = 'windows';
        else if (ua.includes('Mac')) deviceType = 'macos';
        else if (ua.includes('Linux')) deviceType = 'linux';
    } else if (ua.includes('Shadowrocket')) {
        appName = 'Shadowrocket';
        deviceType = 'ios';
        const m = ua.match(/Shadowrocket\/([\d.]+)/);
        if (m) appVersion = m[1];
    } else if (ua.includes('Streisand')) {
        appName = 'Streisand';
        const m = ua.match(/Streisand\/([\d.]+)/);
        if (m) appVersion = m[1];
        if (ua.includes('iOS') || ua.includes('iPhone')) deviceType = 'ios';
        else if (ua.includes('Mac')) deviceType = 'macos';
    } else if (ua.includes('sing-box')) {
        appName = 'sing-box';
        const m = ua.match(/sing-box\/([\d.]+)/);
        if (m) appVersion = m[1];
        if (ua.includes('Android')) deviceType = 'android';
        else if (ua.includes('iOS') || ua.includes('Darwin')) deviceType = 'ios';
        else if (ua.includes('Windows')) deviceType = 'windows';
    } else if (ua.includes('NekoBox') || ua.includes('NekoRay')) {
        appName = ua.includes('NekoBox') ? 'NekoBox' : 'NekoRay';
        deviceType = 'android';
        const m = ua.match(/Neko(?:Box|Ray)\/([\d.]+)/);
        if (m) appVersion = m[1];
    } else if (ua.includes('v2rayN')) {
        appName = 'v2rayN';
        deviceType = 'windows';
        const m = ua.match(/v2rayN\/([\d.]+)/);
        if (m) appVersion = m[1];
    } else if (ua.includes('Clash')) {
        appName = 'Clash';
        const m = ua.match(/Clash\/([\d.]+)/);
        if (m) appVersion = m[1];
    } else if (ua.includes('Happ')) {
        appName = 'Happ';
        const m = ua.match(/Happ\/([\d.]+)/);
        if (m) appVersion = m[1];
        if (ua.includes('ios') || ua.includes('Darwin')) deviceType = 'ios';
        else if (ua.includes('Android')) deviceType = 'android';
    } else if (ua.includes('CFNetwork') || ua.includes('Darwin')) {
        appName = 'iOS App';
        deviceType = 'ios';
    }

    // === Определяем deviceName (модель устройства) ===

    // 1. Remnawave-compatible заголовки (максимальный приоритет)
    //    VPN-приложения (Happ, V2RayNG, Streisand и др.) могут отправлять:
    //    x-device-model: "iPhone 15 Pro", "Samsung Galaxy S24"
    //    x-device-os: "iOS", "Android"  
    //    x-ver-os: "17.5", "14"
    const xDeviceModel = req.headers['x-device-model'];
    const xDeviceOs = req.headers['x-device-os'];
    const xVerOs = req.headers['x-ver-os'];

    if (xDeviceModel) {
        // Применяем detectBrand для кодов типа "SM-S918B" → "Samsung SM-S918B"
        deviceName = detectBrand(xDeviceModel);
    }
    if (xDeviceOs) {
        const osLower = xDeviceOs.toLowerCase();
        if (osLower.includes('ios') || osLower.includes('iphone')) deviceType = 'ios';
        else if (osLower.includes('android')) deviceType = 'android';
        else if (osLower.includes('windows')) deviceType = 'windows';
        else if (osLower.includes('mac') || osLower.includes('darwin')) deviceType = 'macos';
        else if (osLower.includes('linux')) deviceType = 'linux';
    }

    // 2. Из других заголовков
    if (!deviceName) {
        deviceName = req.headers['x-device-name'] || req.headers['device-name'] || null;
    }

    // 2. Из User-Agent — пытаемся извлечь модель
    if (!deviceName) {
        // iPhone/iPad из UA: "Shadowrocket/2.2.3 (iPhone14,5; iOS 17.0)"
        const iosModel = ua.match(/\((iPhone[^;)]*|iPad[^;)]*)/);
        if (iosModel) {
            // "iPhone14,5" → "iPhone"
            deviceName = iosModel[1].replace(/[\d,]+$/, '').trim() || 'iPhone';
        }
        // Android модель из UA
        // Формат 1: "(Linux; Android 14; SM-S928B Build/...)" — модель после "Android XX;"
        // Формат 2: "(Samsung SM-G991B; Android 14)"  — модель перед "Android"
        if (!deviceName && (ua.includes('Android') || deviceType === 'android')) {
            // Формат 1: модель после Android версии (Hiddify, sing-box)
            let androidModel = ua.match(/Android\s*[\d.]*;\s*([^;)]+?)(?:\s+Build\/|\s*[;)])/);
            if (androidModel) {
                const model = androidModel[1].trim();
                if (model && model !== 'Linux' && model.length > 1) {
                    deviceName = detectBrand(model);
                }
            }
            // Формат 2: модель перед ; Android
            if (!deviceName) {
                androidModel = ua.match(/\(([^;)]+);\s*Android/);
                if (androidModel) {
                    const model = androidModel[1].trim();
                    if (model && model !== 'Linux' && model.length > 1) {
                        deviceName = detectBrand(model);
                    }
                }
            }
        }
    }

    // 3. Фоллбэк по типу устройства
    if (!deviceName) {
        if (deviceType === 'ios') {
            if (ua.includes('iPad')) deviceName = 'iPad';
            else deviceName = 'iPhone';
        } else if (deviceType === 'android') {
            deviceName = 'Android';
        } else if (deviceType === 'windows') {
            deviceName = 'Windows PC';
        } else if (deviceType === 'macos') {
            deviceName = 'Mac';
        } else if (deviceType === 'linux') {
            deviceName = 'Linux PC';
        }
    }

    // Формируем полное имя приложения с версией
    const fullAppName = appVersion ? appName + ' ' + appVersion : appName;

    return { hwid, deviceType, appName: fullAppName, deviceName, ip };
}

/**
 * Проверить и зарегистрировать устройство. Возвращает true если доступ разрешён.
 */
async function checkAndRegisterDevice(subToken, deviceInfo, deviceLimit) {
    if (!deviceInfo || !deviceInfo.hwid) return true;

    const isAutoHwid = deviceInfo.hwid.startsWith('auto-');

    // Auto-HWID (сгенерированный из UA+IP) — только трекинг, без блокировки
    if (isAutoHwid) {
        await upsertDevice(subToken, deviceInfo);
        return true;
    }

    // Лимит не установлен — регистрируем и пропускаем
    if (deviceLimit <= 0) {
        await upsertDevice(subToken, deviceInfo);
        return true;
    }

    const { hwid } = deviceInfo;

    // Проверяем: отозвано ли устройство?
    const existing = await queryOne(
        'SELECT id, is_revoked FROM client_devices WHERE sub_token = $1 AND hwid = $2',
        [subToken, hwid]
    );

    if (existing && existing.is_revoked) return false;

    // Уже зарегистрировано и не отозвано — обновляем и пропускаем
    if (existing) {
        await upsertDevice(subToken, deviceInfo);
        return true;
    }

    // Новое устройство — проверяем лимит ДО регистрации
    const activeCount = await queryOne(
        `SELECT COUNT(*) as cnt FROM client_devices
         WHERE sub_token = $1 AND is_revoked = FALSE AND hwid NOT LIKE 'auto-%'`,
        [subToken]
    );

    if (parseInt(activeCount.cnt) >= deviceLimit) {
        return false;
    }

    // Лимит не превышен — регистрируем
    await upsertDevice(subToken, deviceInfo);
    return true;
}

async function upsertDevice(subToken, deviceInfo) {
    await query(`
        INSERT INTO client_devices (sub_token, hwid, device_name, device_type, app_name, last_ip)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (sub_token, hwid) DO UPDATE SET
            last_seen = NOW(),
            last_ip = COALESCE($6, client_devices.last_ip),
            device_name = COALESCE($3, client_devices.device_name),
            device_type = COALESCE($4, client_devices.device_type),
            app_name = COALESCE($5, client_devices.app_name)
    `, [subToken, deviceInfo.hwid, deviceInfo.deviceName, deviceInfo.deviceType, deviceInfo.appName, deviceInfo.ip]);
}

// GET /api/sub/:token — Subscription URL (публичный, без авторизации)
// Один токен = все протоколы клиента (VLESS)
router.get('/:token', async (req, res) => {
    try {
        const { token } = req.params;

        // Ищем ВСЕХ клиентов с этим sub_token (группа протоколов)
        const clientList = await queryAll(
            'SELECT * FROM clients WHERE sub_token = $1 ORDER BY protocol',
            [token]
        );

        if (!clientList || clientList.length === 0) {
            return res.status(404).type('text/plain').send('Not found');
        }

        // Если все заблокированы — отказ
        const activeClients = clientList.filter(c => !c.is_blocked);
        if (activeClients.length === 0) {
            return res.status(403).type('text/plain').send('Blocked');
        }

        // HWID проверка: берём device_limit из первого клиента (общий для подписки)
        const deviceLimit = parseInt(clientList[0].device_limit) || 0;
        const deviceInfo = extractDeviceInfo(req);
        console.log(`[SUB] token=${token.slice(0,8)}... IP=${deviceInfo?.ip || '?'} device=${deviceInfo?.deviceName || '?'} app=${deviceInfo?.appName || '?'} hwid=${deviceInfo?.hwid?.slice(0,12) || 'none'}${req.headers['x-device-model'] ? ' model=' + req.headers['x-device-model'] : ''}`);

        const allowed = await checkAndRegisterDevice(token, deviceInfo, deviceLimit);
        if (!allowed) {
            console.log(`[SUB] HWID blocked: token=${token.slice(0, 8)}... hwid=${deviceInfo?.hwid?.slice(0, 16)}... limit=${deviceLimit}`);
            return res.status(403).type('text/plain').send('Device limit reached');
        }

        const firstName = clientList[0].name;

        // Суммарная статистика по всем протоколам
        let totalUpload = 0, totalDownload = 0, totalLimit = 0;
        let earliestExpire = 0;
        for (const c of clientList) {
            totalUpload += parseInt(c.upload_bytes) || 0;
            totalDownload += parseInt(c.download_bytes) || 0;
            totalLimit += parseInt(c.traffic_limit_bytes) || 0;
            if (c.expires_at) {
                const ts = Math.floor(new Date(c.expires_at).getTime() / 1000);
                if (!earliestExpire || ts < earliestExpire) earliestExpire = ts;
            }
        }

        // Заголовки для VPN-клиентов
        res.setHeader('profile-update-interval', '1');
        res.setHeader('content-disposition', `attachment; filename="${firstName}"`);
        res.setHeader(
            'subscription-userinfo',
            `upload=${totalUpload}; download=${totalDownload}; total=${totalLimit}; expire=${earliestExpire}`
        );

        // Собираем share links для всех Xray-протоколов (с мульти-SNI)
        const links = [];
        for (const c of activeClients) {
            if (XRAY_PROTOCOLS.includes(c.protocol) && c.xray_inbound_id) {
                try {
                    const multiLinks = await xrayService.generateShareLinks(c.id);
                    if (multiLinks) links.push(...multiLinks);
                } catch {}
            }
        }

        if (links.length === 0) {
            return res.status(404).type('text/plain').send('No configs');
        }

        // Стандартный формат подписки: все ссылки через \n, затем base64
        const combined = links.join('\n');
        const encoded = Buffer.from(combined).toString('base64');
        res.type('text/plain').send(encoded);

    } catch (err) {
        console.error('[SUB] Ошибка:', err.message);
        res.status(500).type('text/plain').send('Error');
    }
});

module.exports = router;
