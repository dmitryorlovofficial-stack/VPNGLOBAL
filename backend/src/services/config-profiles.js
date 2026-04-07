// Config Profiles + Snippets — именованные Xray-конфигурации
const { queryOne, queryAll, query } = require('../db/postgres');

// =================== Profiles ===================

async function listProfiles() {
    return queryAll(`
        SELECT cp.*,
            sg.name as server_group_name,
            (SELECT COUNT(*) FROM servers s WHERE s.config_profile_id = cp.id) as servers_count,
            (SELECT COUNT(*) FROM config_profile_snippets cps WHERE cps.profile_id = cp.id) as snippets_count
        FROM config_profiles cp
        LEFT JOIN server_groups sg ON sg.id = cp.server_group_id
        ORDER BY cp.is_default DESC, cp.name
    `);
}

async function getProfile(id) {
    const profile = await queryOne(`
        SELECT cp.*, sg.name as server_group_name
        FROM config_profiles cp
        LEFT JOIN server_groups sg ON sg.id = cp.server_group_id
        WHERE cp.id = $1
    `, [id]);
    if (!profile) return null;

    // Загружаем привязанные сниппеты
    profile.snippets = await queryAll(`
        SELECT cs.*, cps.sort_order as profile_sort_order
        FROM config_snippets cs
        JOIN config_profile_snippets cps ON cps.snippet_id = cs.id
        WHERE cps.profile_id = $1
        ORDER BY cps.sort_order, cs.sort_order
    `, [id]);

    // Серверы с этим профилем
    profile.servers = await queryAll(`
        SELECT id, name, host, ipv4, domain FROM servers WHERE config_profile_id = $1
    `, [id]);

    return profile;
}

async function createProfile({ name, description, base_config, inbound_defaults, server_group_id }) {
    return queryOne(`
        INSERT INTO config_profiles (name, description, base_config, inbound_defaults, server_group_id)
        VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [name, description || null, JSON.stringify(base_config || {}),
        JSON.stringify(inbound_defaults || {}), server_group_id || null]);
}

async function updateProfile(id, data) {
    const sets = [];
    const params = [];
    let idx = 1;

    for (const [key, value] of Object.entries(data)) {
        if (['name', 'description', 'server_group_id'].includes(key)) {
            sets.push(`${key} = $${idx++}`);
            params.push(value);
        } else if (['base_config', 'inbound_defaults'].includes(key)) {
            sets.push(`${key} = $${idx++}`);
            params.push(JSON.stringify(value));
        }
    }

    if (sets.length === 0) return null;
    sets.push('updated_at = NOW()');
    params.push(id);

    return queryOne(
        `UPDATE config_profiles SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        params
    );
}

async function deleteProfile(id) {
    const profile = await queryOne('SELECT is_default FROM config_profiles WHERE id = $1', [id]);
    if (profile?.is_default) throw new Error('Нельзя удалить дефолтный профиль');

    // Открепляем серверы
    await query('UPDATE servers SET config_profile_id = NULL WHERE config_profile_id = $1', [id]);
    await query('DELETE FROM config_profiles WHERE id = $1', [id]);
    return { success: true };
}

// Привязать/отвязать сниппеты к профилю
async function setProfileSnippets(profileId, snippetIds) {
    await query('DELETE FROM config_profile_snippets WHERE profile_id = $1', [profileId]);
    for (let i = 0; i < snippetIds.length; i++) {
        await query(
            'INSERT INTO config_profile_snippets (profile_id, snippet_id, sort_order) VALUES ($1, $2, $3)',
            [profileId, snippetIds[i], i]
        );
    }
    return { success: true };
}

// Привязать профиль к серверу
async function assignProfileToServer(serverId, profileId) {
    await query('UPDATE servers SET config_profile_id = $1 WHERE id = $2', [profileId, serverId]);
    return { success: true };
}

