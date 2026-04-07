// Сервис управления группами серверов и клиентов
const { queryOne, queryAll, query } = require('../db/postgres');
const tunnelService = require('./tunnel');
const xrayService = require('./xray');
const nodeClient = require('./node-client');

// ============================================================
// Server Groups CRUD
// ============================================================

async function getServerGroups() {
    return queryAll(`
        SELECT sg.*,
            (SELECT COUNT(*) FROM server_group_members sgm WHERE sgm.server_group_id = sg.id) as members_count,
            (SELECT COUNT(*) FROM server_group_members sgm WHERE sgm.server_group_id = sg.id AND sgm.role = 'entry') as entry_count,
            (SELECT COUNT(*) FROM server_group_members sgm WHERE sgm.server_group_id = sg.id AND sgm.role = 'exit') as exit_count,
            (SELECT COUNT(*) FROM client_groups cg WHERE cg.server_group_id = sg.id) as client_groups_count
        FROM server_groups sg
        ORDER BY sg.created_at
    `);
}

async function getServerGroup(id) {
    const group = await queryOne(`
        SELECT sg.*,
            (SELECT COUNT(*) FROM client_groups cg WHERE cg.server_group_id = sg.id) as client_groups_count
        FROM server_groups sg WHERE sg.id = $1
    `, [id]);
    if (!group) throw new Error('Группа серверов не найдена');

    group.members = await queryAll(`
        SELECT sgm.*, s.name as server_name, s.ipv4 as server_ip,
            s.domain as server_domain, s.status as server_status,
            s.agent_status,
            (SELECT COUNT(*) FROM xray_inbounds xi WHERE xi.server_id = sgm.server_id AND xi.tag NOT LIKE 'chain-%' AND xi.is_enabled = TRUE) as inbounds_count
        FROM server_group_members sgm
        JOIN servers s ON s.id = sgm.server_id
        WHERE sgm.server_group_id = $1
        ORDER BY sgm.role, s.name
    `, [id]);

    group.client_groups = await queryAll(`
        SELECT cg.*,
            (SELECT COUNT(*) FROM clients c WHERE c.client_group_id = cg.id AND c.is_chain = FALSE) as clients_count
        FROM client_groups cg
        WHERE cg.server_group_id = $1
        ORDER BY cg.name
    `, [id]);

    // Туннели этой группы
    group.tunnels = await queryAll(`
        SELECT sl.id, sl.name, sl.status, sl.xray_protocol, sl.xray_port, sl.endpoint_mode,
            fs.name as from_name, ts.name as to_name
        FROM server_links sl
        JOIN servers fs ON fs.id = sl.from_server_id
        JOIN servers ts ON ts.id = sl.to_server_id
        WHERE sl.server_group_id = $1
        ORDER BY sl.created_at
    `, [id]);

    // Авто-синхронизация клиентов: Exit → Entry (в фоне, не блокируем ответ)
    syncGroupClientInbounds(id).catch(err => {
        console.error(`[GROUPS] Фоновая синхронизация клиентов группы #${id}:`, err.message);
    });

    // Авто-восстановление упавших туннелей (в фоне)
    const errorTunnels = group.tunnels.filter(t => t.status === 'error');
    if (errorTunnels.length > 0) {
        (async () => {
            for (const t of errorTunnels) {
                try {
                    const result = await tunnelService.restartTunnel(t.id);
                    if (result.status === 'active') {
                        console.log(`[GROUPS] Туннель "${t.name}" автовосстановлен`);
                    }
                } catch (err) {
                    console.warn(`[GROUPS] Ошибка восстановления туннеля "${t.name}":`, err.message);
                }
            }
        })().catch(() => {});
    }

    return group;
}

async function createServerGroup({ name, description }) {
    if (!name?.trim()) throw new Error('Имя группы обязательно');
    return queryOne(
        'INSERT INTO server_groups (name, description) VALUES ($1, $2) RETURNING *',
        [name.trim(), description || null]
    );
}

async function updateServerGroup(id, { name, description }) {
    const group = await queryOne('SELECT * FROM server_groups WHERE id = $1', [id]);
    if (!group) throw new Error('Группа серверов не найдена');
    return queryOne(
        'UPDATE server_groups SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3 RETURNING *',
        [name || null, description !== undefined ? description : null, id]
    );
}

async function deleteServerGroup(id) {
    const group = await queryOne('SELECT * FROM server_groups WHERE id = $1', [id]);
    if (!group) throw new Error('Группа серверов не найдена');

    // Удаляем group-managed туннели
    const groupTunnels = await queryAll(
        'SELECT id FROM server_links WHERE server_group_id = $1',
        [id]
    );
    for (const t of groupTunnels) {
        try {
            await tunnelService.deleteTunnel(t.id);
        } catch (err) {
            console.error(`[GROUPS] Ошибка удаления туннеля #${t.id}:`, err.message);
        }
    }

    await query('DELETE FROM server_groups WHERE id = $1', [id]);

    await query(
        `INSERT INTO logs (level, category, message) VALUES ('info', 'system', $1)`,
        [`Удалена группа серверов: ${group.name}`]
    );

    return { success: true };
}

// ============================================================
// Server Group Members (с авто-туннелями)
// ============================================================

/**
 * Реплицировать inbound'ы с шаблонного сервера на целевой
 */
