// Страница мониторинга и управления серверами через API
import { useState, useEffect, useCallback } from 'react';
import {
    Search, RefreshCw, AlertTriangle, Info, AlertCircle, Filter,
    Server, Cpu, MemoryStick, HardDrive, Clock, Wifi, Shield,
    Activity, Container, CheckCircle, XCircle, Loader2,
    ChevronDown, ChevronUp, Play, Square, RotateCw, Zap,
    TrendingUp, ArrowUpDown, Globe, Link2
} from 'lucide-react';
import toast from 'react-hot-toast';
import { monitoring, settings } from '../api/client';

// =================== Утилиты ===================

function fmtUptime(sec) {
    if (!sec) return 'н/д';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}д ${h}ч`;
    if (h > 0) return `${h}ч ${m}м`;
    return `${m}м`;
}

function fmtBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function timeAgo(dateStr) {
    if (!dateStr) return 'никогда';
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 60000) return 'только что';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} мин назад`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч назад`;
    return `${Math.floor(diff / 86400000)} д назад`;
}

function timeFormat(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// =================== Компоненты ===================

function ProgressBar({ value, max, size = 'md' }) {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    const color = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-blue-500';
    const h = size === 'sm' ? 'h-1.5' : 'h-2';
    return (
        <div className={`w-full bg-dark-700 rounded-full ${h}`}>
            <div className={`${h} rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
        </div>
    );
}

function StatusDot({ status }) {
    const colors = {
        online: 'bg-green-400',
        offline: 'bg-red-400',
        active: 'bg-green-400',
        deploying: 'bg-yellow-400 animate-pulse',
        unreachable: 'bg-red-400',
        error: 'bg-red-400',
        none: 'bg-gray-600',
    };
    return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || colors.none}`} />;
}

function ServiceBadge({ name, installed, running, error }) {
    if (!installed) {
        return (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-dark-600 text-gray-500">
                {name}
            </span>
        );
    }
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${
            running ? 'bg-green-600/15 text-green-400' : 'bg-red-600/15 text-red-400'
        }`}>
            {running ? <CheckCircle className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
            {name}
        </span>
    );
}

function SeverityBadge({ severity }) {
    const styles = {
        error: 'bg-red-600/15 text-red-400',
        warning: 'bg-yellow-600/15 text-yellow-400',
        info: 'bg-blue-600/15 text-blue-400',
    };
    return (
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${styles[severity] || styles.info}`}>
            {severity}
        </span>
    );
}

// Суммарная карточка
function SummaryCard({ icon: Icon, label, value, sub, color = 'text-blue-400' }) {
    return (
        <div className="bg-dark-800 border border-dark-700 rounded-xl p-4">
            <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-dark-700`}>
                    <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <div>
                    <div className="text-xl font-bold text-white">{value}</div>
                    <div className="text-xs text-gray-400">{label}</div>
                    {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
                </div>
            </div>
        </div>
    );
}

// =================== Карточка сервера в мониторинге ===================

