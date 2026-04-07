// Сервис управления Xray-core (прямое управление без 3X-UI)
// Установка, конфигурация, деплой, статистика, share links
// Все операции на серверах через vpn-node агент (HTTP API)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { queryOne, queryAll, query, transaction } = require('../db/postgres');
const nodeClient = require('./node-client');

// Только VLESS + XHTTP (WireGuard полностью убран)

// ============================================================
// Установка / удаление
// ============================================================

/**
 * Установить Xray-core на сервер через агент
 */
async function installXray(serverId) {
    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [serverId]);
    if (!server) throw new Error('Сервер не найден');

    console.log(`[XRAY] Установка на сервер #${serverId} (${server.name})...`);

    const result = await nodeClient.xrayInstall(serverId);
    const version = result.version || 'unknown';

    // Создаём запись в БД
    await query(
        `INSERT INTO xray_instances (server_id, version, status, installed_at)
         VALUES ($1, $2, 'active', NOW())
         ON CONFLICT (server_id) DO UPDATE SET
            version = $2, status = 'active', installed_at = NOW()`,
        [serverId, version]
    );

    // Авто-создание дефолтного inbound для клиентов (если нет ни одного)
    const existingCount = await queryOne(
        `SELECT COUNT(*) as cnt FROM xray_inbounds WHERE server_id = $1 AND tag NOT LIKE 'chain-%'`,
        [serverId]
    );
    if (parseInt(existingCount.cnt) === 0) {
        try {
            console.log(`[XRAY] Создаём дефолтный VLESS Reality inbound на сервере ${server.name}...`);
            await createInbound(serverId, {
                tag: 'vless-reality',
                protocol: 'vless',
                port: 443,
                listen: '0.0.0.0',
                settings: {
                    decryption: 'none',
                    clients: [],
                },
                stream_settings: {
                    network: 'tcp',
                    security: 'reality',
                    realitySettings: {
                        show: false,
                        dest: 'www.google.com:443',
                        serverNames: ['www.google.com', 'www.microsoft.com'],
                        fingerprint: 'chrome',
                        shortIds: [generateShortId()],
                    },
                },
                sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true },
                remark: 'Default VLESS Reality',
            });
            console.log(`[XRAY] Дефолтный VLESS inbound создан на сервере ${server.name}`);
        } catch (err) {
            console.error(`[XRAY] Ошибка создания дефолтного VLESS inbound:`, err.message);
        }
    }

    // Создаём базовый конфиг и деплоим
    await deployConfig(serverId);

    await query(
        `INSERT INTO logs (level, category, server_id, message)
         VALUES ('info', 'xray', $1, $2)`,
        [serverId, `Xray-core установлен (${version})`]
    );

    return { success: true, version };
}

/**
 * Удалить Xray-core с сервера
 */
async function uninstallXray(serverId) {
    await nodeClient.xrayUninstall(serverId);

    await query("UPDATE xray_instances SET status = 'stopped' WHERE server_id = $1", [serverId]);
    await query('DELETE FROM xray_inbounds WHERE server_id = $1', [serverId]);

    await query(
        `INSERT INTO logs (level, category, server_id, message) VALUES ('info', 'xray', $1, 'Xray-core удалён')`,
        [serverId]
    );

    return { success: true };
}

// ============================================================
// Статус / управление сервисом
// ============================================================

async function getXrayStatus(serverId) {
    const instance = await queryOne('SELECT * FROM xray_instances WHERE server_id = $1', [serverId]);
    if (!instance) return { installed: false };

    let running = false;
    let version = instance.version;

    try {
        const agentStatus = await nodeClient.xrayStatus(serverId);
        running = agentStatus.running;
        if (agentStatus.version) version = agentStatus.version;
    } catch {}

    // Обновляем в БД
    const newStatus = running ? 'active' : 'stopped';
    if (newStatus !== instance.status || version !== instance.version) {
        await query(
            'UPDATE xray_instances SET status = $1, version = $2, last_sync = NOW() WHERE server_id = $3',
            [newStatus, version, serverId]
        );
    }

    const inboundsCount = await queryOne(
        'SELECT COUNT(*) as count FROM xray_inbounds WHERE server_id = $1', [serverId]
    );
    const clientsCount = await queryOne(
        'SELECT COUNT(*) as count FROM clients WHERE xray_inbound_id IN (SELECT id FROM xray_inbounds WHERE server_id = $1)',
        [serverId]
    );

    return {
        installed: true,
        running,
        version,
        status: newStatus,
        api_port: instance.api_port,
        config_hash: instance.config_hash,
        inbounds: parseInt(inboundsCount.count),
        clients: parseInt(clientsCount.count),
        last_sync: instance.last_sync,
        installed_at: instance.installed_at,
    };
}

async function restartXray(serverId) {
    await nodeClient.xrayRestart(serverId);
    await query("UPDATE xray_instances SET status = 'active', last_sync = NOW() WHERE server_id = $1", [serverId]);
    return { success: true };
}

async function stopXray(serverId) {
    await nodeClient.xrayStop(serverId);
    await query("UPDATE xray_instances SET status = 'stopped' WHERE server_id = $1", [serverId]);
    return { success: true };
}

// ============================================================
// Сборка конфигурации
// ============================================================

/**
 * Собрать полный JSON-конфиг Xray из БД (inbounds + clients)
 */
