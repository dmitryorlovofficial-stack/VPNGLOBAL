// Сервис управления связями между серверами (Xray-цепочки)
// Все операции через vpn-node агент (HTTP API)
const crypto = require('crypto');
const { queryOne, queryAll, query } = require('../db/postgres');
const nodeClient = require('./node-client');
const xrayService = require('./xray');

/**
 * Создать Xray-цепочку между серверами
 */
async function createTunnel(params) {
    const {
        name,
        from_server_id,
        to_server_id,
        endpoint_mode = 'ipv4',
        xray_protocol = 'vless',
        xray_port = 443,
        xray_settings = {},
        xray_stream_settings = {},
        server_group_id = null,
    } = params;

    const fromServer = await queryOne('SELECT * FROM servers WHERE id = $1', [from_server_id]);
    const toServer = await queryOne('SELECT * FROM servers WHERE id = $1', [to_server_id]);
    if (!fromServer) throw new Error('Сервер-источник не найден');
    if (!toServer) throw new Error('Сервер-назначения не найден');

    const fromXray = await queryOne('SELECT * FROM xray_instances WHERE server_id = $1', [from_server_id]);
    const toXray = await queryOne('SELECT * FROM xray_instances WHERE server_id = $1', [to_server_id]);
    if (!fromXray) throw new Error(`Xray не установлен на сервере "${fromServer.name}"`);
    if (!toXray) throw new Error(`Xray не установлен на сервере "${toServer.name}"`);

    // Валидация ролей: сервер не может быть Entry И Exit одновременно
    // (пропускаем для group-managed туннелей — в группе один сервер может быть Entry для нескольких Exit)
    if (!server_group_id) {
        const fromIsExit = await queryOne(
            `SELECT 1 FROM server_links WHERE to_server_id = $1 AND link_type = 'xray' AND status != 'error' AND server_group_id IS NULL LIMIT 1`,
            [from_server_id]
        );
        if (fromIsExit) {
            throw new Error(`Сервер "${fromServer.name}" уже используется как Exit — он не может быть Entry`);
        }

        const toIsEntry = await queryOne(
            `SELECT 1 FROM server_links WHERE from_server_id = $1 AND link_type = 'xray' AND status != 'error' AND server_group_id IS NULL LIMIT 1`,
            [to_server_id]
        );
        if (toIsEntry) {
            throw new Error(`Сервер "${toServer.name}" уже используется как Entry — он не может быть Exit`);
        }
    }

    const chainUuid = crypto.randomUUID();
    const chainTag = `chain-${from_server_id}-to-${to_server_id}`;
    const chainEmail = `chain-${from_server_id}-to-${to_server_id}@vpn`;
    const clientStream = { ...xray_stream_settings };
    const fingerprint = clientStream.realitySettings?.fingerprint || clientStream.tlsSettings?.fingerprint || 'chrome';

    // Проверяем, есть ли уже inbound на этом порту на exit-сервере (от другого тега)
    const existingPortInbound = await queryOne(
        'SELECT * FROM xray_inbounds WHERE server_id = $1 AND port = $2 AND tag != $3',
        [to_server_id, xray_port, chainTag]
    );

    const reuseInbound = !!existingPortInbound;
    if (reuseInbound && existingPortInbound.protocol !== xray_protocol) {
        throw new Error(
            `Порт ${xray_port} на "${toServer.name}" использует протокол ${existingPortInbound.protocol}, ` +
            `а маршрут — ${xray_protocol}. Выберите тот же протокол.`
        );
    }

    // Генерация / получение Reality ключей и построение outbound stream_settings
    let realityPrivateKey = null;
    let realityPublicKey = null;
    let realityShortIds = null;
    let sni = clientStream.realitySettings?.serverNames?.[0]
           || clientStream.tlsSettings?.serverName
           || 'www.google.com';
    let actualSecurity = clientStream.security || 'none';

    if (reuseInbound) {
        // Берём настройки из существующего inbound
        const existingStream = existingPortInbound.stream_settings || {};
        actualSecurity = existingStream.security || 'none';

        if (actualSecurity === 'reality' && existingStream.realitySettings) {
            realityPublicKey = existingStream.realitySettings.publicKey;
            realityShortIds = existingStream.realitySettings.shortIds;
            sni = existingStream.realitySettings.serverNames?.[0] || sni;
        } else if (actualSecurity === 'tls' && existingStream.tlsSettings) {
            sni = existingStream.tlsSettings.serverName || sni;
        }

        console.log(`[TUNNEL] Порт ${xray_port} занят inbound "${existingPortInbound.tag}" на exit #${to_server_id} — переиспользуем`);
    } else {
        // Генерируем новые ключи для нового inbound
        if (clientStream.security === 'reality') {
            const keys = await xrayService.generateRealityKeys(to_server_id);
            realityPrivateKey = keys.privateKey;
            realityPublicKey = keys.publicKey;
            realityShortIds = clientStream.realitySettings?.shortIds || [xrayService.generateShortId()];
        }
    }

    // Outbound stream_settings (для entry-сервера / buildChainOutbound)
    // XHTTP как дефолт для Reality (максимальная маскировка)
    let chainNetwork = reuseInbound
        ? (existingPortInbound.stream_settings?.network || 'tcp')
        : (clientStream.network || 'tcp');
    if (chainNetwork === 'tcp' && actualSecurity === 'reality') chainNetwork = 'xhttp';
    const outboundStreamSettings = { network: chainNetwork };
    if (chainNetwork === 'xhttp') {
        outboundStreamSettings.xhttpSettings = { path: '/', mode: 'auto' };
    }
    if (actualSecurity === 'reality') {
        outboundStreamSettings.security = 'reality';
        outboundStreamSettings.realitySettings = {
            serverName: sni,
            fingerprint,
            publicKey: realityPublicKey,
            shortId: realityShortIds?.[0] || '',
            spiderX: clientStream.realitySettings?.spiderX || '/',
        };
    } else if (actualSecurity === 'tls') {
        outboundStreamSettings.security = 'tls';
        outboundStreamSettings.tlsSettings = {
            serverName: sni,
            fingerprint,
            alpn: ['h2', 'http/1.1'],
        };
    }

    // Удаляем старые записи с ошибками для этой пары серверов (от предыдущих попыток)
    await query(
        `DELETE FROM server_links WHERE from_server_id = $1 AND to_server_id = $2
         AND link_type = 'xray' AND status = 'error'`,
        [from_server_id, to_server_id]
    );

    // Запоминаем старые маршруты К ЭТОМУ ЖЕ Exit от ДРУГИХ Entry-серверов
    // (очистим их ПОСЛЕ того как новый Entry будет задеплоен и готов)
    // Для group-managed туннелей НЕ удаляем старые — в группе может быть несколько Entry
    const oldEntryLinks = server_group_id ? [] : await queryAll(
        `SELECT * FROM server_links
         WHERE to_server_id = $1 AND link_type = 'xray' AND status = 'active'
         AND from_server_id != $2 AND server_group_id IS NULL`,
        [to_server_id, from_server_id]
    );
    if (oldEntryLinks.length > 0) {
        console.log(`[TUNNEL] Найдено ${oldEntryLinks.length} старых маршрутов к Exit #${to_server_id} — очистим после деплоя нового Entry`);
    }

    // Запись в БД
    const link = await queryOne(
        `INSERT INTO server_links (name, from_server_id, to_server_id, link_type, endpoint_mode,
            xray_protocol, xray_port, xray_uuid, xray_settings, xray_stream_settings, status, server_group_id)
         VALUES ($1, $2, $3, 'xray', $4, $5, $6, $7, $8, $9, 'creating', $10)
         RETURNING *`,
        [name || `${fromServer.name} → ${toServer.name}`,
         from_server_id, to_server_id, endpoint_mode,
         xray_protocol, xray_port, chainUuid,
         JSON.stringify(xray_settings), JSON.stringify(outboundStreamSettings),
         server_group_id]
    );

    try {
        let targetInboundId;

        if (reuseInbound) {
            // === Переиспользуем существующий inbound на этом порту ===
            targetInboundId = existingPortInbound.id;

            // Удаляем старый chain inbound с тем же тегом (если остался от предыдущей попытки)
            const oldChainInbound = await queryOne(
                'SELECT id FROM xray_inbounds WHERE server_id = $1 AND tag = $2',
                [to_server_id, chainTag]
            );
            if (oldChainInbound) {
                await query('DELETE FROM clients WHERE xray_inbound_id = $1', [oldChainInbound.id]);
                await xrayService.deleteInbound(oldChainInbound.id);
            }
        } else {
            // === Создаём новый dedicated chain inbound ===
            // Удаляем старый chain inbound с тем же тегом (повторная попытка)
            const oldChainInbound = await queryOne(
                'SELECT id FROM xray_inbounds WHERE server_id = $1 AND tag = $2',
                [to_server_id, chainTag]
            );
            if (oldChainInbound) {
                await query('DELETE FROM clients WHERE xray_inbound_id = $1', [oldChainInbound.id]);
                await xrayService.deleteInbound(oldChainInbound.id);
            }

            let inboundSettings = {};
            switch (xray_protocol) {
                case 'vless':
                    inboundSettings = { decryption: 'none' };
                    if (xray_settings.flow) inboundSettings.flow = xray_settings.flow;
                    break;
                case 'vmess':
                    inboundSettings = { alterId: xray_settings.alterId || 0 };
                    break;
                case 'trojan':
                    inboundSettings = {};
                    break;
            }

            let ibNetwork = clientStream.network || 'tcp';
            if (ibNetwork === 'tcp' && clientStream.security === 'reality') ibNetwork = 'xhttp';
            const inboundStreamSettings = { network: ibNetwork };
            if (ibNetwork === 'xhttp') {
                inboundStreamSettings.xhttpSettings = { path: '/', mode: 'auto' };
            }
            if (clientStream.security === 'reality') {
                inboundStreamSettings.security = 'reality';
                inboundStreamSettings.realitySettings = {
                    dest: `${sni}:443`,
                    serverNames: [sni],
                    privateKey: realityPrivateKey,
                    shortIds: realityShortIds,
                };
            } else if (clientStream.security === 'tls') {
                inboundStreamSettings.security = 'tls';
                inboundStreamSettings.tlsSettings = {
                    serverName: sni,
                    alpn: ['h2', 'http/1.1'],
                };
            }

            await xrayService.createInbound(to_server_id, {
                tag: chainTag,
                protocol: xray_protocol,
                port: xray_port,
                listen: '0.0.0.0',
                settings: inboundSettings,
                stream_settings: inboundStreamSettings,
                sniffing: { enabled: true, destOverride: ['http', 'tls'] },
                remark: `Chain от ${fromServer.name}`,
            });

            const newInbound = await queryOne(
                'SELECT * FROM xray_inbounds WHERE server_id = $1 AND tag = $2',
                [to_server_id, chainTag]
            );
            targetInboundId = newInbound?.id;
        }

        // Добавляем chain-клиента в целевой inbound
        if (targetInboundId) {
            await query('DELETE FROM clients WHERE xray_email = $1', [chainEmail]);

            await query(
                `INSERT INTO clients (name, server_id, protocol, xray_inbound_id, xray_uuid, xray_email, is_blocked, is_chain)
                 VALUES ($1, $2, $3, $4, $5, $6, FALSE, TRUE)`,
                [`chain-${from_server_id}-to-${to_server_id}`, to_server_id,
                 xray_protocol, targetInboundId, chainUuid, chainEmail]
            );
        }

        // Деплоим exit-сервер, затем НОВЫЙ entry-сервер
        // (новый Entry должен заработать ДО отключения старого)
        await xrayService.deployConfig(to_server_id, { force: true });
        await xrayService.deployConfig(from_server_id, { force: true });

        await query("UPDATE server_links SET status = 'active' WHERE id = $1", [link.id]);

        // === Теперь очищаем старые маршруты (новый Entry уже работает) ===
        for (const oldLink of oldEntryLinks) {
            console.log(`[TUNNEL] Очищаем старый маршрут #${oldLink.id} (${oldLink.name}) — новый Entry #${from_server_id} уже работает`);
            // Удаляем chain-клиента старого маршрута
            const oldChainEmail = `chain-${oldLink.from_server_id}-to-${oldLink.to_server_id}@vpn`;
            await query('DELETE FROM clients WHERE xray_email = $1', [oldChainEmail]);
            // Удаляем dedicated chain inbound если был
            const oldChainTag = `chain-${oldLink.from_server_id}-to-${oldLink.to_server_id}`;
            const oldChainInbound = await queryOne(
                'SELECT id FROM xray_inbounds WHERE server_id = $1 AND tag = $2',
                [to_server_id, oldChainTag]
            );
            if (oldChainInbound) {
                await query('DELETE FROM xray_inbounds WHERE id = $1', [oldChainInbound.id]);
            }
            // Удаляем запись маршрута
            await query('DELETE FROM server_links WHERE id = $1', [oldLink.id]);
            // Редеплоим старый Entry (убираем chain outbound) и Exit (убираем старого chain-клиента)
            try {
                await xrayService.deployConfig(oldLink.from_server_id, { force: true });
            } catch (err) {
                console.error(`[TUNNEL] Ошибка деплоя старого Entry #${oldLink.from_server_id}:`, err.message);
            }
        }
        // Если были старые маршруты — редеплоим Exit ещё раз (убрать старых chain-клиентов)
        if (oldEntryLinks.length > 0) {
            try {
                await xrayService.deployConfig(to_server_id, { force: true });
            } catch (err) {
                console.error(`[TUNNEL] Ошибка редеплоя Exit после очистки:`, err.message);
            }
        }

        await query(
            `INSERT INTO logs (level, category, message, details) VALUES ('info', 'tunnel', $1, $2)`,
            [`Создана Xray-цепочка: ${link.name}`,
             JSON.stringify({ id: link.id, from: fromServer.name, to: toServer.name, protocol: xray_protocol, reused: reuseInbound, replaced: oldEntryLinks.length })]
        );

        return { ...link, status: 'active' };

    } catch (err) {
        await query("UPDATE server_links SET status = 'error' WHERE id = $1", [link.id]);
        throw new Error(`Ошибка создания Xray-цепочки: ${err.message}`);
    }
}

