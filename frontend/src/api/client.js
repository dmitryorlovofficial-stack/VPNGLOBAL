// HTTP-клиент для API панели
const API_BASE = '/api';

// Получение токена из localStorage
function getToken() {
    return localStorage.getItem('vpn_panel_token');
}

// Сохранение токена
export function setToken(token) {
    localStorage.setItem('vpn_panel_token', token);
}

// Удаление токена
export function removeToken() {
    localStorage.removeItem('vpn_panel_token');
    localStorage.removeItem('vpn_panel_user');
}

// Проверка авторизации
export function isAuthenticated() {
    return !!getToken();
}

// Базовый fetch с авторизацией
async function request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${path}`, options);

    // Если 401 — токен невалиден
    if (res.status === 401) {
        removeToken();
        window.location.href = '/login';
        throw new Error('Сессия истекла');
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
}

// === Авторизация ===
export const auth = {
    login: (username, password, totp_code) =>
        request('POST', '/auth/login', { username, password, totp_code }),
    logout: () => request('POST', '/auth/logout'),
    me: () => request('GET', '/auth/me'),
    changePassword: (oldPassword, newPassword) =>
        request('POST', '/auth/change-password', { oldPassword, newPassword }),
    setup2FA: () => request('POST', '/auth/2fa/setup'),
    enable2FA: (secret, token) => request('POST', '/auth/2fa/enable', { secret, token }),
    disable2FA: () => request('POST', '/auth/2fa/disable'),
    // Telegram
    telegramConfig: () => request('GET', '/auth/telegram-config'),
    telegramLogin: (data) => request('POST', '/auth/telegram', data),
    telegramRegister: (data) => request('POST', '/auth/telegram-register', data),
    telegramLink: (data) => request('POST', '/auth/telegram-link', data),
};

// === Дашборд ===
export const dashboard = {
    get: () => request('GET', '/dashboard'),
    traffic: (period = '24h', clientId) => {
        let url = `/dashboard/traffic?period=${period}`;
        if (clientId) url += `&client_id=${clientId}`;
        return request('GET', url);
    },
};

// === Клиенты ===
export const clients = {
    list: (params = {}) => {
        const qs = new URLSearchParams(params).toString();
        return request('GET', `/clients?${qs}`);
    },
    get: (id) => request('GET', `/clients/${id}`),
    create: (data) => request('POST', '/clients', data),
    update: (id, data) => request('PUT', `/clients/${id}`, data),
    remove: (id) => request('DELETE', `/clients/${id}`),
    block: (id) => request('POST', `/clients/${id}/block`),
    unblock: (id) => request('POST', `/clients/${id}/unblock`),
    config: async (id) => {
        const token = getToken();
        const res = await fetch(`${API_BASE}/clients/${id}/config`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Ошибка загрузки конфига' }));
            throw new Error(err.error || 'Ошибка');
        }
        return res.text();
    },
    qr: (id) => `${API_BASE}/clients/${id}/qr?token=${getToken()}`,
    qrDataUrl: (id) => request('GET', `/clients/${id}/qr?format=dataurl`),
    resetTraffic: (id) => request('POST', `/clients/${id}/reset-traffic`),
    // HWID / Устройства
    devices: (id) => request('GET', `/clients/${id}/devices`),
    revokeDevice: (id, deviceId) => request('POST', `/clients/${id}/devices/${deviceId}/revoke`),
    restoreDevice: (id, deviceId) => request('POST', `/clients/${id}/devices/${deviceId}/restore`),
    deleteDevice: (id, deviceId) => request('DELETE', `/clients/${id}/devices/${deviceId}`),
    resetDevices: (id) => request('DELETE', `/clients/${id}/devices`),
    setDeviceLimit: (id, limit) => request('PUT', `/clients/${id}/device-limit`, { device_limit: limit }),
    bulkAction: (ids, action) => request('POST', '/clients/bulk-action', { ids, action }),
};

// === Серверы (динамические, CRUD + мониторинг) ===
export const servers = {
    list: () => request('GET', '/servers'),
    get: (id) => request('GET', `/servers/${id}`),
    create: (data) => request('POST', '/servers', data),
    update: (id, data) => request('PUT', `/servers/${id}`, data),
    remove: (id) => request('DELETE', `/servers/${id}`),
    test: (id) => request('POST', `/servers/${id}/test`),
    testNew: (data) => request('POST', '/servers/test-new', data),
    scan: (id) => request('POST', `/servers/${id}/scan`),
    metrics: (id) => request('GET', `/servers/${id}/metrics`),
    reboot: (id) => request('POST', `/servers/${id}/reboot`),
    // Agent
    deployAgent: (id) => request('POST', `/servers/${id}/deploy-agent`),
    checkAgent: (id) => request('POST', `/servers/${id}/check-agent`),
    updateAgent: (id) => request('POST', `/servers/${id}/update-agent`),
    removeAgent: (id) => request('POST', `/servers/${id}/remove-agent`),
    restartAgent: (id) => request('POST', `/servers/${id}/restart-agent`),
};

// === Xray ===
export const xray = {
    status: (serverId) => request('GET', `/xray/servers/${serverId}/status`),
    install: (serverId) => request('POST', `/xray/servers/${serverId}/install`),
    uninstall: (serverId) => request('POST', `/xray/servers/${serverId}/uninstall`),
    restart: (serverId) => request('POST', `/xray/servers/${serverId}/restart`),
    stop: (serverId) => request('POST', `/xray/servers/${serverId}/stop`),
    deployConfig: (serverId, force = false) => request('POST', `/xray/servers/${serverId}/deploy-config`, force ? { force: true } : undefined),
    getConfig: (serverId) => request('GET', `/xray/servers/${serverId}/config`),
    realityKeys: (serverId) => request('POST', `/xray/servers/${serverId}/reality-keys`),
    uuid: () => request('GET', '/xray/uuid'),
    // Inbounds
    allInbounds: (opts = {}) => {
        let url = '/xray/inbounds/all';
        if (opts.serverGroupId) url += `?server_group_id=${opts.serverGroupId}`;
        return request('GET', url);
    },
    inbounds: (serverId) => request('GET', `/xray/inbounds?server_id=${serverId}`),
    getInbound: (id) => request('GET', `/xray/inbounds/${id}`),
    createInbound: (data) => request('POST', '/xray/inbounds', data),
    updateInbound: (id, data) => request('PUT', `/xray/inbounds/${id}`, data),
    deleteInbound: (id) => request('DELETE', `/xray/inbounds/${id}`),
    // Клиенты в inbounds
    addClient: (inboundId, clientId) => request('POST', `/xray/inbounds/${inboundId}/clients`, { client_id: clientId }),
    removeClient: (inboundId, clientId) => request('DELETE', `/xray/inbounds/${inboundId}/clients/${clientId}`),
    // Share link
    shareLink: (clientId) => request('GET', `/xray/clients/${clientId}/share-link`),
};

// === Группы ===
export const groups = {
    // Server groups
    serverGroups: () => request('GET', '/groups/servers'),
    serverGroup: (id) => request('GET', `/groups/servers/${id}`),
    createServerGroup: (data) => request('POST', '/groups/servers', data),
    updateServerGroup: (id, data) => request('PUT', `/groups/servers/${id}`, data),
    deleteServerGroup: (id) => request('DELETE', `/groups/servers/${id}`),
    addMember: (groupId, data) => request('POST', `/groups/servers/${groupId}/members`, data),
    removeMember: (groupId, serverId) => request('DELETE', `/groups/servers/${groupId}/members/${serverId}`),
    // Client groups
    clientGroups: () => request('GET', '/groups/clients'),
    clientGroup: (id) => request('GET', `/groups/clients/${id}`),
    createClientGroup: (data) => request('POST', '/groups/clients', data),
    updateClientGroup: (id, data) => request('PUT', `/groups/clients/${id}`, data),
    deleteClientGroup: (id) => request('DELETE', `/groups/clients/${id}`),
    switchServerGroup: (groupId, data) => request('PUT', `/groups/clients/${groupId}/server-group`, data),
    bulkMove: (data) => request('POST', '/groups/clients/bulk-move', data),
    // Domain routes
    domainRoutes: (groupId) => request('GET', `/groups/servers/${groupId}/domain-routes`),
    createDomainRoute: (groupId, data) => request('POST', `/groups/servers/${groupId}/domain-routes`, data),
    updateDomainRoute: (groupId, routeId, data) => request('PUT', `/groups/servers/${groupId}/domain-routes/${routeId}`, data),
    deleteDomainRoute: (groupId, routeId) => request('DELETE', `/groups/servers/${groupId}/domain-routes/${routeId}`),
    // Sync
    syncClients: (groupId) => request('POST', `/groups/servers/${groupId}/sync-clients`),
};

// === Туннели ===
export const tunnels = {
    list: () => request('GET', '/tunnels'),
    create: (data) => request('POST', '/tunnels', data),
    remove: (id) => request('DELETE', `/tunnels/${id}`),
    restart: (id) => request('POST', `/tunnels/${id}/restart`),
    status: (id) => request('POST', `/tunnels/${id}/status`),
};

// === Мониторинг (admin) ===
export const monitoring = {
    overview: () => request('GET', '/monitoring/overview'),
    serverMetrics: (id) => request('GET', `/monitoring/servers/${id}/metrics`),
    serverServices: (id) => request('GET', `/monitoring/servers/${id}/services`),
    health: () => request('GET', '/monitoring/health'),
    alerts: (limit = 20) => request('GET', `/monitoring/alerts?limit=${limit}`),
    refresh: () => request('POST', '/monitoring/refresh'),
    traffic: (period = '24h', serverId) => {
        let url = `/monitoring/traffic?period=${period}`;
        if (serverId) url += `&server_id=${serverId}`;
        return request('GET', url);
    },
    restartService: (id, service) => request('POST', `/monitoring/servers/${id}/restart-service`, { service }),
    stopService: (id, service) => request('POST', `/monitoring/servers/${id}/stop-service`, { service }),
    agentHealth: (id) => request('GET', `/monitoring/servers/${id}/agent-health`),
    serverLogs: (id, lines = 100, service = null) => {
        let url = `/monitoring/servers/${id}/logs?lines=${lines}`;
        if (service) url += `&service=${service}`;
        return request('GET', url);
    },
    serverConnections: (id) => request('GET', `/monitoring/servers/${id}/connections`),
    serverProcesses: (id) => request('GET', `/monitoring/servers/${id}/processes`),
};

// === Настройки ===
export const tariffs = {
    list: () => request('GET', '/tariffs'),
    all: () => request('GET', '/tariffs/all'),
    create: (data) => request('POST', '/tariffs', data),
    update: (id, data) => request('PUT', '/tariffs/' + id, data),
    remove: (id) => request('DELETE', '/tariffs/' + id),
};

export const payments = {
    list: () => request('GET', '/payments'),
};

export const settings = {
    get: () => request('GET', '/settings'),
    update: (data) => request('PUT', '/settings', data),
    backup: () => request('POST', '/settings/backup'),
    restore: (data) => request('POST', '/settings/restore', data),
    logs: (params = {}) => {
        const qs = new URLSearchParams(params).toString();
        return request('GET', `/settings/logs?${qs}`);
    },
};

// === Пользователи панели (admin only) ===
export const users = {
    list: () => request('GET', '/users'),
    create: (data) => request('POST', '/users', data),
    update: (id, data) => request('PUT', `/users/${id}`, data),
    remove: (id) => request('DELETE', `/users/${id}`),
};

// === Инвайт-коды (admin only) ===
export const invites = {
    list: () => request('GET', '/invites'),
    create: (data) => request('POST', '/invites', data),
    remove: (id) => request('DELETE', `/invites/${id}`),
};

// === SSL / HTTPS (admin only) ===
export const ssl = {
    status: () => request('GET', '/ssl/status'),
    obtain: (domain, email) => request('POST', '/ssl/obtain', { domain, email }),
    renew: () => request('POST', '/ssl/renew'),
    disable: () => request('DELETE', '/ssl'),
};

// === Сайты-заглушки (Stub Sites) ===
export const stubSites = {
    templates: () => request('GET', '/stub-sites/templates'),
    status: (serverId) => request('GET', `/stub-sites/servers/${serverId}`),
    deploy: (serverId, data) => request('POST', `/stub-sites/servers/${serverId}/deploy`, data),
    stop: (serverId) => request('POST', `/stub-sites/servers/${serverId}/stop`),
    remove: (serverId) => request('DELETE', `/stub-sites/servers/${serverId}`),
    // SSL
    sslObtain: (serverId, data) => request('POST', `/stub-sites/servers/${serverId}/ssl/obtain`, data),
    sslStatus: (serverId) => request('GET', `/stub-sites/servers/${serverId}/ssl/status`),
    sslRenew: (serverId) => request('POST', `/stub-sites/servers/${serverId}/ssl/renew`),
};

// === AdGuard Home ===
export const adguard = {
    // Подключения
    servers: () => request('GET', '/adguard/servers'),
    createServer: (data) => request('POST', '/adguard/servers', data),
    updateServer: (id, data) => request('PUT', `/adguard/servers/${id}`, data),
    deleteServer: (id) => request('DELETE', `/adguard/servers/${id}`),
    testServer: (id) => request('POST', `/adguard/servers/${id}/test`),
    // API
    status: (id) => request('GET', `/adguard/servers/${id}/status`),
    dns: (id) => request('GET', `/adguard/servers/${id}/dns`),
    setDns: (id, data) => request('POST', `/adguard/servers/${id}/dns`, data),
    filtering: (id) => request('GET', `/adguard/servers/${id}/filtering`),
    setFiltering: (id, data) => request('POST', `/adguard/servers/${id}/filtering`, data),
    addFilter: (id, data) => request('POST', `/adguard/servers/${id}/filtering/add`, data),
    removeFilter: (id, data) => request('POST', `/adguard/servers/${id}/filtering/remove`, data),
    refreshFilters: (id) => request('POST', `/adguard/servers/${id}/filtering/refresh`),
    clients: (id) => request('GET', `/adguard/servers/${id}/clients`),
    addClient: (id, data) => request('POST', `/adguard/servers/${id}/clients/add`, data),
    updateClient: (id, data) => request('POST', `/adguard/servers/${id}/clients/update`, data),
    deleteClient: (id, data) => request('POST', `/adguard/servers/${id}/clients/delete`, data),
    querylog: (id, params = {}) => {
        const qs = new URLSearchParams(params).toString();
        return request('GET', `/adguard/servers/${id}/querylog${qs ? '?' + qs : ''}`);
    },
    stats: (id) => request('GET', `/adguard/servers/${id}/stats`),
    setProtection: (id, enabled) => request('POST', `/adguard/servers/${id}/protection`, { enabled }),
};


// Сохранение/получение данных пользователя
export function setUserData(data) {
    localStorage.setItem('vpn_panel_user', JSON.stringify(data));
}

export function getUserData() {
    try {
        return JSON.parse(localStorage.getItem('vpn_panel_user'));
    } catch {
        return null;
    }
}

export function clearUserData() {
    localStorage.removeItem('vpn_panel_user');
}