async function buildXrayConfig(serverId) {
    const instance = await queryOne('SELECT * FROM xray_instances WHERE server_id = $1', [serverId]);
    const apiPort = instance?.api_port || 10085;

    // Получаем домен сервера для автодобавления в Reality serverNames
    const server = await queryOne('SELECT domain FROM servers WHERE id = $1', [serverId]);
    const serverDomain = server?.domain || null;

    // Проверяем статус stub site (если dest = 127.0.0.1, а stub не активен — фоллбэк на google)
    const stubSite = await queryOne(
        "SELECT status FROM stub_sites WHERE server_id = $1",
        [serverId]
    );
    const stubActive = stubSite?.status === 'active';

    // Получаем все inbounds сервера
    const inbounds = await queryAll(
        'SELECT * FROM xray_inbounds WHERE server_id = $1 AND is_enabled = TRUE ORDER BY id',
        [serverId]
    );

    // Фикс: если dest=127.0.0.1 но stub site не активен — сбрасываем на google
    for (const ib of inbounds) {
        const rs = ib.stream_settings?.realitySettings;
        if (rs?.dest?.startsWith('127.0.0.1') && !stubActive) {
            console.warn(`[XRAY] Inbound ${ib.tag}: dest=${rs.dest} но stub site не активен — фоллбэк на google`);
            rs.dest = 'www.google.com:443';
            if (!rs.serverNames?.length || rs.serverNames.every(s => /^\d+\.\d+\.\d+\.\d+$/.test(s))) {
                rs.serverNames = ['www.google.com'];
            }
        }
    }

    // Получаем клиентов для каждого inbound
    const xrayInbounds = [];
    for (const ib of inbounds) {
        const clients = await queryAll(
            `SELECT c.*, xi.protocol as ib_protocol,
                    a.username as owner_username
             FROM clients c
             JOIN xray_inbounds xi ON xi.id = c.xray_inbound_id
             LEFT JOIN admins a ON a.id = c.owner_id
             WHERE c.xray_inbound_id = $1 AND c.is_blocked = FALSE`,
            [ib.id]
        );

        const inboundConfig = buildInboundConfig(ib, clients, serverDomain);
        xrayInbounds.push(inboundConfig);
    }

    // Конфиг Xray
    const config = {
        log: {
            loglevel: 'warning',
            access: 'none',
            error: '/var/log/xray/error.log',
        },
        dns: {
            servers: [
                '94.140.14.14',
                '94.140.15.15',

                'localhost',
            ],
            queryStrategy: 'UseIP',
            disableCache: false,
            tag: 'dns-internal',
        },
        api: {
            tag: 'api',
            services: ['HandlerService', 'LoggerService', 'StatsService'],
        },
        stats: {},
        policy: {
            levels: {
                0: {
                    statsUserUplink: true,
                    statsUserDownlink: true,
                    handshake: 8,
                    connIdle: 600,
                    uplinkOnly: 4,
                    downlinkOnly: 8,
                    bufferSize: 512,
                },
            },
            system: {
                statsInboundUplink: true,
                statsInboundDownlink: true,
                statsOutboundUplink: true,
                statsOutboundDownlink: true,
            },
        },
        inbounds: [
            // API inbound (gRPC для статистики)
            {
                tag: 'api',
                listen: '127.0.0.1',
                port: apiPort,
                protocol: 'dokodemo-door',
                settings: { address: '127.0.0.1' },
            },
            ...xrayInbounds,
        ],
        outbounds: [
            {
                tag: 'direct',
                protocol: 'freedom',
                settings: {
                    domainStrategy: 'UseIP',
                },
            },
            { tag: 'blocked', protocol: 'blackhole' },
            {
                tag: 'dns-out',
                protocol: 'dns',
            },
        ],
        routing: {
            domainStrategy: 'AsIs',
            rules: [
                {
                    inboundTag: ['api'],
                    outboundTag: 'api',
                    type: 'field',
                },
                {
                    type: 'field',
                    protocol: ['dns'],
                    outboundTag: 'dns-out',
                },
                // Блокировка GeoIP API сервисов — предотвращение определения таймзоны по IP
                // Сайты используют эти API для client-side сравнения таймзоны IP vs браузера
                // Блокируем API, а не сами сайты проверки
                {
                    type: 'field',
                    domain: [
                        'domain:ip-api.com',
                        'domain:ipapi.co',
                        'domain:ipinfo.io',
                        'domain:ipgeolocation.io',
                        'domain:geojs.io',
                        'domain:ipwhois.io',
                        'domain:freeipapi.com',
                        'domain:ip.sb',
                        'domain:ipdata.co',
                        'domain:abstractapi.com',
                        'domain:ipify.org',
                        'domain:geolocation-db.com',
                        'domain:ip2location.io',
                    ],
                    outboundTag: 'blocked',
                },
                // Блокировка QUIC (UDP:443) — приложения переключатся на TCP
                // TCP через xHTTP работает лучше чем UDP-in-HTTP для видеозвонков
                {
                    type: 'field',
                    network: 'udp',
                    port: 443,
                    outboundTag: 'blocked',
                },
            ],
        },
    };

    // Загружаем маршруты где ЭТОТ сервер = entry (from_server_id)
    // Каждый маршрут — явная связь Entry→Exit, задаётся через UI
    const chains = await queryAll(
        `SELECT sl.*, s.ipv4, s.ipv6, s.host, s.name as to_server_name
         FROM server_links sl
         JOIN servers s ON s.id = sl.to_server_id
         WHERE sl.from_server_id = $1 AND sl.link_type = 'xray' AND sl.status != 'error'`,
        [serverId]
    );

    // DNS остаётся на Entry (dns-out): гео-локация определяется по IP клиента (Exit IP),
    // а не по DNS-резолву. Локальный DNS на Entry быстрее чем через chain.

    for (const chain of chains) {
        let endpoint;
        if (chain.endpoint_mode === 'ipv6') {
            const ip6 = chain.ipv6 || (chain.host && chain.host.includes(':') ? chain.host : null);
            endpoint = ip6 ? ip6.replace(/^\[|\]$/g, '') : null;
        } else {
            endpoint = chain.ipv4 || chain.host;
        }
        if (!endpoint) {
            console.warn(`[XRAY] Пропускаем chain #${chain.id}: нет endpoint (mode=${chain.endpoint_mode})`);
            continue;
        }

        // Проверяем обязательные поля цепочки
        if (!chain.xray_protocol || !chain.xray_uuid || !chain.xray_port) {
            console.warn(`[XRAY] Пропускаем chain #${chain.id}: неполные настройки (protocol=${chain.xray_protocol}, port=${chain.xray_port}, uuid=${chain.xray_uuid ? 'есть' : 'нет'})`);
            continue;
        }

        const outbound = buildChainOutbound(chain, endpoint);
        config.outbounds.unshift(outbound);

        // === Репликация user-facing inbounds с Exit-сервера на Entry ===
        // Пользователи подключаются к Entry, трафик уходит через chain на Exit
        const exitUserInbounds = await queryAll(
            `SELECT * FROM xray_inbounds WHERE server_id = $1 AND is_enabled = TRUE AND tag NOT LIKE 'chain-%' ORDER BY id`,
            [chain.to_server_id]
        );

        for (const exitIb of exitUserInbounds) {
            // Пропускаем если порт уже занят на Entry
            const portTaken = xrayInbounds.some(ib => ib.port === exitIb.port);
            if (portTaken) {
                console.log(`[XRAY] Репликация: порт ${exitIb.port} занят на Entry #${serverId}, пропускаем "${exitIb.tag}"`);
                continue;
            }

            // Получаем клиентов этого inbound (не заблокированных, не chain)
            const exitClients = await queryAll(
                `SELECT c.*, xi.protocol as ib_protocol,
                        a.username as owner_username
                 FROM clients c
                 JOIN xray_inbounds xi ON xi.id = c.xray_inbound_id
                 LEFT JOIN admins a ON a.id = c.owner_id
                 WHERE c.xray_inbound_id = $1 AND c.is_blocked = FALSE AND c.is_chain = FALSE`,
                [exitIb.id]
            );

            // Пропускаем если нет клиентов — Xray не принимает inbound с пустым clients
            if (exitClients.length === 0) {
                console.log(`[XRAY] Репликация: нет клиентов в "${exitIb.tag}" на Exit #${chain.to_server_id}, пропускаем`);
                continue;
            }

            const replicatedConfig = buildInboundConfig(exitIb, exitClients);
            replicatedConfig.tag = `relay-${chain.to_server_id}-${exitIb.tag}`;

            // Убираем flow (xtls-rprx-vision) — Vision несовместим с цепочкой:
            // он пропускает TLS-записи «сырыми», что ломает re-encryption в chain outbound
            if (replicatedConfig.settings?.clients) {
                for (const cl of replicatedConfig.settings.clients) {
                    delete cl.flow;
                }
            }

            console.log(`[XRAY] Репликация: "${exitIb.tag}" → "${replicatedConfig.tag}" (${exitClients.length} клиентов, порт ${exitIb.port})`);

            // Добавляем прямо в config.inbounds (не в xrayInbounds — тот уже скопирован spread'ом)
            config.inbounds.push(replicatedConfig);
            // Также в xrayInbounds для проверки portTaken
            xrayInbounds.push(replicatedConfig);

            // Routing: трафик с реплицированного inbound → chain outbound
            config.routing.rules.push({
                type: 'field',
                inboundTag: [replicatedConfig.tag],
                outboundTag: outbound.tag,
            });
        }
    }

    // === Сборка routing правил (ПОРЯДОК КРИТИЧЕН!) ===
    // Базовые правила: [api(0), dns(1), blocked(2)]
    // Нужный итоговый порядок:
    //   0: api → api
    //   1: chain-inbound tags → direct (если есть chain-inbound'ы)
    //   2: chain-client emails → direct (защита от петли: chain-клиент в shared inbound)
    //   3: user-facing → chain (ВСЕ клиентские подключения через chain)
    //   4: dns → dns-out
    //   5: blocked → blocked
    //   ...
    // Вставляем в ОБРАТНОМ порядке на позицию 1, чтобы каждая новая вставка
    // сдвигала предыдущие. Так chain-direct оказывается ПЕРЕД user-facing → chain.

    // 1. Собираем user-facing теги
    const userFacingTags = xrayInbounds
        .filter(ib => ib.tag && !ib.tag.startsWith('chain-') && !ib.tag.startsWith('relay-') && ib.tag !== 'api')
        .map(ib => ib.tag);

    // 2. Собираем chain-direct правила (для предотвращения петли)
    const chainDirectRules = [];

    // 2a. Chain-inbound'ы → direct (когда сервер = Exit, chain-inbound трафик идёт напрямую)
    const chainInboundTags = xrayInbounds
        .filter(ib => ib.tag && ib.tag.startsWith('chain-'))
        .map(ib => ib.tag);
    if (chainInboundTags.length > 0 && chains.length > 0) {
        chainDirectRules.push({
            type: 'field',
            inboundTag: chainInboundTags,
            outboundTag: 'direct',
        });
    }

    // 2b. Chain-клиенты в shared inbound'ах → direct
    // Когда tunnel reuse существующий inbound (тот же порт), chain-клиент
    // оказывается в user-facing inbound'е (например vless-reality:443).
    // Без этого правила chain трафик попадёт под user-facing → chain rule → ПЕТЛЯ!
    const chainClients = await queryAll(
        `SELECT c.xray_email FROM clients c
         JOIN xray_inbounds xi ON xi.id = c.xray_inbound_id
         WHERE xi.server_id = $1 AND c.is_chain = TRUE AND c.is_blocked = FALSE`,
        [serverId]
    );
    const chainEmails = chainClients.map(c => c.xray_email).filter(Boolean);
    if (chainEmails.length > 0) {
        chainDirectRules.push({
            type: 'field',
            user: chainEmails,
            outboundTag: 'direct',
        });
    }

    // 3. Вставляем правила на позицию 1 (сразу после api):
    // Порядок: chain-direct, user-facing→chain, потом dns-out, blocked
    const rulesToInsert = [];

    // chain-direct правила идут ПЕРВЫМИ (более специфичные)
    rulesToInsert.push(...chainDirectRules);

    // user-facing → chain идёт ПОСЛЕ chain-direct (менее специфичное)
    if (chains.length > 0 && userFacingTags.length > 0) {
        const defaultChain = config.outbounds.find(ob => ob.tag && ob.tag.startsWith('chain-to-'));
        if (defaultChain) {
            rulesToInsert.push({
                type: 'field',
                inboundTag: userFacingTags,
                outboundTag: defaultChain.tag,
            });
            console.log(`[XRAY] User-facing → ${defaultChain.tag}: [${userFacingTags.join(', ')}] (перед dns-out)`);
        }
    }

    if (rulesToInsert.length > 0) {
        // Вставляем все правила на позицию 1 (после api, перед dns-out)
        config.routing.rules.splice(1, 0, ...rulesToInsert);
        console.log(`[XRAY] Вставлено ${rulesToInsert.length} routing правил на позицию 1`);
    }

    // === Доменная маршрутизация ===
    // Ищем группы серверов, где ЭТОТ сервер = Entry
    const entryGroups = await queryAll(
        `SELECT DISTINCT sgm.server_group_id
         FROM server_group_members sgm
         WHERE sgm.server_id = $1 AND sgm.role = 'entry'`,
        [serverId]
    );

    if (entryGroups.length > 0) {
        const domainRulesToInsert = [];

        for (const { server_group_id } of entryGroups) {
            const domainRules = await queryAll(
                `SELECT dr.*, s.name as target_name
                 FROM domain_routes dr
                 JOIN servers s ON s.id = dr.target_server_id
                 WHERE dr.server_group_id = $1 AND dr.is_enabled = TRUE
                 ORDER BY dr.priority DESC, dr.id`,
                [server_group_id]
            );

            for (const rule of domainRules) {
                if (!rule.domains || rule.domains.length === 0) continue;

                const outboundTag = `chain-to-${rule.target_server_id}`;
                const hasOutbound = config.outbounds.some(ob => ob.tag === outboundTag);
                if (!hasOutbound) {
                    console.warn(`[XRAY] Domain rule "${rule.name}": outbound ${outboundTag} не найден, пропускаем`);
                    continue;
                }

                console.log(`[XRAY] Domain rule "${rule.name}": ${rule.domains.join(', ')} → ${outboundTag} (${rule.target_name})`);
                domainRulesToInsert.push({
                    type: 'field',
                    domain: rule.domains,
                    outboundTag: outboundTag,
                    // Только user-facing inbound'ы — не chain-inbound'ы (предотвращение петли)
                    ...(userFacingTags.length > 0 ? { inboundTag: userFacingTags } : {}),
                });
            }
        }

        // Вставляем доменные правила ПЕРЕД chain-to правилом (ищем его позицию)
        // Domain routes должны быть ПЕРЕД catch-all chain правилом!
        if (domainRulesToInsert.length > 0) {
            // Найти позицию первого chain-to правила (catch-all)
            const chainIdx = config.routing.rules.findIndex(r => r.outboundTag && r.outboundTag.startsWith('chain-to-') && !r.domain);
            const insertPos = chainIdx > 0 ? chainIdx : config.routing.rules.length;
            config.routing.rules.splice(insertPos, 0, ...domainRulesToInsert);
            console.log(`[XRAY] Добавлено ${domainRulesToInsert.length} доменных правил на позицию ${insertPos} (перед chain catch-all)`);
        }
    }

    return config;
}