async function _replicateInboundsFromTemplate(templateServerId, targetServerId, targetName) {
    const templateInbounds = await queryAll(
        `SELECT * FROM xray_inbounds
         WHERE server_id = $1 AND tag NOT LIKE 'chain-%' AND is_enabled = TRUE
         ORDER BY port, tag`,
        [templateServerId]
    );
    if (templateInbounds.length === 0) return 0;

    const existingInbounds = await queryAll(
        `SELECT tag, port FROM xray_inbounds WHERE server_id = $1 AND tag NOT LIKE 'chain-%'`,
        [targetServerId]
    );
    const existingTags = new Set(existingInbounds.map(ib => ib.tag));
    const existingPorts = new Set(existingInbounds.map(ib => ib.port));

    let created = 0;
    for (const tmpl of templateInbounds) {
        if (existingTags.has(tmpl.tag) || existingPorts.has(tmpl.port)) continue;
        try {
            const tmplStream = typeof tmpl.stream_settings === 'string' ? JSON.parse(tmpl.stream_settings) : (tmpl.stream_settings || {});
            const newStream = { ...tmplStream };
            if (newStream.security === 'reality' && newStream.realitySettings) {
                const { privateKey, publicKey, ...restReality } = newStream.realitySettings;
                newStream.realitySettings = restReality;
            }
            const tmplSettings = typeof tmpl.settings === 'string' ? JSON.parse(tmpl.settings) : (tmpl.settings || {});
            const newSettings = { ...tmplSettings };
            if (tmpl.protocol === 'shadowsocks') delete newSettings.password;

            await xrayService.createInbound(targetServerId, {
                tag: tmpl.tag, protocol: tmpl.protocol, port: tmpl.port, listen: tmpl.listen || '0.0.0.0',
                settings: newSettings, stream_settings: newStream,
                sniffing: typeof tmpl.sniffing === 'string' ? JSON.parse(tmpl.sniffing) : (tmpl.sniffing || {}),
                remark: tmpl.remark,
            });
            created++;
            console.log(`[GROUPS] Авто-создан inbound "${tmpl.tag}" (${tmpl.protocol}:${tmpl.port}) на сервере ${targetName}`);
        } catch (err) {
            console.error(`[GROUPS] Ошибка создания inbound "${tmpl.tag}" на ${targetName}:`, err.message);
        }
    }
    return created;
}

/**
 * Реплицировать inbound'ы на сервер из группы (ищет шаблон среди Entry, потом Exit серверов)
 */
async function _replicateInboundsToServer(serverGroupId, targetServerId, targetName) {
    // Проверяем есть ли уже inbound'ы
    const existing = await queryAll(
        `SELECT tag FROM xray_inbounds WHERE server_id = $1 AND tag NOT LIKE 'chain-%'`,
        [targetServerId]
    );
    if (existing.length > 0) return 0;

    // Ищем шаблон: сначала другие Entry, потом Exit серверы
    const templateSources = await queryAll(
        `SELECT sgm.server_id, sgm.role FROM server_group_members sgm
         WHERE sgm.server_group_id = $1 AND sgm.server_id != $2
         ORDER BY CASE WHEN sgm.role = 'entry' THEN 0 ELSE 1 END`,
        [serverGroupId, targetServerId]
    );

    for (const src of templateSources) {
        const count = await _replicateInboundsFromTemplate(src.server_id, targetServerId, targetName);
        if (count > 0) return count;
    }

    // Нет шаблонов — создаём дефолтный VLESS Reality
    try {
        await xrayService.createInbound(targetServerId, {
            tag: 'vless-reality', protocol: 'vless', port: 443, listen: '0.0.0.0',
            settings: { decryption: 'none', clients: [] },
            stream_settings: {
                network: 'tcp', security: 'reality',
                realitySettings: { show: false, dest: 'www.google.com:443', serverNames: ['www.google.com', 'www.microsoft.com'], fingerprint: 'chrome' },
            },
            sniffing: { enabled: true, destOverride: ['http', 'tls'] },
            remark: 'Default VLESS Reality',
        });
        console.log(`[GROUPS] Дефолтный inbound создан на ${targetName}`);
        return 1;
    } catch (err) {
        console.error(`[GROUPS] Ошибка создания дефолтного inbound на ${targetName}:`, err.message);
        return 0;
    }
}

