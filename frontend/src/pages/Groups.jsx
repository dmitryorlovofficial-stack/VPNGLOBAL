// Страница управления группами серверов и клиентов
import { useState, useEffect } from 'react';
import { Layers, Server, Users, Plus, Trash2, RefreshCw, ArrowRightLeft, ChevronDown, ChevronRight, Loader2, X, Globe, Pencil, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { groups, servers, tunnels } from '../api/client';

const inputClass = 'w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500';

export default function Groups() {
    const [tab, setTab] = useState('servers'); // 'servers' | 'clients'
    const [serverGroups, setServerGroups] = useState([]);
    const [clientGroups, setClientGroups] = useState([]);
    const [serverList, setServerList] = useState([]);
    const [loading, setLoading] = useState(true);

    // Модалки
    const [showCreateSG, setShowCreateSG] = useState(false);
    const [showCreateCG, setShowCreateCG] = useState(false);
    const [showAddMember, setShowAddMember] = useState(null); // serverGroupId
    const [showSwitchSG, setShowSwitchSG] = useState(null); // clientGroup object
    const [expandedSG, setExpandedSG] = useState({});

    const loadData = async () => {
        setLoading(true);
        try {
            const [sg, cg, srv] = await Promise.all([
                groups.serverGroups(),
                groups.clientGroups(),
                servers.list(),
            ]);
            setServerGroups(sg);
            setClientGroups(cg);
            setServerList(srv);
        } catch (err) {
            toast.error(err.message);
        }
        setLoading(false);
    };

    useEffect(() => { loadData(); }, []);

    const toggleExpand = (id) => {
        setExpandedSG(prev => ({ ...prev, [id]: !prev[id] }));
    };

    // ==== Server Groups ====
    const handleDeleteSG = async (id, name) => {
        if (!confirm(`Удалить группу серверов "${name}"? Все авто-туннели будут удалены.`)) return;
        try {
            await groups.deleteServerGroup(id);
            toast.success('Группа удалена');
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleRemoveMember = async (groupId, serverId, serverName) => {
        if (!confirm(`Убрать "${serverName}" из группы? Связанные туннели будут удалены.`)) return;
        try {
            const result = await groups.removeMember(groupId, serverId);
            toast.success(`Сервер удалён из группы (туннелей удалено: ${result.tunnels_deleted})`);
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    // ==== Client Groups ====
    const handleDeleteCG = async (id, name) => {
        if (!confirm(`Удалить группу клиентов "${name}"? Клиенты будут отвязаны (не удалены).`)) return;
        try {
            await groups.deleteClientGroup(id);
            toast.success('Группа удалена');
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Layers className="w-7 h-7" /> Группы
                    </h1>
                    <p className="text-sm text-gray-400 mt-1">Управление группами серверов и клиентов</p>
                </div>
                <button onClick={loadData} className="p-2 text-gray-400 hover:text-white bg-dark-700 rounded-lg">
                    <RefreshCw className="w-5 h-5" />
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-dark-800 p-1 rounded-lg w-fit">
                <button
                    onClick={() => setTab('servers')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        tab === 'servers' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                >
                    <Server className="w-4 h-4 inline mr-1.5" />
                    Группы серверов ({serverGroups.length})
                </button>
                <button
                    onClick={() => setTab('clients')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        tab === 'clients' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                >
                    <Users className="w-4 h-4 inline mr-1.5" />
                    Группы клиентов ({clientGroups.length})
                </button>
            </div>

            {/* === Server Groups Tab === */}
            {tab === 'servers' && (
                <div className="space-y-3">
                    <button
                        onClick={() => setShowCreateSG(true)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                    >
                        <Plus className="w-4 h-4" /> Создать группу серверов
                    </button>

                    {serverGroups.length === 0 ? (
                        <p className="text-gray-500 text-sm bg-dark-800 rounded-lg p-6 text-center">Нет групп серверов</p>
                    ) : (
                        serverGroups.map(sg => (
                            <ServerGroupCard
                                key={sg.id}
                                group={sg}
                                expanded={expandedSG[sg.id]}
                                onToggle={() => toggleExpand(sg.id)}
                                onDelete={() => handleDeleteSG(sg.id, sg.name)}
                                onAddMember={() => setShowAddMember(sg.id)}
                                onRemoveMember={(serverId, name) => handleRemoveMember(sg.id, serverId, name)}
                                onRefresh={loadData}
                            />
                        ))
                    )}
                </div>
            )}

            {/* === Client Groups Tab === */}
            {tab === 'clients' && (
                <div className="space-y-3">
                    <button
                        onClick={() => setShowCreateCG(true)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                    >
                        <Plus className="w-4 h-4" /> Создать группу клиентов
                    </button>

                    {clientGroups.length === 0 ? (
                        <p className="text-gray-500 text-sm bg-dark-800 rounded-lg p-6 text-center">Нет групп клиентов</p>
                    ) : (
                        clientGroups.map(cg => (
                            <div key={cg.id} className="bg-dark-800 border border-dark-700 rounded-lg p-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-white font-medium">{cg.name}</h3>
                                        {cg.description && <p className="text-xs text-gray-500 mt-0.5">{cg.description}</p>}
                                        <div className="flex items-center gap-3 mt-2 text-xs">
                                            <span className="text-gray-400">
                                                <Users className="w-3.5 h-3.5 inline mr-1" />
                                                {cg.clients_count || 0} клиентов
                                            </span>
                                            <span className={cg.server_group_name ? 'text-blue-400' : 'text-yellow-400'}>
                                                <Server className="w-3.5 h-3.5 inline mr-1" />
                                                {cg.server_group_name || 'Не привязана'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setShowSwitchSG(cg)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/20 text-purple-400 rounded-lg text-xs hover:bg-purple-600/30"
                                            title="Сменить группу серверов"
                                        >
                                            <ArrowRightLeft className="w-3.5 h-3.5" />
                                            Сменить серверы
                                        </button>
                                        <button
                                            onClick={() => handleDeleteCG(cg.id, cg.name)}
                                            className="p-1.5 text-gray-500 hover:text-red-400"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* Модалки */}
            {showCreateSG && (
                <CreateServerGroupModal
                    onClose={() => setShowCreateSG(false)}
                    onCreated={() => { setShowCreateSG(false); loadData(); }}
                />
            )}
            {showCreateCG && (
                <CreateClientGroupModal
                    serverGroups={serverGroups}
                    onClose={() => setShowCreateCG(false)}
                    onCreated={() => { setShowCreateCG(false); loadData(); }}
                />
            )}
            {showAddMember && (
                <AddMemberModal
                    serverGroupId={showAddMember}
                    serverList={serverList}
                    onClose={() => setShowAddMember(null)}
                    onAdded={() => { setShowAddMember(null); loadData(); }}
                />
            )}
            {showSwitchSG && (
                <SwitchServerGroupModal
                    clientGroup={showSwitchSG}
                    serverGroups={serverGroups}
                    onClose={() => setShowSwitchSG(null)}
                    onSwitched={() => { setShowSwitchSG(null); loadData(); }}
                />
            )}
        </div>
    );
}

// === Компоненты ===

function ServerGroupCard({ group, expanded, onToggle, onDelete, onAddMember, onRemoveMember, onRefresh }) {
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(false);
    const [domainRoutes, setDomainRoutes] = useState([]);
    const [showDomainRoute, setShowDomainRoute] = useState(null); // null | 'new' | route object (edit)
    const [checkLoading, setCheckLoading] = useState(null); // tunnel id

    const handleCheckTunnel = async (tunnelId) => {
        setCheckLoading(tunnelId);
        try {
            const status = await tunnels.status(tunnelId);
            if (status.ping_ok) {
                toast.success('Туннель OK');
            } else {
                toast.error('Туннель не работает');
            }
            await loadDetail();
        } catch (err) { toast.error(err.message); }
        setCheckLoading(null);
    };

    const loadDetail = async () => {
        setLoading(true);
        try {
            const [data, routes] = await Promise.all([
                groups.serverGroup(group.id),
                groups.domainRoutes(group.id),
            ]);
            setDetail(data);
            setDomainRoutes(routes);
        } catch (err) {
            toast.error(err.message);
        }
        setLoading(false);
    };

    const reloadRoutes = async () => {
        try {
            setDomainRoutes(await groups.domainRoutes(group.id));
        } catch {}
    };

    const handleDeleteRoute = async (routeId, name) => {
        if (!confirm(`Удалить правило "${name}"? Entry серверы будут обновлены.`)) return;
        try {
            await groups.deleteDomainRoute(group.id, routeId);
            toast.success('Правило удалено');
            reloadRoutes();
        } catch (err) {
            toast.error(err.message);
        }
    };

    useEffect(() => {
        if (expanded && !detail) loadDetail();
    }, [expanded]);

    return (
        <div className="bg-dark-800 border border-dark-700 rounded-lg">
            <div className="flex items-center justify-between p-4 cursor-pointer" onClick={onToggle}>
                <div className="flex items-center gap-3">
                    {expanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    <div>
                        <h3 className="text-white font-medium">{group.name}</h3>
                        {group.description && <p className="text-xs text-gray-500 mt-0.5">{group.description}</p>}
                    </div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                    <span className="text-green-400">{group.entry_count || 0} Entry</span>
                    <span className="text-orange-400">{group.exit_count || 0} Exit</span>
                    <span className="text-gray-400">{group.client_groups_count || 0} групп кл.</span>
                    <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 text-gray-500 hover:text-red-400">
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {expanded && (
                <div className="border-t border-dark-700 p-4 space-y-3">
                    {loading ? (
                        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
                    ) : detail ? (
                        <>
                            {/* Members */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-medium text-gray-300">Серверы</h4>
                                    <button
                                        onClick={onAddMember}
                                        className="flex items-center gap-1 px-2.5 py-1 bg-blue-600/20 text-blue-400 rounded text-xs hover:bg-blue-600/30"
                                    >
                                        <Plus className="w-3 h-3" /> Добавить
                                    </button>
                                </div>
                                {detail.members.length === 0 ? (
                                    <p className="text-xs text-gray-500">Нет серверов в группе</p>
                                ) : (
                                    detail.members.map(m => (
                                        <div key={m.id} className="flex items-center justify-between bg-dark-700 rounded-lg px-3 py-2">
                                            <div className="flex items-center gap-2">
                                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                                    m.role === 'entry' ? 'bg-green-600/20 text-green-400' : 'bg-orange-600/20 text-orange-400'
                                                }`}>
                                                    {m.role === 'entry' ? 'Entry' : 'Exit'}
                                                </span>
                                                <span className="text-sm text-white">{m.server_name}</span>
                                                <span className="text-xs text-gray-500">{m.server_domain || m.server_ip}</span>
                                                {m.inbounds_count > 0 && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-dark-600 text-gray-400">{m.inbounds_count} inb</span>
                                                )}
                                                <span className={`w-2 h-2 rounded-full ${m.server_status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                                            </div>
                                            <button
                                                onClick={() => onRemoveMember(m.server_id, m.server_name)}
                                                className="text-gray-500 hover:text-red-400"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Tunnels */}
                            {detail.tunnels?.length > 0 && (
                                <div className="space-y-1">
                                    <h4 className="text-sm font-medium text-gray-300">Авто-туннели</h4>
                                    {detail.tunnels.map(t => (
                                        <div key={t.id} className="flex items-center gap-2 text-xs text-gray-400 px-3 py-1.5 bg-dark-900/50 rounded">
                                            <span>{t.from_name}</span>
                                            <span className="text-purple-400">→</span>
                                            <span>{t.to_name}</span>
                                            <span className="text-gray-500">({t.xray_protocol}:{t.xray_port})</span>
                                            {t.endpoint_mode === 'ipv6' && (
                                                <span className="px-1 py-0.5 rounded bg-purple-600/20 text-purple-400 text-[10px]">IPv6</span>
                                            )}
                                            <span className={`ml-auto px-1.5 py-0.5 rounded text-xs ${
                                                t.status === 'active' ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                                            }`}>{t.status}</span>
                                            <button
                                                onClick={() => handleCheckTunnel(t.id)}
                                                disabled={checkLoading === t.id}
                                                className="flex items-center gap-1 px-2 py-0.5 bg-dark-700 text-gray-400 rounded text-[10px] hover:bg-dark-600 hover:text-gray-300"
                                            >
                                                {checkLoading === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                                                Проверить
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Domain routes */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-medium text-gray-300 flex items-center gap-1.5">
                                        <Globe className="w-3.5 h-3.5" /> Маршрутизация по доменам
                                    </h4>
                                    <button
                                        onClick={() => setShowDomainRoute('new')}
                                        className="flex items-center gap-1 px-2.5 py-1 bg-purple-600/20 text-purple-400 rounded text-xs hover:bg-purple-600/30"
                                    >
                                        <Plus className="w-3 h-3" /> Правило
                                    </button>
                                </div>
                                {domainRoutes.length === 0 ? (
                                    <p className="text-xs text-gray-500">Нет доменных правил. Весь трафик идёт на Exit по умолчанию.</p>
                                ) : (
                                    domainRoutes.map(r => (
                                        <div key={r.id} className="flex items-center justify-between bg-dark-700 rounded-lg px-3 py-2">
                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                <span className="text-sm text-white font-medium shrink-0">{r.name}</span>
                                                <div className="flex flex-wrap gap-1 min-w-0">
                                                    {r.domains.slice(0, 3).map((d, i) => (
                                                        <span key={i} className="px-1.5 py-0.5 rounded bg-dark-600 text-gray-400 text-[10px] truncate max-w-[160px]">{d}</span>
                                                    ))}
                                                    {r.domains.length > 3 && (
                                                        <span className="text-[10px] text-gray-500">+{r.domains.length - 3}</span>
                                                    )}
                                                </div>
                                                <span className="text-purple-400 text-xs shrink-0">→</span>
                                                <span className="text-xs text-orange-400 shrink-0">{r.target_server_name}</span>
                                                <span className="text-[10px] text-gray-500 shrink-0">P:{r.priority}</span>
                                                {!r.is_enabled && (
                                                    <span className="px-1 py-0.5 rounded bg-red-600/20 text-red-400 text-[10px]">OFF</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1 ml-2 shrink-0">
                                                <button onClick={() => setShowDomainRoute(r)} className="text-gray-500 hover:text-blue-400">
                                                    <Pencil className="w-3.5 h-3.5" />
                                                </button>
                                                <button onClick={() => handleDeleteRoute(r.id, r.name)} className="text-gray-500 hover:text-red-400">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Client groups */}
                            {detail.client_groups?.length > 0 && (
                                <div className="space-y-1">
                                    <h4 className="text-sm font-medium text-gray-300">Привязанные группы клиентов</h4>
                                    {detail.client_groups.map(cg => (
                                        <div key={cg.id} className="text-xs text-gray-400 px-3 py-1.5 bg-dark-900/50 rounded">
                                            {cg.name} — <span className="text-blue-400">{cg.clients_count || 0} кл.</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    ) : null}
                </div>
            )}

            {showDomainRoute && (
                <DomainRouteModal
                    groupId={group.id}
                    route={showDomainRoute === 'new' ? null : showDomainRoute}
                    exitServers={(detail?.members || []).filter(m => m.role === 'exit')}
                    onClose={() => setShowDomainRoute(null)}
                    onSaved={() => { setShowDomainRoute(null); reloadRoutes(); }}
                />
            )}
        </div>
    );
}

// === Модалки ===

function DomainRouteModal({ groupId, route, exitServers, onClose, onSaved }) {
    const [form, setForm] = useState({
        name: route?.name || '',
        domainsText: route?.domains?.join('\n') || '',
        target_server_id: route?.target_server_id?.toString() || '',
        priority: route?.priority?.toString() || '0',
        is_enabled: route?.is_enabled ?? true,
    });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) return toast.error('Введите имя правила');
        const domains = form.domainsText.split('\n').map(s => s.trim()).filter(Boolean);
        if (domains.length === 0) return toast.error('Добавьте хотя бы один домен');
        if (!form.target_server_id) return toast.error('Выберите Exit сервер');

        setLoading(true);
        try {
            const data = {
                name: form.name.trim(),
                domains,
                target_server_id: parseInt(form.target_server_id),
                priority: parseInt(form.priority) || 0,
                is_enabled: form.is_enabled,
            };
            if (route) {
                await groups.updateDomainRoute(groupId, route.id, data);
                toast.success('Правило обновлено');
            } else {
                await groups.createDomainRoute(groupId, data);
                toast.success('Правило создано');
            }
            onSaved();
        } catch (err) {
            toast.error(err.message);
        }
        setLoading(false);
    };

    return (
        <ModalWrapper onClose={onClose} title={route ? 'Редактировать правило' : 'Новое доменное правило'}>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Имя *</label>
                    <input
                        type="text"
                        value={form.name}
                        onChange={e => setForm({ ...form, name: e.target.value })}
                        className={inputClass}
                        placeholder="Российские сайты"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Домены * <span className="text-gray-500 font-normal">(по одному на строку)</span></label>
                    <textarea
                        value={form.domainsText}
                        onChange={e => setForm({ ...form, domainsText: e.target.value })}
                        className={inputClass + ' min-h-[100px] font-mono text-xs'}
                        placeholder={'geosite:ru\ndomain:yandex.ru\nfull:www.google.com\nkeyword:youtube\nregexp:.*\\.ru$'}
                    />
                    <p className="text-[10px] text-gray-500 mt-1">
                        Форматы: domain: (суффикс), full: (точное), geosite: (GeoSite), keyword: (подстрока), regexp: (регулярка)
                    </p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Exit сервер *</label>
                    <select
                        value={form.target_server_id}
                        onChange={e => setForm({ ...form, target_server_id: e.target.value })}
                        className={inputClass}
                    >
                        <option value="">Выберите Exit...</option>
                        {exitServers.map(s => (
                            <option key={s.server_id} value={s.server_id}>
                                {s.server_name} ({s.server_domain || s.server_ip})
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex gap-3">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Приоритет</label>
                        <input
                            type="number"
                            value={form.priority}
                            onChange={e => setForm({ ...form, priority: e.target.value })}
                            className={inputClass}
                            placeholder="0"
                        />
                        <p className="text-[10px] text-gray-500 mt-1">Выше = проверяется раньше</p>
                    </div>
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Статус</label>
                        <button
                            type="button"
                            onClick={() => setForm({ ...form, is_enabled: !form.is_enabled })}
                            className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                                form.is_enabled
                                    ? 'bg-green-600/20 border-green-500 text-green-400'
                                    : 'bg-red-600/20 border-red-500 text-red-400'
                            }`}
                        >
                            {form.is_enabled ? 'Включено' : 'Отключено'}
                        </button>
                    </div>
                </div>
                <ModalButtons onClose={onClose} loading={loading} label={route ? 'Сохранить' : 'Создать'} />
            </form>
        </ModalWrapper>
    );
}

function CreateServerGroupModal({ onClose, onCreated }) {
    const [form, setForm] = useState({ name: '', description: '' });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) return toast.error('Введите имя группы');
        setLoading(true);
        try {
            await groups.createServerGroup(form);
            toast.success('Группа серверов создана');
            onCreated();
        } catch (err) {
            toast.error(err.message);
        }
        setLoading(false);
    };

    return (
        <ModalWrapper onClose={onClose} title="Новая группа серверов">
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Имя *</label>
                    <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="Например: Европа" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Описание</label>
                    <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={inputClass} placeholder="NL + DE серверы" />
                </div>
                <ModalButtons onClose={onClose} loading={loading} label="Создать" />
            </form>
        </ModalWrapper>
    );
}

function CreateClientGroupModal({ serverGroups, onClose, onCreated }) {
    const [form, setForm] = useState({ name: '', description: '', server_group_id: '' });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) return toast.error('Введите имя группы');
        setLoading(true);
        try {
            await groups.createClientGroup({
                ...form,
                server_group_id: form.server_group_id ? parseInt(form.server_group_id) : undefined,
            });
            toast.success('Группа клиентов создана');
            onCreated();
        } catch (err) {
            toast.error(err.message);
        }
        setLoading(false);
    };

    return (
        <ModalWrapper onClose={onClose} title="Новая группа клиентов">
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Имя *</label>
                    <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="Например: Базовый тариф" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Описание</label>
                    <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={inputClass} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Группа серверов</label>
                    <select value={form.server_group_id} onChange={e => setForm({ ...form, server_group_id: e.target.value })} className={inputClass}>
                        <option value="">Без привязки</option>
                        {serverGroups.map(sg => (
                            <option key={sg.id} value={sg.id}>{sg.name}</option>
                        ))}
                    </select>
                </div>
                <ModalButtons onClose={onClose} loading={loading} label="Создать" />
            </form>
        </ModalWrapper>
    );
}

function AddMemberModal({ serverGroupId, serverList, onClose, onAdded }) {
    const [form, setForm] = useState({ server_id: '', role: 'entry' });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.server_id) return toast.error('Выберите сервер');
        setLoading(true);
        try {
            const result = await groups.addMember(serverGroupId, {
                server_id: parseInt(form.server_id),
                role: form.role,
            });
            const parts = [`туннелей: ${result.tunnels_created}`];
            if (result.inbounds_created) parts.push(`inbound'ов: ${result.inbounds_created}`);
            toast.success(`Сервер добавлен (${parts.join(', ')})`);
            onAdded();
        } catch (err) {
            toast.error(err.message);
        }
        setLoading(false);
    };

    return (
        <ModalWrapper onClose={onClose} title="Добавить сервер в группу">
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Сервер *</label>
                    <select value={form.server_id} onChange={e => setForm({ ...form, server_id: e.target.value })} className={inputClass}>
                        <option value="">Выберите сервер...</option>
                        {serverList.map(s => (
                            <option key={s.id} value={s.id}>{s.name} ({s.domain || s.ipv4 || s.host})</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Роль *</label>
                    <div className="flex gap-2">
                        {['entry', 'exit'].map(r => (
                            <button
                                key={r}
                                type="button"
                                onClick={() => setForm({ ...form, role: r })}
                                className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                                    form.role === r
                                        ? r === 'entry'
                                            ? 'bg-green-600/20 border-green-500 text-green-400'
                                            : 'bg-orange-600/20 border-orange-500 text-orange-400'
                                        : 'bg-dark-700 border-dark-600 text-gray-400 hover:border-dark-500'
                                }`}
                            >
                                {r === 'entry' ? 'Entry (точка входа)' : 'Exit (точка выхода)'}
                            </button>
                        ))}
                    </div>
                </div>
                <ModalButtons onClose={onClose} loading={loading} label="Добавить" />
            </form>
        </ModalWrapper>
    );
}

function SwitchServerGroupModal({ clientGroup, serverGroups, onClose, onSwitched }) {
    const [selectedSG, setSelectedSG] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!selectedSG) return toast.error('Выберите группу серверов');
        setLoading(true);
        try {
            const result = await groups.switchServerGroup(clientGroup.id, {
                server_group_id: parseInt(selectedSG),
            });
            toast.success(`Переключено: ${result.migrated} клиентов мигрировано, ${result.skipped} пропущено`);
            onSwitched();
        } catch (err) {
            toast.error(err.message);
        }
        setLoading(false);
    };

    const targetSG = serverGroups.find(sg => sg.id === parseInt(selectedSG));

    return (
        <ModalWrapper onClose={onClose} title={`Сменить серверы для "${clientGroup.name}"`}>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div className="bg-dark-900/50 rounded-lg px-3 py-2 text-xs text-gray-400">
                    Текущая привязка: <span className="text-blue-400 font-medium">
                        {clientGroup.server_group_name || 'нет'}
                    </span>
                    <br />
                    Клиентов: <span className="text-white">{clientGroup.clients_count || 0}</span>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Новая группа серверов *</label>
                    <select value={selectedSG} onChange={e => setSelectedSG(e.target.value)} className={inputClass}>
                        <option value="">Выберите...</option>
                        {serverGroups
                            .filter(sg => sg.id !== clientGroup.server_group_id)
                            .map(sg => (
                                <option key={sg.id} value={sg.id}>
                                    {sg.name} ({sg.entry_count || 0} Entry, {sg.exit_count || 0} Exit)
                                </option>
                            ))}
                    </select>
                </div>
                {targetSG && (
                    <div className="bg-yellow-600/10 text-yellow-400 text-xs px-3 py-2 rounded-lg">
                        Все {clientGroup.clients_count || 0} клиентов будут переключены на серверы группы "{targetSG.name}".
                        Изменения вступят в силу при следующем обновлении подписки.
                    </div>
                )}
                <ModalButtons onClose={onClose} loading={loading} label="Переключить" />
            </form>
        </ModalWrapper>
    );
}

// === Общие компоненты ===

function ModalWrapper({ onClose, title, children }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
            <div className="bg-dark-800 border border-dark-700 rounded-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-dark-600">
                    <h2 className="text-lg font-semibold text-white">{title}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                {children}
            </div>
        </div>
    );
}

function ModalButtons({ onClose, loading, label }) {
    return (
        <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 bg-dark-700 text-gray-300 rounded-lg text-sm font-medium hover:bg-dark-600">
                Отмена
            </button>
            <button type="submit" disabled={loading} className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {loading ? 'Загрузка...' : label}
            </button>
        </div>
    );
}