/**
 * Собрать конфиг одного inbound с клиентами
 */
function buildInboundConfig(inbound, clients, serverDomain) {
    const settings = inbound.settings || {};
    const streamSettings = inbound.stream_settings || {};
    const sniffing = inbound.sniffing || { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true };

    let protocolSettings;

    switch (inbound.protocol) {
        case 'vless':
            protocolSettings = {
                decryption: 'none',
                clients: clients.map(c => {
                    const client = {
                        id: c.xray_uuid,
                        email: c.xray_email || `${c.name}@vpn`,
                    };
                    const network = (inbound.stream_settings || {}).network;
                    const isChainClient = (c.name || '').startsWith('chain-');
                    if (settings.flow && network !== 'xhttp' && !isChainClient) client.flow = settings.flow;
                    return client;
                }),
            };
            break;

        default:
            protocolSettings = {};
    }

    // Очищаем streamSettings для Xray: убираем client-side поля из Reality
    // (publicKey, fingerprint, spiderX — нужны только для share links, хранятся в БД)
    const cleanStream = { ...streamSettings };
    if (cleanStream.security === 'reality' && cleanStream.realitySettings) {
        const rs = cleanStream.realitySettings;
        let sNames = rs.serverNames?.length ? [...rs.serverNames] : ['www.google.com'];
        // Автодобавление домена сервера в serverNames (максимальная маскировка)
        if (serverDomain && !sNames.includes(serverDomain)) {
            sNames.unshift(serverDomain);
        }
        // Добавляем домены из sni_list (мульти-SNI для подписки)
        const sniList = Array.isArray(inbound.sni_list) ? inbound.sni_list : [];
        for (const sni of sniList) {
            if (sni && !sNames.includes(sni)) {
                sNames.push(sni);
            }
        }
        cleanStream.realitySettings = {
            dest: rs.dest || 'www.google.com:443',
            serverNames: sNames,
            privateKey: rs.privateKey || '',
            shortIds: rs.shortIds?.length ? rs.shortIds : [generateShortId()],
        };
    }
    // Убираем null/undefined поля из streamSettings (Xray строгий к типам)
    if (cleanStream.network === null || cleanStream.network === undefined) {
        delete cleanStream.network;
    }

    // VLESS + Reality — XHTTP по-умолчанию (максимальная маскировка, трафик неотличим от HTTPS)
    // TCP допускается только если явно указан другой транспорт (ws, grpc, h2)
    if (inbound.protocol === 'vless' && cleanStream.security === 'reality') {
        if (!cleanStream.network || cleanStream.network == "tcp") {
            // cleanStream.network = "xhttp"; // DISABLED for TCP+Vision
        }
        // Добавляем дефолтные xhttpSettings если отсутствуют
        if (cleanStream.network === 'xhttp' && !cleanStream.xhttpSettings) {
        }
        // xHTTP host (если xhttp используется)
        if (cleanStream.network === 'xhttp' && cleanStream.xhttpSettings && !cleanStream.xhttpSettings.host) {
            const sn = cleanStream.realitySettings?.serverNames?.[0];
            if (sn) cleanStream.xhttpSettings.host = sn;
        }
        // Убираем quic из sniffing если есть
        // quic оставляем в destOverride

        // На сервере вызывает invalid padding, убираем из deployed конфига
        if (cleanStream.xhttpSettings) {
        }
    }

    const result = {
        tag: inbound.tag,
        listen: inbound.listen || '0.0.0.0',
        port: inbound.port,
        protocol: inbound.protocol,
        settings: protocolSettings,
    };

    result.streamSettings = cleanStream;
    result.sniffing = sniffing;

    return result;
}

