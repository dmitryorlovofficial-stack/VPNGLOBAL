// Сервис управления сайтами-заглушками (stub sites)
// Шаблоны, деплой на серверы через агент, обновление Reality dest
const fs = require('fs');
const path = require('path');
const { queryOne, queryAll, query } = require('../db/postgres');
const nodeClient = require('./node-client');

const TEMPLATES_DIR = path.join(__dirname, '../../stub-templates');

// ============================================================
// Шаблоны
// ============================================================

/**
 * Список доступных шаблонов
 */
function listTemplates() {
    const templates = [];
    if (!fs.existsSync(TEMPLATES_DIR)) return templates;

    const dirs = fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory());

    for (const dir of dirs) {
        const metaPath = path.join(TEMPLATES_DIR, dir.name, 'meta.json');
        if (!fs.existsSync(metaPath)) continue;
        try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            templates.push(meta);
        } catch (err) {
            console.warn(`[STUB] Ошибка чтения meta.json для ${dir.name}:`, err.message);
        }
    }

    return templates;
}

/**
 * Получить файлы шаблона с подстановкой переменных
 */
function getTemplateFiles(templateId, variables = {}) {
    const templateDir = path.join(TEMPLATES_DIR, templateId);
    if (!fs.existsSync(templateDir)) {
        throw new Error(`Шаблон "${templateId}" не найден`);
    }

    const files = {};
    const entries = fs.readdirSync(templateDir);

    for (const entry of entries) {
        if (entry === 'meta.json') continue;
        const filePath = path.join(templateDir, entry);
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;

        let content = fs.readFileSync(filePath, 'utf8');

        // Подставляем {{variable}} → значение
        for (const [key, value] of Object.entries(variables)) {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            content = content.replace(regex, value);
        }

        files[entry] = content;
    }

    if (!files['index.html']) {
        throw new Error(`Шаблон "${templateId}" не содержит index.html`);
    }

    return files;
}

// ============================================================
// Деплой / удаление
// ============================================================

/**
 * Развернуть сайт-заглушку на сервере
 */
async function deployStubSite(serverId, { templateId, variables, customFiles, internalPort = 8444, autoUpdateDest = true }) {
    const server = await queryOne('SELECT * FROM servers WHERE id = $1', [serverId]);
    if (!server) throw new Error('Сервер не найден');

    // Подготовить файлы
    let files;
    if (customFiles && Object.keys(customFiles).length > 0) {
        // Кастомный HTML
        if (!customFiles['index.html']) {
            throw new Error('custom_files должен содержать index.html');
        }
        files = customFiles;
    } else if (templateId) {
        // Из шаблона
        files = getTemplateFiles(templateId, variables || {});
    } else {
        throw new Error('Укажите templateId или customFiles');
    }

    const domain = server.domain || null;

    console.log(`[STUB] Деплой на сервер #${serverId} (${server.name}), шаблон: ${templateId || 'custom'}, файлов: ${Object.keys(files).length}`);

    // Отправляем на агент
    await nodeClient.stubSiteDeploy(serverId, {
        files,
        domain,
        internalPort,
    });

    // Сохраняем в БД
    await query(
        `INSERT INTO stub_sites (server_id, template_id, status, internal_port, domain, variables, custom_files, auto_update_dest, deployed_at)
         VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (server_id) DO UPDATE SET
            template_id = $2, status = 'active', internal_port = $3, domain = $4,
            variables = $5, custom_files = $6, auto_update_dest = $7, deployed_at = NOW()`,
        [
            serverId,
            templateId || 'custom',
            internalPort,
            domain,
            JSON.stringify(variables || {}),
            JSON.stringify(customFiles ? customFiles : {}),
            autoUpdateDest,
        ]
    );

    // Авто-обновление Reality dest → локальный nginx
    if (autoUpdateDest) {
        try {
            await updateRealityDest(serverId, internalPort, domain);
        } catch (err) {
            console.warn(`[STUB] Ошибка обновления Reality dest на #${serverId}:`, err.message);
        }
    }

    console.log(`[STUB] Заглушка развёрнута на #${serverId}`);
    return { ok: true };
}

