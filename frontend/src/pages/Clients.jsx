// Страница управления VPN-клиентами (мульти-протокол, группировка по подписке)
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, Search, MoreVertical, QrCode, Lock, Unlock, Trash2, Edit, RotateCcw, Download, ArrowRightLeft, ChevronDown, ChevronRight, Smartphone, X, Ban, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { clients, groups } from '../api/client';
import { useUser } from '../App';
import StatusBadge from '../components/StatusBadge';
import ClientModal from '../components/ClientModal';
import QRModal from '../components/QRModal';

// Типы устройств → иконки/лейблы
const DEVICE_TYPES = {
    android: 'Android',
    ios: 'iOS',
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux',
    unknown: 'Unknown',
};

// Модалка управления устройствами (HWID)
function DevicesModal({ clientId, clientName, onClose }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [limitInput, setLimitInput] = useState('');
    const [saving, setSaving] = useState(false);

    const fetchDevices = useCallback(async () => {
        try {
            const result = await clients.devices(clientId);
            setData(result);
            setLimitInput(String(result.device_limit || 0));
        } catch (err) {
            toast.error(err.message);
        }
        setLoading(false);
    }, [clientId]);

    useEffect(() => { fetchDevices(); }, [fetchDevices]);

    const handleSetLimit = async () => {
        setSaving(true);
        try {
            await clients.setDeviceLimit(clientId, parseInt(limitInput) || 0);
            toast.success('Лимит обновлён');
            fetchDevices();
        } catch (err) {
            toast.error(err.message);
        }
        setSaving(false);
    };

    const handleRevoke = async (deviceId) => {
        try {
            await clients.revokeDevice(clientId, deviceId);
            toast.success('Устройство отозвано');
            fetchDevices();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleRestore = async (deviceId) => {
        try {
            await clients.restoreDevice(clientId, deviceId);
            toast.success('Устройство восстановлено');
            fetchDevices();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleDeleteDevice = async (deviceId) => {
        try {
            await clients.deleteDevice(clientId, deviceId);
            fetchDevices();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleResetAll = async () => {
        if (!confirm('Сбросить все устройства? Клиенту придётся подключиться заново.')) return;
        try {
            await clients.resetDevices(clientId);
            toast.success('Все устройства сброшены');
            fetchDevices();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const timeAgo = (date) => {
        if (!date) return '—';
        const diff = Date.now() - new Date(date).getTime();
        if (diff < 60000) return 'только что';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} мин назад`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч назад`;
        return `${Math.floor(diff / 86400000)} дн назад`;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
            <div className="glass-card w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-dark-700">
                    <div>
                        <h2 className="text-lg font-semibold text-white">Устройства</h2>
                        <p className="text-sm text-gray-400">{clientName}</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {loading ? (
                    <div className="p-8 text-center text-gray-500">Загрузка...</div>
                ) : (
                    <div className="p-5 space-y-4">
                        {/* Лимит устройств */}
                        <div className="flex items-center gap-3">
                            <label className="text-sm text-gray-300 whitespace-nowrap">Лимит устройств:</label>
                            <input
                                type="number"
                                min="0"
                                value={limitInput}
                                onChange={e => setLimitInput(e.target.value)}
                                className="w-20 bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-accent-500"
                            />
                            <button
                                onClick={handleSetLimit}
                                disabled={saving || String(data?.device_limit || 0) === limitInput}
                                className="px-3 py-1.5 btn-primary text-xs disabled:opacity-50"
                            >
                                Сохранить
                            </button>
                            <span className="text-xs text-gray-500 ml-auto">
                                {data?.device_limit ? `${data.active} / ${data.device_limit}` : 'Без лимита'}
                            </span>
                        </div>
                        <p className="text-[11px] text-gray-500">0 = без ограничений. VPN-приложение должно поддерживать отправку Device ID.</p>

                        {/* Список устройств */}
                        {data?.devices?.length > 0 ? (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-medium text-gray-300">
                                        Устройства ({data.devices.length})
                                    </h3>
                                    <button
                                        onClick={handleResetAll}
                                        className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                                    >
                                        <RefreshCw className="w-3 h-3" /> Сбросить все
                                    </button>
                                </div>
                                {data.devices.map(dev => (
                                    <div
                                        key={dev.id}
                                        className={`p-3 rounded-lg border ${
                                            dev.is_revoked
                                                ? 'bg-red-900/10 border-red-900/30'
                                                : 'bg-dark-900 border-dark-700'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Smartphone className={`w-4 h-4 ${dev.is_revoked ? 'text-red-400' : 'text-accent-400'}`} />
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm text-white">
                                                            {dev.device_name || DEVICE_TYPES[dev.device_type] || 'Unknown'}
                                                        </span>
                                                        {dev.app_name && dev.app_name !== 'unknown' && (
                                                            <span className="px-1.5 py-0.5 bg-accent-500/20 rounded text-[10px] text-accent-300">
                                                                {dev.app_name}
                                                            </span>
                                                        )}
                                                        {dev.is_revoked && (
                                                            <span className="px-1.5 py-0.5 bg-red-500/20 rounded text-[10px] text-red-400">
                                                                Отозвано
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-[11px] text-gray-500 mt-0.5">
                                                        {dev.last_ip || '—'} &middot; {timeAgo(dev.last_seen)}
                                                        {dev.hwid && <> &middot; <span className="font-mono">{dev.hwid.slice(0, 12)}...</span></>}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex gap-1">
                                                {dev.is_revoked ? (
                                                    <button
                                                        onClick={() => handleRestore(dev.id)}
                                                        className="p-1 text-green-400 hover:text-green-300"
                                                        title="Восстановить"
                                                    >
                                                        <RefreshCw className="w-3.5 h-3.5" />
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleRevoke(dev.id)}
                                                        className="p-1 text-yellow-400 hover:text-yellow-300"
                                                        title="Отозвать"
                                                    >
                                                        <Ban className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleDeleteDevice(dev.id)}
                                                    className="p-1 text-red-400 hover:text-red-300"
                                                    title="Удалить"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8 text-gray-500 text-sm">
                                Нет зарегистрированных устройств.
                                <br />
                                <span className="text-xs">Устройства появятся после обращения к подписке.</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// Модалка массового перемещения клиентов в группу
function BulkMoveModal({ selectedIds, onClose, onDone }) {
    const [clientGroupList, setClientGroupList] = useState([]);
    const [targetGroupId, setTargetGroupId] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        groups.clientGroups().then(setClientGroupList).catch(() => {});
    }, []);

    const handleMove = async () => {
        if (!targetGroupId) return;
        setLoading(true);
        try {
            const result = await groups.bulkMove({
                client_ids: [...selectedIds],
                target_group_id: parseInt(targetGroupId),
            });
            const msg = `Перемещено: ${result.moved}` + (result.skipped ? `, пропущено: ${result.skipped}` : '');
            toast.success(msg);
            onDone();
        } catch (err) {
            toast.error(err.message);
        }
        setLoading(false);
    };

    const targetGroup = clientGroupList.find(g => g.id === parseInt(targetGroupId));

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onClose}>
            <div className="glass-card w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-dark-700">
                    <h2 className="text-lg font-semibold text-white">Переместить в группу</h2>
                    <p className="text-sm text-gray-400 mt-1">Выбрано клиентов: {selectedIds.size}</p>
                </div>
                <div className="p-5 space-y-4">
                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Целевая группа клиентов</label>
                        <select
                            value={targetGroupId}
                            onChange={e => setTargetGroupId(e.target.value)}
                            className="w-full bg-dark-700/50 border border-dark-600/80 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
                        >
                            <option value="">Выберите группу...</option>
                            {clientGroupList.map(g => (
                                <option key={g.id} value={g.id}>
                                    {g.name} {g.server_group_name ? `(→ ${g.server_group_name})` : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                    {targetGroup && (
                        <div className="bg-dark-700/50 rounded-lg p-3 text-xs text-gray-400">
                            <p>Группа серверов: <span className="text-white">{targetGroup.server_group_name || 'не привязана'}</span></p>
                            <p>Клиентов в группе: <span className="text-white">{targetGroup.client_count || 0}</span></p>
                            <p className="mt-2 text-yellow-400/80">⚠ Клиенты будут переназначены на inbound'ы целевой группы</p>
                        </div>
                    )}
                    <div className="flex gap-3">
                        <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 bg-dark-700 text-gray-300 rounded-lg text-sm hover:bg-dark-600">
                            Отмена
                        </button>
                        <button
                            onClick={handleMove}
                            disabled={!targetGroupId || loading}
                            className="flex-1 px-4 py-2.5 btn-primary disabled:opacity-50"
                        >
                            {loading ? 'Перемещение...' : 'Переместить'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Форматирование байтов (обрабатывает строки из PostgreSQL BIGINT, null, 0)
function fmtBytes(b) {
    const n = Number(b) || 0;
    if (n <= 0) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(k)), s.length - 1);
    return (n / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
}

// Бейдж протокола
function ProtocolBadge({ protocol }) {
    const styles = {
        vless: 'bg-purple-600/20 text-purple-400',
    };
    const labels = {
        vless: 'VLESS',
    };
    return (
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${styles[protocol] || 'bg-dark-600 text-gray-400'}`}>
            {labels[protocol] || protocol}
        </span>
    );
}

// Группировка клиентов по подписке (name + owner_id)
function groupClients(flatClients) {
    const map = new Map();
    for (const c of flatClients) {
        const key = `${c.name}__${c.owner_id || 0}`;
        if (!map.has(key)) {
            map.set(key, {
                key,
                name: c.name,
                note: c.note,
                owner_id: c.owner_id,
                owner_username: c.owner_username,
                client_group_name: c.client_group_name,
                client_group_id: c.client_group_id,
                clients: [],
                ids: [],
                upload_bytes: 0,
                download_bytes: 0,
                is_online: false,
                all_blocked: true,
                endpoint: null,
                device_count: 0,
                device_limit: 0,
                sub_token: null,
            });
        }
        const g = map.get(key);
        g.clients.push(c);
        g.ids.push(c.id);
        g.upload_bytes += parseInt(c.upload_bytes) || 0;
        g.download_bytes += parseInt(c.download_bytes) || 0;
        if (c.is_online) g.is_online = true;
        if (!c.is_blocked) g.all_blocked = false;
        if (c.endpoint && !g.endpoint) g.endpoint = c.endpoint;
        if (!g.sub_token && c.sub_token) g.sub_token = c.sub_token;
        const dc = parseInt(c.device_count) || 0;
        const dl = parseInt(c.device_limit) || 0;
        if (dc > g.device_count) g.device_count = dc;
        if (dl > g.device_limit) g.device_limit = dl;
    }
    return Array.from(map.values());
}

export default function Clients() {
    const currentUser = useUser();
    const isAdmin = currentUser?.role === 'admin';
    const [data, setData] = useState({ clients: [], pagination: {} });
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('');
    const [protoFilter, setProtoFilter] = useState('');
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState(new Set());
    const [showCreate, setShowCreate] = useState(false);
    const [editClient, setEditClient] = useState(null);
    const [qrGroup, setQrGroup] = useState(null);
    const [menuGroup, setMenuGroup] = useState(null);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
    const menuBtnRef = useRef({});
    const [groupFilter, setGroupFilter] = useState('');
    const [clientGroupList, setClientGroupList] = useState([]);
    const [showBulkMove, setShowBulkMove] = useState(false);
    const [devicesClientId, setDevicesClientId] = useState(null);
    const [devicesClientName, setDevicesClientName] = useState('');
    const [expanded, setExpanded] = useState(new Set());

    const toggleExpand = (key) => {
        setExpanded(prev => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });
    };

    // Группированные клиенты
    const grouped = useMemo(() => groupClients(data.clients), [data.clients]);

    // Загрузка списка групп клиентов (для фильтра)
    useEffect(() => {
        if (isAdmin) {
            groups.clientGroups().then(setClientGroupList).catch(() => {});
        }
    }, [isAdmin]);

    const fetchClients = useCallback(() => {
        setLoading(true);
        const params = { search, status: filter, page, limit: 50 };
        if (protoFilter) params.protocol = protoFilter;
        if (groupFilter) params.group_id = groupFilter;
        clients.list(params)
            .then(setData)
            .catch(err => toast.error(err.message))
            .finally(() => setLoading(false));
    }, [search, filter, protoFilter, groupFilter, page]);

    useEffect(() => { fetchClients(); }, [fetchClients]);

    // Автообновление каждые 5 секунд (статус, трафик, IP — максимально быстро)
    useEffect(() => {
        const interval = setInterval(() => {
            clients.list({
                search, status: filter, page, limit: 50,
                ...(protoFilter && { protocol: protoFilter }),
                ...(groupFilter && { group_id: groupFilter }),
            })
                .then(setData)
                .catch(() => {});
        }, 5000);
        return () => clearInterval(interval);
    }, [search, filter, protoFilter, groupFilter, page]);

    // Закрытие меню по Escape
    useEffect(() => {
        const handleEsc = (e) => { if (e.key === 'Escape') setMenuGroup(null); };
        document.addEventListener('keydown', handleEsc);
        return () => document.removeEventListener('keydown', handleEsc);
    }, []);

    const openMenu = (group) => {
        if (menuGroup?.key === group.key) {
            setMenuGroup(null);
            return;
        }
        const btn = menuBtnRef.current[group.key];
        if (btn) {
            const rect = btn.getBoundingClientRect();
            setMenuPos({
                top: rect.bottom + 4,
                left: rect.right - 192,
            });
        }
        setMenuGroup(group);
    };

    // === Действия над группой (всеми подклиентами) ===
    const handleBlock = async (ids) => {
        if (!confirm('Заблокировать клиента?')) return;
        try {
            for (const id of ids) await clients.block(id);
            toast.success('Клиент заблокирован');
            fetchClients();
        } catch (err) { toast.error(err.message); }
    };

    const handleUnblock = async (ids) => {
        try {
            for (const id of ids) await clients.unblock(id);
            toast.success('Клиент разблокирован');
            fetchClients();
        } catch (err) { toast.error(err.message); }
    };

    const handleDelete = async (ids) => {
        if (!confirm('Удалить клиента и все его подключения? Это действие необратимо.')) return;
        try {
            for (const id of ids) await clients.remove(id);
            toast.success('Клиент удалён');
            fetchClients();
        } catch (err) { toast.error(err.message); }
    };

    const handleResetTraffic = async (ids) => {
        try {
            for (const id of ids) await clients.resetTraffic(id);
            toast.success('Трафик сброшен');
            fetchClients();
        } catch (err) { toast.error(err.message); }
    };

    const handleBulkAction = async (action) => {
        if (selected.size === 0) return;
        const label = action === 'delete' ? 'удалить' : action === 'block' ? 'заблокировать' : 'разблокировать';
        if (!confirm(`${label} ${selected.size} клиентов?`)) return;
        await clients.bulkAction([...selected], action);
        toast.success(`Действие выполнено: ${selected.size} клиентов`);
        setSelected(new Set());
        fetchClients();
    };

    const toggleSelect = (ids) => {
        const next = new Set(selected);
        const allIn = ids.every(id => next.has(id));
        if (allIn) {
            ids.forEach(id => next.delete(id));
        } else {
            ids.forEach(id => next.add(id));
        }
        setSelected(next);
    };

    const toggleSelectAll = () => {
        const allIds = grouped.flatMap(g => g.ids);
        if (selected.size === allIds.length) {
            setSelected(new Set());
        } else {
            setSelected(new Set(allIds));
        }
    };

    const groupStatus = (g) => {
        if (g.all_blocked) return 'blocked';
        if (g.is_online) return 'online';
        return 'offline';
    };

    const colCount = isAdmin ? 8 : 7;

    return (
        <div className="space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-white">VPN-клиенты</h1>
                <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-2 px-4 py-2 btn-primary transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    Новый клиент
                </button>
            </div>

            {/* Фильтры и поиск */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => { setSearch(e.target.value); setPage(1); }}
                        className="w-full bg-dark-800 border border-dark-700 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent-500"
                        placeholder="Поиск по имени, IP..."
                    />
                </div>
                <select
                    value={filter}
                    onChange={e => { setFilter(e.target.value); setPage(1); }}
                    className="bg-dark-800 border border-dark-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
                >
                    <option value="">Все статусы</option>
                    <option value="active">Активные</option>
                    <option value="online">Онлайн</option>
                    <option value="blocked">Заблокированные</option>
                </select>
                {isAdmin && clientGroupList.length > 0 && (
                    <select
                        value={groupFilter}
                        onChange={e => { setGroupFilter(e.target.value); setPage(1); }}
                        className="bg-dark-800 border border-dark-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
                    >
                        <option value="">Все группы</option>
                        <option value="none">Без группы</option>
                        {clientGroupList.map(g => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                    </select>
                )}
            </div>

            {/* Массовые действия */}
            {selected.size > 0 && (
                <div className="flex items-center gap-3 bg-dark-800 border border-dark-700 rounded-lg p-3">
                    <span className="text-sm text-gray-300">Выбрано: {selected.size}</span>
                    <button onClick={() => handleBulkAction('block')} className="px-3 py-1.5 bg-yellow-600/20 text-yellow-400 rounded-lg text-xs hover:bg-yellow-600/30">
                        Заблокировать
                    </button>
                    <button onClick={() => handleBulkAction('unblock')} className="px-3 py-1.5 bg-green-600/20 text-green-400 rounded-lg text-xs hover:bg-green-600/30">
                        Разблокировать
                    </button>
                    <button onClick={() => handleBulkAction('delete')} className="px-3 py-1.5 bg-red-600/20 text-red-400 rounded-lg text-xs hover:bg-red-600/30">
                        Удалить
                    </button>
                    {isAdmin && (
                        <button onClick={() => setShowBulkMove(true)} className="px-3 py-1.5 bg-accent-500/15 text-accent-400 rounded-lg text-xs hover:bg-accent-500/25 flex items-center gap-1">
                            <ArrowRightLeft className="w-3 h-3" />
                            В группу
                        </button>
                    )}
                </div>
            )}

            {/* Таблица клиентов */}
            <div className="glass-card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-dark-700">
                                <th className="p-3 text-left">
                                    <input
                                        type="checkbox"
                                        checked={grouped.length > 0 && selected.size === data.clients.length}
                                        onChange={toggleSelectAll}
                                        className="rounded border-dark-500"
                                    />
                                </th>
                                <th className="p-3 text-left text-xs font-medium text-gray-400 uppercase">Имя</th>
                                <th className="p-3 text-left text-xs font-medium text-gray-400 uppercase">Email</th>
                                {isAdmin && <th className="p-3 text-left text-xs font-medium text-gray-400 uppercase">Группа</th>}
                                <th className="p-3 text-left text-xs font-medium text-gray-400 uppercase">Статус</th>
                                <th className="p-3 text-left text-xs font-medium text-gray-400 uppercase">Трафик</th>
                                <th className="p-3 text-center text-xs font-medium text-gray-400 uppercase">Устройства</th>
                                <th className="p-3 text-right text-xs font-medium text-gray-400 uppercase">Действия</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={colCount} className="p-8 text-center text-gray-500">Загрузка...</td></tr>
                            ) : grouped.length === 0 ? (
                                <tr><td colSpan={colCount} className="p-8 text-center text-gray-500">Нет клиентов</td></tr>
                            ) : grouped.map(g => {
                                const isExpanded = expanded.has(g.key);
                                const hasMultiple = g.clients.length > 1;
                                return (
                                    <React.Fragment key={g.key}>
                                        {/* Основная строка */}
                                        <tr className="border-b border-dark-700/50 hover:bg-dark-700/30 transition-colors">
                                            <td className="p-3">
                                                <input
                                                    type="checkbox"
                                                    checked={g.ids.every(id => selected.has(id))}
                                                    onChange={() => toggleSelect(g.ids)}
                                                    className="rounded border-dark-500"
                                                />
                                            </td>
                                            <td className="p-3">
                                                <div className="flex items-center gap-2">
                                                    {hasMultiple && (
                                                        <button
                                                            onClick={() => toggleExpand(g.key)}
                                                            className="text-gray-500 hover:text-white transition-colors"
                                                        >
                                                            {isExpanded
                                                                ? <ChevronDown className="w-4 h-4" />
                                                                : <ChevronRight className="w-4 h-4" />
                                                            }
                                                        </button>
                                                    )}
                                                    <div>
                                                        <p className="text-white font-medium">{g.name}</p>
                                                        {g.note && <p className="text-xs text-gray-500 truncate max-w-[200px]">{g.note}</p>}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-3 text-xs text-gray-400 truncate max-w-[200px]">
                                                {g.clients[0]?.email || '—'}
                                            </td>
                                            {isAdmin && (
                                                <td className="p-3">
                                                    {g.client_group_name ? (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-600/20 text-indigo-400 font-medium">
                                                            {g.client_group_name}
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-600 text-xs">—</span>
                                                    )}
                                                </td>
                                            )}
                                            <td className="p-3"><StatusBadge status={groupStatus(g)} /></td>
                                            <td className="p-3">
                                                <div className="text-xs">
                                                    <span className="text-green-400">↑{fmtBytes(g.upload_bytes)}</span>
                                                    {' / '}
                                                    <span className="text-accent-400">↓{fmtBytes(g.download_bytes)}</span>
                                                </div>
                                            </td>
                                            <td className="p-3 text-center">
                                                <button
                                                    onClick={() => {
                                                        setDevicesClientId(g.clients[0].id);
                                                        setDevicesClientName(g.name);
                                                    }}
                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs hover:bg-dark-700 transition-colors group"
                                                    title="Управление устройствами"
                                                >
                                                    <Smartphone className="w-3.5 h-3.5 text-gray-500 group-hover:text-accent-400" />
                                                    <span className={g.device_count > 0
                                                        ? (g.device_limit > 0 && g.device_count >= g.device_limit
                                                            ? 'text-red-400 font-medium'
                                                            : 'text-emerald-400 font-medium')
                                                        : 'text-gray-600'
                                                    }>
                                                        {g.device_count}
                                                    </span>
                                                    {g.device_limit > 0 && (
                                                        <span className="text-gray-600">/{g.device_limit}</span>
                                                    )}
                                                </button>
                                            </td>
                                            <td className="p-3">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button
                                                        onClick={() => setQrGroup(g)}
                                                        className="p-1.5 text-gray-400 hover:text-accent-400 rounded-lg hover:bg-dark-700"
                                                        title="QR-код / Share Link"
                                                    >
                                                        <QrCode className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        ref={el => menuBtnRef.current[g.key] = el}
                                                        onClick={() => openMenu(g)}
                                                        className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-dark-700"
                                                    >
                                                        <MoreVertical className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        {/* Раскрывающиеся подстроки по каждому протоколу */}
                                        {isExpanded && g.clients.map(c => (
                                            <tr key={`sub-${c.id}`} className="bg-dark-900/50 border-b border-dark-700/30">
                                                <td className="p-2 pl-6"></td>
                                                <td className="p-2 pl-10">
                                                    <span className="text-xs text-gray-500 font-mono">
                                                        {c.ip_address || (c.xray_uuid ? c.xray_uuid.substring(0, 8) + '...' : '—')}
                                                    </span>
                                                </td>
                                                <td className="p-2">
                                                    <ProtocolBadge protocol={c.protocol} />
                                                </td>
                                                {isAdmin && <td className="p-2"></td>}
                                                {isAdmin && <td className="p-2"></td>}
                                                <td className="p-2">
                                                    <StatusBadge status={c.is_blocked ? 'blocked' : c.is_online ? 'online' : 'offline'} />
                                                </td>
                                                <td className="p-2">
                                                    <div className="text-xs">
                                                        <span className="text-green-400/70">↑{fmtBytes(c.upload_bytes)}</span>
                                                        {' / '}
                                                        <span className="text-accent-400/70">↓{fmtBytes(c.download_bytes)}</span>
                                                    </div>
                                                </td>
                                                <td className="p-2 text-xs text-gray-400 font-mono">
                                                    {c.endpoint ? c.endpoint.replace(/:\d+$/, '') : '\u2014'}
                                                </td>
                                                <td className="p-2"></td>
                                                <td className="p-2">
                                                    <button
                                                        onClick={() => setQrGroup({ ...g, clients: [c] })}
                                                        className="p-1 text-gray-500 hover:text-accent-400 rounded hover:bg-dark-700"
                                                        title={`QR — ${c.protocol}`}
                                                    >
                                                        <QrCode className="w-3.5 h-3.5" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Пагинация */}
                {data.pagination.pages > 1 && (
                    <div className="flex items-center justify-between p-3 border-t border-dark-700">
                        <span className="text-xs text-gray-400">
                            Всего: {data.pagination.total}
                        </span>
                        <div className="flex gap-1">
                            {Array.from({ length: data.pagination.pages }, (_, i) => i + 1).map(p => (
                                <button
                                    key={p}
                                    onClick={() => setPage(p)}
                                    className={`px-3 py-1 text-xs rounded-md ${
                                        page === p
                                            ? 'bg-accent-500 text-white'
                                            : 'text-gray-400 hover:text-white hover:bg-dark-700'
                                    }`}
                                >
                                    {p}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Выпадающее меню (fixed позиция) */}
            {menuGroup && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuGroup(null)} />
                    <div
                        className="fixed z-50 w-48 bg-dark-700/50 border border-dark-600/80 rounded-lg shadow-xl py-1"
                        style={{ top: menuPos.top, left: menuPos.left }}
                    >
                        <button
                            onClick={() => { setEditClient(menuGroup.clients[0]); setMenuGroup(null); }}
                            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-300 hover:bg-dark-600"
                        >
                            <Edit className="w-4 h-4" /> Редактировать
                        </button>
                        <button
                            onClick={() => { setQrGroup(menuGroup); setMenuGroup(null); }}
                            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-300 hover:bg-dark-600"
                        >
                            <Download className="w-4 h-4" /> Конфиг / QR
                        </button>
                        <button
                            onClick={() => {
                                setDevicesClientId(menuGroup.clients[0].id);
                                setDevicesClientName(menuGroup.name);
                                setMenuGroup(null);
                            }}
                            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-300 hover:bg-dark-600"
                        >
                            <Smartphone className="w-4 h-4" /> Устройства
                        </button>
                        {menuGroup.all_blocked ? (
                            <button
                                onClick={() => { handleUnblock(menuGroup.ids); setMenuGroup(null); }}
                                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-green-400 hover:bg-dark-600"
                            >
                                <Unlock className="w-4 h-4" /> Разблокировать
                            </button>
                        ) : (
                            <button
                                onClick={() => { handleBlock(menuGroup.ids); setMenuGroup(null); }}
                                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-yellow-400 hover:bg-dark-600"
                            >
                                <Lock className="w-4 h-4" /> Заблокировать
                            </button>
                        )}
                        <button
                            onClick={() => { handleResetTraffic(menuGroup.ids); setMenuGroup(null); }}
                            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-300 hover:bg-dark-600"
                        >
                            <RotateCcw className="w-4 h-4" /> Сбросить трафик
                        </button>
                        <hr className="border-dark-600 my-1" />
                        <button
                            onClick={() => { handleDelete(menuGroup.ids); setMenuGroup(null); }}
                            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-dark-600"
                        >
                            <Trash2 className="w-4 h-4" /> Удалить
                        </button>
                    </div>
                </>
            )}

            {/* Модальные окна */}
            {(showCreate || editClient) && (
                <ClientModal
                    client={editClient}
                    onClose={() => { setShowCreate(false); setEditClient(null); }}
                    onSaved={() => { setShowCreate(false); setEditClient(null); fetchClients(); }}
                />
            )}

            {qrGroup && <QRModal clients={qrGroup.clients} onClose={() => setQrGroup(null)} />}

            {devicesClientId && (
                <DevicesModal
                    clientId={devicesClientId}
                    clientName={devicesClientName}
                    onClose={() => setDevicesClientId(null)}
                />
            )}

            {showBulkMove && (
                <BulkMoveModal
                    selectedIds={selected}
                    onClose={() => setShowBulkMove(false)}
                    onDone={() => {
                        setShowBulkMove(false);
                        setSelected(new Set());
                        fetchClients();
                        // Обновить список групп (счётчики)
                        groups.clientGroups().then(setClientGroupList).catch(() => {});
                    }}
                />
            )}
        </div>
    );
}