// ============================================================
// Деплой конфигурации
// ============================================================

/**
 * Собрать конфиг, отправить на агент, валидировать и перезапустить Xray
 * @param {number} serverId
 * @param {object} [options]
 * @param {boolean} [options.force] — пропустить проверку хеша (принудительный редеплой)
 */
async function deployConfig(serverId, options = {}) {
    // Автоподстановка домена сервера в Reality serverNames
    const server = await queryOne('SELECT domain FROM servers WHERE id = $1', [serverId]);
    if (server?.domain) {
        const realityInbounds = await queryAll(
            `SELECT id, stream_settings FROM xray_inbounds
             WHERE server_id = $1 AND stream_settings->>'security' = 'reality'`,
            [serverId]
        );
        for (const ib of realityInbounds) {
            const ss = ib.stream_settings || {};
            const rs = ss.realitySettings || {};
            if (!rs.serverNames?.includes(server.domain)) {
                rs.serverNames = rs.serverNames?.length
                    ? [server.domain, ...rs.serverNames.filter(n => n !== server.domain)]
                    : [server.domain];
                ss.realitySettings = rs;
                await query('UPDATE xray_inbounds SET stream_settings = $1 WHERE id = $2',
                    [JSON.stringify(ss), ib.id]);
            }
        }
    }

    const config = await buildXrayConfig(serverId);
    const configJson = JSON.stringify(config, null, 2);
    const configHash = crypto.createHash('sha256').update(configJson).digest('hex').substring(0, 16);

    // Проверяем — не тот же ли конфиг уже задеплоен (если не force)
    if (!options.force) {
        const instance = await queryOne('SELECT config_hash FROM xray_instances WHERE server_id = $1', [serverId]);
        if (instance && instance.config_hash === configHash) {
            return { success: true, changed: false, hash: configHash };
        }
    }

    // Логируем сводку конфига
    console.log(`[XRAY] Deploy #${serverId}: ${config.inbounds.length} inbounds, ${config.outbounds.length} outbounds, ${config.routing.rules.length} rules`);

    // Отправляем конфиг на агент (агент сам валидирует, бэкапит и перезапускает)
    let result;
    try {
        result = await nodeClient.xrayDeployConfig(serverId, config);
    } catch (err) {
        console.error(`[XRAY] Ошибка деплоя на сервер #${serverId}:`, err.message);
        console.error(`[XRAY] Конфиг (inbounds):`, JSON.stringify(config.inbounds.map(i => ({ tag: i.tag, port: i.port, protocol: i.protocol, clients: i.settings?.clients?.length ?? 0 })), null, 2));
        // Дампим полный конфиг в файл для диагностики
        try {
            const dumpDir = path.join(__dirname, '../../data');
            if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
            const dumpFile = path.join(dumpDir, `xray-config-error-server-${serverId}.json`);
            fs.writeFileSync(dumpFile, JSON.stringify(config, null, 2));
            console.error(`[XRAY] Конфиг сохранён для диагностики: ${dumpFile}`);
        } catch (dumpErr) {
            console.error(`[XRAY] Не удалось сохранить дамп конфига:`, dumpErr.message);
        }
        throw new Error(`Ошибка деплоя конфига Xray на сервер #${serverId}: ${err.message}`);
    }
    if (!result.ok && !result.running) {
        throw new Error(`Ошибка деплоя конфига Xray: ${result.details || 'validation failed'}`);
    }

    // Обновляем хеш в БД
    await query(
        'UPDATE xray_instances SET config_hash = $1, last_sync = NOW(), status = $2 WHERE server_id = $3',
        [configHash, 'active', serverId]
    );

    console.log(`[XRAY] Конфиг задеплоен на #${serverId} (hash: ${configHash})`);

    return { success: true, changed: true, hash: configHash };
}

/**
 * Задеплоить конфиг на ВСЕ серверы с Xray (для синхронизации маршрутов)
 * @param {number[]} [excludeIds] — серверы, которые уже задеплоены
 */
async function deployConfigToAll(excludeIds = []) {
    const instances = await queryAll('SELECT server_id FROM xray_instances');
    const results = [];
    for (const inst of instances) {
        if (excludeIds.includes(inst.server_id)) continue;
        try {
            const r = await deployConfig(inst.server_id, { force: true });
            results.push({ serverId: inst.server_id, ...r });
        } catch (err) {
            console.error(`[XRAY] Ошибка деплоя на сервер #${inst.server_id}:`, err.message);
            results.push({ serverId: inst.server_id, success: false, error: err.message });
        }
    }
    return results;
}

// ============================================================
// CRUD Inbounds
// ============================================================

async function getInbounds(serverId) {
    const inbounds = await queryAll(
        `SELECT xi.*,
            (SELECT COUNT(*) FROM clients c WHERE c.xray_inbound_id = xi.id) as clients_count
         FROM xray_inbounds xi
         WHERE xi.server_id = $1
         ORDER BY xi.created_at`,
        [serverId]
    );
    return inbounds;
}

/**
 * Получить ВСЕ inbound'ы со всех серверов (для формы создания клиента)
 * Исключает chain-inbounds
 * @param {Object} opts - Опции фильтрации
 * @param {number} opts.serverGroupId - Фильтр по группе серверов (только Entry серверы — клиенты подключаются к Entry)
 */
async function getAllInbounds({ serverGroupId } = {}) {
    const params = [];
    let sql = `SELECT xi.*, s.name as server_name, s.ipv4 as server_ip, s.domain as server_domain,
            (SELECT COUNT(*) FROM clients c WHERE c.xray_inbound_id = xi.id AND c.is_chain = FALSE) as clients_count
         FROM xray_inbounds xi
         INNER JOIN servers s ON s.id = xi.server_id
         WHERE xi.tag NOT LIKE 'chain-%'`;

    if (serverGroupId) {
        params.push(serverGroupId);
        sql += ` AND xi.server_id IN (
            SELECT server_id FROM server_group_members
            WHERE server_group_id = $${params.length} AND role = 'entry'
        )`;
    }

    sql += ' ORDER BY s.name, xi.port, xi.tag';
    return queryAll(sql, params);
}

async function getInbound(inboundId) {
    return queryOne('SELECT * FROM xray_inbounds WHERE id = $1', [inboundId]);
}