/**
 * Получить статус заглушки для сервера
 */
async function getStubSiteStatus(serverId) {
    const record = await queryOne('SELECT * FROM stub_sites WHERE server_id = $1', [serverId]);

    // Запрашиваем актуальный статус с агента
    let agentStatus = null;
    try {
        agentStatus = await nodeClient.stubSiteStatus(serverId);
    } catch {}

    return {
        configured: !!record,
        status: record?.status || 'inactive',
        templateId: record?.template_id || null,
        domain: record?.domain || null,
        internalPort: record?.internal_port || 8444,
        autoUpdateDest: record?.auto_update_dest ?? true,
        deployedAt: record?.deployed_at || null,
        variables: record?.variables || {},
        agent: agentStatus,
    };
}

/**
 * Остановить nginx на сервере
 */
async function stopStubSite(serverId) {
    await nodeClient.stubSiteStop(serverId);
    await query(
        "UPDATE stub_sites SET status = 'stopped' WHERE server_id = $1",
        [serverId]
    );
    return { ok: true };
}

/**
 * Удалить заглушку и вернуть Reality dest к дефолту
 */
async function removeStubSite(serverId) {
    const record = await queryOne('SELECT * FROM stub_sites WHERE server_id = $1', [serverId]);

    // Удаляем на агенте
    try {
        await nodeClient.stubSiteRemove(serverId);
    } catch (err) {
        console.warn(`[STUB] Ошибка удаления на агенте #${serverId}:`, err.message);
    }

    // Удаляем из БД
    await query('DELETE FROM stub_sites WHERE server_id = $1', [serverId]);

    // Возвращаем Reality dest к google.com:443
    if (record?.auto_update_dest) {
        try {
            await revertRealityDest(serverId);
        } catch (err) {
            console.warn(`[STUB] Ошибка возврата Reality dest на #${serverId}:`, err.message);
        }
    }

    console.log(`[STUB] Заглушка удалена с #${serverId}`);
    return { ok: true };
}

// ============================================================
// Reality dest управление
// ============================================================

/**
 * Обновить dest всех Reality inbounds на сервере → 127.0.0.1:port
 * Также добавить домен сервера в serverNames
 */
async function updateRealityDest(serverId, internalPort, domain) {
    const xrayService = require('./xray');

    // Находим все Reality inbounds на этом сервере
    const inbounds = await queryAll(
        `SELECT id, stream_settings FROM xray_inbounds
         WHERE server_id = $1 AND stream_settings->>'security' = 'reality'`,
        [serverId]
    );

    if (inbounds.length === 0) {
        console.log(`[STUB] Нет Reality inbounds на сервере #${serverId}, пропускаем обновление dest`);
        return;
    }

    for (const ib of inbounds) {
        const ss = ib.stream_settings || {};
        const rs = ss.realitySettings || {};

        // Обновляем dest на локальный nginx
        rs.dest = `127.0.0.1:${internalPort}`;

        // serverNames = только домен сервера (убираем дефолтные google/microsoft)
        if (domain) {
            rs.serverNames = [domain];
        }

        ss.realitySettings = rs;

        await query(
            'UPDATE xray_inbounds SET stream_settings = $1 WHERE id = $2',
            [JSON.stringify(ss), ib.id]
        );

        console.log(`[STUB] Inbound #${ib.id}: dest → 127.0.0.1:${internalPort}`);
    }

    // Редеплой конфига
    try {
        await xrayService.deployConfig(serverId, { force: true });
        console.log(`[STUB] Xray конфиг передеплоен на #${serverId}`);
    } catch (err) {
        console.warn(`[STUB] Ошибка редеплоя Xray на #${serverId}:`, err.message);
    }
}

/**
 * Вернуть Reality dest к дефолту (google.com:443)
 */