async function addServerToGroup(serverGroupId, serverId, role) {
    const group = await queryOne('SELECT * FROM server_groups WHERE id = $1', [serverGroupId]);
    if (!group) throw new Error('Группа серверов не найдена');

    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [serverId]);
    if (!server) throw new Error('Сервер не найден');

    if (!['entry', 'exit'].includes(role)) {
        throw new Error('Роль должна быть "entry" или "exit"');
    }

    // Проверяем что сервер ещё не в этой группе
    const existing = await queryOne(
        'SELECT * FROM server_group_members WHERE server_group_id = $1 AND server_id = $2',
        [serverGroupId, serverId]
    );
    if (existing) {
        throw new Error(`Сервер "${server.name}" уже в группе "${group.name}"`);
    }

    // Добавляем в группу
    const member = await queryOne(
        'INSERT INTO server_group_members (server_group_id, server_id, role) VALUES ($1, $2, $3) RETURNING *',
        [serverGroupId, serverId, role]
    );

    // === Авто-inbound'ы для Entry серверов (клиенты подключаются к Entry) ===
    let inboundsCreated = 0;

    if (role === 'entry') {
        // Новый Entry — реплицируем inbound'ы с других Entry или Exit серверов группы
        inboundsCreated = await _replicateInboundsToServer(serverGroupId, serverId, server.name);
    } else if (role === 'exit') {
        // Новый Exit — создаём inbound на нём (для chain-механизма) и реплицируем на все Entry
        const exitExistingInbounds = await queryAll(
            `SELECT tag, port, protocol FROM xray_inbounds WHERE server_id = $1 AND tag NOT LIKE 'chain-%'`,
            [serverId]
        );
        if (exitExistingInbounds.length === 0) {
            // Exit без inbound'ов — создаём дефолтный (нужен для chain-inbound)
            const otherExits = await queryAll(
                `SELECT sgm.server_id FROM server_group_members sgm
                 WHERE sgm.server_group_id = $1 AND sgm.role = 'exit' AND sgm.server_id != $2`,
                [serverGroupId, serverId]
            );
            if (otherExits.length > 0) {
                inboundsCreated = await _replicateInboundsFromTemplate(otherExits[0].server_id, serverId, server.name);
            } else {
                try {
                    await xrayService.createInbound(serverId, {
                        tag: 'vless-reality', protocol: 'vless', port: 443, listen: '0.0.0.0',
                        settings: { decryption: 'none', clients: [] },
                        stream_settings: {
                            network: 'tcp', security: 'reality',
                            realitySettings: { show: false, dest: 'www.google.com:443', serverNames: ['www.google.com', 'www.microsoft.com'], fingerprint: 'chrome' },
                        },
                        sniffing: { enabled: true, destOverride: ['http', 'tls'] },
                        remark: 'Default VLESS Reality',
                    });
                    inboundsCreated++;
                } catch (err) {
                    console.error(`[GROUPS] Ошибка создания дефолтного inbound на ${server.name}:`, err.message);
                }
            }
        }

        // Реплицируем inbound'ы на все Entry серверы группы (если у них ещё нет)
        const entries = await queryAll(
            `SELECT sgm.server_id, s.name FROM server_group_members sgm
             JOIN servers s ON s.id = sgm.server_id
             WHERE sgm.server_group_id = $1 AND sgm.role = 'entry'`,
            [serverGroupId]
        );
        for (const entry of entries) {
            try {
                const created = await _replicateInboundsToServer(serverGroupId, entry.server_id, entry.name);
                if (created > 0) console.log(`[GROUPS] Реплицировано ${created} inbound'ов на Entry ${entry.name}`);
            } catch (err) {
                console.error(`[GROUPS] Ошибка репликации inbound'ов на Entry ${entry.name}:`, err.message);
            }
        }
    }

    // === Авто-туннели ===
    const tunnelsCreated = [];

    if (role === 'entry') {
        // Новый Entry → создать туннели ко всем Exit в группе
        const exits = await queryAll(
            `SELECT sgm.server_id, s.name FROM server_group_members sgm
             JOIN servers s ON s.id = sgm.server_id
             WHERE sgm.server_group_id = $1 AND sgm.role = 'exit'`,
            [serverGroupId]
        );
        for (const exit of exits) {
            try {
                const tunnel = await createGroupTunnel(serverGroupId, serverId, exit.server_id);
                tunnelsCreated.push(tunnel);
            } catch (err) {
                console.error(`[GROUPS] Ошибка авто-туннеля ${server.name} → ${exit.name}:`, err.message);
            }
        }
    } else {
        // Новый Exit → создать туннели от всех Entry в группе
        const entries = await queryAll(
            `SELECT sgm.server_id, s.name FROM server_group_members sgm
             JOIN servers s ON s.id = sgm.server_id
             WHERE sgm.server_group_id = $1 AND sgm.role = 'entry'`,
            [serverGroupId]
        );
        for (const entry of entries) {
            try {
                const tunnel = await createGroupTunnel(serverGroupId, entry.server_id, serverId);
                tunnelsCreated.push(tunnel);
            } catch (err) {
                console.error(`[GROUPS] Ошибка авто-туннеля ${entry.name} → ${server.name}:`, err.message);
            }
        }
    }

    await query(
        `INSERT INTO logs (level, category, message, details) VALUES ('info', 'system', $1, $2)`,
        [`Сервер "${server.name}" добавлен в группу "${group.name}" как ${role}`,
         JSON.stringify({ tunnels_created: tunnelsCreated.length, inbounds_created: inboundsCreated })]
    );

    // === Авто-синхронизация клиентов: Exit → Entry inbound'ы ===
    const clientsMoved = await syncGroupClientInbounds(serverGroupId);
    if (clientsMoved > 0) {
        console.log(`[GROUPS] Синхронизировано ${clientsMoved} клиентов на Entry inbound'ы`);
    }

    return { member, tunnels_created: tunnelsCreated.length, inbounds_created: inboundsCreated, clients_moved: clientsMoved };
}

/**
 * Создать туннель внутри группы (без удаления старых маршрутов к Exit)
 */