async function createInbound(serverId, data) {
    const { tag, protocol, port, listen, settings, stream_settings, sniffing, remark, sni_list } = data;

    // Валидация
    if (!tag || !protocol || !port) {
        throw new Error('tag, protocol и port обязательны');
    }
    if (!['vless'].includes(protocol)) {
        throw new Error('Неподдерживаемый протокол');
    }

    // Проверяем конфликт порта с другим inbound на этом сервере
    const portConflict = await queryOne(
        'SELECT id, tag FROM xray_inbounds WHERE server_id = $1 AND port = $2 AND tag != $3',
        [serverId, port, tag]
    );
    let migrateChainInbound = null;
    if (portConflict) {
        if (portConflict.tag.startsWith('chain-')) {
            // Chain-инбаунд занимает порт — мигрируем chain-клиентов в новый инбаунд
            // (chain-клиент станет просто ещё одним клиентом user-facing инбаунда)
            console.log(`[XRAY] Порт ${port} занят chain "${portConflict.tag}" — мигрируем в "${tag}"`);
            migrateChainInbound = portConflict;
        } else {
            throw new Error(`Порт ${port} уже занят inbound "${portConflict.tag}" на сервере #${serverId}`);
        }
    }

    // Генерация Reality ключей при необходимости
    let finalStreamSettings = stream_settings || {};
    if (finalStreamSettings.security === 'reality' && !finalStreamSettings.realitySettings?.privateKey) {
        const keys = await generateRealityKeys(serverId);
        finalStreamSettings = {
            ...finalStreamSettings,
            realitySettings: {
                ...finalStreamSettings.realitySettings,
                privateKey: keys.privateKey,
                publicKey: keys.publicKey,
                shortIds: finalStreamSettings.realitySettings?.shortIds?.length ? finalStreamSettings.realitySettings.shortIds : [generateShortId()],
            },
        };
    }

    let finalSettings = settings || {};

    // Если мигрируем chain-инбаунд — удаляем его ДО создания нового (освобождаем порт)
    if (migrateChainInbound) {
        // Временно открепляем chain-клиентов (потом привяжем к новому)
        await query(
            'UPDATE clients SET xray_inbound_id = NULL WHERE xray_inbound_id = $1 AND is_chain = TRUE',
            [migrateChainInbound.id]
        );
        // Удаляем chain-инбаунд (без деплоя — задеплоим после создания нового)
        await query('DELETE FROM xray_inbounds WHERE id = $1', [migrateChainInbound.id]);
        console.log(`[XRAY] Chain inbound "${migrateChainInbound.tag}" удалён, порт ${port} освобождён`);
    }

    const inbound = await queryOne(
        `INSERT INTO xray_inbounds (server_id, tag, protocol, port, listen, settings, stream_settings, sniffing, remark, sni_list)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (server_id, tag) DO UPDATE SET
            protocol = EXCLUDED.protocol,
            port = EXCLUDED.port,
            listen = EXCLUDED.listen,
            settings = EXCLUDED.settings,
            stream_settings = EXCLUDED.stream_settings,
            sniffing = EXCLUDED.sniffing,
            remark = EXCLUDED.remark,
            sni_list = EXCLUDED.sni_list,
            is_enabled = TRUE
         RETURNING *`,
        [serverId, tag, protocol, port, listen || '0.0.0.0',
         JSON.stringify(finalSettings), JSON.stringify(finalStreamSettings),
         JSON.stringify(sniffing || { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true }),
         remark || null,
         JSON.stringify(sni_list || [])]
    );

    // Если мигрировали chain — привязываем chain-клиентов к новому инбаунду
    // и обновляем server_link stream_settings (чтобы Entry-сервер знал новые ключи)
    if (migrateChainInbound) {
        // Ищем chain-клиентов, чей email совпадает с тегом chain-инбаунда
        // Формат: chain-{fromId}-to-{toId} → email: chain-{fromId}-to-{toId}@vpn
        const chainEmail = `${migrateChainInbound.tag}@vpn`;
        const updated = await query(
            'UPDATE clients SET xray_inbound_id = $1 WHERE xray_email = $2 AND is_chain = TRUE',
            [inbound.id, chainEmail]
        );
        console.log(`[XRAY] Chain-клиенты мигрированы в "${tag}" (${updated.rowCount} шт.)`);

        // Обновляем server_link: outbound stream_settings для Entry → match новый inbound
        const match = migrateChainInbound.tag.match(/^chain-(\d+)-to-(\d+)$/);
        if (match) {
            const fromServerId = parseInt(match[1]);
            // XHTTP как дефолт для VLESS + Reality цепочек
            let chainNetwork = finalStreamSettings.network || 'tcp';
            // if (chainNetwork == "tcp" && finalStreamSettings.security == "reality") chainNetwork = "xhttp"; // DISABLED for TCP+Vision
            const outboundStream = { network: chainNetwork };

            // Копируем transport-specific settings
            if (finalStreamSettings.network === 'xhttp' && finalStreamSettings.xhttpSettings) {
                outboundStream.xhttpSettings = { ...finalStreamSettings.xhttpSettings };
            } else if (finalStreamSettings.network === 'ws' && finalStreamSettings.wsSettings) {
                outboundStream.wsSettings = { ...finalStreamSettings.wsSettings };
            } else if (finalStreamSettings.network === 'grpc' && finalStreamSettings.grpcSettings) {
                outboundStream.grpcSettings = { ...finalStreamSettings.grpcSettings };
            } else if (finalStreamSettings.network === 'h2' && finalStreamSettings.httpSettings) {
                outboundStream.httpSettings = { ...finalStreamSettings.httpSettings };
            }

            if (finalStreamSettings.security === 'reality' && finalStreamSettings.realitySettings) {
                const rs = finalStreamSettings.realitySettings;
                outboundStream.security = 'reality';
                outboundStream.realitySettings = {
                    serverName: rs.serverNames?.[0] || 'www.google.com',
                    fingerprint: rs.fingerprint || 'chrome',
                    publicKey: rs.publicKey || '',
                    shortId: rs.shortIds?.[0] || '',
                    spiderX: rs.spiderX || '/',
                };
            } else if (finalStreamSettings.security === 'tls' && finalStreamSettings.tlsSettings) {
                outboundStream.security = 'tls';
                outboundStream.tlsSettings = {
                    serverName: finalStreamSettings.tlsSettings.serverName || '',
                    fingerprint: 'chrome',
                    alpn: ['h2', 'http/1.1'],
                };
            }

            await query(
                `UPDATE server_links SET xray_stream_settings = $1
                 WHERE from_server_id = $2 AND to_server_id = $3 AND link_type = 'xray' AND status != 'error'`,
                [JSON.stringify(outboundStream), fromServerId, serverId]
            );
            console.log(`[XRAY] server_link ${fromServerId}→${serverId} stream_settings обновлены`);
        }
    }

    // Авто-деплой (+ Entry-серверы, чтобы реплицированные inbound'ы обновились)
    try {
        await deployWithEntries(serverId);
    } catch (err) {
        console.error(`[XRAY] Ошибка деплоя после создания inbound:`, err.message);
    }

    await query(
        `INSERT INTO logs (level, category, server_id, message, details)
         VALUES ('info', 'xray', $1, $2, $3)`,
        [serverId, `Создан inbound: ${tag} (${protocol}:${port})`,
         JSON.stringify({ inbound_id: inbound.id, migrated_chain: migrateChainInbound?.tag || null })]
    );

    return inbound;
}