/**
 * Удалить Xray-цепочку
 */
async function deleteTunnel(linkId) {
    const link = await queryOne('SELECT * FROM server_links WHERE id = $1', [linkId]);
    if (!link) throw new Error('Связь не найдена');

    // Удаляем chain-клиента по email (работает и для dedicated, и для shared inbound)
    const chainEmail = `chain-${link.from_server_id}-to-${link.to_server_id}@vpn`;
    await query('DELETE FROM clients WHERE xray_email = $1', [chainEmail]);

    // Удаляем dedicated chain inbound если он существует
    // (если inbound был shared — его не трогаем, только клиент удалён выше)
    const chainTags = [
        `chain-${link.from_server_id}-to-${link.to_server_id}`,
        `chain-from-${link.from_server_id}`,
    ];

    try {
        for (const chainTag of chainTags) {
            const chainInbound = await queryOne(
                'SELECT * FROM xray_inbounds WHERE server_id = $1 AND tag = $2',
                [link.to_server_id, chainTag]
            );
            if (chainInbound) {
                await query('DELETE FROM clients WHERE xray_inbound_id = $1', [chainInbound.id]);
                await xrayService.deleteInbound(chainInbound.id);
                break;
            }
        }
    } catch (err) {
        console.error(`[TUNNEL] Ошибка удаления chain inbound:`, err.message);
    }

    await query('DELETE FROM server_links WHERE id = $1', [linkId]);

    // Деплоим конфиг на entry (убираем outbound) и exit (убираем inbound)
    try {
        await xrayService.deployConfig(link.to_server_id, { force: true });
    } catch (err) {
        console.error(`[TUNNEL] Ошибка деплоя exit после удаления:`, err.message);
    }
    try {
        await xrayService.deployConfig(link.from_server_id, { force: true });
    } catch (err) {
        console.error(`[TUNNEL] Ошибка деплоя entry после удаления:`, err.message);
    }

    await query(
        `INSERT INTO logs (level, category, message) VALUES ('info', 'tunnel', $1)`,
        [`Удалена Xray-цепочка: ${link.name}`]
    );

    return { success: true };
}

