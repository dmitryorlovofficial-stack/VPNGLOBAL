// Страница управления серверами — динамический CRUD + мониторинг
import { useState, useEffect, useCallback } from 'react';
import {
    Server, RefreshCw, Power, Cpu, MemoryStick, HardDrive,
    Plus, Edit, Trash2, Search as SearchIcon, Wifi, Link2,
    Loader2, ChevronDown, ChevronUp,
    Container, RotateCw, X, Activity, Globe, Upload, Lock, ShieldCheck
} from 'lucide-react';
import toast from 'react-hot-toast';
import { servers, xray, stubSites } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import ServerModal from '../components/ServerModal';
import InboundModal from '../components/InboundModal';

// Форматирование аптайма
function fmtUptime(sec) {
    if (!sec) return 'н/д';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}д ${h}ч`;
    if (h > 0) return `${h}ч ${m}м`;
    return `${m}м`;
}

// Форматирование байт → человекочитаемый вид
function fmtBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = bytes / Math.pow(k, i);
    return `${val.toFixed(i > 2 ? decimals : 0)} ${sizes[i]}`;
}

// Конвертация метрик из агента (байты → МБ/ГБ для отображения)
function fmtRam(bytes) { return fmtBytes(bytes); }
function fmtDisk(bytes) { return fmtBytes(bytes); }

// Прогресс-бар
function ProgressBar({ value, max }) {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    const color = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-blue-500';
    return (
        <div className="w-full bg-dark-700 rounded-full h-2">
            <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
        </div>
    );
}

// Иконка роли
function RoleBadge({ role }) {
    const styles = {
        node: 'bg-blue-600/20 text-blue-400',
        exit: 'bg-green-600/20 text-green-400',
        gateway: 'bg-yellow-600/20 text-yellow-400',
    };
    const labels = { node: 'Node', exit: 'Exit', gateway: 'Gateway' };
    return (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[role] || styles.node}`}>
            {labels[role] || role}
        </span>
    );
}

// Бейдж протокола
function ProtocolBadge({ protocol, status }) {
    const active = status === 'active';
    const icons = { xui: Link2 };
    const labels = { xui: 'X-UI' };
    const Icon = icons[protocol] || Wifi;
    return (
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
            active ? 'bg-green-600/15 text-green-400' : 'bg-dark-600 text-gray-500'
        }`}>
            <Icon className="w-3 h-3" />
            {labels[protocol] || protocol}
        </span>
    );
}

// Бейдж протокола Xray
function XrayProtoBadge({ protocol }) {
    const colors = {
        vless: 'bg-purple-600/20 text-purple-400',
    };
    const labels = {
        vless: 'VLESS',
    };
    return (
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${colors[protocol] || 'bg-dark-600 text-gray-400'}`}>
            {labels[protocol] || protocol}
        </span>
    );
}