async function updateInbound(inboundId, data) {
    const inbound = await queryOne('SELECT * FROM xray_inbounds WHERE id = $1', [inboundId]);
    if (!inbound) throw new Error('Inbound не найден');

    const fields = [];
    const params = [];
    let idx = 1;

    const updateFields = ['tag', 'protocol', 'port', 'listen', 'remark', 'is_enabled'];
    for (const f of updateFields) {
        if (data[f] !== undefined) {
            fields.push(`${f} = $${idx++}`);
            params.push(data[f]);
        }
    }

    // JSONB поля
    const jsonFields = ['settings', 'stream_settings', 'sniffing', 'sni_list'];
    for (const f of jsonFields) {
        if (data[f] !== undefined) {
            fields.push(`${f} = $${idx++}`);
            params.push(JSON.stringify(data[f]));
        }
    }

    if (fields.length === 0) throw new Error('Нет полей для обновления');

    params.push(inboundId);
    const updated = await queryOne(
        `UPDATE xray_inbounds SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        params
    );

    // Авто-деплой (+ Entry-серверы)
    try {
        await deployWithEntries(inbound.server_id);
    } catch (err) {
        console.error(`[XRAY] Ошибка деплоя после обновления inbound:`, err.message);
    }

    return updated;
}

async function deleteInbound(inboundId) {
    const inbound = await queryOne('SELECT * FROM xray_inbounds WHERE id = $1', [inboundId]);
    if (!inbound) throw new Error('Inbound не найден');

    // Открепляем клиентов
    await query('UPDATE clients SET xray_inbound_id = NULL WHERE xray_inbound_id = $1', [inboundId]);

    await query('DELETE FROM xray_inbounds WHERE id = $1', [inboundId]);

    // Авто-деплой (+ Entry-серверы)
    try {
        await deployWithEntries(inbound.server_id);
    } catch (err) {
        console.error(`[XRAY] Ошибка деплоя после удаления inbound:`, err.message);
    }

    await query(
        `INSERT INTO logs (level, category, server_id, message)
         VALUES ('info', 'xray', $1, $2)`,
        [inbound.server_id, `Удалён inbound: ${inbound.tag}`]
    );

    return { success: true };
}

// ============================================================
// Управление клиентами в inbounds
// ============================================================

/**
 * Добавить клиента в Xray inbound
 */
async function addClientToInbound(clientId, inboundId) {
    const inbound = await queryOne('SELECT * FROM xray_inbounds WHERE id = $1', [inboundId]);
    if (!inbound) throw new Error('Inbound не найден');

    const uuid = crypto.randomUUID();
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [clientId]);
    if (!client) throw new Error('Клиент не найден');

    await query(
        `UPDATE clients SET
            xray_inbound_id = $1,
            xray_uuid = $2,
            xray_email = $3,
            protocol = $4
         WHERE id = $5`,
        [inboundId, uuid, `${client.name}@vpn`, inbound.protocol, clientId]
    );

    // Деплоим обновлённый конфиг (+ Entry-серверы)
    await deployWithEntries(inbound.server_id);

    return { success: true, uuid };
}

/**
 * Удалить клиента из Xray inbound
 */
async function removeClientFromInbound(clientId) {
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [clientId]);
    if (!client) throw new Error('Клиент не найден');

    const serverId = client.xray_inbound_id
        ? (await queryOne('SELECT server_id FROM xray_inbounds WHERE id = $1', [client.xray_inbound_id]))?.server_id
        : null;

    await query(
        `UPDATE clients SET xray_inbound_id = NULL, xray_uuid = NULL, xray_email = NULL WHERE id = $1`,
        [clientId]
    );

    if (serverId) {
        await deployWithEntries(serverId);
    }

    return { success: true };
}

// ============================================================
// Сбор статистики
// ============================================================

/**
 * Собрать статистику Xray через агент API
 */
async function collectXrayStats(serverId) {
    const instance = await queryOne('SELECT * FROM xray_instances WHERE server_id = $1', [serverId]);
    if (!instance || instance.status !== 'active') return;

    try {
        // Запрос статистики через агент с одновременным сбросом (атомарная операция)
        // Используем reset endpoint — он вызывает xray api statsquery -reset,
        // что возвращает текущие значения И обнуляет счётчики за один вызов
        const result = await nodeClient.xrayResetStats(serverId, instance.api_port);
        // reset endpoint возвращает { ok, stats: [...] } — stats тут в сыром формате
        const rawStats = result.stats || [];

        if (rawStats.length === 0) return;

        // Парсим raw stats (формат: { name: "user>>>email@vpn>>>traffic>>>uplink", value: "12345" })
        const statEntries = rawStats.map(s => {
            const parts = s.name.split('>>>');
            return {
                name: s.name,
                type: parts[0],
                tag: parts[1],
                direction: parts[3],
                value: parseInt(s.value) || 0,
            };
        });

        // Группируем статистику
        const users = {};
        const inboundsTraffic = {};

        for (const s of statEntries) {
            if (s.type === 'user') {
                if (!users[s.tag]) users[s.tag] = { uplink: 0, downlink: 0 };
                users[s.tag][s.direction] = s.value;
            } else if (s.type === 'inbound') {
                if (!inboundsTraffic[s.tag]) inboundsTraffic[s.tag] = { uplink: 0, downlink: 0 };
                inboundsTraffic[s.tag][s.direction] = s.value;
            }
        }

        // Обновляем трафик клиентов
        await transaction(async (client) => {
            // === VLESS: per-user stats (Xray трекает по email) ===
            for (const [email, traffic] of Object.entries(users)) {
                const dbClient = await client.query(
                    'SELECT id, upload_bytes, download_bytes FROM clients WHERE xray_email = $1',
                    [email]
                );

                if (!dbClient.rows[0]) continue;
                const cl = dbClient.rows[0];

                const hasNewTraffic = (traffic.uplink || 0) > 0 || (traffic.downlink || 0) > 0;

                // Пропускаем если нет нового трафика (дельта = 0 после reset)
                if (!hasNewTraffic) continue;

                const newUp = (parseInt(cl.upload_bytes) || 0) + (traffic.uplink || 0);
                const newDown = (parseInt(cl.download_bytes) || 0) + (traffic.downlink || 0);

                // last_connected обновляем ТОЛЬКО при реальном трафике
                await client.query(
                    `UPDATE clients SET upload_bytes = $1, download_bytes = $2, last_connected = NOW() WHERE id = $3`,
                    [newUp, newDown, cl.id]
                );

                // Запись в историю трафика
                await client.query(
                    `INSERT INTO traffic_history (client_id, server_id, tx_bytes, rx_bytes, recorded_at)
                     VALUES ($1, $2, $3, $4, NOW())`,
                    [cl.id, serverId, traffic.uplink || 0, traffic.downlink || 0]
                );
            }

            // Обновляем трафик inbounds
            for (const [tag, traffic] of Object.entries(inboundsTraffic)) {
                await client.query(
                    `UPDATE xray_inbounds SET
                        up_bytes = up_bytes + $1,
                        down_bytes = down_bytes + $2
                     WHERE server_id = $3 AND tag = $4`,
                    [traffic.uplink || 0, traffic.downlink || 0, serverId, tag]
                );
            }
        });
    } catch (err) {
        console.error(`[XRAY] Ошибка сбора статистики #${serverId}:`, err.message);
    }
}