async function createGroupTunnel(serverGroupId, fromServerId, toServerId) {
    const fromServer = await queryOne('SELECT * FROM servers WHERE id = $1', [fromServerId]);
    const toServer = await queryOne('SELECT * FROM servers WHERE id = $1', [toServerId]);

    // Проверяем что Xray установлен на обоих серверах
    const fromXray = await queryOne('SELECT * FROM xray_instances WHERE server_id = $1', [fromServerId]);
    const toXray = await queryOne('SELECT * FROM xray_instances WHERE server_id = $1', [toServerId]);
    if (!fromXray || !toXray) {
        throw new Error(`Xray не установлен на одном из серверов (${fromServer.name} / ${toServer.name})`);
    }

    // Проверяем нет ли уже туннеля между этими серверами
    const existing = await queryOne(
        `SELECT * FROM server_links WHERE from_server_id = $1 AND to_server_id = $2 AND link_type = 'xray' AND status != 'error'`,
        [fromServerId, toServerId]
    );
    if (existing) {
        // Привязываем к группе если ещё не привязан
        if (!existing.server_group_id) {
            await query('UPDATE server_links SET server_group_id = $1 WHERE id = $2', [serverGroupId, existing.id]);
        }
        return existing;
    }

    // Берём настройки из существующих user-facing inbounds на Exit (если есть)
    const exitInbound = await queryOne(
        `SELECT * FROM xray_inbounds WHERE server_id = $1 AND tag NOT LIKE 'chain-%' AND is_enabled = TRUE ORDER BY created_at LIMIT 1`,
        [toServerId]
    );

    const protocol = exitInbound?.protocol || 'vless';
    const port = exitInbound?.port || 443;
    const stream = exitInbound?.stream_settings || {};

    // Создаём туннель через существующий сервис
    // Серверы между собой общаются строго по IPv6
    const tunnel = await tunnelService.createTunnel({
        name: `${fromServer.name} → ${toServer.name}`,
        from_server_id: fromServerId,
        to_server_id: toServerId,
        endpoint_mode: 'ipv6',
        xray_protocol: protocol,
        xray_port: port,
        xray_settings: exitInbound?.settings || {},
        xray_stream_settings: {
            network: stream.network || 'tcp',
            security: stream.security || 'reality',
            realitySettings: stream.security === 'reality' ? {
                serverNames: stream.realitySettings?.serverNames || ['www.google.com'],
                fingerprint: 'chrome',
            } : undefined,
        },
        server_group_id: serverGroupId,
    });

    // Привязываем к группе
    await query('UPDATE server_links SET server_group_id = $1 WHERE id = $2', [serverGroupId, tunnel.id]);

    return tunnel;
}

async function removeServerFromGroup(serverGroupId, serverId) {
    const member = await queryOne(
        'SELECT * FROM server_group_members WHERE server_group_id = $1 AND server_id = $2',
        [serverGroupId, serverId]
    );
    if (!member) throw new Error('Сервер не найден в группе');

    const server = await queryOne('SELECT name FROM servers WHERE id = $1', [serverId]);

    // Удаляем group-managed туннели с участием этого сервера
    const groupTunnels = await queryAll(
        `SELECT id FROM server_links
         WHERE server_group_id = $1 AND (from_server_id = $2 OR to_server_id = $2)`,
        [serverGroupId, serverId]
    );
    for (const t of groupTunnels) {
        try {
            await tunnelService.deleteTunnel(t.id);
        } catch (err) {
            console.error(`[GROUPS] Ошибка удаления туннеля #${t.id}:`, err.message);
        }
    }

    // Запоминаем роль до удаления
    const wasEntry = member.role === 'entry';

    // Удаляем из группы
    await query(
        'DELETE FROM server_group_members WHERE server_group_id = $1 AND server_id = $2',
        [serverGroupId, serverId]
    );

    await query(
        `INSERT INTO logs (level, category, message) VALUES ('info', 'system', $1)`,
        [`Сервер "${server?.name}" удалён из группы #${serverGroupId}`]
    );

    return { success: true, tunnels_deleted: groupTunnels.length };
}

// ============================================================
// Client Groups CRUD
// ============================================================

async function getClientGroups() {
    return queryAll(`
        SELECT cg.*,
            sg.name as server_group_name,
            (SELECT COUNT(*) FROM clients c WHERE c.client_group_id = cg.id AND c.is_chain = FALSE) as clients_count
        FROM client_groups cg
        LEFT JOIN server_groups sg ON sg.id = cg.server_group_id
        ORDER BY cg.name
    `);
}

async function getClientGroup(id) {
    const group = await queryOne(`
        SELECT cg.*,
            sg.name as server_group_name,
            sg.id as server_group_id
        FROM client_groups cg
        LEFT JOIN server_groups sg ON sg.id = cg.server_group_id
        WHERE cg.id = $1
    `, [id]);
    if (!group) throw new Error('Группа клиентов не найдена');

    group.clients = await queryAll(`
        SELECT c.id, c.name, c.protocol, c.is_blocked, c.server_id,
            s.name as server_name,
            xi.tag as inbound_tag, xi.port as inbound_port
        FROM clients c
        LEFT JOIN servers s ON s.id = c.server_id
        LEFT JOIN xray_inbounds xi ON xi.id = c.xray_inbound_id
        WHERE c.client_group_id = $1 AND c.is_chain = FALSE
        ORDER BY c.name
    `, [id]);

    return group;
}

async function createClientGroup({ name, description, server_group_id }) {
    if (!name?.trim()) throw new Error('Имя группы обязательно');

    if (server_group_id) {
        const sg = await queryOne('SELECT id FROM server_groups WHERE id = $1', [server_group_id]);
        if (!sg) throw new Error('Группа серверов не найдена');
    }

    return queryOne(
        'INSERT INTO client_groups (name, description, server_group_id) VALUES ($1, $2, $3) RETURNING *',
        [name.trim(), description || null, server_group_id || null]
    );
}