function MonitorServerCard({ server, onRefreshServices }) {
    const [expanded, setExpanded] = useState(false);
    const [services, setServices] = useState(null);
    const [servicesLoading, setServicesLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState('');

    const loadServices = useCallback(async () => {
        if (server.agent_status !== 'active') return;
        setServicesLoading(true);
        try {
            const svc = await monitoring.serverServices(server.id);
            setServices(svc);
        } catch {}
        setServicesLoading(false);
    }, [server.id, server.agent_status]);

    const handleExpand = () => {
        const next = !expanded;
        setExpanded(next);
        if (next && !services) loadServices();
    };

    const handleRestartService = async (service) => {
        setActionLoading(`restart-${service}`);
        try {
            await monitoring.restartService(server.id, service);
            toast.success(`${service} перезапущен на ${server.name}`);
            loadServices();
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleStopService = async (service) => {
        if (!confirm(`Остановить ${service} на ${server.name}?`)) return;
        setActionLoading(`stop-${service}`);
        try {
            await monitoring.stopService(server.id, service);
            toast.success(`${service} остановлен`);
            loadServices();
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleCheckAgent = async () => {
        setActionLoading('check');
        try {
            const result = await monitoring.agentHealth(server.id);
            if (result.ok) {
                toast.success(`Агент OK: v${result.agentVersion || '?'}, uptime ${fmtUptime(result.uptime)}`);
            } else {
                toast.error(`Агент недоступен: ${result.error}`);
            }
            if (onRefreshServices) onRefreshServices();
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const cpuPct = server.cpu_percent || 0;
    const ramPct = server.ram_total_mb > 0 ? Math.round((server.ram_used_mb / server.ram_total_mb) * 100) : 0;
    const diskPct = server.disk_total_gb > 0 ? Math.round((server.disk_used_gb / server.disk_total_gb) * 100) : 0;

    // Определяем цвет рамки по статусу
    const borderColor = server.status === 'online'
        ? (cpuPct > 90 || ramPct > 90 ? 'border-yellow-600/50' : 'border-dark-700')
        : 'border-red-600/30';

    return (
        <div className={`bg-dark-800 border ${borderColor} rounded-xl overflow-hidden`}>
            <div className="p-4 cursor-pointer hover:bg-dark-700/30 transition-colors" onClick={handleExpand}>
                <div className="flex items-center justify-between">
                    {/* Левая часть: имя, статус, IP */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                        <StatusDot status={server.status} />
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm font-semibold text-white truncate">{server.name}</h3>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                    { node: 'bg-blue-600/20 text-blue-400', exit: 'bg-green-600/20 text-green-400', gateway: 'bg-yellow-600/20 text-yellow-400' }[server.role] || 'bg-dark-600 text-gray-400'
                                }`}>
                                    {server.role}
                                </span>
                                {/* Agent status */}
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                    { active: 'bg-green-600/15 text-green-400', none: 'bg-dark-600 text-gray-500', unreachable: 'bg-red-600/15 text-red-400', error: 'bg-red-600/15 text-red-400', deploying: 'bg-yellow-600/15 text-yellow-400' }[server.agent_status] || 'bg-dark-600 text-gray-500'
                                }`}>
                                    <Container className="w-2.5 h-2.5 inline mr-0.5" />
                                    {server.agent_status === 'active' ? 'Agent' : server.agent_status}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[11px] text-gray-400">{server.ipv4 || server.host}</span>
                                {server.last_seen && (
                                    <span className="text-[10px] text-gray-500">
                                        <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                                        {timeAgo(server.last_seen)}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Средняя часть: мини-метрики */}
                    <div className="hidden md:flex items-center gap-4 mx-4">
                        {server.status === 'online' && (
                            <>
                                <div className="text-center w-16">
                                    <div className={`text-xs font-mono font-bold ${cpuPct > 80 ? 'text-yellow-400' : cpuPct > 90 ? 'text-red-400' : 'text-gray-300'}`}>
                                        {cpuPct}%
                                    </div>
                                    <ProgressBar value={cpuPct} max={100} size="sm" />
                                    <div className="text-[9px] text-gray-500 mt-0.5">CPU</div>
                                </div>
                                <div className="text-center w-16">
                                    <div className={`text-xs font-mono font-bold ${ramPct > 80 ? 'text-yellow-400' : ramPct > 90 ? 'text-red-400' : 'text-gray-300'}`}>
                                        {ramPct}%
                                    </div>
                                    <ProgressBar value={ramPct} max={100} size="sm" />
                                    <div className="text-[9px] text-gray-500 mt-0.5">RAM</div>
                                </div>
                                <div className="text-center w-16">
                                    <div className={`text-xs font-mono font-bold ${diskPct > 80 ? 'text-yellow-400' : diskPct > 90 ? 'text-red-400' : 'text-gray-300'}`}>
                                        {diskPct}%
                                    </div>
                                    <ProgressBar value={diskPct} max={100} size="sm" />
                                    <div className="text-[9px] text-gray-500 mt-0.5">Disk</div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Правая часть: протоколы + клиенты */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="hidden sm:flex items-center gap-1">
                            {server.protocols?.map(p => (
                                <span key={p.protocol} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                    p.status === 'active' ? 'bg-green-600/15 text-green-400' : 'bg-dark-600 text-gray-500'
                                }`}>
                                    {p.protocol === 'xray' ? 'Xray' : p.protocol}
                                </span>
                            ))}
                        </div>
                        {server.client_count > 0 && (
                            <span className="text-[11px] text-gray-400">
                                <Wifi className="w-3 h-3 inline mr-0.5" />{server.client_count}
                            </span>
                        )}
                        {server.active_links > 0 && (
                            <span className="text-[11px] text-gray-400">
                                <Link2 className="w-3 h-3 inline mr-0.5" />{server.active_links}
                            </span>
                        )}
                        {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                    </div>
                </div>
            </div>

            {/* Раскрытые детали */}
            {expanded && (
                <div className="border-t border-dark-700 p-4 space-y-4 animate-fade-in">
                    {/* Полные метрики */}
                    {server.status === 'online' && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div>
                                <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                                    <span className="flex items-center gap-1"><Cpu className="w-3 h-3" /> CPU</span>
                                    <span className="font-mono">{cpuPct}%</span>
                                </div>
                                <ProgressBar value={cpuPct} max={100} />
                            </div>
                            <div>
                                <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                                    <span className="flex items-center gap-1"><MemoryStick className="w-3 h-3" /> RAM</span>
                                    <span className="font-mono">{server.ram_used_mb || 0}/{server.ram_total_mb || 0} MB</span>
                                </div>
                                <ProgressBar value={server.ram_used_mb || 0} max={server.ram_total_mb || 1} />
                            </div>
                            <div>
                                <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                                    <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" /> Disk</span>
                                    <span className="font-mono">{server.disk_used_gb || 0}/{server.disk_total_gb || 0} GB</span>
                                </div>
                                <ProgressBar value={server.disk_used_gb || 0} max={server.disk_total_gb || 1} />
                            </div>
                            <div>
                                <div className="text-[11px] text-gray-400 mb-1">
                                    <Clock className="w-3 h-3 inline mr-1" /> Uptime
                                </div>
                                <div className="text-sm text-gray-300 font-mono">{fmtUptime(server.uptime_seconds)}</div>
                            </div>
                        </div>
                    )}

                    {/* Информация */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                        {server.os_info && <div><span className="text-gray-500">ОС:</span> <span className="text-gray-300">{server.os_info}</span></div>}
                        {server.kernel && <div><span className="text-gray-500">Ядро:</span> <span className="text-gray-300">{server.kernel}</span></div>}
                        {server.main_iface && <div><span className="text-gray-500">Интерфейс:</span> <span className="text-gray-300">{server.main_iface}</span></div>}
                        {server.ipv6 && <div><span className="text-gray-500">IPv6:</span> <span className="text-gray-300 truncate">{server.ipv6}</span></div>}
                    </div>

                    {/* Статус сервисов */}
                    {servicesLoading ? (
                        <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                            <Loader2 className="w-3 h-3 animate-spin" /> Загрузка статуса сервисов...
                        </div>
                    ) : services ? (
                        <div className="space-y-3">
                            <h4 className="text-xs font-medium text-gray-400 uppercase">Сервисы</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {/* Agent */}
                                <div className="bg-dark-900/50 rounded-lg p-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-1.5">
                                            <Container className="w-3.5 h-3.5 text-cyan-400" />
                                            <span className="text-xs font-medium text-white">Agent</span>
                                        </div>
                                        <ServiceBadge name={services.agent.healthy ? 'OK' : 'Error'} installed={true} running={services.agent.healthy} />
                                    </div>
                                    <div className="text-[10px] text-gray-500 space-y-0.5">
                                        {services.agent.agentVersion && <div>Версия: {services.agent.agentVersion}</div>}
                                        {services.agent.uptime && <div>Uptime: {fmtUptime(services.agent.uptime)}</div>}
                                        <div>Порт: {services.agent.port}</div>
                                    </div>
                                    <div className="flex gap-1 mt-2">
                                        <button onClick={handleCheckAgent} disabled={!!actionLoading}
                                            className="text-[10px] px-2 py-1 bg-dark-600 text-gray-300 rounded hover:bg-dark-500 disabled:opacity-50">
                                            {actionLoading === 'check' ? <Loader2 className="w-2.5 h-2.5 animate-spin inline" /> : <Activity className="w-2.5 h-2.5 inline" />}
                                            {' '}Health
                                        </button>
                                    </div>
                                </div>

                                {/* Xray */}
                                <div className="bg-dark-900/50 rounded-lg p-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-1.5">
                                            <Shield className="w-3.5 h-3.5 text-purple-400" />
                                            <span className="text-xs font-medium text-white">Xray-core</span>
                                        </div>
                                        <ServiceBadge name={services.xray.running ? 'Active' : services.xray.installed ? 'Stopped' : 'N/A'}
                                            installed={services.xray.installed} running={services.xray.running} />
                                    </div>
                                    <div className="text-[10px] text-gray-500 space-y-0.5">
                                        {services.xray.version && <div>Версия: {services.xray.version}</div>}
                                        {services.xray.pid && <div>PID: {services.xray.pid}</div>}
                                    </div>
                                    {services.xray.installed && (
                                        <div className="flex gap-1 mt-2">
                                            <button onClick={() => handleRestartService('xray')} disabled={!!actionLoading}
                                                className="text-[10px] px-2 py-1 bg-dark-600 text-gray-300 rounded hover:bg-dark-500 disabled:opacity-50">
                                                {actionLoading === 'restart-xray' ? <Loader2 className="w-2.5 h-2.5 animate-spin inline" /> : <RotateCw className="w-2.5 h-2.5 inline" />}
                                                {' '}Restart
                                            </button>
                                            {services.xray.running && (
                                                <button onClick={() => handleStopService('xray')} disabled={!!actionLoading}
                                                    className="text-[10px] px-2 py-1 bg-red-600/10 text-red-400 rounded hover:bg-red-600/20 disabled:opacity-50">
                                                    {actionLoading === 'stop-xray' ? <Loader2 className="w-2.5 h-2.5 animate-spin inline" /> : <Square className="w-2.5 h-2.5 inline" />}
                                                    {' '}Stop
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : server.agent_status === 'active' ? (
                        <button onClick={loadServices} className="text-xs text-blue-400 hover:text-blue-300">
                            Загрузить статус сервисов
                        </button>
                    ) : (
                        <div className="text-xs text-gray-500 bg-dark-900/50 rounded-lg px-3 py-2">
                            <Container className="w-3 h-3 inline mr-1" />
                            Агент не установлен — управление сервисами недоступно
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// =================== Таб: Обзор ===================

function OverviewTab() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const fetchOverview = useCallback(() => {
        monitoring.overview()
            .then(setData)
            .catch(err => toast.error(err.message))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { fetchOverview(); }, [fetchOverview]);

    // Авто-обновление каждые 30 секунд
    useEffect(() => {
        const interval = setInterval(fetchOverview, 30000);
        return () => clearInterval(interval);
    }, [fetchOverview]);

    const handleRefreshAll = async () => {
        setRefreshing(true);
        try {
            const result = await monitoring.refresh();
            toast.success(`Обновлено ${result.refreshed}/${result.total} серверов`);
            fetchOverview();
        } catch (err) { toast.error(err.message); }
        setRefreshing(false);
    };

    if (loading) {
        return <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Загрузка мониторинга...</div>;
    }

    if (!data) return null;
    const { summary, servers } = data;

    return (
        <div className="space-y-6">
            {/* Сводка */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <SummaryCard icon={Server} label="Серверы онлайн" value={`${summary.onlineServers}/${summary.totalServers}`}
                    sub={summary.offlineServers > 0 ? `${summary.offlineServers} офлайн` : undefined}
                    color={summary.offlineServers > 0 ? 'text-yellow-400' : 'text-green-400'} />
                <SummaryCard icon={Container} label="Агенты" value={`${summary.agentsActive}/${summary.agentsTotal}`}
                    color="text-cyan-400" />
                <SummaryCard icon={Wifi} label="VPN клиенты" value={summary.totalClients} color="text-blue-400" />
                <SummaryCard icon={Cpu} label="Средний CPU" value={`${summary.avgCpu}%`}
                    color={summary.avgCpu > 80 ? 'text-yellow-400' : 'text-green-400'} />
                <div className="col-span-2 lg:col-span-1 flex items-center justify-center">
                    <button onClick={handleRefreshAll} disabled={refreshing}
                        className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 w-full justify-center">
                        {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        Обновить все
                    </button>
                </div>
            </div>

            {/* Список серверов */}
            <div className="space-y-2">
                {servers.map(srv => (
                    <MonitorServerCard key={srv.id} server={srv} onRefreshServices={fetchOverview} />
                ))}
            </div>
        </div>
    );
}

// =================== Таб: Здоровье ===================

function HealthTab() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchHealth = useCallback(() => {
        monitoring.health()
            .then(setData)
            .catch(err => toast.error(err.message))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { fetchHealth(); }, [fetchHealth]);

    useEffect(() => {
        const interval = setInterval(fetchHealth, 60000);
        return () => clearInterval(interval);
    }, [fetchHealth]);

    if (loading) {
        return <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Проверка здоровья...</div>;
    }

    if (!data) return null;

    return (
        <div className="space-y-6">
            {/* Общий статус */}
            <div className={`p-4 rounded-xl border ${data.healthy ? 'bg-green-600/5 border-green-600/20' : 'bg-red-600/5 border-red-600/20'}`}>
                <div className="flex items-center gap-3">
                    {data.healthy
                        ? <CheckCircle className="w-6 h-6 text-green-400" />
                        : <AlertCircle className="w-6 h-6 text-red-400" />
                    }
                    <div>
                        <div className={`text-lg font-semibold ${data.healthy ? 'text-green-400' : 'text-red-400'}`}>
                            {data.healthy ? 'Всё работает' : 'Обнаружены проблемы'}
                        </div>
                        <div className="text-xs text-gray-400">
                            {data.problems.filter(p => p.severity === 'error').length} ошибок,{' '}
                            {data.problems.filter(p => p.severity === 'warning').length} предупреждений
                        </div>
                    </div>
                </div>
            </div>

            {/* Проблемы */}
            {data.problems.length > 0 && (
                <div className="space-y-2">
                    <h3 className="text-sm font-medium text-white">Проблемы</h3>
                    {data.problems.map((p, i) => (
                        <div key={i} className="flex items-center gap-3 bg-dark-800 border border-dark-700 rounded-lg px-4 py-3">
                            <SeverityBadge severity={p.severity} />
                            <span className="text-xs font-medium text-gray-300">{p.server}</span>
                            <span className="text-xs text-gray-400">{p.message}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Туннели */}
            <div className="space-y-2">
                <h3 className="text-sm font-medium text-white">Туннели ({data.tunnels.length})</h3>
                {data.tunnels.length === 0 ? (
                    <div className="text-xs text-gray-500 bg-dark-800 border border-dark-700 rounded-lg px-4 py-6 text-center">
                        Нет настроенных туннелей
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {data.tunnels.map(t => (
                            <div key={t.id} className="flex items-center justify-between bg-dark-800 border border-dark-700 rounded-lg px-4 py-3">
                                <div className="flex items-center gap-3">
                                    <Link2 className="w-4 h-4 text-gray-500" />
                                    <span className="text-xs text-white font-medium">{t.from_name}</span>
                                    <ArrowUpDown className="w-3 h-3 text-gray-600" />
                                    <span className="text-xs text-white font-medium">{t.to_name}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${
                                        t.link_type === 'wg' ? 'bg-green-600/15 text-green-400' : 'bg-purple-600/15 text-purple-400'
                                    }`}>{t.link_type}</span>
                                </div>
                                <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                                    t.status === 'active' ? 'bg-green-600/15 text-green-400' : 'bg-red-600/15 text-red-400'
                                }`}>{t.status}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// =================== Таб: Алерты ===================

function AlertsTab() {
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchAlerts = useCallback(() => {
        monitoring.alerts(50)
            .then(setAlerts)
            .catch(err => toast.error(err.message))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

    useEffect(() => {
        const interval = setInterval(fetchAlerts, 30000);
        return () => clearInterval(interval);
    }, [fetchAlerts]);

    if (loading) {
        return <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Загрузка алертов...</div>;
    }

    return (
        <div className="space-y-2">
            {alerts.length === 0 ? (
                <div className="text-center py-12">
                    <CheckCircle className="w-10 h-10 text-green-600 mx-auto mb-3" />
                    <p className="text-gray-400 text-sm">Нет алертов</p>
                </div>
            ) : (
                alerts.map(a => (
                    <div key={a.id} className="flex items-start gap-3 bg-dark-800 border border-dark-700 rounded-lg px-4 py-3">
                        {a.level === 'error'
                            ? <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                            : <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                        }
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <SeverityBadge severity={a.level} />
                                <span className="text-[10px] text-gray-500 px-1.5 py-0.5 bg-dark-700 rounded">{a.category}</span>
                                <span className="text-[10px] text-gray-500">{timeFormat(a.created_at)}</span>
                            </div>
                            <p className="text-xs text-gray-300 mt-1">{a.message}</p>
                        </div>
                    </div>
                ))
            )}
        </div>
    );
}

// =================== Таб: Логи ===================

const LEVEL_STYLES = {
    info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-600/10' },
    warning: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-600/10' },
    error: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-600/10' },
};

const CATEGORIES = ['', 'auth', 'client', 'server', 'system'];

function LogsTab() {
    const [logs, setLogs] = useState([]);
    const [pagination, setPagination] = useState({});
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [level, setLevel] = useState('');
    const [category, setCategory] = useState('');
    const [page, setPage] = useState(1);

    const fetchLogs = useCallback(() => {
        setLoading(true);
        const params = { page, limit: 50 };
        if (search) params.search = search;
        if (level) params.level = level;
        if (category) params.category = category;

        settings.logs(params)
            .then(data => { setLogs(data.logs); setPagination(data.pagination); })
            .catch(err => toast.error(err.message))
            .finally(() => setLoading(false));
    }, [search, level, category, page]);

    useEffect(() => { fetchLogs(); }, [fetchLogs]);

    useEffect(() => {
        const interval = setInterval(fetchLogs, 15000);
        return () => clearInterval(interval);
    }, [fetchLogs]);

    return (
        <div className="space-y-4">
            {/* Фильтры */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => { setSearch(e.target.value); setPage(1); }}
                        className="w-full bg-dark-800 border border-dark-700 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                        placeholder="Поиск в логах..."
                    />
                </div>
                <select
                    value={level}
                    onChange={e => { setLevel(e.target.value); setPage(1); }}
                    className="bg-dark-800 border border-dark-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none"
                >
                    <option value="">Все уровни</option>
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="error">Error</option>
                </select>
                <select
                    value={category}
                    onChange={e => { setCategory(e.target.value); setPage(1); }}
                    className="bg-dark-800 border border-dark-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none"
                >
                    <option value="">Все категории</option>
                    {CATEGORIES.filter(Boolean).map(c => (
                        <option key={c} value={c}>{c}</option>
                    ))}
                </select>
            </div>

            {/* Таблица логов */}
            <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-dark-700">
                                <th className="p-3 text-left text-xs font-medium text-gray-400 w-36">Время</th>
                                <th className="p-3 text-left text-xs font-medium text-gray-400 w-20">Уровень</th>
                                <th className="p-3 text-left text-xs font-medium text-gray-400 w-24">Категория</th>
                                <th className="p-3 text-left text-xs font-medium text-gray-400">Сообщение</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && logs.length === 0 ? (
                                <tr><td colSpan={4} className="p-8 text-center text-gray-500">Загрузка...</td></tr>
                            ) : logs.length === 0 ? (
                                <tr><td colSpan={4} className="p-8 text-center text-gray-500">Нет записей</td></tr>
                            ) : logs.map(log => {
                                const style = LEVEL_STYLES[log.level] || LEVEL_STYLES.info;
                                const Icon = style.icon;
                                return (
                                    <tr key={log.id} className="border-b border-dark-700/50 hover:bg-dark-700/30">
                                        <td className="p-3 text-xs text-gray-400 font-mono whitespace-nowrap">
                                            {timeFormat(log.created_at)}
                                        </td>
                                        <td className="p-3">
                                            <span className={`inline-flex items-center gap-1 text-xs font-medium ${style.color}`}>
                                                <Icon className="w-3 h-3" />
                                                {log.level}
                                            </span>
                                        </td>
                                        <td className="p-3">
                                            <span className="text-xs px-2 py-0.5 rounded bg-dark-700 text-gray-300">
                                                {log.category}
                                            </span>
                                        </td>
                                        <td className="p-3 text-gray-200 text-xs">{log.message}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Пагинация */}
                {pagination.pages > 1 && (
                    <div className="flex items-center justify-between p-3 border-t border-dark-700">
                        <span className="text-xs text-gray-400">Всего: {pagination.total}</span>
                        <div className="flex gap-1">
                            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
                                className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30">
                                Назад
                            </button>
                            <span className="px-3 py-1 text-xs text-gray-300">{page} / {pagination.pages}</span>
                            <button onClick={() => setPage(Math.min(pagination.pages, page + 1))} disabled={page >= pagination.pages}
                                className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30">
                                Далее
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// =================== Основная страница ===================

const TABS = [
    { id: 'overview', label: 'Серверы', icon: Server },
    { id: 'health', label: 'Здоровье', icon: Activity },
    { id: 'alerts', label: 'Алерты', icon: AlertTriangle },
    { id: 'logs', label: 'Логи', icon: Search },
];

export default function Monitoring() {
    const [activeTab, setActiveTab] = useState('overview');

    return (
        <div className="space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-white">Мониторинг</h1>
            </div>

            {/* Табы */}
            <div className="flex gap-1 bg-dark-800 border border-dark-700 rounded-xl p-1">
                {TABS.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-1 justify-center ${
                                isActive
                                    ? 'bg-blue-600/20 text-blue-400'
                                    : 'text-gray-400 hover:text-white hover:bg-dark-700'
                            }`}
                        >
                            <Icon className="w-4 h-4" />
                            <span className="hidden sm:inline">{tab.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* Контент */}
            {activeTab === 'overview' && <OverviewTab />}
            {activeTab === 'health' && <HealthTab />}
            {activeTab === 'alerts' && <AlertsTab />}
            {activeTab === 'logs' && <LogsTab />}
        </div>
    );
}