// Xray секция в карточке сервера
function XraySection({ serverId }) {
    const [xrayStatus, setXrayStatus] = useState(null);
    const [inbounds, setInbounds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState('');
    const [showInboundModal, setShowInboundModal] = useState(false);
    const [editInbound, setEditInbound] = useState(null);

    const fetchXray = useCallback(async () => {
        try {
            const [status, ibs] = await Promise.all([
                xray.status(serverId),
                xray.inbounds(serverId).catch(() => []),
            ]);
            setXrayStatus(status);
            setInbounds(ibs);
        } catch {}
        setLoading(false);
    }, [serverId]);

    useEffect(() => { fetchXray(); }, [fetchXray]);

    const handleInstall = async () => {
        if (!confirm('Установить Xray-core на этот сервер?')) return;
        setActionLoading('install');
        try {
            await xray.install(serverId);
            toast.success('Xray-core установлен');
            fetchXray();
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleRestart = async () => {
        setActionLoading('restart');
        try {
            await xray.restart(serverId);
            toast.success('Xray перезапущен');
            fetchXray();
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleDeploy = async () => {
        setActionLoading('deploy');
        try {
            const result = await xray.deployConfig(serverId, true);
            toast.success(result.changed ? 'Конфиг обновлён и задеплоен' : 'Конфиг без изменений');
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleDeleteInbound = async (id) => {
        if (!confirm('Удалить inbound? Клиенты будут откреплены.')) return;
        try {
            await xray.deleteInbound(id);
            toast.success('Inbound удалён');
            fetchXray();
        } catch (err) { toast.error(err.message); }
    };

    if (loading) return <div className="text-xs text-gray-500 py-2">Загрузка Xray...</div>;

    return (
        <div className="space-y-3 border-t border-dark-700 pt-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-purple-400">Xray-core</span>
                    {xrayStatus?.installed ? (
                        <>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                xrayStatus.running ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                            }`}>
                                {xrayStatus.running ? 'Active' : 'Stopped'}
                            </span>
                            {xrayStatus.version && <span className="text-[10px] text-gray-500">v{xrayStatus.version}</span>}
                        </>
                    ) : (
                        <span className="text-[10px] text-gray-500">Не установлен</span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {!xrayStatus?.installed ? (
                        <button
                            onClick={handleInstall}
                            disabled={actionLoading === 'install'}
                            className="text-xs px-2.5 py-1 bg-purple-600/20 text-purple-400 rounded-lg hover:bg-purple-600/30 disabled:opacity-50"
                        >
                            {actionLoading === 'install' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Установить'}
                        </button>
                    ) : (
                        <>
                            <button onClick={handleRestart} disabled={!!actionLoading}
                                className="text-[11px] px-2 py-1 bg-dark-600 text-gray-300 rounded hover:bg-dark-500 disabled:opacity-50">
                                {actionLoading === 'restart' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Restart'}
                            </button>
                            <button onClick={handleDeploy} disabled={!!actionLoading}
                                className="text-[11px] px-2 py-1 bg-dark-600 text-gray-300 rounded hover:bg-dark-500 disabled:opacity-50">
                                {actionLoading === 'deploy' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Deploy'}
                            </button>
                            <button onClick={() => { setEditInbound(null); setShowInboundModal(true); }}
                                className="text-[11px] px-2 py-1 bg-blue-600/20 text-blue-400 rounded hover:bg-blue-600/30">
                                <Plus className="w-3 h-3 inline" /> Inbound
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Список inbounds */}
            {inbounds.length > 0 && (
                <div className="space-y-1.5">
                    {inbounds.map(ib => (
                        <div key={ib.id} className="flex items-center justify-between bg-dark-900/50 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2">
                                <XrayProtoBadge protocol={ib.protocol} />
                                <span className="text-xs text-white font-medium">{ib.tag}</span>
                                <span className="text-[10px] text-gray-500">:{ib.port}</span>
                                <span className="text-[10px] text-gray-500">{ib.clients_count || 0} кл.</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <button onClick={() => { setEditInbound(ib); setShowInboundModal(true); }}
                                    className="p-1 text-gray-500 hover:text-blue-400 rounded">
                                    <Edit className="w-3 h-3" />
                                </button>
                                <button onClick={() => handleDeleteInbound(ib.id)}
                                    className="p-1 text-gray-500 hover:text-red-400 rounded">
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showInboundModal && (
                <InboundModal
                    serverId={serverId}
                    inbound={editInbound}
                    onClose={() => { setShowInboundModal(false); setEditInbound(null); }}
                    onSaved={() => { setShowInboundModal(false); setEditInbound(null); fetchXray(); }}
                />
            )}
        </div>
    );
}

// Бейдж статуса агента
function AgentStatusBadge({ status }) {
    const styles = {
        active: 'bg-green-600/20 text-green-400',
        deploying: 'bg-yellow-600/20 text-yellow-400',
        unreachable: 'bg-red-600/20 text-red-400',
        error: 'bg-red-600/20 text-red-400',
        none: 'bg-dark-600 text-gray-500',
    };
    const labels = {
        active: 'Online',
        deploying: 'Установка...',
        unreachable: 'Не отвечает',
        error: 'Ошибка',
        none: 'Не установлен',
    };
    return (
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${styles[status] || styles.none}`}>
            {labels[status] || status}
        </span>
    );
}

// Agent секция — управление Docker-агентом
function AgentSection({ server, onRefresh }) {
    const [actionLoading, setActionLoading] = useState('');

    const handleDeploy = async () => {
        if (!confirm('Развернуть Docker-агент на этом сервере? Будет установлен Docker (если нет) и запущен контейнер vpn-node-agent.')) return;
        setActionLoading('deploy');
        try {
            const result = await servers.deployAgent(server.id);
            if (result.healthy) {
                toast.success('Агент развёрнут и работает!');
            } else {
                toast.warning('Контейнер запущен, но health check не прошёл');
            }
            onRefresh();
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleCheck = async () => {
        setActionLoading('check');
        try {
            const result = await servers.checkAgent(server.id);
            if (result.ok) {
                toast.success(`Агент OK (v${result.agentVersion || '?'})`);
            } else {
                toast.error(`Агент недоступен: ${result.error || 'timeout'}`);
            }
            onRefresh();
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleUpdate = async () => {
        if (!confirm('Обновить агент? Контейнер будет пересоздан с новым кодом.')) return;
        setActionLoading('update');
        try {
            await servers.updateAgent(server.id);
            toast.success('Агент обновлён');
            onRefresh();
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleRestart = async () => {
        setActionLoading('restart');
        try {
            const result = await servers.restartAgent(server.id);
            if (result.healthy) {
                toast.success('Агент перезапущен и работает!');
            } else {
                toast.warning('Контейнер перезапущен, но health check не прошёл');
            }
            onRefresh();
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleRemove = async () => {
        if (!confirm('Удалить агент с сервера? Контейнер будет остановлен и удалён.')) return;
        setActionLoading('remove');
        try {
            await servers.removeAgent(server.id);
            toast.success('Агент удалён');
            onRefresh();
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const agentStatus = server.agent_status || 'none';

    return (
        <div className="space-y-2 border-t border-dark-700 pt-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Container className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-xs font-medium text-cyan-400">Docker Agent</span>
                    <AgentStatusBadge status={agentStatus} />
                    {server.agent_port && agentStatus !== 'none' && (
                        <span className="text-[10px] text-gray-500">:{server.agent_port}</span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {agentStatus === 'none' ? (
                        <button
                            onClick={handleDeploy}
                            disabled={!!actionLoading}
                            className="text-xs px-2.5 py-1 bg-cyan-600/20 text-cyan-400 rounded-lg hover:bg-cyan-600/30 disabled:opacity-50"
                        >
                            {actionLoading === 'deploy' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : '🚀 Установить'}
                        </button>
                    ) : (
                        <>
                            <button onClick={handleCheck} disabled={!!actionLoading}
                                className="text-[11px] px-2 py-1 bg-dark-600 text-gray-300 rounded hover:bg-dark-500 disabled:opacity-50">
                                {actionLoading === 'check' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : <Activity className="w-3 h-3 inline" />}
                                {' '}Check
                            </button>
                            <button onClick={handleRestart} disabled={!!actionLoading}
                                className="text-[11px] px-2 py-1 bg-yellow-600/15 text-yellow-400 rounded hover:bg-yellow-600/25 disabled:opacity-50">
                                {actionLoading === 'restart' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : <RotateCw className="w-3 h-3 inline" />}
                                {' '}Restart
                            </button>
                            <button onClick={handleUpdate} disabled={!!actionLoading}
                                className="text-[11px] px-2 py-1 bg-dark-600 text-gray-300 rounded hover:bg-dark-500 disabled:opacity-50">
                                {actionLoading === 'update' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : <RotateCw className="w-3 h-3 inline" />}
                                {' '}Update
                            </button>
                            <button onClick={handleRemove} disabled={!!actionLoading}
                                className="text-[11px] px-2 py-1 bg-red-600/10 text-red-400 rounded hover:bg-red-600/20 disabled:opacity-50">
                                {actionLoading === 'remove' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : <X className="w-3 h-3 inline" />}
                                {' '}Remove
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// Stub Site секция — сайт-заглушка для маскировки Xray
function StubSiteSection({ serverId }) {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState('');
    const [showDeploy, setShowDeploy] = useState(false);
    const [templates, setTemplates] = useState([]);
    const [selectedTemplate, setSelectedTemplate] = useState('');
    const [variables, setVariables] = useState({});
    const [customHtml, setCustomHtml] = useState('');
    const [useCustom, setUseCustom] = useState(false);
    const [autoUpdateDest, setAutoUpdateDest] = useState(true);
    // SSL
    const [sslStatus, setSslStatus] = useState(null);
    const [showSslModal, setShowSslModal] = useState(false);
    const [sslDomain, setSslDomain] = useState('');
    const [sslEmail, setSslEmail] = useState('');

    const fetchStatus = useCallback(async () => {
        try {
            const s = await stubSites.status(serverId);
            setStatus(s);
        } catch {}
        setLoading(false);
    }, [serverId]);

    useEffect(() => { fetchStatus(); }, [fetchStatus]);

    // Загрузка SSL статуса
    const fetchSslStatus = useCallback(async () => {
        try {
            const s = await stubSites.sslStatus(serverId);
            setSslStatus(s);
            if (s.domain) setSslDomain(s.domain);
        } catch {}
    }, [serverId]);

    useEffect(() => {
        if (status?.status === 'active') fetchSslStatus();
    }, [status?.status, fetchSslStatus]);

    const handleObtainSSL = async () => {
        if (!sslDomain.trim()) { toast.error('Укажите домен'); return; }
        setActionLoading('ssl');
        try {
            await stubSites.sslObtain(serverId, { domain: sslDomain.trim(), email: sslEmail.trim() || undefined });
            toast.success('SSL-сертификат получен!');
            setShowSslModal(false);
            fetchSslStatus();
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleRenewSSL = async () => {
        setActionLoading('ssl-renew');
        try {
            await stubSites.sslRenew(serverId);
            toast.success('SSL-сертификат обновлён');
            fetchSslStatus();
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const openDeployModal = async () => {
        try {
            const tpls = await stubSites.templates();
            setTemplates(tpls);
            if (tpls.length > 0 && !selectedTemplate) {
                setSelectedTemplate(tpls[0].id);
                setVariables(tpls[0].variables || {});
            }
        } catch (err) { toast.error('Ошибка загрузки шаблонов: ' + err.message); }
        setShowDeploy(true);
    };

    const handleSelectTemplate = (tplId) => {
        setSelectedTemplate(tplId);
        setUseCustom(false);
        const tpl = templates.find(t => t.id === tplId);
        if (tpl) setVariables({ ...tpl.variables });
    };

    const handleDeploy = async () => {
        setActionLoading('deploy');
        try {
            const body = { autoUpdateDest };
            if (useCustom) {
                if (!customHtml.trim()) { toast.error('Введите HTML'); setActionLoading(''); return; }
                body.customFiles = { 'index.html': customHtml };
            } else {
                body.templateId = selectedTemplate;
                body.variables = variables;
            }
            await stubSites.deploy(serverId, body);
            toast.success('Заглушка развёрнута!');
            setShowDeploy(false);
            fetchStatus();
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleRemove = async () => {
        if (!confirm('Удалить сайт-заглушку? Reality dest вернётся к google.com.')) return;
        setActionLoading('remove');
        try {
            await stubSites.remove(serverId);
            toast.success('Заглушка удалена');
            fetchStatus();
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleStop = async () => {
        setActionLoading('stop');
        try {
            await stubSites.stop(serverId);
            toast.success('Nginx остановлен');
            fetchStatus();
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    if (loading) return <div className="text-xs text-gray-500 py-2">Загрузка Stub Site...</div>;

    const isActive = status?.status === 'active' && status?.agent?.running;
    const isStopped = status?.configured && status?.status === 'stopped';
    const templateNames = { business: 'Business Card', blog: 'Tech Blog', landing: 'Landing Page', hosting: 'Hosting Provider', custom: 'Custom HTML' };

    return (
        <div className="space-y-2 border-t border-dark-700 pt-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs font-medium text-amber-400">Stub Site</span>
                    {isActive ? (
                        <>
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-600/20 text-green-400">Active</span>
                            <span className="text-[10px] text-gray-500">{templateNames[status.templateId] || status.templateId}</span>
                            {status.domain && <span className="text-[10px] text-gray-500">{status.domain}</span>}
                        </>
                    ) : isStopped ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-yellow-600/20 text-yellow-400">Stopped</span>
                    ) : (
                        <span className="text-[10px] text-gray-500">Не настроен</span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {isActive ? (
                        <>
                            <button onClick={handleStop} disabled={!!actionLoading}
                                className="text-[11px] px-2 py-1 bg-dark-600 text-gray-300 rounded hover:bg-dark-500 disabled:opacity-50">
                                {actionLoading === 'stop' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Stop'}
                            </button>
                            <button onClick={handleRemove} disabled={!!actionLoading}
                                className="text-[11px] px-2 py-1 bg-red-600/10 text-red-400 rounded hover:bg-red-600/20 disabled:opacity-50">
                                {actionLoading === 'remove' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Remove'}
                            </button>
                        </>
                    ) : isStopped ? (
                        <>
                            <button onClick={openDeployModal}
                                className="text-[11px] px-2 py-1 bg-amber-600/20 text-amber-400 rounded hover:bg-amber-600/30">
                                Переразвернуть
                            </button>
                            <button onClick={handleRemove} disabled={!!actionLoading}
                                className="text-[11px] px-2 py-1 bg-red-600/10 text-red-400 rounded hover:bg-red-600/20 disabled:opacity-50">
                                Remove
                            </button>
                        </>
                    ) : (
                        <button onClick={openDeployModal}
                            className="text-xs px-2.5 py-1 bg-amber-600/20 text-amber-400 rounded-lg hover:bg-amber-600/30">
                            Развернуть
                        </button>
                    )}
                </div>
            </div>

            {/* SSL-секция (когда stub site активен) */}
            {isActive && (
                <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-2">
                        <Lock className="w-3 h-3 text-gray-500" />
                        {sslStatus?.enabled ? (
                            <>
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-600/20 text-green-400">
                                    SSL {'\u2713'}
                                </span>
                                <span className="text-[10px] text-gray-500">{sslStatus.domain}</span>
                                {sslStatus.daysLeft != null && (
                                    <span className={`text-[10px] ${sslStatus.daysLeft < 14 ? 'text-yellow-400' : 'text-gray-500'}`}>
                                        ({sslStatus.daysLeft}д)
                                    </span>
                                )}
                            </>
                        ) : (
                            <span className="text-[10px] text-gray-500">SSL не настроен</span>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        {sslStatus?.enabled ? (
                            <button onClick={handleRenewSSL} disabled={!!actionLoading}
                                className="text-[11px] px-2 py-1 bg-dark-600 text-gray-300 rounded hover:bg-dark-500 disabled:opacity-50">
                                {actionLoading === 'ssl-renew' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Обновить SSL'}
                            </button>
                        ) : (
                            <button onClick={() => { setSslDomain(status?.domain || ''); setShowSslModal(true); }}
                                className="text-[11px] px-2 py-1 bg-green-600/20 text-green-400 rounded hover:bg-green-600/30">
                                Получить SSL
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Модалка получения SSL */}
            {showSslModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowSslModal(false)}>
                    <div className="bg-dark-800 border border-dark-700 rounded-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-dark-700 flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                <ShieldCheck className="w-5 h-5 text-green-400" /> SSL-сертификат
                            </h3>
                            <button onClick={() => setShowSslModal(false)} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-5 space-y-3">
                            <div>
                                <label className="text-xs text-gray-400 block mb-1">Домен</label>
                                <input
                                    type="text"
                                    value={sslDomain}
                                    onChange={e => setSslDomain(e.target.value)}
                                    className="w-full bg-dark-900 border border-dark-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500/50"
                                    placeholder="example.com"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-gray-400 block mb-1">Email (опционально)</label>
                                <input
                                    type="email"
                                    value={sslEmail}
                                    onChange={e => setSslEmail(e.target.value)}
                                    className="w-full bg-dark-900 border border-dark-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500/50"
                                    placeholder="admin@example.com"
                                />
                            </div>
                            <p className="text-[11px] text-gray-500">
                                DNS домена должен указывать на этот сервер. Certbot получит сертификат через webroot (nginx не останавливается).
                            </p>
                        </div>
                        <div className="p-5 border-t border-dark-700 flex justify-end gap-2">
                            <button onClick={() => setShowSslModal(false)}
                                className="px-4 py-2 bg-dark-700 text-gray-300 rounded-lg text-sm hover:bg-dark-600">
                                Отмена
                            </button>
                            <button onClick={handleObtainSSL} disabled={actionLoading === 'ssl'}
                                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                                {actionLoading === 'ssl' ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
                                Получить
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Модалка деплоя */}
            {showDeploy && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowDeploy(false)}>
                    <div className="bg-dark-800 border border-dark-700 rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-dark-700 flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-white">Сайт-заглушка</h3>
                            <button onClick={() => setShowDeploy(false)} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
                        </div>

                        <div className="p-5 space-y-4">
                            {/* Выбор: шаблон или кастом */}
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setUseCustom(false)}
                                    className={`flex-1 text-sm py-2 rounded-lg font-medium transition-colors ${!useCustom ? 'bg-amber-600/20 text-amber-400 border border-amber-600/30' : 'bg-dark-700 text-gray-400 border border-dark-600'}`}
                                >
                                    Шаблоны
                                </button>
                                <button
                                    onClick={() => setUseCustom(true)}
                                    className={`flex-1 text-sm py-2 rounded-lg font-medium transition-colors ${useCustom ? 'bg-amber-600/20 text-amber-400 border border-amber-600/30' : 'bg-dark-700 text-gray-400 border border-dark-600'}`}
                                >
                                    <Upload className="w-3.5 h-3.5 inline mr-1" /> Свой HTML
                                </button>
                            </div>

                            {!useCustom ? (
                                <>
                                    {/* Сетка шаблонов */}
                                    <div className="grid grid-cols-2 gap-2">
                                        {templates.map(tpl => (
                                            <button
                                                key={tpl.id}
                                                onClick={() => handleSelectTemplate(tpl.id)}
                                                className={`text-left p-3 rounded-lg border transition-colors ${
                                                    selectedTemplate === tpl.id
                                                        ? 'border-amber-500/50 bg-amber-600/10'
                                                        : 'border-dark-600 bg-dark-700/50 hover:border-dark-500'
                                                }`}
                                            >
                                                <div className="text-sm font-medium text-white">{tpl.name}</div>
                                                <div className="text-[11px] text-gray-500 mt-0.5">{tpl.description}</div>
                                            </button>
                                        ))}
                                    </div>

                                    {/* Переменные шаблона */}
                                    {Object.keys(variables).length > 0 && (
                                        <div className="space-y-2">
                                            <div className="text-xs font-medium text-gray-400">Переменные шаблона</div>
                                            {Object.entries(variables).map(([key, val]) => (
                                                <div key={key}>
                                                    <label className="text-[11px] text-gray-500 block mb-0.5">{key}</label>
                                                    <input
                                                        type="text"
                                                        value={val}
                                                        onChange={e => setVariables(prev => ({ ...prev, [key]: e.target.value }))}
                                                        className="w-full bg-dark-900 border border-dark-600 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500/50"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            ) : (
                                /* Кастомный HTML */
                                <div>
                                    <label className="text-xs font-medium text-gray-400 block mb-1">HTML-код (index.html)</label>
                                    <textarea
                                        value={customHtml}
                                        onChange={e => setCustomHtml(e.target.value)}
                                        rows={10}
                                        className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-amber-500/50 resize-y"
                                        placeholder="<!DOCTYPE html>\n<html>\n<head><title>My Site</title></head>\n<body>\n  <h1>Hello</h1>\n</body>\n</html>"
                                    />
                                </div>
                            )}

                            {/* Чекбокс Reality dest */}
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={autoUpdateDest}
                                    onChange={e => setAutoUpdateDest(e.target.checked)}
                                    className="w-4 h-4 rounded border-dark-600 bg-dark-900 text-amber-500 focus:ring-amber-500/30"
                                />
                                <span className="text-sm text-gray-300">Обновить Reality dest на локальный nginx</span>
                            </label>
                            <p className="text-[11px] text-gray-500 -mt-2 ml-6">
                                Xray Reality будет перенаправлять не-VPN запросы на этот сайт вместо google.com
                            </p>
                        </div>

                        <div className="p-5 border-t border-dark-700 flex justify-end gap-2">
                            <button onClick={() => setShowDeploy(false)}
                                className="px-4 py-2 bg-dark-700 text-gray-300 rounded-lg text-sm hover:bg-dark-600">
                                Отмена
                            </button>
                            <button
                                onClick={handleDeploy}
                                disabled={actionLoading === 'deploy'}
                                className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
                            >
                                {actionLoading === 'deploy' ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
                                Развернуть
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Карточка сервера (раскрываемая)
function ServerCard({ server, onEdit, onDelete, onRefresh }) {
    const [expanded, setExpanded] = useState(false);
    const [metrics, setMetrics] = useState(null);
    const [metricsLoading, setMetricsLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState('');

    const isDeploying = server.agent_status === 'deploying';

    // Загружаем метрики при раскрытии
    const loadMetrics = useCallback(async () => {
        if (metricsLoading) return;
        setMetricsLoading(true);
        try {
            const m = await servers.metrics(server.id);
            setMetrics(m);
        } catch (err) {
            setMetrics({ error: err.message });
        }
        setMetricsLoading(false);
    }, [server.id, metricsLoading]);

    const handleExpand = () => {
        const next = !expanded;
        setExpanded(next);
        if (next && !metrics) loadMetrics();
    };

    const handleReboot = async () => {
        if (!confirm(`Перезагрузить сервер "${server.name}"? Это может занять несколько минут.`)) return;
        setActionLoading('reboot');
        try {
            await servers.reboot(server.id);
            toast.success('Сервер перезагружается...');
        } catch (err) { toast.error(err.message); }
        setActionLoading('');
    };

    const handleDelete = () => {
        if (server.client_count > 0) {
            if (!confirm(`На сервере есть клиенты (VPN: ${server.client_count}). Удалить?`)) return;
        } else {
            if (!confirm(`Удалить сервер "${server.name}"?`)) return;
        }
        onDelete(server.id);
    };

    return (
        <div className="bg-dark-800 border border-dark-700 rounded-xl overflow-hidden">
            {/* Заголовок — всегда видим */}
            <div
                className="p-5 cursor-pointer hover:bg-dark-700/30 transition-colors"
                onClick={handleExpand}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className={`p-2.5 rounded-lg flex-shrink-0 ${
                            server.status === 'online' ? 'bg-green-600/20' : 'bg-dark-600'
                        }`}>
                            <Server className={`w-5 h-5 ${
                                server.status === 'online' ? 'text-green-400' : 'text-gray-500'
                            }`} />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="text-sm font-semibold text-white truncate">{server.name}</h3>
                                <RoleBadge role={server.role} />
                            </div>
                            <div className="flex items-center gap-3 mt-0.5">
                                <p className="text-xs text-gray-400">
                                    {server.domain && <span className="text-blue-400 mr-2">{server.domain}</span>}
                                    {server.host || server.ipv4 || '—'}
                                    {server.ipv6 && <span className="ml-2 text-gray-500">{server.ipv6}</span>}
                                </p>
                                {server.description && (
                                    <p className="text-xs text-gray-500 truncate max-w-[200px]">{server.description}</p>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                        {/* Протоколы */}
                        <div className="hidden sm:flex items-center gap-1.5">
                            {server.protocols?.map(p => (
                                <ProtocolBadge key={p.protocol} protocol={p.protocol} status={p.status} />
                            ))}
                        </div>

                        {/* Счётчики */}
                        <div className="hidden md:flex items-center gap-3 text-xs text-gray-400">
                            <span title="VPN-клиенты"><Wifi className="w-3 h-3 inline mr-1" />{server.client_count || 0}</span>
                            {server.link_count > 0 && (
                                <span title="Связи"><Link2 className="w-3 h-3 inline mr-1" />{server.link_count}</span>
                            )}
                        </div>

                        {isDeploying && (
                            <span className="flex items-center gap-1.5 text-[11px] text-yellow-400 bg-yellow-600/10 px-2 py-1 rounded-lg animate-pulse">
                                <Loader2 className="w-3 h-3 animate-spin" /> Настройка...
                            </span>
                        )}
                        <StatusBadge status={server.status} />
                        {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                    </div>
                </div>
            </div>

            {/* Раскрытая секция */}
            {expanded && (
                <div className="border-t border-dark-700 p-5 space-y-4 animate-fade-in">
                    {/* Метрики */}
                    {metricsLoading ? (
                        <div className="flex items-center justify-center py-4 text-gray-500 text-sm">
                            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Загрузка метрик...
                        </div>
                    ) : metrics && !metrics.error ? (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                                <div className="flex justify-between text-xs text-gray-400 mb-1">
                                    <span className="flex items-center gap-1"><Cpu className="w-3 h-3" /> CPU</span>
                                    <span>{metrics.cpu}%</span>
                                </div>
                                <ProgressBar value={metrics.cpu} max={100} />
                            </div>
                            <div>
                                <div className="flex justify-between text-xs text-gray-400 mb-1">
                                    <span className="flex items-center gap-1"><MemoryStick className="w-3 h-3" /> RAM</span>
                                    <span>{fmtRam(metrics.ram?.used)} / {fmtRam(metrics.ram?.total)}</span>
                                </div>
                                <ProgressBar value={metrics.ram?.used || 0} max={metrics.ram?.total || 1} />
                            </div>
                            <div>
                                <div className="flex justify-between text-xs text-gray-400 mb-1">
                                    <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" /> Disk</span>
                                    <span>{fmtDisk(metrics.disk?.used)} / {fmtDisk(metrics.disk?.total)}</span>
                                </div>
                                <ProgressBar value={metrics.disk?.used || 0} max={metrics.disk?.total || 1} />
                            </div>
                        </div>
                    ) : metrics?.error ? (
                        <div className="text-xs text-red-400 bg-red-600/10 px-3 py-2 rounded-lg">
                            Ошибка метрик: {metrics.error}
                        </div>
                    ) : null}

                    {/* Информация о сервере */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        {server.os_info && (
                            <div><span className="text-gray-500">ОС:</span> <span className="text-gray-300">{server.os_info}</span></div>
                        )}
                        {server.kernel && (
                            <div><span className="text-gray-500">Ядро:</span> <span className="text-gray-300">{server.kernel}</span></div>
                        )}
                        {server.main_iface && <div><span className="text-gray-500">Интерфейс:</span> <span className="text-gray-300">{server.main_iface}</span></div>}
                        {metrics?.uptime && (
                            <div><span className="text-gray-500">Аптайм:</span> <span className="text-gray-300">{fmtUptime(metrics.uptime)}</span></div>
                        )}
                    </div>

                    {/* Протоколы (мобильная версия) */}
                    <div className="sm:hidden flex flex-wrap gap-1.5">
                        {server.protocols?.map(p => (
                            <ProtocolBadge key={p.protocol} protocol={p.protocol} status={p.status} />
                        ))}
                    </div>

                    {/* Xray секция */}
                    <XraySection serverId={server.id} />

                    {/* Stub Site секция */}
                    <StubSiteSection serverId={server.id} />

                    {/* Docker Agent секция */}
                    <AgentSection server={server} onRefresh={onRefresh} />

                    {/* Кнопки управления */}
                    <div className="flex flex-wrap gap-2 border-t border-dark-700 pt-4">
                        <button
                            onClick={() => onEdit(server)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-700 text-gray-300 rounded-lg text-xs hover:bg-dark-600 transition-colors"
                        >
                            <Edit className="w-3 h-3" /> Изменить
                        </button>

                        <div className="flex-1" />

                        <button
                            onClick={handleReboot}
                            disabled={actionLoading === 'reboot'}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-600/20 text-yellow-400 rounded-lg text-xs hover:bg-yellow-600/30 transition-colors disabled:opacity-50"
                        >
                            {actionLoading === 'reboot' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
                            Перезагрузка
                        </button>
                        <button
                            onClick={handleDelete}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/20 text-red-400 rounded-lg text-xs hover:bg-red-600/30 transition-colors"
                        >
                            <Trash2 className="w-3 h-3" /> Удалить
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function Servers() {
    const [serverList, setServerList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editServer, setEditServer] = useState(null);

    const fetchServers = useCallback(() => {
        servers.list()
            .then(data => setServerList(data))
            .catch(err => toast.error(err.message))
            .finally(() => setLoading(false));
    }, []);

    // Быстрее обновляем если есть серверы в процессе настройки
    const hasDeploying = serverList.some(s => s.agent_status === 'deploying');
    useEffect(() => {
        fetchServers();
        const interval = setInterval(fetchServers, hasDeploying ? 5000 : 30000);
        return () => clearInterval(interval);
    }, [fetchServers, hasDeploying]);

    const handleDelete = async (id) => {
        try {
            await servers.remove(id);
            toast.success('Сервер удалён');
            fetchServers();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleEdit = (server) => {
        setEditServer(server);
        setShowModal(true);
    };

    const handleSaved = () => {
        setShowModal(false);
        setEditServer(null);
        fetchServers();
    };

    // Фильтрация
    const filtered = serverList.filter(s => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
            s.name?.toLowerCase().includes(q) ||
            s.host?.toLowerCase().includes(q) ||
            s.ipv4?.toLowerCase().includes(q) ||
            s.ipv6?.toLowerCase().includes(q) ||
            s.domain?.toLowerCase().includes(q) ||
            s.description?.toLowerCase().includes(q) ||
            s.role?.toLowerCase().includes(q)
        );
    });

    // Статистика
    const stats = {
        total: serverList.length,
        online: serverList.filter(s => s.status === 'online').length,
        totalClients: serverList.reduce((sum, s) => sum + (s.client_count || 0), 0),
    };

    if (loading) {
        return <div className="flex items-center justify-center h-64 text-gray-500">Загрузка серверов...</div>;
    }

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Заголовок */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Серверы</h1>
                    <p className="text-sm text-gray-400 mt-0.5">
                        {stats.online}/{stats.total} онлайн
                        {stats.totalClients > 0 && <span className="ml-3">VPN: {stats.totalClients}</span>}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={fetchServers}
                        className="flex items-center gap-2 px-3 py-2 bg-dark-700 text-gray-300 rounded-lg text-sm hover:bg-dark-600"
                    >
                        <RefreshCw className="w-4 h-4" /> Обновить
                    </button>
                    <button
                        onClick={() => { setEditServer(null); setShowModal(true); }}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                    >
                        <Plus className="w-4 h-4" /> Добавить сервер
                    </button>
                </div>
            </div>

            {/* Поиск */}
            {serverList.length > 3 && (
                <div className="relative">
                    <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full bg-dark-800 border border-dark-700 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                        placeholder="Поиск по имени, IP, описанию..."
                    />
                </div>
            )}

            {/* Список серверов */}
            {filtered.length === 0 ? (
                <div className="text-center py-12">
                    <Server className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400">
                        {search ? 'Серверы не найдены' : 'Нет серверов'}
                    </p>
                    {!search && (
                        <button
                            onClick={() => setShowModal(true)}
                            className="mt-3 text-sm text-blue-400 hover:text-blue-300"
                        >
                            Добавить первый сервер
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map(server => (
                        <ServerCard
                            key={server.id}
                            server={server}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onRefresh={fetchServers}
                        />
                    ))}
                </div>
            )}

            {/* Модалка добавления/редактирования */}
            {showModal && (
                <ServerModal
                    server={editServer}
                    onClose={() => { setShowModal(false); setEditServer(null); }}
                    onSaved={handleSaved}
                />
            )}
        </div>
    );
}