async function updateClientGroup(id, { name, description }) {
    const group = await queryOne('SELECT * FROM client_groups WHERE id = $1', [id]);
    if (!group) throw new Error('Группа клиентов не найдена');
    return queryOne(
        'UPDATE client_groups SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3 RETURNING *',
        [name || null, description !== undefined ? description : null, id]
    );
}

async function deleteClientGroup(id) {
    const group = await queryOne('SELECT * FROM client_groups WHERE id = $1', [id]);
    if (!group) throw new Error('Группа клиентов не найдена');

    // Отвязываем клиентов (не удаляем!)
    await query('UPDATE clients SET client_group_id = NULL WHERE client_group_id = $1', [id]);
    await query('DELETE FROM client_groups WHERE id = $1', [id]);

    await query(
        `INSERT INTO logs (level, category, message) VALUES ('info', 'system', $1)`,
        [`Удалена группа клиентов: ${group.name}`]
    );

    return { success: true };
}

// ============================================================
// Смена привязки группы клиентов к группе серверов
// ============================================================

async function switchClientGroupServerGroup(clientGroupId, newServerGroupId) {
    const diag = []; // Диагностика каждого шага
    const log = (step, msg, data) => {
        const entry = { step, msg, ...(data || {}), ts: new Date().toISOString() };
        diag.push(entry);
        console.log(`[GROUPS][DIAG] [${step}] ${msg}`, data ? JSON.stringify(data) : '');
    };

    log('START', `Переключение группы клиентов #${clientGroupId} → серверную группу #${newServerGroupId}`);

    const clientGroup = await queryOne('SELECT * FROM client_groups WHERE id = $1', [clientGroupId]);
    if (!clientGroup) throw new Error('Группа клиентов не найдена');

    const newServerGroup = await queryOne('SELECT * FROM server_groups WHERE id = $1', [newServerGroupId]);
    if (!newServerGroup) throw new Error('Группа серверов не найдена');

    log('GROUPS', `"${clientGroup.name}" (старая серверная группа: #${clientGroup.server_group_id}) → "${newServerGroup.name}" (#${newServerGroupId})`);

    // Получаем всех клиентов группы (не chain)
    const clients = await queryAll(
        'SELECT * FROM clients WHERE client_group_id = $1 AND is_chain = FALSE',
        [clientGroupId]
    );

    log('CLIENTS', `Всего: ${clients.length}`, {
        clients: clients.map(c => ({ id: c.id, name: c.name, protocol: c.protocol, server_id: c.server_id })),
    });

    if (clients.length === 0) {
        await query('UPDATE client_groups SET server_group_id = $1 WHERE id = $2', [newServerGroupId, clientGroupId]);
        log('EMPTY', 'Нет клиентов, только обновили привязку');
        return { migrated: 0, skipped: 0, errors: [], diag };
    }

    // Получаем inbound'ы на Entry серверах НОВОЙ группы
    const newInbounds = await queryAll(`
        SELECT xi.* FROM xray_inbounds xi
        JOIN server_group_members sgm ON sgm.server_id = xi.server_id
        WHERE sgm.server_group_id = $1 AND sgm.role = 'entry'
          AND xi.tag NOT LIKE 'chain-%' AND xi.is_enabled = TRUE
        ORDER BY xi.server_id, xi.port
    `, [newServerGroupId]);

    // Члены новой группы с ролями
    const newGroupMembers = await queryAll(
        `SELECT sgm.server_id, sgm.role, s.name, s.ipv4, s.agent_status
         FROM server_group_members sgm JOIN servers s ON s.id = sgm.server_id
         WHERE sgm.server_group_id = $1`, [newServerGroupId]
    );
    log('NEW_GROUP', `Серверы в новой группе "${newServerGroup.name}"`, {
        members: newGroupMembers.map(m => ({ id: m.server_id, name: m.name, role: m.role, ip: m.ipv4, agent: m.agent_status })),
        inbounds: newInbounds.map(ib => ({ id: ib.id, tag: ib.tag, port: ib.port, protocol: ib.protocol, server_id: ib.server_id })),
    });

    if (newInbounds.length === 0) {
        throw new Error('В новой группе серверов нет доступных inbound\'ов');
    }

    const oldServerIds = new Set();
    const newServerIds = new Set();
    let migrated = 0;
    let skipped = 0;
    const errors = [];

    for (const client of clients) {
        if (client.server_id) oldServerIds.add(client.server_id);

        // Xray-клиенты
        let targetInbound = newInbounds.find(ib =>
            ib.protocol === client.protocol && ib.port === (client.xray_inbound_id
                ? (newInbounds.find(x => x.id === client.xray_inbound_id)?.port)
                : null)
        );
        if (!targetInbound) targetInbound = newInbounds.find(ib => ib.protocol === client.protocol);
        if (!targetInbound) targetInbound = newInbounds[0];

        if (!targetInbound) {
            skipped++;
            errors.push({ client_id: client.id, name: client.name, error: 'Нет matching inbound' });
            continue;
        }

        try {
            await query('UPDATE clients SET xray_inbound_id = $1, server_id = $2 WHERE id = $3',
                [targetInbound.id, targetInbound.server_id, client.id]);
            newServerIds.add(targetInbound.server_id);
            migrated++;
        } catch (err) {
            skipped++;
            errors.push({ client_id: client.id, name: client.name, error: err.message });
        }
    }

    // Обновляем привязку группы
    await query('UPDATE client_groups SET server_group_id = $1 WHERE id = $2', [newServerGroupId, clientGroupId]);
    log('DB_UPDATED', `server_group_id = ${newServerGroupId}, migrated=${migrated}, skipped=${skipped}`);

    // Собираем ВСЕ серверы для деплоя
    const allGroupServerIds = new Set([...oldServerIds, ...newServerIds]);
    if (clientGroup.server_group_id) {
        const oldMembers = await queryAll('SELECT server_id FROM server_group_members WHERE server_group_id = $1', [clientGroup.server_group_id]);
        oldMembers.forEach(m => allGroupServerIds.add(m.server_id));
    }
    const newMembers = await queryAll('SELECT server_id FROM server_group_members WHERE server_group_id = $1', [newServerGroupId]);
    newMembers.forEach(m => allGroupServerIds.add(m.server_id));
    log('SERVERS_TO_DEPLOY', `Серверы для деплоя: [${[...allGroupServerIds].join(', ')}]`);

    // === XRAY ДЕПЛОЙ ===
    log('XRAY_DEPLOY_START', `Деплоим Xray на ${allGroupServerIds.size} серверах`);
    const xrayDeployResults = {};
    for (const serverId of allGroupServerIds) {
        try {
            const result = await xrayService.deployConfig(serverId, { force: true });
            xrayDeployResults[serverId] = { ok: true, ...result };
            log('XRAY_DEPLOY_RESULT', `Сервер #${serverId}: OK`, result);
        } catch (err) {
            xrayDeployResults[serverId] = { ok: false, error: err.message };
            log('XRAY_DEPLOY_ERROR', `Сервер #${serverId}: ${err.message}`);
        }
    }

    await query(
        `INSERT INTO logs (level, category, message, details) VALUES ('info', 'system', $1, $2)`,
        [`Группа "${clientGroup.name}" переключена на серверы "${newServerGroup.name}"`,
         JSON.stringify({ migrated, skipped, errors: errors.length, diag })]
    );

    log('DONE', `Готово: migrated=${migrated}, skipped=${skipped}, errors=${errors.length}`);

    return { migrated, skipped, errors, diag };
}