/**
 * Перезапустить Xray-цепочку
 */
async function restartTunnel(linkId) {
    const link = await queryOne('SELECT * FROM server_links WHERE id = $1', [linkId]);
    if (!link) throw new Error('Связь не найдена');

    // Деплоим на exit и entry
    await xrayService.deployConfig(link.to_server_id, { force: true });
    await xrayService.deployConfig(link.from_server_id, { force: true });

    return checkTunnelStatus(linkId);
}

/**
 * Проверить статус Xray-цепочки через агент
 */
async function checkTunnelStatus(linkId) {
    const link = await queryOne('SELECT * FROM server_links WHERE id = $1', [linkId]);
    if (!link) throw new Error('Связь не найдена');

    const result = {
        id: link.id,
        name: link.name,
        link_type: 'xray',
        from_server_id: link.from_server_id,
        to_server_id: link.to_server_id,
        protocol: link.xray_protocol,
        port: link.xray_port,
        endpoint_mode: link.endpoint_mode || 'ipv4',
        from_status: 'unknown',
        to_status: 'unknown',
        ping_ok: false,
    };

    // Проверяем Xray на entry-сервере через агент
    try {
        const fromStatus = await nodeClient.xrayStatus(link.from_server_id);
        result.from_status = fromStatus.running ? 'up' : 'down';
    } catch {
        result.from_status = 'error';
    }

    // Проверяем Xray на exit-сервере через агент
    try {
        const toStatus = await nodeClient.xrayStatus(link.to_server_id);
        result.to_status = toStatus.running ? 'up' : 'down';
    } catch {
        result.to_status = 'error';
    }

    // Проверяем что chain-клиент существует на exit-сервере
    // Может быть в dedicated chain inbound ИЛИ в shared (переиспользованном) inbound
    const chainEmail = `chain-${link.from_server_id}-to-${link.to_server_id}@vpn`;
    const chainClient = await queryOne(
        `SELECT c.id FROM clients c
         JOIN xray_inbounds xi ON xi.id = c.xray_inbound_id
         WHERE c.xray_email = $1 AND xi.server_id = $2`,
        [chainEmail, link.to_server_id]
    );
    result.ping_ok = !!(chainClient && result.from_status === 'up' && result.to_status === 'up');

    const newStatus = (result.from_status === 'up' && result.to_status === 'up' && result.ping_ok)
        ? 'active' : 'error';
    await query('UPDATE server_links SET status = $1 WHERE id = $2', [newStatus, link.id]);
    result.status = newStatus;

    return result;
}

/**
 * Получить все связи
 */
async function getTunnels() {
    const links = await queryAll(`
        SELECT sl.*,
            fs.name as from_server_name, fs.ipv4 as from_server_ip,
            ts.name as to_server_name, ts.ipv4 as to_server_ip
        FROM server_links sl
        LEFT JOIN servers fs ON fs.id = sl.from_server_id
        LEFT JOIN servers ts ON ts.id = sl.to_server_id
        ORDER BY sl.created_at
    `);
    return links;
}

module.exports = {
    createTunnel,
    deleteTunnel,
    restartTunnel,
    checkTunnelStatus,
    getTunnels,
};