async function generateShareLink(clientId) {
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [clientId]);
    if (!client) throw new Error('Клиент не найден');
    if (!client.xray_inbound_id) throw new Error('Клиент не привязан к Xray inbound');

    const inbound = await queryOne('SELECT * FROM xray_inbounds WHERE id = $1', [client.xray_inbound_id]);
    if (!inbound) throw new Error('Inbound не найден');

    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [inbound.server_id]);
    if (!server) throw new Error('Сервер не найден');

    let address;
    let viaEntry = false;
    let effectiveInbound = inbound;

    // 1) Entry server lookup via client group
    if (client.client_group_id) {
        const group = await queryOne(
            'SELECT cg.server_group_id FROM client_groups cg WHERE cg.id = $1',
            [client.client_group_id]
        );
        if (group?.server_group_id) {
            let entries = await queryAll(
                `SELECT s.* FROM server_group_members sgm
                 JOIN servers s ON s.id = sgm.server_id
                 WHERE sgm.server_group_id = $1 AND sgm.role = 'entry'
                   AND s.status = 'online'
                 ORDER BY s.id`,
                [group.server_group_id]
            );
            if (entries.length === 0) {
                entries = await queryAll(
                    `SELECT s.* FROM server_group_members sgm
                     JOIN servers s ON s.id = sgm.server_id
                     WHERE sgm.server_group_id = $1 AND sgm.role = 'entry'
                     ORDER BY s.id`,
                    [group.server_group_id]
                );
            }
            if (entries.length > 0) {
                const entryServer = entries[client.id % entries.length];
                address = entryServer.domain || entryServer.ipv4;
                viaEntry = true;

                if (inbound.server_id !== entryServer.id) {
                    const entryInbound = await queryOne(
                        `SELECT * FROM xray_inbounds
                         WHERE server_id = $1 AND protocol = $2 AND port = $3
                           AND tag NOT LIKE 'chain-%' AND is_enabled = TRUE
                         LIMIT 1`,
                        [entryServer.id, inbound.protocol, inbound.port]
                    );
                    if (!entryInbound) {
                        const fallbackInbound = await queryOne(
                            `SELECT * FROM xray_inbounds
                             WHERE server_id = $1 AND protocol = $2
                               AND tag NOT LIKE 'chain-%' AND is_enabled = TRUE
                             ORDER BY port LIMIT 1`,
                            [entryServer.id, inbound.protocol]
                        );
                        if (fallbackInbound) effectiveInbound = fallbackInbound;
                    } else {
                        effectiveInbound = entryInbound;
                    }
                }
            }
        }
    }

    // 2) Legacy path via server_links
    if (!address) {
        const entryServer = await queryOne(
            `SELECT s.* FROM server_links sl
             JOIN servers s ON s.id = sl.from_server_id
             WHERE sl.to_server_id = $1 AND sl.link_type = 'xray' AND sl.status = 'active'
             ORDER BY sl.created_at DESC LIMIT 1`,
            [server.id]
        );
        viaEntry = !!entryServer;
        const linkServer = entryServer || server;
        address = linkServer.domain || linkServer.ipv4 || linkServer.host;
    }

    if (!address) {
        throw new Error(`Нет адреса для подключения (server #${server.id}: domain=${server.domain}, ipv4=${server.ipv4}, host=${server.host})`);
    }

    const port = effectiveInbound.port;

    let streamSettings;
    if (viaEntry && effectiveInbound.id !== inbound.id) {
        const entryStream = effectiveInbound.stream_settings || {};
        const exitStream = inbound.stream_settings || {};
        streamSettings = {
            ...exitStream,
            security: entryStream.security || exitStream.security,
            realitySettings: entryStream.realitySettings || exitStream.realitySettings,
            tlsSettings: entryStream.tlsSettings || exitStream.tlsSettings,
        };
    } else {
        streamSettings = effectiveInbound.stream_settings || {};
    }

    if (effectiveInbound.protocol == "vless" && streamSettings.security == "reality") {
        if (!streamSettings.network || streamSettings.network == "tcp") {
            // streamSettings.network = "xhttp"; // DISABLED for TCP+Vision
            if (!streamSettings.xhttpSettings) streamSettings.xhttpSettings = { path: "/", mode: "auto" };
        }
    }

    const settings = streamSettings.network === 'xhttp'
        ? { ...(effectiveInbound.settings || {}), flow: '' }
        : (effectiveInbound.settings || {});
    const remark = encodeURIComponent(client.name);

    switch (effectiveInbound.protocol) {
        case 'vless':
            return buildVlessLink(client, address, port, streamSettings, settings, remark);
        default:
            throw new Error(`Unsupported protocol: ${effectiveInbound.protocol}`);
    }
}

/**
 * Генерация нескольких share links с разными SNI (для подписки).
 * Если у inbound заполнен sni_list — создаёт отдельный vless:// для каждого SNI.
 * Если sni_list пустой — возвращает один стандартный link.
 */
async function generateShareLinks(clientId) {
    // Пробуем мульти-SNI, при любой ошибке — fallback на обычный generateShareLink
    try {
        const client = await queryOne('SELECT * FROM clients WHERE id = $1', [clientId]);
        if (!client) throw new Error('Клиент не найден');
        if (!client.xray_inbound_id) throw new Error('Клиент не привязан к Xray inbound');

        const inbound = await queryOne('SELECT * FROM xray_inbounds WHERE id = $1', [client.xray_inbound_id]);
        if (!inbound) throw new Error('Inbound не найден');

        const sniList = Array.isArray(inbound.sni_list) ? inbound.sni_list.filter(s => s) : [];

        // Если sni_list пустой — обычная генерация одного link
        if (sniList.length === 0) {
            const link = await generateShareLink(clientId);
            return [link];
        }

    // Повторяем логику generateShareLink для получения address, port, streamSettings, settings
    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [inbound.server_id]);
    if (!server) throw new Error('Сервер не найден');

    let address;
    let viaEntry = false;
    let effectiveInbound = inbound;

    // Entry server lookup via client group (копия из generateShareLink)
    if (client.client_group_id) {
        const group = await queryOne(
            'SELECT cg.server_group_id FROM client_groups cg WHERE cg.id = $1',
            [client.client_group_id]
        );
        if (group?.server_group_id) {
            let entries = await queryAll(
                `SELECT s.* FROM server_group_members sgm
                 JOIN servers s ON s.id = sgm.server_id
                 WHERE sgm.server_group_id = $1 AND sgm.role = 'entry'
                   AND s.status = 'online'
                 ORDER BY s.id`,
                [group.server_group_id]
            );
            if (entries.length === 0) {
                entries = await queryAll(
                    `SELECT s.* FROM server_group_members sgm
                     JOIN servers s ON s.id = sgm.server_id
                     WHERE sgm.server_group_id = $1 AND sgm.role = 'entry'
                     ORDER BY s.id`,
                    [group.server_group_id]
                );
            }
            if (entries.length > 0) {
                const entryServer = entries[client.id % entries.length];
                address = entryServer.domain || entryServer.ipv4;
                viaEntry = true;

                if (inbound.server_id !== entryServer.id) {
                    const entryInbound = await queryOne(
                        `SELECT * FROM xray_inbounds
                         WHERE server_id = $1 AND protocol = $2 AND port = $3
                           AND tag NOT LIKE 'chain-%' AND is_enabled = TRUE
                         LIMIT 1`,
                        [entryServer.id, inbound.protocol, inbound.port]
                    );
                    if (!entryInbound) {
                        const fallbackInbound = await queryOne(
                            `SELECT * FROM xray_inbounds
                             WHERE server_id = $1 AND protocol = $2
                               AND tag NOT LIKE 'chain-%' AND is_enabled = TRUE
                             ORDER BY port LIMIT 1`,
                            [entryServer.id, inbound.protocol]
                        );
                        if (fallbackInbound) effectiveInbound = fallbackInbound;
                    } else {
                        effectiveInbound = entryInbound;
                    }
                }
            }
        }
    }

    // Legacy path via server_links
    if (!address) {
        const entryServer = await queryOne(
            `SELECT s.* FROM server_links sl
             JOIN servers s ON s.id = sl.from_server_id
             WHERE sl.to_server_id = $1 AND sl.link_type = 'xray' AND sl.status = 'active'
             ORDER BY sl.created_at DESC LIMIT 1`,
            [server.id]
        );
        viaEntry = !!entryServer;
        const linkServer = entryServer || server;
        address = linkServer.domain || linkServer.ipv4 || linkServer.host;
    }

    if (!address) {
        throw new Error(`Нет адреса для подключения (server #${server.id}: domain=${server.domain}, ipv4=${server.ipv4}, host=${server.host})`);
    }

    const port = effectiveInbound.port;

    let streamSettings;
    if (viaEntry && effectiveInbound.id !== inbound.id) {
        const entryStream = effectiveInbound.stream_settings || {};
        const exitStream = inbound.stream_settings || {};
        streamSettings = {
            ...exitStream,
            security: entryStream.security || exitStream.security,
            realitySettings: entryStream.realitySettings || exitStream.realitySettings,
            tlsSettings: entryStream.tlsSettings || exitStream.tlsSettings,
        };
    } else {
        streamSettings = effectiveInbound.stream_settings || {};
    }

    if (effectiveInbound.protocol == "vless" && streamSettings.security == "reality") {
        if (!streamSettings.network || streamSettings.network == "tcp") {
            if (!streamSettings.xhttpSettings) streamSettings.xhttpSettings = { path: "/", mode: "auto" };
        }
    }

    const settings = streamSettings.network === 'xhttp'
        ? { ...(effectiveInbound.settings || {}), flow: '' }
        : (effectiveInbound.settings || {});

    // Генерируем link для каждого SNI
    const links = [];
    for (const sni of sniList) {
        const remark = encodeURIComponent(`${client.name} | ${sni}`);
        switch (effectiveInbound.protocol) {
            case 'vless':
                links.push(buildVlessLink(client, address, port, streamSettings, settings, remark, sni));
                break;
        }
    }

    return links;

    } catch (err) {
        // Fallback: при любой ошибке мульти-SNI — вернуть обычный link
        console.warn(`[XRAY] generateShareLinks fallback для #${clientId}:`, err.message);
        const link = await generateShareLink(clientId);
        return [link];
    }
}