// ============================================================
// Массовое перемещение клиентов между группами
// ============================================================

async function bulkMoveClients(clientIds, targetGroupId) {
    if (!clientIds?.length) throw new Error('Не указаны клиенты');

    const targetGroup = await queryOne(`
        SELECT cg.*, sg.id as sg_id FROM client_groups cg
        LEFT JOIN server_groups sg ON sg.id = cg.server_group_id
        WHERE cg.id = $1
    `, [targetGroupId]);
    if (!targetGroup) throw new Error('Целевая группа клиентов не найдена');

    // Получаем inbound'ы целевой группы серверов (клиенты подключаются к Entry)
    let targetInbounds = [];
    if (targetGroup.sg_id) {
        targetInbounds = await queryAll(`
            SELECT xi.* FROM xray_inbounds xi
            JOIN server_group_members sgm ON sgm.server_id = xi.server_id
            WHERE sgm.server_group_id = $1 AND sgm.role = 'entry'
              AND xi.tag NOT LIKE 'chain-%' AND xi.is_enabled = TRUE
            ORDER BY xi.server_id, xi.port
        `, [targetGroup.sg_id]);
    }

    const oldServerIds = new Set();
    const newServerIds = new Set();
    const oldServerGroupIds = new Set(); // для редеплоя всех серверов старых групп
    let moved = 0;
    let skipped = 0;
    const errors = [];

    // Собираем старые группы серверов ДО миграции
    for (const clientId of clientIds) {
        const cl = await queryOne(
            `SELECT cg.server_group_id FROM clients c
             JOIN client_groups cg ON cg.id = c.client_group_id
             WHERE c.id = $1 AND cg.server_group_id IS NOT NULL`,
            [clientId]
        );
        if (cl?.server_group_id) oldServerGroupIds.add(cl.server_group_id);
    }

    for (const clientId of clientIds) {
        const client = await queryOne(
            'SELECT * FROM clients WHERE id = $1 AND is_chain = FALSE',
            [clientId]
        );
        if (!client) {
            skipped++;
            continue;
        }

        if (client.server_id) oldServerIds.add(client.server_id);

        // Если целевая группа привязана к серверам — мигрируем inbound
        if (targetInbounds.length > 0) {
            let targetInbound = targetInbounds.find(ib => ib.protocol === client.protocol);
            if (!targetInbound) targetInbound = targetInbounds[0];

            if (targetInbound) {
                await query(
                    'UPDATE clients SET client_group_id = $1, xray_inbound_id = $2, server_id = $3 WHERE id = $4',
                    [targetGroupId, targetInbound.id, targetInbound.server_id, clientId]
                );
                newServerIds.add(targetInbound.server_id);
            } else {
                await query(
                    'UPDATE clients SET client_group_id = $1 WHERE id = $2',
                    [targetGroupId, clientId]
                );
            }
        } else {
            // Просто меняем группу без миграции inbound
            await query(
                'UPDATE clients SET client_group_id = $1 WHERE id = $2',
                [targetGroupId, clientId]
            );
        }
        moved++;
    }

    // Редеплоим ВСЕ серверы в целевой группе + затронутые серверы
    const allGroupServerIds = new Set([...oldServerIds, ...newServerIds]);

    // Добавляем все серверы из целевой группы
    if (targetGroup.sg_id) {
        const groupMembers = await queryAll(
            'SELECT server_id FROM server_group_members WHERE server_group_id = $1',
            [targetGroup.sg_id]
        );
        groupMembers.forEach(m => allGroupServerIds.add(m.server_id));
    }

    // Добавляем серверы из старых групп клиентов (собрано ДО миграции)
    for (const sgId of oldServerGroupIds) {
        const members = await queryAll(
            'SELECT server_id FROM server_group_members WHERE server_group_id = $1',
            [sgId]
        );
        members.forEach(m => allGroupServerIds.add(m.server_id));
    }

    // Xray деплой
    console.log(`[GROUPS] Редеплой Xray на ${allGroupServerIds.size} серверах`);
    for (const serverId of allGroupServerIds) {
        try {
            await xrayService.deployConfig(serverId, { force: true });
        } catch (err) {
            console.error(`[GROUPS] Ошибка деплоя сервера #${serverId}:`, err.message);
        }
    }

    await query(
        `INSERT INTO logs (level, category, message, details) VALUES ('info', 'system', $1, $2)`,
        [`Массовое перемещение ${moved} клиентов в группу "${targetGroup.name}"`,
         JSON.stringify({ moved, skipped, errors: errors.length })]
    );

    return { moved, skipped, errors };
}

