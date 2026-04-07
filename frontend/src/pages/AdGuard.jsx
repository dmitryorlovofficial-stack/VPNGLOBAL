// Страница управления AdGuard Home DNS серверами
import { useState, useEffect, useCallback } from 'react';
import {
    Shield, Plus, Edit, Trash2, RefreshCw, Loader2, X,
    ChevronDown, ChevronUp, Wifi, Filter, BarChart3,
    CheckCircle, XCircle, Search as SearchIcon, Globe, Power
} from 'lucide-react';
import toast from 'react-hot-toast';
import { adguard } from '../api/client';

// Форматирование чисел
function fmtNum(n) {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
}

// ─── Карточка AdGuard-сервера ────────────────────────────────
function ServerCard({ server, onRefresh, onEdit, onDelete }) {
    const [expanded, setExpanded] = useState(false);
    const [tab, setTab] = useState('status');
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState('');

    // Данные вкладок
    const [agStatus, setAgStatus] = useState(null);
    const [dnsConfig, setDnsConfig] = useState(null);
    const [filtering, setFiltering] = useState(null);
    const [stats, setStats] = useState(null);

    // DNS edit
    const [upstreamDns, setUpstreamDns] = useState('');
    const [bootstrapDns, setBootstrapDns] = useState('');

    // Фильтр-лист добавление
    const [showAddFilter, setShowAddFilter] = useState(false);
    const [filterUrl, setFilterUrl] = useState('');
    const [filterName, setFilterName] = useState('');

    const fetchTabData = useCallback(async (t) => {
        setLoading(true);
        try {
            if (t === 'status') {
                const s = await adguard.status(server.id);
                setAgStatus(s);
            } else if (t === 'dns') {
                const d = await adguard.dns(server.id);
                setDnsConfig(d);
                setUpstreamDns((d.upstream_dns || []).join('\n'));
                setBootstrapDns((d.bootstrap_dns || []).join('\n'));
            } else if (t === 'filtering') {
                const f = await adguard.filtering(server.id);
                setFiltering(f);
            } else if (t === 'stats') {
                const s = await adguard.stats(server.id);
                setStats(s);
            }
        } catch (err) {
            toast.error(`Ошибка: ${err.message}`);
        }
        setLoading(false);
    }, [server.id]);

    useEffect(() => {
        if (expanded) fetchTabData(tab);
    }, [expanded, tab, fetchTabData]);

    const handleTest = async () => {
        setActionLoading('test');
        try {
            await adguard.testServer(server.id);
            toast.success('Подключение успешно');
            onRefresh();
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleToggleProtection = async () => {
        if (!agStatus) return;
        setActionLoading('protection');
        try {
            await adguard.setProtection(server.id, !agStatus.protection_enabled);
            toast.success(agStatus.protection_enabled ? 'Защита отключена' : 'Защита включена');
            fetchTabData('status');
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleSaveDns = async () => {
        setActionLoading('dns-save');
        try {
            await adguard.setDns(server.id, {
                upstream_dns: upstreamDns.split('\n').map(s => s.trim()).filter(Boolean),
                bootstrap_dns: bootstrapDns.split('\n').map(s => s.trim()).filter(Boolean),
            });
            toast.success('DNS настройки сохранены');
            fetchTabData('dns');
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleAddFilter = async () => {
        if (!filterUrl.trim()) { toast.error('Укажите URL'); return; }
        setActionLoading('add-filter');
        try {
            await adguard.addFilter(server.id, {
                name: filterName.trim() || filterUrl.trim(),
                url: filterUrl.trim(),
                whitelist: false,
            });
            toast.success('Фильтр-лист добавлен');
            setShowAddFilter(false);
            setFilterUrl('');
            setFilterName('');
            fetchTabData('filtering');
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleRemoveFilter = async (url) => {
        if (!confirm('Удалить этот фильтр-лист?')) return;
        try {
            await adguard.removeFilter(server.id, { url, whitelist: false });
            toast.success('Фильтр удалён');
            fetchTabData('filtering');
        } catch (err) { toast.error(err.message); }
    };

    const handleRefreshFilters = async () => {
        setActionLoading('refresh-filters');
        try {
            await adguard.refreshFilters(server.id);
            toast.success('Фильтры обновлены');
            fetchTabData('filtering');
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleToggleFiltering = async () => {
        if (!filtering) return;
        setActionLoading('toggle-filtering');
        try {
            await adguard.setFiltering(server.id, {
                enabled: !filtering.enabled,
                interval: filtering.interval || 24,
            });
            toast.success(filtering.enabled ? 'Фильтрация отключена' : 'Фильтрация включена');
            fetchTabData('filtering');
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const isOnline = server.status === 'online';
    const tabs = [
        { id: 'status', label: 'Статус', icon: Shield },
        { id: 'dns', label: 'DNS', icon: Globe },
        { id: 'filtering', label: 'Фильтрация', icon: Filter },
        { id: 'stats', label: 'Статистика', icon: BarChart3 },
    ];

    return (
        <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-hidden">
            {/* Заголовок */}
            <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-dark-750" onClick={() => setExpanded(!expanded)}>
                <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isOnline ? 'bg-green-600/20' : 'bg-red-600/20'}`}>
                        <Shield className={`w-4 h-4 ${isOnline ? 'text-green-400' : 'text-red-400'}`} />
                    </div>
                    <div>
                        <div className="text-sm font-medium text-white">{server.name}</div>
                        <div className="text-xs text-gray-500">{server.url}</div>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isOnline ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'}`}>
                        {isOnline ? 'Online' : 'Offline'}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={e => { e.stopPropagation(); handleTest(); }} disabled={!!actionLoading}
                        className="text-[11px] px-2 py-1 bg-dark-600 text-gray-300 rounded hover:bg-dark-500 disabled:opacity-50">
                        {actionLoading === 'test' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : <RefreshCw className="w-3 h-3 inline" />}
                    </button>
                    <button onClick={e => { e.stopPropagation(); onEdit(server); }}
                        className="text-[11px] px-2 py-1 bg-dark-600 text-gray-300 rounded hover:bg-dark-500">
                        <Edit className="w-3 h-3" />
                    </button>
                    <button onClick={e => { e.stopPropagation(); onDelete(server.id); }}
                        className="text-[11px] px-2 py-1 bg-red-600/10 text-red-400 rounded hover:bg-red-600/20">
                        <Trash2 className="w-3 h-3" />
                    </button>
                    {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                </div>
            </div>

            {/* Развёрнутое содержимое */}
            {expanded && (
                <div className="border-t border-dark-700">
                    {/* Табы */}
                    <div className="flex border-b border-dark-700 px-4">
                        {tabs.map(t => (
                            <button key={t.id} onClick={() => setTab(t.id)}
                                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                                    tab === t.id
                                        ? 'border-blue-500 text-blue-400'
                                        : 'border-transparent text-gray-500 hover:text-gray-300'
                                }`}>
                                <t.icon className="w-3.5 h-3.5" />
                                {t.label}
                            </button>
                        ))}
                    </div>

                    <div className="p-4">
                        {loading ? (
                            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>
                        ) : (
                            <>
                                {/* === Статус === */}
                                {tab === 'status' && agStatus && (
                                    <div className="space-y-3">
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="bg-dark-900 rounded-lg p-3">
                                                <div className="text-[10px] text-gray-500 uppercase">Версия</div>
                                                <div className="text-sm font-medium text-white">{agStatus.version || 'N/A'}</div>
                                            </div>
                                            <div className="bg-dark-900 rounded-lg p-3">
                                                <div className="text-[10px] text-gray-500 uppercase">DNS порт</div>
                                                <div className="text-sm font-medium text-white">{agStatus.dns_port || 53}</div>
                                            </div>
                                            <div className="bg-dark-900 rounded-lg p-3">
                                                <div className="text-[10px] text-gray-500 uppercase">HTTP порт</div>
                                                <div className="text-sm font-medium text-white">{agStatus.http_port || 'N/A'}</div>
                                            </div>
                                            <div className="bg-dark-900 rounded-lg p-3">
                                                <div className="text-[10px] text-gray-500 uppercase">Язык</div>
                                                <div className="text-sm font-medium text-white">{agStatus.language || 'en'}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between bg-dark-900 rounded-lg p-3">
                                            <div>
                                                <div className="text-sm text-white">Защита DNS</div>
                                                <div className="text-[11px] text-gray-500">Фильтрация и блокировка рекламы</div>
                                            </div>
                                            <button
                                                onClick={handleToggleProtection}
                                                disabled={actionLoading === 'protection'}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                                                    agStatus.protection_enabled
                                                        ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                                                        : 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                                                }`}>
                                                {actionLoading === 'protection' ? <Loader2 className="w-3 h-3 animate-spin inline" /> :
                                                    agStatus.protection_enabled ? 'Включена' : 'Отключена'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* === DNS === */}
                                {tab === 'dns' && dnsConfig && (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-xs font-medium text-gray-400 block mb-1">Upstream DNS серверы</label>
                                            <textarea
                                                value={upstreamDns}
                                                onChange={e => setUpstreamDns(e.target.value)}
                                                rows={4}
                                                className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500/50 resize-y"
                                                placeholder="https://dns.cloudflare.com/dns-query&#10;https://dns.google/dns-query"
                                            />
                                            <p className="text-[10px] text-gray-500 mt-1">По одному на строку. Поддерживаются: IP, DoH, DoT, DoQ</p>
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-gray-400 block mb-1">Bootstrap DNS</label>
                                            <textarea
                                                value={bootstrapDns}
                                                onChange={e => setBootstrapDns(e.target.value)}
                                                rows={2}
                                                className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500/50 resize-y"
                                                placeholder="9.9.9.10&#10;149.112.112.10"
                                            />
                                        </div>
                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="bg-dark-900 rounded-lg p-3">
                                                <div className="text-[10px] text-gray-500 uppercase">Кеш</div>
                                                <div className="text-sm font-medium text-white">
                                                    {dnsConfig.cache_size ? `${Math.round(dnsConfig.cache_size / 1024)} KB` : 'Выкл'}
                                                </div>
                                            </div>
                                            <div className="bg-dark-900 rounded-lg p-3">
                                                <div className="text-[10px] text-gray-500 uppercase">Rate limit</div>
                                                <div className="text-sm font-medium text-white">{dnsConfig.ratelimit || 0} r/s</div>
                                            </div>
                                            <div className="bg-dark-900 rounded-lg p-3">
                                                <div className="text-[10px] text-gray-500 uppercase">DNSSEC</div>
                                                <div className="text-sm font-medium text-white">{dnsConfig.dnssec_enabled ? 'Вкл' : 'Выкл'}</div>
                                            </div>
                                        </div>
                                        <button onClick={handleSaveDns} disabled={actionLoading === 'dns-save'}
                                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                                            {actionLoading === 'dns-save' ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
                                            Сохранить DNS
                                        </button>
                                    </div>
                                )}

                                {/* === Фильтрация === */}
                                {tab === 'filtering' && filtering && (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <button onClick={handleToggleFiltering} disabled={actionLoading === 'toggle-filtering'}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                                                        filtering.enabled
                                                            ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                                                            : 'bg-gray-600/20 text-gray-400 hover:bg-gray-600/30'
                                                    }`}>
                                                    {actionLoading === 'toggle-filtering' ? <Loader2 className="w-3 h-3 animate-spin inline" /> :
                                                        filtering.enabled ? 'Фильтрация вкл' : 'Фильтрация выкл'}
                                                </button>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button onClick={handleRefreshFilters} disabled={actionLoading === 'refresh-filters'}
                                                    className="text-[11px] px-2 py-1 bg-dark-600 text-gray-300 rounded hover:bg-dark-500 disabled:opacity-50">
                                                    {actionLoading === 'refresh-filters' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : <RefreshCw className="w-3 h-3 inline mr-1" />}
                                                    Обновить
                                                </button>
                                                <button onClick={() => setShowAddFilter(true)}
                                                    className="text-[11px] px-2 py-1 bg-blue-600/20 text-blue-400 rounded hover:bg-blue-600/30">
                                                    <Plus className="w-3 h-3 inline mr-0.5" /> Добавить
                                                </button>
                                            </div>
                                        </div>

                                        {/* Список фильтров */}
                                        <div className="space-y-1">
                                            {(filtering.filters || []).map((f, i) => (
                                                <div key={i} className="flex items-center justify-between bg-dark-900 rounded-lg px-3 py-2">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            {f.enabled ? (
                                                                <CheckCircle className="w-3 h-3 text-green-400 flex-shrink-0" />
                                                            ) : (
                                                                <XCircle className="w-3 h-3 text-gray-500 flex-shrink-0" />
                                                            )}
                                                            <span className="text-xs text-white truncate">{f.name}</span>
                                                        </div>
                                                        <div className="text-[10px] text-gray-500 truncate ml-5">{f.url}</div>
                                                    </div>
                                                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                                        <span className="text-[10px] text-gray-500">{fmtNum(f.rules_count)} правил</span>
                                                        <button onClick={() => handleRemoveFilter(f.url)}
                                                            className="text-red-400 hover:text-red-300 p-0.5">
                                                            <Trash2 className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                            {(!filtering.filters || filtering.filters.length === 0) && (
                                                <div className="text-xs text-gray-500 text-center py-4">Нет фильтр-листов</div>
                                            )}
                                        </div>

                                        {/* Модалка добавления фильтра */}
                                        {showAddFilter && (
                                            <div className="bg-dark-900 rounded-lg p-3 border border-dark-600 space-y-2">
                                                <input
                                                    type="text"
                                                    value={filterName}
                                                    onChange={e => setFilterName(e.target.value)}
                                                    className="w-full bg-dark-800 border border-dark-600 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/50"
                                                    placeholder="Название (опционально)"
                                                />
                                                <input
                                                    type="text"
                                                    value={filterUrl}
                                                    onChange={e => setFilterUrl(e.target.value)}
                                                    className="w-full bg-dark-800 border border-dark-600 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/50"
                                                    placeholder="URL фильтр-листа"
                                                />
                                                <div className="flex justify-end gap-2">
                                                    <button onClick={() => setShowAddFilter(false)}
                                                        className="text-xs px-3 py-1.5 bg-dark-700 text-gray-300 rounded hover:bg-dark-600">Отмена</button>
                                                    <button onClick={handleAddFilter} disabled={actionLoading === 'add-filter'}
                                                        className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                                                        {actionLoading === 'add-filter' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Добавить'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* === Статистика === */}
                                {tab === 'stats' && stats && (
                                    <div className="space-y-3">
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                            <div className="bg-dark-900 rounded-lg p-3">
                                                <div className="text-[10px] text-gray-500 uppercase">Всего запросов</div>
                                                <div className="text-lg font-bold text-white">{fmtNum(stats.num_dns_queries)}</div>
                                            </div>
                                            <div className="bg-dark-900 rounded-lg p-3">
                                                <div className="text-[10px] text-gray-500 uppercase">Заблокировано</div>
                                                <div className="text-lg font-bold text-red-400">{fmtNum(stats.num_blocked_filtering)}</div>
                                            </div>
                                            <div className="bg-dark-900 rounded-lg p-3">
                                                <div className="text-[10px] text-gray-500 uppercase">% блокировок</div>
                                                <div className="text-lg font-bold text-amber-400">
                                                    {stats.num_dns_queries > 0
                                                        ? ((stats.num_blocked_filtering / stats.num_dns_queries) * 100).toFixed(1)
                                                        : 0}%
                                                </div>
                                            </div>
                                            <div className="bg-dark-900 rounded-lg p-3">
                                                <div className="text-[10px] text-gray-500 uppercase">Среднее время</div>
                                                <div className="text-lg font-bold text-blue-400">
                                                    {stats.avg_processing_time
                                                        ? (stats.avg_processing_time * 1000).toFixed(1) + ' мс'
                                                        : 'N/A'}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Топ домены */}
                                        {stats.top_queried_domains && stats.top_queried_domains.length > 0 && (
                                            <div>
                                                <div className="text-xs font-medium text-gray-400 mb-2">Топ запрашиваемых доменов</div>
                                                <div className="space-y-1">
                                                    {stats.top_queried_domains.slice(0, 10).map((entry, i) => {
                                                        const [domain, count] = Object.entries(entry)[0] || ['?', 0];
                                                        return (
                                                            <div key={i} className="flex items-center justify-between bg-dark-900 rounded px-3 py-1.5">
                                                                <span className="text-xs text-white truncate">{domain}</span>
                                                                <span className="text-[10px] text-gray-500 flex-shrink-0 ml-2">{fmtNum(count)}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {/* Топ заблокированных */}
                                        {stats.top_blocked_domains && stats.top_blocked_domains.length > 0 && (
                                            <div>
                                                <div className="text-xs font-medium text-gray-400 mb-2">Топ заблокированных доменов</div>
                                                <div className="space-y-1">
                                                    {stats.top_blocked_domains.slice(0, 10).map((entry, i) => {
                                                        const [domain, count] = Object.entries(entry)[0] || ['?', 0];
                                                        return (
                                                            <div key={i} className="flex items-center justify-between bg-dark-900 rounded px-3 py-1.5">
                                                                <span className="text-xs text-red-400 truncate">{domain}</span>
                                                                <span className="text-[10px] text-gray-500 flex-shrink-0 ml-2">{fmtNum(count)}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {/* Топ клиентов */}
                                        {stats.top_clients && stats.top_clients.length > 0 && (
                                            <div>
                                                <div className="text-xs font-medium text-gray-400 mb-2">Топ клиентов</div>
                                                <div className="space-y-1">
                                                    {stats.top_clients.slice(0, 10).map((entry, i) => {
                                                        const [client, count] = Object.entries(entry)[0] || ['?', 0];
                                                        return (
                                                            <div key={i} className="flex items-center justify-between bg-dark-900 rounded px-3 py-1.5">
                                                                <span className="text-xs text-white truncate">{client}</span>
                                                                <span className="text-[10px] text-gray-500 flex-shrink-0 ml-2">{fmtNum(count)}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Главная страница AdGuard ────────────────────────────────
export default function AdGuard() {
    const [servers, setServers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingServer, setEditingServer] = useState(null);
    const [form, setForm] = useState({ name: '', url: '', username: '', password: '' });
    const [saving, setSaving] = useState(false);

    const fetchServers = useCallback(async () => {
        try {
            const data = await adguard.servers();
            setServers(data);
        } catch (err) {
            toast.error(err.message);
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchServers(); }, [fetchServers]);

    const openAddModal = () => {
        setEditingServer(null);
        setForm({ name: '', url: '', username: '', password: '' });
        setShowModal(true);
    };

    const openEditModal = (server) => {
        setEditingServer(server);
        setForm({ name: server.name, url: server.url, username: server.username, password: '' });
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!form.name.trim() || !form.url.trim() || !form.username.trim()) {
            toast.error('Заполните все обязательные поля');
            return;
        }
        if (!editingServer && !form.password.trim()) {
            toast.error('Укажите пароль');
            return;
        }

        setSaving(true);
        try {
            if (editingServer) {
                const updateData = { name: form.name, url: form.url, username: form.username };
                if (form.password.trim()) updateData.password = form.password;
                await adguard.updateServer(editingServer.id, updateData);
                toast.success('Сервер обновлён');
            } else {
                await adguard.createServer(form);
                toast.success('Сервер добавлен');
            }
            setShowModal(false);
            fetchServers();
        } catch (err) { toast.error(err.message); }
        setSaving(false);
    };

    const handleDelete = async (id) => {
        if (!confirm('Удалить подключение к AdGuard Home?')) return;
        try {
            await adguard.deleteServer(id);
            toast.success('Подключение удалено');
            fetchServers();
        } catch (err) { toast.error(err.message); }
    };

    return (
        <div className="space-y-6">
            {/* Заголовок */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-600/20 rounded-xl flex items-center justify-center">
                        <Shield className="w-5 h-5 text-green-400" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-white">AdGuard Home</h1>
                        <p className="text-sm text-gray-500">Управление DNS-фильтрацией</p>
                    </div>
                </div>
                <button onClick={openAddModal}
                    className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 transition-colors">
                    <Plus className="w-4 h-4" /> Добавить сервер
                </button>
            </div>

            {/* Список серверов */}
            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-500" /></div>
            ) : servers.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                    <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Нет подключённых серверов AdGuard Home</p>
                    <p className="text-xs mt-1">Добавьте сервер, чтобы управлять DNS-фильтрацией</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {servers.map(srv => (
                        <ServerCard
                            key={srv.id}
                            server={srv}
                            onRefresh={fetchServers}
                            onEdit={openEditModal}
                            onDelete={handleDelete}
                        />
                    ))}
                </div>
            )}

            {/* Модалка добавления/редактирования */}
            {showModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
                    <div className="bg-dark-800 border border-dark-700 rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-dark-700 flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-white">
                                {editingServer ? 'Редактировать сервер' : 'Добавить AdGuard Home'}
                            </h3>
                            <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="text-xs text-gray-400 block mb-1">Название</label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                    className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                    placeholder="Home DNS"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-gray-400 block mb-1">URL AdGuard Home</label>
                                <input
                                    type="text"
                                    value={form.url}
                                    onChange={e => setForm({ ...form, url: e.target.value })}
                                    className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                    placeholder="http://192.168.1.1:3000"
                                />
                                <p className="text-[10px] text-gray-500 mt-1">IP или домен с портом (обычно 3000 или 80)</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-gray-400 block mb-1">Логин</label>
                                    <input
                                        type="text"
                                        value={form.username}
                                        onChange={e => setForm({ ...form, username: e.target.value })}
                                        className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                        placeholder="admin"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-400 block mb-1">
                                        Пароль {editingServer && <span className="text-gray-600">(оставьте пустым)</span>}
                                    </label>
                                    <input
                                        type="password"
                                        value={form.password}
                                        onChange={e => setForm({ ...form, password: e.target.value })}
                                        className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                        placeholder="••••••"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="p-5 border-t border-dark-700 flex justify-end gap-2">
                            <button onClick={() => setShowModal(false)}
                                className="px-4 py-2.5 bg-dark-700 text-gray-300 rounded-lg text-sm hover:bg-dark-600">
                                Отмена
                            </button>
                            <button onClick={handleSave} disabled={saving}
                                className="px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
                                {editingServer ? 'Сохранить' : 'Добавить'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