function buildVlessLink(client, address, port, stream, settings, remark, sniOverride) {
    const uuid = client.xray_uuid;
    const params = new URLSearchParams();

    // Transport
    const network = stream.network || 'tcp';
    params.set('type', network);

    // Security
    const security = stream.security || 'none';
    params.set('security', security);

    // Flow (XTLS) — XHTTP несовместим с flow
    if (settings.flow && network !== 'xhttp') {
        params.set('flow', settings.flow);
    }

    // Reality settings
    if (security === 'reality') {
        const rs = stream.realitySettings || {};
        if (rs.publicKey) params.set('pbk', rs.publicKey);
        if (rs.shortIds?.[0]) params.set('sid', rs.shortIds[0]);
        // SNI: sniOverride > домен сервера (address) > serverNames[0]
        let sni = sniOverride;
        if (!sni) {
            const isAddressDomain = address && !/^\d+\.\d+\.\d+\.\d+$/.test(address) && !address.includes(':');
            sni = isAddressDomain ? address : (rs.serverNames?.[0] || address);
        }
        if (sni) params.set('sni', sni);
        params.set('fp', rs.fingerprint || 'chrome');
        if (rs.spiderX) params.set('spx', rs.spiderX);
    }

    // TLS settings
    if (security === 'tls') {
        const ts = stream.tlsSettings || {};
        if (ts.serverName) params.set('sni', ts.serverName);
        if (ts.fingerprint) params.set('fp', ts.fingerprint);
        if (ts.alpn) params.set('alpn', Array.isArray(ts.alpn) ? ts.alpn.join(',') : ts.alpn);
    }

    // Transport-specific
    addTransportParams(params, network, stream);

    return `vless://${uuid}@${address}:${port}?${params.toString()}#${remark}`;
}


/**
 * Добавить параметры транспорта в URLSearchParams
 */
function addTransportParams(params, network, stream) {
    switch (network) {
        case 'ws': {
            const ws = stream.wsSettings || {};
            if (ws.path) params.set('path', ws.path);
            if (ws.headers?.Host) params.set('host', ws.headers.Host);
            break;
        }
        case 'grpc': {
            const grpc = stream.grpcSettings || {};
            if (grpc.serviceName) params.set('serviceName', grpc.serviceName);
            if (grpc.multiMode) params.set('mode', 'multi');
            break;
        }
        case 'h2': {
            const h2 = stream.httpSettings || {};
            if (h2.path) params.set('path', h2.path);
            if (h2.host?.length) params.set('host', h2.host.join(','));
            break;
        }
        case 'tcp': {
            const tcp = stream.tcpSettings || {};
            if (tcp.header?.type === 'http') {
                params.set('headerType', 'http');
                if (tcp.header.request?.path?.[0]) params.set('path', tcp.header.request.path[0]);
                if (tcp.header.request?.headers?.Host?.[0]) params.set('host', tcp.header.request.headers.Host[0]);
            }
            break;
        }
        case 'xhttp': {
            const xh = stream.xhttpSettings || {};
            if (xh.path) params.set('path', xh.path);
            if (xh.host) params.set('host', xh.host);
            if (xh.mode && xh.mode !== 'auto') params.set('mode', xh.mode);

            break;
        }
    }
}

// ============================================================
// Утилиты
// ============================================================

/**
 * Собрать outbound для Xray-цепочки (proxy chain)
 */
function buildChainOutbound(chain, endpoint) {
    const tag = `chain-to-${chain.to_server_id}`;
    const settings = chain.xray_settings || {};
    const streamSettings = chain.xray_stream_settings || {};

    // Очищаем streamSettings от null/undefined значений (Xray строгий к типам)
    const cleanStream = {};
    for (const [key, value] of Object.entries(streamSettings)) {
        if (value !== null && value !== undefined) {
            cleanStream[key] = value;
        }
    }

    if (cleanStream.security == "reality" && (!cleanStream.network || cleanStream.network == "tcp")) {
        // cleanStream.network = "xhttp"; // DISABLED for TCP+Vision
        if (!cleanStream.xhttpSettings) cleanStream.xhttpSettings = { path: "/", mode: "auto" };
    }

    if (cleanStream.network === 'xhttp' && cleanStream.xhttpSettings) {
        const xh = cleanStream.xhttpSettings;
        if (!xh.scMaxEachPostBytes) xh.scMaxEachPostBytes = '500000-1000000';
        if (!xh.scMaxConcurrentPosts) xh.scMaxConcurrentPosts = '50-100';
        if (!xh.scMinPostsIntervalMs) xh.scMinPostsIntervalMs = '10-30';
        // Chain: stream-up (постоянный поток, оптимально для видео/UDP)
        // chain mode auto
    }

    const outbound = {
        tag,
        protocol: chain.xray_protocol || 'vless',
        settings: {},
        streamSettings: cleanStream,

    };

    // Формат настроек зависит от протокола
    switch (chain.xray_protocol) {
        case 'vless': {
            const user = {
                id: chain.xray_uuid,
                encryption: 'none',
            };
            // flow для tcp/reality (xtls-rprx-vision)
            if (settings.flow && cleanStream.network !== 'xhttp') user.flow = settings.flow;
            outbound.settings = {
                vnext: [{
                    address: endpoint,
                    port: chain.xray_port,
                    users: [user],
                }],
            };
            break;
        }
    }

    return outbound;
}

/**
 * Генерация Reality x25519 ключей через агент
 */
async function generateRealityKeys(serverId) {
    try {
        const keys = await nodeClient.xrayGenerateKeys(serverId);
        return { privateKey: keys.privateKey, publicKey: keys.publicKey };
    } catch (err) {
        // Фоллбек: генерируем локально через crypto
        console.warn('[XRAY] Не удалось сгенерировать ключи через агент, используем crypto');
        const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
        return {
            privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32).toString('base64url'),
            publicKey: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url'),
        };
    }
}

/**
 * Генерация short ID для Reality
 */
function generateShortId() {
    return crypto.randomBytes(4).toString('hex');
}

/**
 * Генерация UUID v4
 */
function generateUUID() {
    return crypto.randomUUID();
}

// ============================================================
// Мульти-сервер: Entry ↔ Exit синхронизация
// ============================================================

/**
 * Получить Entry-серверы, которые маршрутизируют трафик на данный Exit-сервер
 */
async function getEntryServersForExit(exitServerId) {
    return queryAll(
        `SELECT DISTINCT sl.from_server_id as server_id
         FROM server_links sl
         WHERE sl.to_server_id = $1 AND sl.link_type = 'xray' AND sl.status != 'error'`,
        [exitServerId]
    );
}

/**
 * Задеплоить конфиг на сервер И на все Entry-серверы, которые на него ссылаются.
 * Вызывать при изменении inbound/клиентов на Exit-сервере — чтобы Entry
 * получили актуальные реплицированные inbound'ы.
 */
async function deployWithEntries(serverId, options = {}) {
    await deployConfig(serverId, options);

    const entries = await getEntryServersForExit(serverId);
    for (const entry of entries) {
        try {
            await deployConfig(entry.server_id, { force: true });
        } catch (err) {
            console.error(`[XRAY] Ошибка деплоя Entry #${entry.server_id}:`, err.message);
        }
    }
}

module.exports = {
    // Установка
    installXray,
    uninstallXray,
    // Статус
    getXrayStatus,
    restartXray,
    stopXray,
    // Конфиг
    buildXrayConfig,
    deployConfig,
    deployConfigToAll,
    // Inbounds CRUD
    getInbounds,
    getAllInbounds,
    getInbound,
    createInbound,
    updateInbound,
    deleteInbound,
    // Клиенты
    addClientToInbound,
    removeClientFromInbound,
    // Статистика
    collectXrayStats,
    // Share links
    generateShareLink,
    generateShareLinks,
    // Мульти-сервер
    getEntryServersForExit,
    deployWithEntries,
    // Утилиты
    generateRealityKeys,
    generateShortId,
    generateUUID,
};