// ============================================================
// Доменная маршрутизация
// ============================================================

async function getDomainRoutes(serverGroupId) {
    return queryAll(`
        SELECT dr.*, s.name as target_server_name,
            s.ipv4 as target_server_ip, s.domain as target_server_domain
        FROM domain_routes dr
        JOIN servers s ON s.id = dr.target_server_id
        WHERE dr.server_group_id = $1
        ORDER BY dr.priority DESC, dr.id
    `, [serverGroupId]);
}

async function createDomainRoute({ server_group_id, name, domains, target_server_id, priority }) {
    if (!name?.trim()) throw new Error('Имя правила обязательно');
    if (!domains || domains.length === 0) throw new Error('Укажите хотя бы один домен');
    if (!target_server_id) throw new Error('Укажите целевой сервер');

    const group = await queryOne('SELECT id FROM server_groups WHERE id = $1', [server_group_id]);
    if (!group) throw new Error('Группа серверов не найдена');

    // Проверяем что target_server_id — Exit в этой группе
    const member = await queryOne(
        `SELECT id FROM server_group_members WHERE server_group_id = $1 AND server_id = $2 AND role = 'exit'`,
        [server_group_id, target_server_id]
    );
    if (!member) throw new Error('Целевой сервер не является Exit в этой группе');

    const route = await queryOne(
        `INSERT INTO domain_routes (server_group_id, name, domains, target_server_id, priority)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [server_group_id, name.trim(), domains, target_server_id, priority || 0]
    );

    // Редеплоим Entry серверы группы
    await redeployGroupEntries(server_group_id);

    await query(
        `INSERT INTO logs (level, category, message) VALUES ('info', 'system', $1)`,
        [`Создано доменное правило "${name}" → сервер #${target_server_id}`]
    );

    return route;
}

async function updateDomainRoute(id, data) {
    const route = await queryOne('SELECT * FROM domain_routes WHERE id = $1', [id]);
    if (!route) throw new Error('Правило не найдено');

    const fields = [];
    const params = [];
    let idx = 1;

    if (data.name !== undefined) { fields.push(`name = $${idx++}`); params.push(data.name); }
    if (data.domains !== undefined) { fields.push(`domains = $${idx++}`); params.push(data.domains); }
    if (data.target_server_id !== undefined) {
        // Проверяем что новый target — Exit в группе
        const member = await queryOne(
            `SELECT id FROM server_group_members WHERE server_group_id = $1 AND server_id = $2 AND role = 'exit'`,
            [route.server_group_id, data.target_server_id]
        );
        if (!member) throw new Error('Целевой сервер не является Exit в этой группе');
        fields.push(`target_server_id = $${idx++}`); params.push(data.target_server_id);
    }
    if (data.priority !== undefined) { fields.push(`priority = $${idx++}`); params.push(data.priority); }
    if (data.is_enabled !== undefined) { fields.push(`is_enabled = $${idx++}`); params.push(data.is_enabled); }

    if (fields.length === 0) return route;

    params.push(id);
    const updated = await queryOne(
        `UPDATE domain_routes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        params
    );

    await redeployGroupEntries(route.server_group_id);

    return updated;
}

async function deleteDomainRoute(id) {
    const route = await queryOne('SELECT * FROM domain_routes WHERE id = $1', [id]);
    if (!route) throw new Error('Правило не найдено');

    await query('DELETE FROM domain_routes WHERE id = $1', [id]);

    await redeployGroupEntries(route.server_group_id);

    await query(
        `INSERT INTO logs (level, category, message) VALUES ('info', 'system', $1)`,
        [`Удалено доменное правило "${route.name}"`]
    );

    return { success: true };
}

/**
 * Редеплой всех Entry серверов группы (при изменении доменных правил)
 */
async function redeployGroupEntries(serverGroupId) {
    const entries = await queryAll(
        `SELECT sgm.server_id FROM server_group_members sgm
         WHERE sgm.server_group_id = $1 AND sgm.role = 'entry'`,
        [serverGroupId]
    );
    // Deploy асинхронно (не блокирует HTTP ответ)
    for (const { server_id } of entries) {
        xrayService.deployConfig(server_id, { force: true }).catch(err => {
            console.error(`[GROUPS] Ошибка редеплоя Entry #${server_id}:`, err.message);
        });
    }
    console.log(`[GROUPS] Редеплой ${entries.length} Entry серверов запущен (async)`);
}