async function revertRealityDest(serverId) {
    const xrayService = require('./xray');

    const inbounds = await queryAll(
        `SELECT id, stream_settings FROM xray_inbounds
         WHERE server_id = $1 AND stream_settings->>'security' = 'reality'`,
        [serverId]
    );

    for (const ib of inbounds) {
        const ss = ib.stream_settings || {};
        const rs = ss.realitySettings || {};

        // Возвращаем дефолтный dest и serverNames
        rs.dest = 'www.google.com:443';
        rs.serverNames = ['www.google.com'];

        ss.realitySettings = rs;

        await query(
            'UPDATE xray_inbounds SET stream_settings = $1 WHERE id = $2',
            [JSON.stringify(ss), ib.id]
        );
    }

    // Редеплой
    try {
        await xrayService.deployConfig(serverId, { force: true });
    } catch (err) {
        console.warn(`[STUB] Ошибка редеплоя после возврата dest на #${serverId}:`, err.message);
    }
}

// ============================================================
// SSL (Let's Encrypt) для stub sites
// ============================================================

/**
 * Получить SSL-сертификат для stub site
 */
async function obtainSSL(serverId, domain, email) {
    const record = await queryOne('SELECT * FROM stub_sites WHERE server_id = $1', [serverId]);
    if (!record) throw new Error('Stub site не развёрнут на этом сервере');
    if (record.status !== 'active') throw new Error('Stub site не активен');

    if (!domain) {
        const server = await queryOne('SELECT domain FROM servers WHERE id = $1', [serverId]);
        domain = server?.domain;
    }
    if (!domain) throw new Error('Домен не указан (укажите домен сервера или передайте вручную)');

    const internalPort = record.internal_port || 8444;

    console.log(`[STUB-SSL] Получение SSL для #${serverId}, домен: ${domain}`);

    // Вызываем агент для получения сертификата
    const result = await nodeClient.stubSiteObtainSSL(serverId, {
        domain,
        email,
        internalPort,
    });

    // Сохраняем в БД
    const expiresAt = result.cert?.validTo ? new Date(result.cert.validTo) : null;
    await query(
        `UPDATE stub_sites SET ssl_enabled = TRUE, ssl_domain = $1, ssl_email = $2, ssl_expires_at = $3
         WHERE server_id = $4`,
        [domain, email || null, expiresAt, serverId]
    );

    console.log(`[STUB-SSL] SSL получен для #${serverId}`);
    return { ok: true, cert: result.cert };
}

/**
 * Получить статус SSL для stub site
 */
async function getSSLStatus(serverId) {
    const record = await queryOne(
        'SELECT ssl_enabled, ssl_domain, ssl_email, ssl_expires_at FROM stub_sites WHERE server_id = $1',
        [serverId]
    );

    if (!record || !record.ssl_enabled) {
        return { enabled: false };
    }

    // Запрашиваем актуальный статус с агента
    let agentCert = null;
    try {
        agentCert = await nodeClient.stubSiteSSLStatus(serverId, record.ssl_domain);
    } catch {}

    return {
        enabled: true,
        domain: record.ssl_domain,
        email: record.ssl_email,
        expiresAt: record.ssl_expires_at,
        daysLeft: record.ssl_expires_at
            ? Math.floor((new Date(record.ssl_expires_at) - new Date()) / (1000 * 60 * 60 * 24))
            : null,
        agent: agentCert,
    };
}

/**
 * Обновить SSL-сертификат
 */
async function renewSSL(serverId) {
    const record = await queryOne('SELECT * FROM stub_sites WHERE server_id = $1', [serverId]);
    if (!record?.ssl_enabled) throw new Error('SSL не активен на этом сервере');

    const internalPort = record.internal_port || 8444;

    const result = await nodeClient.stubSiteRenewSSL(serverId, {
        domain: record.ssl_domain,
        internalPort,
    });

    // Обновляем срок в БД
    if (result.cert?.validTo) {
        await query(
            'UPDATE stub_sites SET ssl_expires_at = $1 WHERE server_id = $2',
            [new Date(result.cert.validTo), serverId]
        );
    }

    return { ok: true, cert: result.cert };
}

module.exports = {
    listTemplates,
    getTemplateFiles,
    deployStubSite,
    getStubSiteStatus,
    stopStubSite,
    removeStubSite,
    updateRealityDest,
    revertRealityDest,
    obtainSSL,
    getSSLStatus,
    renewSSL,
};