/**
 * Получить эффективный профиль для сервера.
 * Приоритет: сервер.config_profile_id → группа.profile → дефолтный.
 */
async function getEffectiveProfile(serverId) {
    // 1. Явно назначенный профиль
    const server = await queryOne('SELECT config_profile_id FROM servers WHERE id = $1', [serverId]);
    if (server?.config_profile_id) {
        return getProfile(server.config_profile_id);
    }

    // 2. Профиль группы серверов
    const groupProfile = await queryOne(`
        SELECT cp.id FROM config_profiles cp
        JOIN server_group_members sgm ON sgm.server_group_id = cp.server_group_id
        WHERE sgm.server_id = $1
        LIMIT 1
    `, [serverId]);
    if (groupProfile) {
        return getProfile(groupProfile.id);
    }

    // 3. Дефолтный
    const defaultProfile = await queryOne('SELECT id FROM config_profiles WHERE is_default = TRUE LIMIT 1');
    if (defaultProfile) {
        return getProfile(defaultProfile.id);
    }

    return null;
}

/**
 * Собрать итоговый конфиг из профиля + сниппетов.
 * Возвращает объект с dns, routing rules, policy для мержа в buildXrayConfig.
 */
function buildProfileConfig(profile) {
    if (!profile) return {};

    const result = {
        dns: null,
        routingRules: [],
        policy: null,
    };

    // Базовый конфиг профиля
    const base = profile.base_config || {};
    if (base.dns) result.dns = base.dns;
    if (base.policy) result.policy = base.policy;

    // Применяем сниппеты
    for (const snippet of (profile.snippets || [])) {
        if (!snippet.is_enabled) continue;
        const content = snippet.content || {};

        switch (snippet.type) {
            case 'dns':
                if (content.servers) {
                    result.dns = result.dns || {};
                    result.dns.servers = content.servers;
                }
                break;
            case 'routing_rule':
                result.routingRules.push(content);
                break;
            case 'policy':
                result.policy = { ...(result.policy || {}), ...content };
                break;
        }
    }

    return result;
}

// =================== Snippets ===================

async function listSnippets() {
    return queryAll(`
        SELECT cs.*,
            (SELECT COUNT(*) FROM config_profile_snippets cps WHERE cps.snippet_id = cs.id) as profiles_count
        FROM config_snippets cs
        ORDER BY cs.type, cs.sort_order, cs.name
    `);
}

async function getSnippet(id) {
    return queryOne('SELECT * FROM config_snippets WHERE id = $1', [id]);
}

async function createSnippet({ name, description, type, content, sort_order }) {
    return queryOne(`
        INSERT INTO config_snippets (name, description, type, content, sort_order)
        VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [name, description || null, type, JSON.stringify(content), sort_order || 0]);
}

async function updateSnippet(id, data) {
    const sets = [];
    const params = [];
    let idx = 1;

    for (const [key, value] of Object.entries(data)) {
        if (['name', 'description', 'type', 'is_enabled'].includes(key)) {
            sets.push(`${key} = $${idx++}`);
            params.push(value);
        } else if (key === 'content') {
            sets.push(`content = $${idx++}`);
            params.push(JSON.stringify(value));
        } else if (key === 'sort_order') {
            sets.push(`sort_order = $${idx++}`);
            params.push(value);
        }
    }

    if (sets.length === 0) return null;
    sets.push('updated_at = NOW()');
    params.push(id);

    return queryOne(
        `UPDATE config_snippets SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        params
    );
}

async function deleteSnippet(id) {
    await query('DELETE FROM config_snippets WHERE id = $1', [id]);
    return { success: true };
}

module.exports = {
    // Profiles
    listProfiles,
    getProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    setProfileSnippets,
    assignProfileToServer,
    getEffectiveProfile,
    buildProfileConfig,
    // Snippets
    listSnippets,
    getSnippet,
    createSnippet,
    updateSnippet,
    deleteSnippet,
};