/**
 * Авто-синхронизация клиентов: переносит клиентов с Exit inbound'ов на Entry inbound'ы.
 * Клиенты подключаются к Entry серверам — их inbound должен быть на Entry.
 */
async function syncGroupClientInbounds(serverGroupId) {
    let moved = 0;
    const affectedServerIds = new Set();

    // Все клиентские группы этой серверной группы
    const clientGroups = await queryAll(
        'SELECT id FROM client_groups WHERE server_group_id = $1',
        [serverGroupId]
    );
    if (clientGroups.length === 0) return moved;

    // Entry серверы группы
    const entryServers = await queryAll(
        `SELECT sgm.server_id FROM server_group_members sgm
         WHERE sgm.server_group_id = $1 AND sgm.role = 'entry'`,
        [serverGroupId]
    );
    if (entryServers.length === 0) return moved;
    const entryServerIds = new Set(entryServers.map(s => s.server_id));

    // Клиенты в этих группах (не chain, с xray inbound)
    for (const cg of clientGroups) {
        const clients = await queryAll(
            `SELECT c.id, c.name, c.xray_inbound_id, c.xray_uuid,
                    xi.server_id as current_server_id, xi.protocol, xi.port, xi.tag as current_tag
             FROM clients c
             JOIN xray_inbounds xi ON xi.id = c.xray_inbound_id
             WHERE c.client_group_id = $1 AND c.is_chain = FALSE AND c.xray_inbound_id IS NOT NULL`,
            [cg.id]
        );

        for (const client of clients) {
            // Уже на Entry — пропускаем
            if (entryServerIds.has(client.current_server_id)) continue;

            // Ищем подходящий inbound на Entry сервере (тот же протокол и порт)
            let target = await queryOne(
                `SELECT xi.id, xi.tag, xi.server_id, s.name as server_name
                 FROM xray_inbounds xi
                 JOIN servers s ON s.id = xi.server_id
                 WHERE xi.server_id = ANY($1::int[])
                   AND xi.protocol = $2
                   AND xi.port = $3
                   AND xi.tag NOT LIKE 'chain-%'
                   AND xi.is_enabled = TRUE
                 ORDER BY xi.server_id
                 LIMIT 1`,
                [entryServers.map(s => s.server_id), client.protocol, client.port]
            );

            if (!target) {
                // Нет подходящего — ищем любой с тем же протоколом
                target = await queryOne(
                    `SELECT xi.id, xi.tag, xi.server_id, s.name as server_name
                     FROM xray_inbounds xi
                     JOIN servers s ON s.id = xi.server_id
                     WHERE xi.server_id = ANY($1::int[])
                       AND xi.protocol = $2
                       AND xi.tag NOT LIKE 'chain-%'
                       AND xi.is_enabled = TRUE
                     ORDER BY xi.server_id
                     LIMIT 1`,
                    [entryServers.map(s => s.server_id), client.protocol]
                );
            }

            if (!target) {
                console.warn(`[GROUPS] Sync: нет Entry inbound для клиента "${client.name}" (${client.protocol}), пропускаем`);
                continue;
            }

            affectedServerIds.add(client.current_server_id); // старый сервер
            affectedServerIds.add(target.server_id);          // новый сервер

            await query(
                'UPDATE clients SET xray_inbound_id = $1, server_id = $2 WHERE id = $3',
                [target.id, target.server_id, client.id]
            );
            moved++;
            console.log(`[GROUPS] Sync: клиент "${client.name}" → Entry ${target.server_name} (${target.tag})`);
        }
    }

    // Редеплой конфигов на всех затронутых серверах
    if (moved > 0) {
        // Собираем ВСЕ серверы группы (Entry + Exit) — конфиг может зависеть от клиентов
        const allMembers = await queryAll(
            'SELECT server_id FROM server_group_members WHERE server_group_id = $1',
            [serverGroupId]
        );
        for (const m of allMembers) {
            affectedServerIds.add(m.server_id);
        }

        console.log(`[GROUPS] Sync: редеплой ${affectedServerIds.size} серверов после переноса ${moved} клиентов`);
        for (const serverId of affectedServerIds) {
            try {
                await xrayService.deployConfig(serverId, { force: true });
            } catch (err) {
                console.error(`[GROUPS] Sync: ошибка редеплоя #${serverId}:`, err.message);
            }
        }
    }

    return moved;
}

module.exports = {
    // Server Groups
    getServerGroups,
    getServerGroup,
    createServerGroup,
    updateServerGroup,
    deleteServerGroup,
    // Server Group Members
    addServerToGroup,
    removeServerFromGroup,
    // Client Groups
    getClientGroups,
    getClientGroup,
    createClientGroup,
    updateClientGroup,
    deleteClientGroup,
    // Operations
    switchClientGroupServerGroup,
    bulkMoveClients,
    syncGroupClientInbounds,
    // Domain Routing
    getDomainRoutes,
    createDomainRoute,
    updateDomainRoute,
    deleteDomainRoute,
};
